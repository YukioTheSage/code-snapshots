// New file: src/ui/snapshotContextInput.ts
import path = require('path');
import * as vscode from 'vscode';
import { GitignoreParser } from 'codelapse-core';
import { getSnapshotLocation } from '../config';

export interface SnapshotContextOptions {
  description: string;
  tags: string[];
  notes: string;
  taskReference: string;
  isFavorite: boolean;
  isSelective: boolean; // Flag to indicate if only specific files are included
  selectedFiles: string[]; // Relative paths of selected files (when isSelective is true)
}

/**
 * Lists files the snapshot engine will actually include.
 *
 * Uses the same `GitignoreParser` that `takeSnapshotInternal` uses, so the
 * picker cannot offer a file the engine then filters out. The previous
 * implementation hardcoded `**\/node_modules/**` and ignored `.gitignore`, so a
 * user could select build output and end up with a snapshot containing none of
 * their selections.
 *
 * Paths are returned with the platform's own separator, because the engine
 * matches the selection set against `path.relative(...)`. Normalising to
 * forward slashes here looks tidier and silently drops every selection on
 * Windows: `selectedPathsSet.has('src\\a.ts')` is false for `'src/a.ts'`, so a
 * selective snapshot would contain nothing at all.
 */
export async function listSelectableFiles(
  workspaceRoot: string,
): Promise<string[]> {
  // The configured store location: the picker must not offer the store's own
  // files, which the engine (using the same configured location) will refuse.
  const parser = new GitignoreParser(workspaceRoot, getSnapshotLocation());
  const initial = await vscode.workspace.findFiles(
    '**/*',
    parser.getExcludeGlobPattern(),
  );

  const seen = new Set<string>();
  for (const uri of initial) {
    const relative = path.relative(workspaceRoot, uri.fsPath);
    if (!relative || relative.startsWith('..')) {
      continue;
    }
    if (!parser.shouldIgnore(relative)) {
      seen.add(relative);
    }
  }

  return [...seen].sort();
}

export class SnapshotContextInput {
  public static async show(
    initialDescription = '',
  ): Promise<SnapshotContextOptions | undefined> {
    // Initial quickpick to select context level
    const contextLevel = await vscode.window.showQuickPick(
      [
        { label: 'Quick Snapshot', description: 'Include all files' },
        {
          label: 'Detailed Snapshot',
          description: 'Add tags, notes, and more',
        },
        {
          label: 'Selective Snapshot',
          description: 'Choose specific files to include',
        },
      ],
      {
        placeHolder: 'Select snapshot type',
        title: 'Take Snapshot',
        // Without this, clicking away silently discards a half-completed
        // wizard and the take reports as cancelled.
        ignoreFocusOut: true,
      },
    );

    if (!contextLevel) {
      return undefined; // User cancelled
    }

    // Get the description regardless of context level
    const description = await vscode.window.showInputBox({
      prompt: 'Enter a description for this snapshot',
      placeHolder: 'E.g., "Implemented login feature"',
      value: initialDescription,
      ignoreFocusOut: true,
    });

    if (description === undefined) {
      return undefined; // User cancelled
    }

    // Default response with empty values
    const result: SnapshotContextOptions = {
      description: description || '', // Default to empty string if null
      tags: [],
      notes: '',
      taskReference: '',
      isFavorite: false,
      isSelective: contextLevel.label === 'Selective Snapshot',
      selectedFiles: [],
    };

    // For selective snapshot, let the user pick files
    if (contextLevel.label === 'Selective Snapshot') {
      // Guard against missing workspace
      if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders.length === 0
      ) {
        vscode.window.showErrorMessage('No workspace folder found');
        return undefined;
      }
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

      const files = await listSelectableFiles(workspaceRoot);

      if (files.length === 0) {
        vscode.window.showWarningMessage(
          'No files in this workspace are eligible for a snapshot. Check .gitignore and the snapshotLocation setting.',
        );
        return undefined;
      }

      // Create QuickPick items from files
      const fileItems = files.map((relativePath) => ({
        label: relativePath,
        picked: false, // Initially not selected
      }));

      // Show multi-select QuickPick
      const selectedItems = await vscode.window.showQuickPick(fileItems, {
        canPickMany: true,
        placeHolder:
          'Select files to include in this snapshot (files not selected will be ignored)',
        title: 'Select Files for Snapshot',
        ignoreFocusOut: true,
      });

      if (selectedItems === undefined) {
        return undefined; // User cancelled
      }

      // Store selected file paths
      result.selectedFiles = selectedItems.map((item) => item.label);

      if (result.selectedFiles.length === 0) {
        const continueAnyway = await vscode.window.showWarningMessage(
          'No files selected. Take snapshot of all files instead?',
          'Yes',
          'No',
        );

        if (continueAnyway === 'Yes') {
          result.isSelective = false; // Revert to full snapshot
        } else {
          return undefined; // User cancelled after warning
        }
      }
    }

    // If quick snapshot, return just the description
    if (contextLevel.label === 'Quick Snapshot') {
      return result;
    }

    // For detailed or selective snapshot, collect additional fields
    // 1. Tags input
    const tagsInput = await vscode.window.showInputBox({
      prompt: 'Enter tags (comma-separated)',
      placeHolder: 'E.g., "feature, login, authentication"',
      ignoreFocusOut: true,
    });

    if (tagsInput === undefined) {
      return undefined; // User cancelled
    }

    // Parse tags, removing empty ones and trimming whitespace
    result.tags = tagsInput
      ? tagsInput
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      : [];

    // Continue with other inputs as in the original implementation...
    // 2. Task reference
    const taskRef = await vscode.window.showInputBox({
      prompt: 'Enter associated task/issue reference (optional)',
      placeHolder: 'E.g., "JIRA-123" or "Issue #42"',
      ignoreFocusOut: true,
    });

    if (taskRef === undefined) {
      return undefined; // User cancelled
    }

    result.taskReference = taskRef || '';

    // 3. Additional notes
    const notes = await vscode.window.showInputBox({
      prompt: 'Enter additional notes (optional)',
      placeHolder: 'E.g., "Fixed edge cases with validation"',
      ignoreFocusOut: true,
    });

    if (notes === undefined) {
      return undefined; // User cancelled
    }

    result.notes = notes || '';

    // 4. Favorite marking
    const favoriteResponse = await vscode.window.showQuickPick(['No', 'Yes'], {
      placeHolder: 'Mark this snapshot as a favorite?',
      ignoreFocusOut: true,
    });

    if (favoriteResponse === undefined) {
      return undefined; // User cancelled
    }

    result.isFavorite = favoriteResponse === 'Yes';

    return result;
  }
}
