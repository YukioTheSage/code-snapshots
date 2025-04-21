// New file: src/ui/snapshotContextInput.ts
import path = require('path');
import * as vscode from 'vscode';

export interface SnapshotContextOptions {
  description: string;
  tags: string[];
  notes: string;
  taskReference: string;
  isFavorite: boolean;
  isSelective: boolean; // Flag to indicate if only specific files are included
  selectedFiles: string[]; // Relative paths of selected files (when isSelective is true)
}

export class SnapshotContextInput {
  /**
   * Opens a multi-step input process to collect enhanced context for a snapshot
   * @returns The collected context options, or undefined if cancelled
   */
  // Add method to get workspace files using VS Code API
  private static async getWorkspaceFiles(): Promise<vscode.Uri[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    // Fetch files using same ignore patterns as the snapshot functionality
    // Note: We're simplifying the ignore pattern handling here
    const files = await vscode.workspace.findFiles(
      '**/*',
      '{**/node_modules/**,**/.git/**,**/.snapshots/**}',
    );

    return files;
  }

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
      // Get workspace files
      const files = await this.getWorkspaceFiles();

      // Guard against missing workspace
      if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders.length === 0
      ) {
        vscode.window.showErrorMessage('No workspace folder found');
        return undefined;
      }
      const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;

      // Create QuickPick items from files
      const fileItems = files.map((file) => {
        const relativePath = path.relative(workspaceRoot, file.fsPath);
        return {
          label: relativePath,
          picked: false, // Initially not selected
        };
      });

      // Sort alphabetically for easier selection
      fileItems.sort((a, b) => a.label.localeCompare(b.label));

      // Show multi-select QuickPick
      const selectedItems = await vscode.window.showQuickPick(fileItems, {
        canPickMany: true,
        placeHolder:
          'Select files to include in this snapshot (files not selected will be ignored)',
        title: 'Select Files for Snapshot',
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
    });

    if (taskRef === undefined) {
      return undefined; // User cancelled
    }

    result.taskReference = taskRef || '';

    // 3. Additional notes
    const notes = await vscode.window.showInputBox({
      prompt: 'Enter additional notes (optional)',
      placeHolder: 'E.g., "Fixed edge cases with validation"',
    });

    if (notes === undefined) {
      return undefined; // User cancelled
    }

    result.notes = notes || '';

    // 4. Favorite marking
    const favoriteResponse = await vscode.window.showQuickPick(['No', 'Yes'], {
      placeHolder: 'Mark this snapshot as a favorite?',
    });

    if (favoriteResponse === undefined) {
      return undefined; // User cancelled
    }

    result.isFavorite = favoriteResponse === 'Yes';

    return result;
  }
}
