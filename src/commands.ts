import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SnapshotManager, TakeSnapshotOutcome } from './snapshotManager';
import { SnapshotQuickPick } from './ui/quickPick';
import { SnapshotTreeDataProvider, SnapshotTreeItem } from './ui/treeView';
import { SnapshotContentProvider } from './snapshotContentProvider';
import { SnapshotContextInput } from './ui/snapshotContextInput';
import { log, logVerbose, showOutputChannel } from './logger';
import { ChangeNotifier } from './changeNotifier';
import { API as GitAPI, CommitOptions } from './types/git.d';
import { AutoSnapshotRulesUI } from './ui/autoSnapshotRulesUI';
import { SemanticSearchService } from './services/semanticSearchService';
import { SemanticSearchWebview } from './ui/semanticSearchWebview';
import { throwIfCancelled, isCancellationError } from './utils/cancellation';
import { ACTIVE_NONE } from './snapshotSelection';
import { AnimationHelpers } from './utils';
import { getUxSettings } from './config';

// Structure to hold dependencies passed from activate
export interface CommandDependencies {
  // Export the interface
  context: vscode.ExtensionContext;
  snapshotManager: SnapshotManager;
  snapshotQuickPick: SnapshotQuickPick;
  snapshotTreeDataProvider: SnapshotTreeDataProvider;
  autoSnapshotTreeDataProvider: SnapshotTreeDataProvider;
  changeNotifier: ChangeNotifier; // Add changeNotifier type
  semanticSearchService: SemanticSearchService;
  gitApi: GitAPI | null; // Add Git API
  semanticSearchWebview: SemanticSearchWebview;
}

/**
 * Registers all commands for the extension.
 * @param deps - Dependencies needed by the commands.
 */
export function registerCommands(deps: CommandDependencies): void {
  log('Registering commands...');

  registerTakeSnapshotCommand(deps);
  registerViewSnapshotsCommand(deps);
  registerJumpToSnapshotCommand(deps);
  registerPreviousSnapshotCommand(deps);
  registerNextSnapshotCommand(deps);
  registerTreeViewCommands(deps);
  registerFilterCommand(deps);
  registerCreateGitCommitCommand(deps);
  registerDiagnosticCommand(deps);
  registerManageAutoSnapshotRulesCommand(deps);
  registerToggleChangedFilesCommand(deps);
  registerFocusViewCommands(deps);
  registerSemanticIndexCommand(deps);
  registerSemanticSearchCommand(deps);
  registerShowLogsCommand(deps);

  log('All commands registered.');
}

// --- Individual Command Registration Functions ---

/**
 * Registers the two "focus this view" commands.
 *
 * VS Code generates `<viewId>.focus` for every view declared in
 * `contributes.views`. The previous implementation registered an id that was
 * never contributed and targeted a workbench command that does not exist, so
 * the two ids the manifest actually declares reported "command not found".
 */
function registerFocusViewCommands({ context }: CommandDependencies): void {
  log('Registering focus view commands...');

  const manual = vscode.commands.registerCommand(
    'vscode-snapshots.focusManualSnapshotView',
    async () => {
      // Both views declare `when: workspaceFolderCount > 0`, so with no folder
      // open there is no view to focus and executeCommand would do nothing
      // silently. Say so instead.
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showInformationMessage(
          'Open a folder to use the CodeLapse snapshot views.',
        );
        return;
      }
      await vscode.commands.executeCommand('manualSnapshotHistoryView.focus');
    },
  );

  const auto = vscode.commands.registerCommand(
    'vscode-snapshots.focusAutoSnapshotView',
    async () => {
      if (!vscode.workspace.workspaceFolders?.length) {
        vscode.window.showInformationMessage(
          'Open a folder to use the CodeLapse snapshot views.',
        );
        return;
      }
      await vscode.commands.executeCommand('autoSnapshotHistoryView.focus');
    },
  );

  context.subscriptions.push(manual, auto);
  log('Focus view commands registered successfully');
}

function registerManageAutoSnapshotRulesCommand({
  context,
}: CommandDependencies): void {
  log('Registering manageAutoSnapshotRules command...');
  const manageRulesCmd = vscode.commands.registerCommand(
    'vscode-snapshots.manageAutoSnapshotRules',
    async () => {
      log('manageAutoSnapshotRules command executed');
      await AutoSnapshotRulesUI.show();
    },
  );
  context.subscriptions.push(manageRulesCmd);
  log('manageAutoSnapshotRules command registered successfully');
}

function registerTakeSnapshotCommand({
  context,
  snapshotManager,
  changeNotifier,
}: CommandDependencies): void {
  log('Registering takeSnapshot command...');
  const takeSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.takeSnapshot',
    async () => {
      // Use the new context input UI
      const contextOptions = await SnapshotContextInput.show();

      // If user cancelled, exit
      if (!contextOptions) {
        return undefined;
      }

      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Taking Snapshot...',
          cancellable: true,
        },
        async (progress, token) => {
          try {
            log('takeSnapshot command execution started');

            // Initialize progress
            progress.report({
              message: 'Initializing...',
              increment: 5,
            });

            // Cancellation is checked at the await boundaries below. A listener
            // that throws cannot interrupt the work: its return value is
            // discarded, so the throw lands in the emitter's dispatch frame and
            // the operation runs to completion while the UI says it was
            // cancelled. See utils/cancellation.ts.
            throwIfCancelled(token);

            // Scanning workspace files stage
            progress.report({
              message: contextOptions.isSelective
                ? `Preparing ${contextOptions.selectedFiles.length} selected files...`
                : 'Scanning workspace files...',
              increment: 15,
            });

            // Processing files stage
            progress.report({
              message: 'Processing files...',
              increment: 30,
            });

            // Saving stage
            progress.report({
              message: 'Saving snapshot data...',
              increment: 25,
            });

            // Take the actual snapshot - core operation
            const outcome = await snapshotManager.takeSnapshot(
              contextOptions.description,
              {
                tags: contextOptions.tags,
                notes: contextOptions.notes,
                taskReference: contextOptions.taskReference,
                isFavorite: contextOptions.isFavorite,
                isSelective: contextOptions.isSelective,
                selectedFiles: contextOptions.selectedFiles,
              },
            );

            throwIfCancelled(token);

            // Finalizing stage
            progress.report({
              message: 'Finalizing...',
              increment: 25,
            });

            if (!outcome.created) {
              // Reporting success here is what produced a "View Snapshot"
              // button that opened a different snapshot from the one the
              // message implied had just been taken.
              vscode.window.showInformationMessage(
                'Nothing to snapshot: the workspace is unchanged since the previous snapshot.',
              );
              return outcome;
            }

            // Reset notification state only when a snapshot was recorded.
            changeNotifier.resetNotificationState();

            // Show success message with tag count if applicable
            const tagInfo =
              contextOptions.tags.length > 0
                ? ` with ${contextOptions.tags.length} tags`
                : '';

            const actionItems = ['View Snapshot'];

            // If snapshot has a task reference, add action to copy it
            if (contextOptions.taskReference) {
              actionItems.push('Copy Task Reference');
            }

            // Show a more informative success message with actions
            vscode.window
              .showInformationMessage(
                `Snapshot ${
                  contextOptions.description
                    ? `"${contextOptions.description}"`
                    : ''
                } taken successfully${tagInfo}`,
                ...actionItems,
              )
              .then((selection) => {
                if (selection === 'View Snapshot') {
                  // The snapshot this call created, not whatever happens to be
                  // last in the list.
                  vscode.commands.executeCommand(
                    'vscode-snapshots.showChangedFilesInSnapshot',
                    {
                      snapshot: outcome.snapshot,
                      contextValue: 'snapshotItem',
                    },
                  );
                } else if (selection === 'Copy Task Reference') {
                  vscode.env.clipboard.writeText(contextOptions.taskReference);
                  vscode.window.showInformationMessage(
                    'Task reference copied to clipboard',
                  );
                }
              });

            return outcome;
          } catch (error: unknown) {
            if (isCancellationError(error)) {
              vscode.window.showInformationMessage(
                'Snapshot creation cancelled',
              );
              return undefined;
            }

            log(
              `takeSnapshot error: ${
                error instanceof Error ? error.message : error
              }`,
            );
            vscode.window.showErrorMessage(
              `Failed to take snapshot: ${
                error instanceof Error ? error.message : error
              }`,
            );
            return undefined;
          }
        },
      );
    },
  );
  context.subscriptions.push(takeSnapshotCmd);
  log('takeSnapshot command registered successfully');
}

// --- Placeholder for other command registrations ---

function registerViewSnapshotsCommand({
  context,
  snapshotQuickPick,
}: CommandDependencies): void {
  log('Registering viewSnapshots command...');
  const viewSnapshotsCmd = vscode.commands.registerCommand(
    'vscode-snapshots.viewSnapshots',
    async () => {
      log('viewSnapshots command executed');
      const snapshotId = await snapshotQuickPick.show(); // Get the selected snapshot ID
      if (snapshotId) {
        // If a snapshot was selected (not cancelled), execute jumpToSnapshot
        await vscode.commands.executeCommand(
          'vscode-snapshots.jumpToSnapshot',
          snapshotId,
        );
      }
    },
  );
  context.subscriptions.push(viewSnapshotsCmd);
  log('viewSnapshots command registered successfully');
}

function registerJumpToSnapshotCommand({
  context,
  snapshotManager,
  snapshotQuickPick,
}: CommandDependencies): void {
  log('Registering jumpToSnapshot command...');
  const jumpToSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.jumpToSnapshot',
    // This command handler now assumes snapshotId is *always* provided,
    // typically from tree view actions or potentially other UI elements.
    // The flow of picking from the list is handled by the viewSnapshots command.
    async (snapshotId: string) => {
      if (!snapshotId) {
        // Should not happen if called correctly, but add a safeguard.
        log('jumpToSnapshot command called without a snapshotId.');
        vscode.window.showErrorMessage('No snapshot ID provided to jump to.');
        return;
      }

      const targetSnapshotId = snapshotId; // Use the provided ID directly
      log(`jumpToSnapshot command executed for ID: ${targetSnapshotId}`);

      const snapshot = snapshotManager.getSnapshotById(targetSnapshotId);
      if (!snapshot) {
        log(`Snapshot with ID ${targetSnapshotId} not found.`);
        vscode.window.showErrorMessage(
          `Snapshot with ID ${targetSnapshotId} not found.`,
        );
        return;
      }

      const workspaceRoot = snapshotManager.getWorkspaceRoot();
      if (!workspaceRoot) {
        log('Cannot jump to snapshot: No workspace folder open.');
        vscode.window.showErrorMessage(
          'Cannot restore snapshot: No workspace folder open.',
        );
        return;
      }

      // --- Start: Preview and Confirmation UI ---
      let changes;
      try {
        changes = await snapshotManager.calculateRestoreChanges(
          snapshot,
          workspaceRoot,
        );
      } catch (error: unknown) {
        log(
          `Error calculating restore changes: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to calculate changes for restore: ${
            error instanceof Error ? error.message : error
          }`,
        );
        return;
      }

      // Warn before the confirmation UI, so the user knows this snapshot cannot
      // be fully applied before they are asked to approve anything. The restore
      // itself will skip those files and refuse to delete anything; saying so up
      // front is the difference between an informed choice and a surprise.
      const unrecoverableFiles = snapshotManager.getUnrecoverableFilesFor(
        snapshot.id,
      );
      if (unrecoverableFiles.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
          `This snapshot's history is incomplete: ${unrecoverableFiles.length} file(s) cannot be reconstructed and will be skipped. Files not in the snapshot will also be left untouched rather than deleted. Restore what is readable anyway?`,
          { modal: true },
          'Restore What Is Readable',
        );
        if (proceed !== 'Restore What Is Readable') {
          log(
            `Restore cancelled by user: snapshot ${targetSnapshotId} has ${unrecoverableFiles.length} unrecoverable file(s).`,
          );
          return;
        }
      }

      if (changes.length === 0) {
        log('No changes detected between snapshot and workspace.'); // Corrected: Use log
        vscode.window.showInformationMessage(
          'No changes to apply from this snapshot.',
        );
        return; // No need to confirm if there are no changes
      }

      const quickPickItems = changes.map((change) => ({
        label: change.label,
        description:
          change.description + (change.isDirty ? ' (Unsaved Changes)' : ''),
      }));

      const CONFIRM_OPTION = {
        label: '$(check) Restore Snapshot',
        description: 'Apply these changes to your workspace',
      };
      const CANCEL_OPTION = {
        label: '$(close) Cancel',
        description: 'Do not restore',
      };

      // `ux.confirmRestoreOperations` was declared and documented but read by
      // nothing, so turning it off still produced this prompt.
      if (getUxSettings().confirmRestoreOperations) {
        const selectedOption = await vscode.window.showQuickPick(
          [
            CONFIRM_OPTION,
            CANCEL_OPTION,
            {
              label: '--- Changes ---',
              kind: vscode.QuickPickItemKind.Separator,
            },
            ...quickPickItems,
          ],
          {
            placeHolder: 'Review changes and confirm restore',
            title: `Restore Snapshot '${snapshot.description || snapshot.id}'?`,
            ignoreFocusOut: true,
          },
        );

        if (selectedOption !== CONFIRM_OPTION) {
          log('User cancelled restore from preview.'); // Corrected: Use log
          vscode.window.showInformationMessage('Snapshot restore cancelled.');
          return;
        }
        log('User confirmed restore from preview.'); // Corrected: Use log
      }
      // --- End: Preview and Confirmation UI ---

      // --- Start: Conflict Resolution UI ---
      // This prompt is deliberately NOT gated on ux.confirmRestoreOperations:
      // it protects unsaved work, which is a different concern from routine
      // confirmation. The setting turns off the convenience prompt above, not
      // the data-loss guard.
      const affectedRelativePaths = new Set<string>(
        changes.map((c) => c.relativePath),
      ); // Use calculated changes for affected paths
      const conflictingDirtyEditors = vscode.window.visibleTextEditors.filter(
        (editor) =>
          editor.document.isDirty &&
          affectedRelativePaths.has(
            path.relative(workspaceRoot, editor.document.uri.fsPath),
          ),
      );

      if (conflictingDirtyEditors.length > 0) {
        const conflictingFiles = conflictingDirtyEditors.map((editor) =>
          path.relative(workspaceRoot, editor.document.uri.fsPath),
        );
        const maxFilesToShow = 3;
        const fileListSummary =
          conflictingFiles.slice(0, maxFilesToShow).join(', ') +
          (conflictingFiles.length > maxFilesToShow
            ? `, and ${conflictingFiles.length - maxFilesToShow} more...`
            : '');
        const message = `You have unsaved changes in ${conflictingDirtyEditors.length} file(s) affected by this restore (e.g., ${fileListSummary}). Restoring the snapshot will overwrite these changes.`;

        const result = await vscode.window.showWarningMessage(
          message,
          { modal: true },
          'Restore (Overwrite Unsaved)',
          'Take Snapshot & Restore',
          'Cancel',
        );

        // Fail closed. Dismissing a modal returns `undefined`, which matched
        // neither branch below, so closing the dialog -- the least deliberate
        // action available -- was read as consent and the restore proceeded,
        // overwriting the unsaved changes this prompt exists to protect. The
        // confirmation prompt above already treats "not the confirm option" as
        // cancel; this one now does the same.
        if (
          result !== 'Restore (Overwrite Unsaved)' &&
          result !== 'Take Snapshot & Restore'
        ) {
          log(
            `Restore cancelled due to unsaved changes conflict (dialog result: ${String(
              result,
            )}).`,
          );
          vscode.window.showInformationMessage('Snapshot restore cancelled.');
          return;
        }

        if (result === 'Take Snapshot & Restore') {
          log(
            'Taking snapshot before restoring due to unsaved changes conflict.',
          );

          // The take command prompts for context, so the user can cancel it,
          // and it refuses to record anything when the workspace is unchanged.
          // Both outcomes leave the unsaved changes unprotected, and the
          // previous code restored anyway -- discarding exactly what this
          // prompt exists to protect.
          const outcome = await vscode.commands.executeCommand<
            TakeSnapshotOutcome | undefined
          >('vscode-snapshots.takeSnapshot');

          if (!outcome?.created) {
            log('No snapshot was taken; cancelling the restore.');
            vscode.window.showWarningMessage(
              'No snapshot was taken, so the restore has been cancelled to avoid discarding your unsaved changes.',
            );
            return;
          }

          log('Snapshot taken, proceeding with restore.');
        }
        log(
          'Proceeding with restore despite unsaved changes (user confirmed overwrite or took snapshot).',
        );
      }
      // --- End: Conflict Resolution UI ---

      // A restore overwrites the workspace from disk and writes nothing to VS
      // Code's undo stack, so the pre-restore state is the only thing a user can
      // be brought back to -- and a snapshot is the only mechanism this product
      // has for that. Taken unconditionally rather than only when unsaved
      // buffers exist: a snapshot reads files from disk, so the dirty-buffer
      // prompt never protected the state this protects. A "nothing changed"
      // outcome is not a failure -- the newest snapshot already holds it.
      let protectiveOutcome: TakeSnapshotOutcome | undefined;
      try {
        protectiveOutcome = await snapshotManager.takeSnapshot(
          `Backup before restoring ${snapshot.description || targetSnapshotId}`,
          { tags: ['backup', 'auto'] },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to take protective snapshot before restore: ${message}`);
        vscode.window.showErrorMessage(
          `Cannot restore snapshot: failed to take a protective snapshot first (${message}).`,
        );
        return;
      }
      const protectiveId = protectiveOutcome?.created ? protectiveOutcome.snapshot.id : undefined;
      log(
        protectiveOutcome?.created
          ? `Protective snapshot ${protectiveId} taken before restore.`
          : 'Workspace unchanged since the newest snapshot; no protective snapshot needed.',
      );

      // --- Apply Restore with Progress ---
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restoring Snapshot: ${
            snapshot.description || snapshot.id.substring(0, 8)
          }`,
          cancellable: true, // Now supporting cancellation
        },
        async (progress, token) => {
          try {
            // Cancellation is checked at the await boundaries below. A listener
            // that throws cannot interrupt the work: its return value is discarded,
            // so the throw lands in the emitter's dispatch frame. See
            // utils/cancellation.ts.
            throwIfCancelled(token);

            // Save editor states for better transition
            progress.report({
              message: 'Preparing workspace...',
              increment: 10,
            });
            const editorStates = await preserveEditorViewStates();

            // Report more detailed progress
            progress.report({ message: 'Analyzing changes...', increment: 15 });

            // Fetch snapshot details for better messages
            const snapshotDate = new Date(snapshot.timestamp).toLocaleString();

            // Start the actual restore process
            log(
              `Applying snapshot restore via manager for ID: ${targetSnapshotId}`,
            );

            progress.report({
              message: protectiveOutcome?.created
                ? `Protective snapshot ready: ${protectiveId}`
                : 'No new protective snapshot needed',
              increment: 15,
            });

            throwIfCancelled(token);

            progress.report({ message: 'Restoring files...', increment: 30 });

            // Track operation start time for performance logging
            const startTime = Date.now();

            // Actual restore operation
            const result = await snapshotManager.applySnapshotRestore(
              targetSnapshotId,
            );

            // Log performance metrics
            const duration = Date.now() - startTime;
            log(`Snapshot restore completed in ${duration}ms`);

            if (!result.success) {
              log(
                `applySnapshotRestore returned success=false for ${targetSnapshotId}`,
              );
              vscode.window.showErrorMessage(
                `Failed to apply snapshot restore.`,
              );
              return;
            }

            if (
              result.skipped.length > 0 ||
              result.refusedDeletions.length > 0
            ) {
              // The restore did what it could. Saying nothing would repeat the
              // original bug: the user would believe the workspace now matches
              // the snapshot when part of it could not be reconstructed.
              vscode.window.showWarningMessage(
                `Restored ${result.restored.length} file(s). ${result.skipped.length} file(s) could not be restored because this snapshot's history is incomplete, and ${result.refusedDeletions.length} file(s) were left untouched for the same reason.`,
              );
            }

            progress.report({
              message: 'Refreshing workspace...',
              increment: 15,
            });

            // Restore editor view states for each open file
            await restoreEditorViewStates(editorStates);

            progress.report({ message: 'Finalizing...', increment: 15 });

            // Show enhanced success message with context and actions
            const actions = ['View Changes'];

            // If snapshot has tags, offer to filter by those tags
            if (snapshot.tags && snapshot.tags.length > 0) {
              actions.push('Filter by Tags');
            }
            if (protectiveId) {
              actions.push('Show backup');
            }

            // A selective restore writes only the files its snapshot captured, so
            // the workspace is not now that snapshot's state. Reporting an
            // unqualified success is the same over-claim the preview was fixed
            // for: the user would read "Restored snapshot ..." as "the workspace
            // matches it".
            const backupSummary = protectiveId
              ? ` The previous state is saved as snapshot ${protectiveId}.`
              : '';
            const restoredSummary = result.selective
              ? `Restored ${
                  result.restored.length
                } captured file(s) from snapshot '${
                  snapshot.description || snapshot.id
                }'; the rest of the workspace was left untouched.${backupSummary}`
              : `Restored snapshot '${
                  snapshot.description || snapshot.id
                }' from ${snapshotDate}.${backupSummary}`;

            vscode.window
              .showInformationMessage(restoredSummary, ...actions)
              .then((selection) => {
                if (selection === 'View Changes') {
                  vscode.commands.executeCommand(
                    'vscode-snapshots.showChangedFilesInSnapshot',
                    { snapshot, contextValue: 'snapshotItem' },
                  );
                } else if (selection === 'Filter by Tags' && snapshot.tags) {
                  // Set the tree filter to show only snapshots with these tags
                  vscode.commands.executeCommand(
                    'vscode-snapshots.filterByTags',
                    snapshot.tags,
                  );
                } else if (selection === 'Show backup' && protectiveId) {
                  // The backup is itself a snapshot; opening it is the undo
                  // path. Guard against re-entering the restore that created it.
                  if (protectiveId !== targetSnapshotId) {
                    vscode.commands.executeCommand(
                      'vscode-snapshots.jumpToSnapshot',
                      protectiveId,
                    );
                  }
                }
              });
          } catch (error: unknown) {
            if (isCancellationError(error)) {
              vscode.window.showInformationMessage(
                'Snapshot restore cancelled',
              );
              return;
            }

            log(
              `applySnapshotRestore error: ${
                error instanceof Error ? error.message : error
              }`,
            );
            vscode.window.showErrorMessage(
              `Failed to restore snapshot: ${
                error instanceof Error ? error.message : error
              }`,
            );
          }
        },
      );
    },
  );
  context.subscriptions.push(jumpToSnapshotCmd);
  log('jumpToSnapshot command registered successfully');
}

// function registerPreviousSnapshotCommand({ context, snapshotManager }: CommandDependencies): void { ... }
// function registerNextSnapshotCommand({ context, snapshotManager }: CommandDependencies): void { ... }

function registerTreeViewCommands({
  context,
  snapshotManager,
  snapshotTreeDataProvider, // Needed for some commands? Maybe not directly.
}: CommandDependencies): void {
  log('Registering Tree View context menu commands...');

  // --- Register Tree View Context Menu Commands ---

  log('Registering restoreFromTree command...');
  const restoreFromTreeCmd = vscode.commands.registerCommand(
    'vscode-snapshots.restoreFromTree',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot) {
        log('restoreFromTree called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      // Execute the main jumpToSnapshot command, which now handles UI/confirmation
      log(
        `restoreFromTree triggering jumpToSnapshot for ID: ${item.snapshot.id}`,
      );
      await vscode.commands.executeCommand(
        'vscode-snapshots.jumpToSnapshot',
        item.snapshot.id,
      );
      // No need for progress/error handling here, jumpToSnapshot command handles it.
    },
  );
  context.subscriptions.push(restoreFromTreeCmd);
  log('restoreFromTree command registered successfully');

  log('Registering compareWithCurrentFromTree command...');
  const compareWithCurrentFromTreeCmd = vscode.commands.registerCommand(
    'vscode-snapshots.compareWithCurrentFromTree',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot) {
        log('compareWithCurrentFromTree called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      try {
        log(
          `compareWithCurrentFromTree command executed for ID: ${item.snapshot.id}`,
        );

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage('No workspace folder open.');
          return;
        }

        // Get files from the snapshot object itself
        const filesInSnapshot = Object.entries(item.snapshot.files || {})
          .filter(([, fileData]) => !fileData.deleted) // Filter out deleted files
          .map(([relativePath]) => relativePath); // Get relative paths

        if (filesInSnapshot.length === 0) {
          vscode.window.showInformationMessage(
            'Selected snapshot contains no files to compare.',
          );
          return;
        }

        // Filter snapshot files to those that currently exist in the workspace
        const comparableFiles = filesInSnapshot.filter((relPath) => {
          const currentFilePath = path.join(
            workspaceFolder.uri.fsPath,
            relPath,
          );
          // Check if the path exists and is a file (not a directory)
          try {
            // Use async stat for potentially better performance? Or keep sync for simplicity here?
            // Let's keep sync for now as it was in extension.ts
            return (
              fs.existsSync(currentFilePath) &&
              fs.lstatSync(currentFilePath).isFile()
            );
          } catch (e) {
            log(`Error checking existence of ${currentFilePath}: ${e}`);
            return false;
          }
        });

        if (comparableFiles.length === 0) {
          vscode.window.showInformationMessage(
            'None of the files in this snapshot exist in the current workspace to compare.',
          );
          return;
        }

        // Show Quick Pick to select a file
        const selectedRelativePath = await vscode.window.showQuickPick(
          comparableFiles,
          {
            placeHolder: 'Select a file to compare with the current version',
            title: `Compare Snapshot '${item.label}' with Current`,
          },
        );

        if (!selectedRelativePath) {
          log('File selection cancelled by user.');
          return; // User cancelled the quick pick
        }

        // Proceed with the selected file
        const currentFileUri = vscode.Uri.joinPath(
          workspaceFolder.uri,
          selectedRelativePath,
        );
        // Construct the snapshotfs URI. Add timestamp to force refresh if needed.
        // Note: SnapshotContentProvider needs to be registered in activate
        const snapshotUri = SnapshotContentProvider.getUri(
          item.snapshot.id,
          selectedRelativePath,
        );
        const title = `"${selectedRelativePath}" (${item.label} vs Current)`;

        log(
          `Opening diff for selected file: ${snapshotUri} vs ${currentFileUri}`,
        );
        await vscode.commands.executeCommand(
          'vscode.diff',
          snapshotUri,
          currentFileUri,
          title,
        );
      } catch (error: unknown) {
        log(
          `compareWithCurrentFromTree error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to compare snapshot: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(compareWithCurrentFromTreeCmd);
  log('compareWithCurrentFromTree command registered successfully');

  log('Registering deleteFromTree command...');
  const deleteFromTreeCmd = vscode.commands.registerCommand(
    'vscode-snapshots.deleteFromTree',
    async (item: SnapshotTreeItem) => {
      // Ensure item is a snapshot node, not a file node
      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('deleteFromTree called with invalid or non-snapshot item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      try {
        log(`deleteFromTree command executed for ID: ${item.snapshot.id}`);
        // Call the deleteSnapshot method from SnapshotManager
        // Confirmation is handled within deleteSnapshot now
        await snapshotManager.deleteSnapshot(item.snapshot.id);
        // Refresh is handled by the onDidChangeSnapshots listener in TreeDataProvider
        // Success message shown by deleteSnapshot
      } catch (error: unknown) {
        log(
          `deleteFromTree error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to delete snapshot: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(deleteFromTreeCmd);
  log('deleteFromTree command registered successfully');

  // --- New Tree View Context Menu Commands for Files ---

  log('Registering compareFileWithWorkspace command...');
  const compareFileWithWorkspaceCmd = vscode.commands.registerCommand(
    'vscode-snapshots.compareFileWithWorkspace',
    async (item: SnapshotTreeItem) => {
      if (
        !item ||
        !item.snapshotId ||
        !item.relativePath ||
        item.contextValue !== 'snapshotFile' // Ensure it's a file item
      ) {
        log('compareFileWithWorkspace called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a file inside a snapshot in the CodeLapse view.',
        );
        return;
      }

      const { snapshotId, relativePath } = item;
      log(
        `compareFileWithWorkspace: snapshotId=${snapshotId}, relativePath=${relativePath}`,
      );

      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage('No workspace folder open.');
          log('compareFileWithWorkspace: No workspace folder open.');
          return;
        }

        // SnapshotContentProvider needs to be registered in activate
        const snapshotUri = SnapshotContentProvider.getUri(
          snapshotId,
          relativePath,
        );
        // const snapshotUri = SnapshotContentProvider.getUri(snapshotId, relativePath); // If helper exists
        const workspaceUri = vscode.Uri.joinPath(
          workspaceFolder.uri,
          relativePath,
        );

        // Check if workspace file exists before attempting diff
        try {
          await vscode.workspace.fs.stat(workspaceUri);
        } catch (error) {
          // File doesn't exist in workspace
          log(
            `Workspace file ${relativePath} does not exist. Opening snapshot version only.`,
          );
          vscode.window.showInformationMessage(
            `File '${relativePath}' does not exist in the current workspace. Opening snapshot version.`,
          );
          // Open the snapshot version in a normal editor instead of diff
          await vscode.window.showTextDocument(snapshotUri);
          return;
        }

        const snapshotTimestamp = item.snapshotTimestamp
          ? new Date(item.snapshotTimestamp).toLocaleString()
          : snapshotId;
        const title = `${path.basename(
          relativePath,
        )} (${snapshotTimestamp} vs Workspace)`;

        log(`Opening diff: ${snapshotUri} vs ${workspaceUri}`);
        await vscode.commands.executeCommand(
          'vscode.diff',
          snapshotUri,
          workspaceUri,
          title,
        );
      } catch (error: unknown) {
        log(
          `compareFileWithWorkspace error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to compare file: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(compareFileWithWorkspaceCmd);
  log('compareFileWithWorkspace command registered successfully');

  log('Registering restoreFileFromSnapshot command...');
  const restoreFileFromSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.restoreFileFromSnapshot',
    async (item: SnapshotTreeItem) => {
      if (
        !item ||
        !item.snapshotId ||
        !item.relativePath ||
        item.contextValue !== 'snapshotFile' // Ensure it's a file item
      ) {
        log('restoreFileFromSnapshot called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a file inside a snapshot in the CodeLapse view.',
        );
        return;
      }

      const { snapshotId, relativePath } = item;
      log(
        `restoreFileFromSnapshot: snapshotId=${snapshotId}, relativePath=${relativePath}`,
      );

      // Confirmation dialog
      const confirmation = await vscode.window.showWarningMessage(
        `Are you sure you want to restore '${relativePath}' from snapshot '${
          item.label || snapshotId
        }'? This will overwrite the current file in your workspace.`,
        { modal: true },
        'Restore',
      );

      if (confirmation !== 'Restore') {
        log('Restore cancelled by user.');
        return;
      }

      try {
        // Use the manager method directly, it handles workspace root check and file writing
        await snapshotManager.restoreSingleFile(snapshotId, relativePath);

        log(
          `Successfully restored ${relativePath} from snapshot ${snapshotId}`,
        );
        vscode.window.showInformationMessage(
          `Restored '${relativePath}' from snapshot.`,
        );

        // Optional: Open the restored file
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const workspaceFilePath = path.join(
            workspaceFolder.uri.fsPath,
            relativePath,
          );
          const fileUri = vscode.Uri.file(workspaceFilePath);
          await vscode.window.showTextDocument(fileUri);
        }
      } catch (error: unknown) {
        log(
          `restoreFileFromSnapshot error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to restore file: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(restoreFileFromSnapshotCmd);
  log('restoreFileFromSnapshot command registered successfully');

  log('Registering showChangedFilesInSnapshot command...');
  const showChangedFilesInSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.showChangedFilesInSnapshot',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('showChangedFilesInSnapshot called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }

      const { snapshot } = item;
      log(`showChangedFilesInSnapshot: snapshotId=${snapshot.id}`);

      // BUGFIX: We need to check if files were actually deleted in THIS snapshot
      // Find the previous snapshot to compare against
      const allSnapshots = snapshotManager.getSnapshots();
      const currentIndex = allSnapshots.findIndex((s) => s.id === snapshot.id);
      const previousSnapshot =
        currentIndex > 0 ? allSnapshots[currentIndex - 1] : null;

      const changedFiles: {
        label: string;
        description: string;
        relativePath: string;
        status: 'A' | 'M' | 'D';
      }[] = [];

      for (const [relativePath, fileData] of Object.entries(
        snapshot.files || {},
      )) {
        // BUGFIX: Only show deleted files if they were deleted in THIS snapshot
        if (fileData.deleted) {
          // Check if the file exists in the previous snapshot and wasn't already deleted
          if (
            !previousSnapshot ||
            !previousSnapshot.files[relativePath] ||
            !previousSnapshot.files[relativePath].deleted
          ) {
            // This file was deleted in the current snapshot
            changedFiles.push({
              label: `- ${relativePath}`,
              description: 'Deleted',
              relativePath,
              status: 'D',
            });
          } else {
            // File was already deleted in a previous snapshot, don't show it
            logVerbose(
              `Filtering out previously deleted file: ${relativePath}`,
            );
          }
        } else if (fileData.diff) {
          changedFiles.push({
            label: `~ ${relativePath}`,
            description: 'Modified',
            relativePath,
            status: 'M',
          });
        } else if (fileData.content && !fileData.baseSnapshotId) {
          // File has full content and no base reference, likely new
          changedFiles.push({
            label: `+ ${relativePath}`,
            description: 'Added',
            relativePath,
            status: 'A',
          });
        }
      }

      // Rest of the function remains unchanged
      if (changedFiles.length === 0) {
        vscode.window.showInformationMessage(
          'No changes detected in this snapshot.',
        );
        log('showChangedFilesInSnapshot: No changes found.');
        return;
      }

      // Sort files: Added, Modified, Deleted, then alphabetically
      changedFiles.sort((a, b) => {
        const statusOrder = { A: 1, M: 2, D: 3 };
        if (statusOrder[a.status] !== statusOrder[b.status]) {
          return statusOrder[a.status] - statusOrder[b.status];
        }
        return a.relativePath.localeCompare(b.relativePath);
      });

      const selectedFile = await vscode.window.showQuickPick(changedFiles, {
        placeHolder: 'Select a changed file to view diff',
        title: `Changes in Snapshot (${new Date(
          snapshot.timestamp,
        ).toLocaleString()})`,
        matchOnDescription: true,
      });

      if (!selectedFile) {
        log('showChangedFilesInSnapshot: Quick pick cancelled.');
        return;
      }

      // Construct a temporary TreeItem-like object for the compare command
      const fileItemArg: Partial<SnapshotTreeItem> & {
        snapshotId: string;
        relativePath: string;
        contextValue: string;
        snapshotTimestamp: number;
      } = {
        snapshotId: snapshot.id,
        relativePath: selectedFile.relativePath,
        contextValue: 'snapshotFile', // Mimic file item context
        snapshotTimestamp: snapshot.timestamp, // Pass timestamp for title
      };

      log(
        `showChangedFilesInSnapshot: User selected ${selectedFile.relativePath}. Triggering compare command.`,
      );
      // Trigger the compare command with the selected file info
      await vscode.commands.executeCommand(
        'vscode-snapshots.compareFileWithWorkspace',
        fileItemArg, // Pass the constructed argument
      );
    },
  );
  context.subscriptions.push(showChangedFilesInSnapshotCmd);
  log('showChangedFilesInSnapshot command registered successfully');

  log('Registering toggleFavoriteStatus command...');
  const toggleFavoriteCmd = vscode.commands.registerCommand(
    'vscode-snapshots.toggleFavoriteStatus',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('toggleFavoriteStatus called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      try {
        const snapshot = item.snapshot;
        // Toggle the favorite status
        snapshot.isFavorite = !snapshot.isFavorite;

        // Save the updated snapshot
        await snapshotManager.updateSnapshotContext(snapshot.id, {
          isFavorite: snapshot.isFavorite,
        });

        // Show confirmation and refresh the tree view
        vscode.window.showInformationMessage(
          snapshot.isFavorite
            ? `Snapshot marked as favorite`
            : `Favorite status removed`,
        );
      } catch (error: unknown) {
        log(
          `toggleFavoriteStatus error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to update favorite status: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(toggleFavoriteCmd);
  log('toggleFavoriteStatus command registered successfully');

  log('Registering editSnapshotTags command...');
  const editTagsCmd = vscode.commands.registerCommand(
    'vscode-snapshots.editSnapshotTags',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('editSnapshotTags called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      try {
        const snapshot = item.snapshot;
        // Show input box with current tags
        const currentTags = snapshot.tags?.join(', ') || '';
        const tagsInput = await vscode.window.showInputBox({
          prompt: 'Edit tags (comma-separated)',
          placeHolder: 'E.g., "feature, login, authentication"',
          value: currentTags,
        });

        if (tagsInput === undefined) {
          return; // User cancelled
        }

        // Parse tags, removing empty ones and trimming whitespace
        const tags = tagsInput
          ? tagsInput
              .split(',')
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0)
          : [];

        // Save the updated snapshot
        await snapshotManager.updateSnapshotContext(snapshot.id, { tags });

        // Show confirmation
        vscode.window.showInformationMessage(
          tags.length > 0
            ? `Updated snapshot tags: ${tags.join(', ')}`
            : `Removed all tags from snapshot`,
        );
      } catch (error: unknown) {
        log(
          `editSnapshotTags error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to update tags: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(editTagsCmd);
  log('editSnapshotTags command registered successfully');

  log('Registering editSnapshotNotes command...');
  const editNotesCmd = vscode.commands.registerCommand(
    'vscode-snapshots.editSnapshotNotes',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('editSnapshotNotes called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      try {
        const snapshot = item.snapshot;
        // Show input box with current notes
        const notesInput = await vscode.window.showInputBox({
          prompt: 'Edit additional notes',
          placeHolder: 'E.g., "Fixed edge cases with validation"',
          value: snapshot.notes || '',
        });

        if (notesInput === undefined) {
          return; // User cancelled
        }

        // Save the updated snapshot
        await snapshotManager.updateSnapshotContext(snapshot.id, {
          notes: notesInput,
        });

        // Show confirmation
        vscode.window.showInformationMessage(
          notesInput ? `Updated snapshot notes` : `Removed notes from snapshot`,
        );
      } catch (error: unknown) {
        log(
          `editSnapshotNotes error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to update notes: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(editNotesCmd);
  log('editSnapshotNotes command registered successfully');

  log('Registering editTaskReference command...');
  const editTaskCmd = vscode.commands.registerCommand(
    'vscode-snapshots.editTaskReference',
    async (item: SnapshotTreeItem) => {
      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('editTaskReference called with invalid item');
        vscode.window.showInformationMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }
      try {
        const snapshot = item.snapshot;
        // Show input box with current task reference
        const taskInput = await vscode.window.showInputBox({
          prompt: 'Edit task/issue reference',
          placeHolder: 'E.g., "JIRA-123" or "Issue #42"',
          value: snapshot.taskReference || '',
        });

        if (taskInput === undefined) {
          return; // User cancelled
        }

        // Save the updated snapshot
        await snapshotManager.updateSnapshotContext(snapshot.id, {
          taskReference: taskInput,
        });

        // Show confirmation
        vscode.window.showInformationMessage(
          taskInput
            ? `Updated task reference to: ${taskInput}`
            : `Removed task reference from snapshot`,
        );
      } catch (error: unknown) {
        log(
          `editTaskReference error: ${
            error instanceof Error ? error.message : error
          }`,
        );
        vscode.window.showErrorMessage(
          `Failed to update task reference: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    },
  );
  context.subscriptions.push(editTaskCmd);
  log('editTaskReference command registered successfully');

  log('Tree View context menu commands registered.');
}

function registerPreviousSnapshotCommand({
  context,
  snapshotManager,
}: CommandDependencies): void {
  log('Registering previousSnapshot command...');
  const previousSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.previousSnapshot',
    async () => {
      // Ask the manager where this navigation would land, so the progress
      // title names the snapshot that is actually restored. Computing the
      // target separately is how a title ends up naming a different one.
      const targetIndex = snapshotManager.getNavigationTargetIndex('previous');
      const snapshots = snapshotManager.getSnapshots();

      if (targetIndex === ACTIVE_NONE) {
        vscode.window.showInformationMessage(
          snapshots.length === 0
            ? 'No snapshots available'
            : 'No previous snapshots available',
        );
        return;
      }

      // Get previous snapshot details for better progress messaging
      const previousSnapshot = snapshots[targetIndex];
      const previousDate = new Date(
        previousSnapshot.timestamp,
      ).toLocaleString();
      const previousDescription =
        previousSnapshot.description || 'unnamed snapshot';

      // Use detailed progress with direction indicator
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Navigating ⬅️ to previous snapshot: ${previousDescription}`,
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Cancellation is checked at the await boundaries below; see
            // utils/cancellation.ts for why a throwing listener cannot work.
            throwIfCancelled(token);

            // Begin smooth transition
            progress.report({
              message: 'Preparing files...',
              increment: 20,
            });

            // Decorative transition indicator, gated on ux.useAnimations:
            // `animationHelpers` was dead code, so the setting had no effect.
            // Cleared once the restore has settled rather than lingering.
            if (getUxSettings().useAnimations) {
              const indicator =
                AnimationHelpers.showTransitionIndicators('backward');
              context.subscriptions.push(indicator);
              setTimeout(() => indicator.dispose(), 1500);
            }

            // First, save view states of open editors
            const editorStates = await preserveEditorViewStates();

            // Perform the actual navigation
            progress.report({
              message: `Loading snapshot from ${previousDate}...`,
              increment: 40,
            });

            const success = await snapshotManager.navigateToPreviousSnapshot();

            if (!success) {
              vscode.window.showInformationMessage(
                'No previous snapshot available',
              );
              return;
            }

            progress.report({
              message: 'Applying changes...',
              increment: 30,
            });

            // Restore editor states
            await restoreEditorViewStates(editorStates);

            progress.report({
              message: 'Finishing up...',
              increment: 10,
            });

            // Show success message with context
            vscode.window
              .showInformationMessage(
                `Navigated to previous snapshot: ${previousDescription} (${previousDate})`,
                'View Changes',
              )
              .then((selection) => {
                if (selection === 'View Changes') {
                  vscode.commands.executeCommand(
                    'vscode-snapshots.showChangedFilesInSnapshot',
                    {
                      snapshot: previousSnapshot,
                      contextValue: 'snapshotItem',
                    },
                  );
                }
              });
          } catch (error: unknown) {
            if (isCancellationError(error)) {
              vscode.window.showInformationMessage(
                'Navigation to previous snapshot cancelled',
              );
              return;
            }

            log(
              `previousSnapshot error: ${
                error instanceof Error ? error.message : error
              }`,
            );
            vscode.window.showErrorMessage(
              `Failed to navigate to previous snapshot: ${
                error instanceof Error ? error.message : error
              }`,
            );
          }
        },
      );
    },
  );
  context.subscriptions.push(previousSnapshotCmd);
  log('previousSnapshot command registered successfully');
}

function registerNextSnapshotCommand({
  context,
  snapshotManager,
}: CommandDependencies): void {
  log('Registering nextSnapshot command...');
  const nextSnapshotCmd = vscode.commands.registerCommand(
    'vscode-snapshots.nextSnapshot',
    async () => {
      // See the previous-snapshot command: the manager resolves the target so
      // the command and the navigation cannot disagree.
      const targetIndex = snapshotManager.getNavigationTargetIndex('next');
      const snapshots = snapshotManager.getSnapshots();

      if (targetIndex === ACTIVE_NONE) {
        vscode.window.showInformationMessage(
          snapshots.length === 0
            ? 'No snapshots available'
            : 'No next snapshots available',
        );
        return;
      }

      // Get next snapshot details for better progress messaging
      const nextSnapshot = snapshots[targetIndex];
      const nextDate = new Date(nextSnapshot.timestamp).toLocaleString();
      const nextDescription = nextSnapshot.description || 'unnamed snapshot';

      // Use detailed progress with direction indicator
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Navigating ➡️ to next snapshot: ${nextDescription}`,
          cancellable: true,
        },
        async (progress, token) => {
          try {
            // Cancellation is checked at the await boundaries below; see
            // utils/cancellation.ts for why a throwing listener cannot work.
            throwIfCancelled(token);

            // Begin smooth transition
            progress.report({
              message: 'Preparing files...',
              increment: 20,
            });

            // Decorative transition indicator, gated on ux.useAnimations; see
            // the previous-snapshot command for the rationale.
            if (getUxSettings().useAnimations) {
              const indicator =
                AnimationHelpers.showTransitionIndicators('forward');
              context.subscriptions.push(indicator);
              setTimeout(() => indicator.dispose(), 1500);
            }

            // First, save view states of open editors
            const editorStates = await preserveEditorViewStates();

            // Perform the actual navigation
            progress.report({
              message: `Loading snapshot from ${nextDate}...`,
              increment: 40,
            });

            const success = await snapshotManager.navigateToNextSnapshot();

            if (!success) {
              vscode.window.showInformationMessage(
                'No next snapshot available',
              );
              return;
            }

            progress.report({
              message: 'Applying changes...',
              increment: 30,
            });

            // Restore editor states
            await restoreEditorViewStates(editorStates);

            progress.report({
              message: 'Finishing up...',
              increment: 10,
            });

            // Show success message with context
            vscode.window
              .showInformationMessage(
                `Navigated to next snapshot: ${nextDescription} (${nextDate})`,
                'View Changes',
              )
              .then((selection) => {
                if (selection === 'View Changes') {
                  vscode.commands.executeCommand(
                    'vscode-snapshots.showChangedFilesInSnapshot',
                    { snapshot: nextSnapshot, contextValue: 'snapshotItem' },
                  );
                }
              });
          } catch (error: unknown) {
            if (isCancellationError(error)) {
              vscode.window.showInformationMessage(
                'Navigation to next snapshot cancelled',
              );
              return;
            }

            log(
              `nextSnapshot error: ${
                error instanceof Error ? error.message : error
              }`,
            );
            vscode.window.showErrorMessage(
              `Failed to navigate to next snapshot: ${
                error instanceof Error ? error.message : error
              }`,
            );
          }
        },
      );
    },
  );
  context.subscriptions.push(nextSnapshotCmd);
  log('nextSnapshot command registered successfully');
}

function registerToggleChangedFilesCommand({
  context,
}: CommandDependencies): void {
  log('Registering toggleChangedFilesView command...');
  const toggleCmd = vscode.commands.registerCommand(
    'vscode-snapshots.toggleChangedFilesView',
    async () => {
      const config = vscode.workspace.getConfiguration('vscode-snapshots');
      const currentValue = config.get<boolean>('showOnlyChangedFiles', true);

      // Toggle the value
      await config.update(
        'showOnlyChangedFiles',
        !currentValue,
        vscode.ConfigurationTarget.Global,
      );

      vscode.window.showInformationMessage(
        !currentValue
          ? 'Now showing only changed files in snapshots'
          : 'Now showing all files in snapshots',
      );
    },
  );
  context.subscriptions.push(toggleCmd);
  log('toggleChangedFilesView command registered successfully');
}

// FILE: C:\Konectify\PersonalProject\vscode-snapshots\src\commands.ts
// ... (other imports like vscode, SnapshotManager, SnapshotTreeDataProvider, log, logVerbose, path etc.) ...

function registerFilterCommand({
  context,
  snapshotManager, // Keep snapshotManager if needed for tag collection etc.
  snapshotTreeDataProvider, // Manual provider
  autoSnapshotTreeDataProvider, // Auto provider
}: CommandDependencies): void {
  log('Registering filter commands...');

  // Helper function to determine which tree view is active or if both should be targeted
  // Returns the provider(s) to apply the filter to.
  const getTargetProviders = async (
    filterName: string,
  ): Promise<SnapshotTreeDataProvider[] | undefined> => {
    const targetChoice = await vscode.window.showQuickPick(
      [
        {
          label: 'Active View Only',
          description:
            'Apply filter only to the currently focused snapshot view',
          value: 'active',
        },
        {
          label: 'Both Views',
          description: "Apply filter to 'My Snapshots' and 'Auto Snapshots'",
          value: 'both',
        },
        {
          label: 'Cancel',
          description: 'Do not apply filter',
          value: 'cancel',
        },
      ],
      {
        placeHolder: `Apply '${filterName}' filter to which view(s)?`,
        title: 'Filter Target Selection',
        ignoreFocusOut: true, // Keep open if focus lost briefly
      },
    );

    if (!targetChoice || targetChoice.value === 'cancel') {
      log(`Filter application cancelled by user for '${filterName}'.`);
      return undefined; // User cancelled
    }

    if (targetChoice.value === 'both') {
      log(`Targeting both views for '${filterName}' filter.`);
      return [snapshotTreeDataProvider, autoSnapshotTreeDataProvider];
    }

    // Determine Active View
    logVerbose(`Determining active view for '${filterName}' filter...`);
    try {
      // Check visibility using executeCommand - wrap in try/catch
      // Use <boolean> type assertion as executeCommand returns any
      const manualViewVisible = await vscode.commands
        .executeCommand<boolean>(
          'workbench.view.extension.snapshot-explorer.manualSnapshotHistoryView.visible',
        )
        .then(
          (value) => value ?? false,
          (err: Error) => {
            log(`Error checking visibility for manual view: ${err}`);
            return false; // Assume not visible on error
          },
        );

      const autoViewVisible = await vscode.commands
        .executeCommand<boolean>(
          'workbench.view.extension.snapshot-explorer.autoSnapshotHistoryView.visible',
        )
        .then(
          (value) => value ?? false,
          (err: Error) => {
            log(`Error checking visibility for auto view: ${err}`);
            return false; // Assume not visible on error
          },
        );

      logVerbose(
        `View visibility: Manual=${manualViewVisible}, Auto=${autoViewVisible}`,
      );

      // Prioritize the visible view. Default to manual if both/neither are visible (e.g., command palette trigger)
      if (autoViewVisible && !manualViewVisible) {
        log(`Targeting active view (Auto) for '${filterName}' filter.`);
        return [autoSnapshotTreeDataProvider];
      } else {
        log(
          `Targeting active view (Manual or Default) for '${filterName}' filter.`,
        );
        return [snapshotTreeDataProvider]; // Default to manual view
      }
    } catch (error) {
      log(
        `Error determining active view: ${error}. Defaulting to manual view.`,
      );
      // Fallback in case of unexpected error during visibility check
      return [snapshotTreeDataProvider];
    }
  };

  // Helper function to apply filter options to the specified providers
  const applyFilterToProviders = (
    providers: SnapshotTreeDataProvider[],
    filterOptions: Record<string, unknown>,
  ) => {
    logVerbose(
      `Applying filter ${JSON.stringify(filterOptions)} to ${
        providers.length
      } provider(s).`,
    );
    providers.forEach((provider) => {
      // Determine view name for logging
      const viewName =
        provider === snapshotTreeDataProvider ? 'Manual' : 'Auto';
      logVerbose(`Applying filter to ${viewName} view provider.`);
      provider.setFilter(filterOptions);
    });
  };

  // --- Date filter command ---
  const filterSnapshotsCmd = vscode.commands.registerCommand(
    'vscode-snapshots.filterSnapshotsByDate',
    async () => {
      log('filterSnapshotsByDate command executed');

      // Options setup
      const options: (vscode.QuickPickItem & {
        startDate?: number | null;
        endDate?: number | null;
      })[] = [
        {
          label: 'Show All',
          description: 'Remove date filter',
          startDate: null,
          endDate: null,
        },
        {
          label: 'Last 24 Hours',
          startDate: Date.now() - 24 * 60 * 60 * 1000,
          endDate: null,
        },
        {
          label: 'Last 7 Days',
          startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
          endDate: null,
        },
        {
          label: 'Last 30 Days',
          startDate: Date.now() - 30 * 24 * 60 * 60 * 1000,
          endDate: null,
        },
        // Add more options if needed (e.g., custom range)
      ];

      const selectedOption = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select a date range to filter snapshots',
        title: 'Filter Snapshots by Date',
      });

      if (!selectedOption) {
        log('Filter selection cancelled.');
        return; // User cancelled
      }

      // Ask where to apply the filter and get target providers
      const targetProviders = await getTargetProviders('date');
      if (!targetProviders) return; // User cancelled target selection

      // Apply the filter to appropriate provider(s)
      applyFilterToProviders(targetProviders, {
        startDate: selectedOption.startDate ?? null,
        endDate: selectedOption.endDate ?? null,
      });

      // Show confirmation
      const targetDesc =
        targetProviders.length > 1 ? 'both views' : 'active view';
      vscode.window.showInformationMessage(
        `Applied date filter: ${selectedOption.label} to ${targetDesc}`,
      );
    },
  );
  context.subscriptions.push(filterSnapshotsCmd);

  // --- Tag filter command ---
  const filterByTagsCmd = vscode.commands.registerCommand(
    'vscode-snapshots.filterByTags',
    async (preselectedTags?: string[]) => {
      log('filterByTags command executed');

      // When called programmatically with tags (the "Filter by Tags" action in
      // the restore success toast at the top of this file), apply them
      // directly to both views. Prompting for a target there would interrogate
      // the user about a decision the caller already made. This parameter was
      // previously dropped entirely, so the action opened an unselected picker.
      const applyToBothViews = Array.isArray(preselectedTags);

      let targetProviders: SnapshotTreeDataProvider[];
      if (applyToBothViews) {
        targetProviders = [
          snapshotTreeDataProvider,
          autoSnapshotTreeDataProvider,
        ];
      } else {
        // Ask where to apply the filter FIRST to get target providers
        const chosen = await getTargetProviders('tag');
        if (!chosen) return; // User cancelled target selection
        targetProviders = chosen;
      }

      // Get all unique tags from all snapshots (regardless of target) for the selection list
      const allSnapshots = snapshotManager.getSnapshots();
      const tagCounts = new Map<string, number>();
      allSnapshots.forEach((snapshot) => {
        snapshot.tags?.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
      });

      if (tagCounts.size === 0) {
        vscode.window.showInformationMessage('No tags found in any snapshots');
        return;
      }

      if (applyToBothViews) {
        const tags = (preselectedTags ?? []).filter((t) => t.length > 0);
        if (tags.length === 0) {
          vscode.window.showInformationMessage(
            'That snapshot has no tags to filter by.',
          );
          return;
        }
        applyFilterToProviders(targetProviders, { tags });
        vscode.window.showInformationMessage(
          `Filtering by ${tags.length} tag${
            tags.length === 1 ? '' : 's'
          } in both views: ${tags.join(', ')}`,
        );
        return;
      }

      // Determine initial picked state based on the target(s)
      let initiallyPickedTags = new Set<string>();
      let showAllInitiallyPicked = false;
      if (targetProviders.length === 1) {
        // Active View: Use its current filter state
        initiallyPickedTags = new Set(targetProviders[0].getFilterTags());
        logVerbose(
          `Pre-selecting tags based on active view: ${[
            ...initiallyPickedTags,
          ].join(', ')}`,
        );
        showAllInitiallyPicked = initiallyPickedTags.size === 0; // Pick "Show All" if active view has no tags selected
      } else {
        // Both Views: Check if *both* views currently have *no* tag filters applied.
        const manualTags = snapshotTreeDataProvider.getFilterTags();
        const autoTags = autoSnapshotTreeDataProvider.getFilterTags();
        if (manualTags.length === 0 && autoTags.length === 0) {
          showAllInitiallyPicked = true; // If neither has tags, pre-select "Show All"
          logVerbose(
            "Targeting both views, pre-selecting 'Show All' as neither view has tag filters.",
          );
        } else {
          // If either view has tags, don't pre-select anything specific, let user decide for both.
          logVerbose(
            'Targeting both views, not pre-selecting specific tags as at least one view has filters.',
          );
        }
      }

      // Create tag options
      const tagOptions: (vscode.QuickPickItem & { tag: string })[] = Array.from(
        tagCounts.entries(),
      ).map(([tag, count]) => ({
        label: `$(tag) ${tag}`,
        description: `(${count} snapshot${count !== 1 ? 's' : ''})`,
        // Set picked based on the determined initial state (only if not picking "Show All")
        picked: !showAllInitiallyPicked && initiallyPickedTags.has(tag),
        tag, // Store the raw tag value
      }));
      tagOptions.sort((a, b) => a.tag.localeCompare(b.tag));

      // Add "Show All" option
      const showAllOption: vscode.QuickPickItem = {
        label: '$(clear-all) Show All (Clear Tag Filter)',
        description: 'Remove all tag filters',
        picked: showAllInitiallyPicked, // Pre-select "Show All" based on logic above
      };

      // Create QuickPick
      const quickPick = vscode.window.createQuickPick();
      quickPick.title = 'Filter Snapshots by Tags';
      quickPick.placeholder = "Select tags to filter by (or 'Show All')";
      quickPick.canSelectMany = true;
      quickPick.items = [showAllOption, ...tagOptions];
      quickPick.selectedItems = quickPick.items.filter((item) => item.picked); // Set initial selection based on 'picked' property

      quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems;
        quickPick.hide(); // Hide immediately after accept

        const clearFilter = selection.some((item) =>
          item.label.includes('Show All'),
        );
        const selectedTags = clearFilter
          ? []
          : (selection as (vscode.QuickPickItem & { tag?: string })[])
              .map((item) => item.tag)
              .filter((tag): tag is string => Boolean(tag));

        log(
          `Applying tag filter. Clear: ${clearFilter}, Tags: ${selectedTags.join(
            ', ',
          )}`,
        );

        // Apply the filter to the previously determined target providers
        applyFilterToProviders(targetProviders, { tags: selectedTags });

        // Show confirmation
        const targetDesc =
          targetProviders.length > 1 ? 'both views' : 'active view';
        vscode.window.showInformationMessage(
          clearFilter
            ? `Tag filter cleared for ${targetDesc}`
            : `Filtering by ${
                selectedTags.length
              } tags in ${targetDesc}: ${selectedTags.join(', ')}`,
        );
      });

      quickPick.onDidHide(() => quickPick.dispose()); // Dispose on hide
      quickPick.show();
    },
  );
  context.subscriptions.push(filterByTagsCmd);

  // --- Favorites filter command ---
  const filterByFavoritesCmd = vscode.commands.registerCommand(
    'vscode-snapshots.filterByFavorites',
    async () => {
      log('filterByFavorites command executed');

      // Ask where to apply the filter and get target providers
      const targetProviders = await getTargetProviders('favorites');
      if (!targetProviders) return; // User cancelled target selection

      // Determine initial value based on target(s)
      let currentFilterValue = false; // Default to showing all
      if (targetProviders.length === 1) {
        currentFilterValue = targetProviders[0].getFilterFavoritesOnly();
        logVerbose(
          `Pre-selecting favorites filter based on active view: ${currentFilterValue}`,
        );
      } else {
        // For 'Both', check if *both* are currently filtering by favorites
        currentFilterValue =
          snapshotTreeDataProvider.getFilterFavoritesOnly() &&
          autoSnapshotTreeDataProvider.getFilterFavoritesOnly();
        logVerbose(
          `Pre-selecting favorites filter based on both views: ${currentFilterValue}`,
        );
      }

      const options = [
        {
          label: 'Show All Snapshots',
          description: 'Include non-favorites',
          value: false,
          picked: !currentFilterValue,
        },
        {
          label: 'Show Only Favorites $(star-full)',
          description: 'Exclude non-favorites',
          value: true,
          picked: currentFilterValue,
        },
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Filter by favorite status',
        title: 'Filter by Favorites',
      });

      if (!selected) {
        return; // User cancelled
      }

      // Apply the filter
      applyFilterToProviders(targetProviders, {
        favoritesOnly: selected.value,
      });

      // Show confirmation
      const targetDesc =
        targetProviders.length > 1 ? 'both views' : 'active view';
      vscode.window.showInformationMessage(
        `${
          selected.value
            ? 'Showing only favorite snapshots'
            : 'Showing all snapshots'
        } in ${targetDesc}`,
      );
    },
  );
  context.subscriptions.push(filterByFavoritesCmd);

  // --- File filter command ---
  const filterByFileCmd = vscode.commands.registerCommand(
    'vscode-snapshots.filterByFile',
    async () => {
      log('filterByFile command executed');

      // Ask where to apply the filter and get target providers
      const targetProviders = await getTargetProviders('file pattern');
      if (!targetProviders) return; // User cancelled target selection

      // Get current file if any is open (for initial value suggestion)
      let initialValue = '';
      if (vscode.window.activeTextEditor) {
        const currentFilePath =
          vscode.window.activeTextEditor.document.uri.fsPath;
        const workspaceRoot = snapshotManager.getWorkspaceRoot();
        if (workspaceRoot && currentFilePath.startsWith(workspaceRoot)) {
          initialValue = path.relative(workspaceRoot, currentFilePath);
        }
      }
      // If targeting only one view, use its current file filter as initial value
      if (targetProviders.length === 1) {
        initialValue =
          targetProviders[0].getFilterFilePattern() || initialValue; // Use provider's value if set
        logVerbose(
          `Setting initial file pattern based on active view: "${initialValue}"`,
        );
      } else {
        // If targeting both, check if they have the *same* filter applied
        const manualPattern = snapshotTreeDataProvider.getFilterFilePattern();
        const autoPattern = autoSnapshotTreeDataProvider.getFilterFilePattern();
        if (manualPattern && manualPattern === autoPattern) {
          initialValue = manualPattern;
          logVerbose(
            `Setting initial file pattern based on both views having same filter: "${initialValue}"`,
          );
        } else {
          logVerbose(
            `Not setting initial file pattern for both views (filters differ or none set).`,
          );
        }
      }

      // Show input box for file path pattern
      const filePattern = await vscode.window.showInputBox({
        prompt:
          'Enter file path or pattern to filter snapshots (leave empty to clear)',
        placeHolder: 'e.g., src/components/*.ts or exact/file/path.js',
        value: initialValue,
        title: 'Filter by File Pattern',
      });

      if (filePattern === undefined) {
        return; // User cancelled
      }

      const patternToApply = filePattern.trim() ? filePattern.trim() : null; // Use null to clear

      // Apply the filter
      applyFilterToProviders(targetProviders, { filePattern: patternToApply });

      // Show confirmation
      const targetDesc =
        targetProviders.length > 1 ? 'both views' : 'active view';
      vscode.window.showInformationMessage(
        patternToApply
          ? `Filtering snapshots containing files matching "${patternToApply}" in ${targetDesc}`
          : `File filter cleared for ${targetDesc}`,
      );
    },
  );
  context.subscriptions.push(filterByFileCmd);

  // --- Clear all filters command ---
  const clearAllFiltersCmd = vscode.commands.registerCommand(
    'vscode-snapshots.clearAllFilters',
    async () => {
      log('clearAllFilters command executed');

      // Ask which view(s) to clear filters for
      const targetProviders = await getTargetProviders('clear all filters');
      if (!targetProviders) return; // User cancelled target selection

      // Reset all filters for the target provider(s)
      log(`Clearing all filters for ${targetProviders.length} provider(s).`);
      applyFilterToProviders(targetProviders, {
        startDate: null,
        endDate: null,
        tags: [],
        favoritesOnly: false,
        filePattern: null,
      });

      // Show confirmation
      const targetDesc =
        targetProviders.length > 1 ? 'both views' : 'active view';
      vscode.window.showInformationMessage(
        `All snapshot filters cleared for ${targetDesc}`,
      );
    },
  );
  context.subscriptions.push(clearAllFiltersCmd);

  log('All filter commands registered successfully');
}

function registerDiagnosticCommand({ context }: CommandDependencies): void {
  log('Registering diagnostic command...');
  const diagnosticCommand = vscode.commands.registerCommand(
    'vscode-snapshots.diagnostics',
    () => {
      showOutputChannel();
      log('\n--- DIAGNOSTICS ---');
      log(`Timestamp: ${new Date().toISOString()}`);
      log(`Extension path: ${context.extensionPath}`);
      log(`Global state keys: ${Object.keys(context.globalState).join(', ')}`);
      log(
        `Workspace state keys: ${Object.keys(context.workspaceState).join(
          ', ',
        )}`,
      );

      // Check if our commands are registered
      const commands = [
        'vscode-snapshots.takeSnapshot',
        'vscode-snapshots.viewSnapshots',
        'vscode-snapshots.jumpToSnapshot',
        'vscode-snapshots.previousSnapshot',
        'vscode-snapshots.nextSnapshot',
        // Add other commands as needed
      ];

      log('\nChecking commands:');
      vscode.commands.getCommands(true).then((allCommands) => {
        for (const cmd of commands) {
          const isRegistered = allCommands.includes(cmd);
          log(`${cmd}: ${isRegistered ? 'REGISTERED ✓' : 'NOT REGISTERED ✗'}`);
        }

        log('\nAll VS Code commands containing "snapshot":');
        const snapshotCommands = allCommands.filter((cmd) =>
          cmd.toLowerCase().includes('snapshot'),
        );
        for (const cmd of snapshotCommands) {
          log(`  - ${cmd}`);
        }
      });

      vscode.window.showInformationMessage(
        'CodeLapse diagnostics logged to output channel',
      );
    },
  );
  context.subscriptions.push(diagnosticCommand);
  log('Registered diagnostic command');
}

function registerSemanticIndexCommand({
  context,
  semanticSearchService,
}: CommandDependencies): void {
  log('Registering semanticIndex command...');
  const indexCmd = vscode.commands.registerCommand(
    'vscode-snapshots.indexForSemanticSearch',
    async () => {
      log('indexForSemanticSearch command executed');

      // Check if semantic search is enabled
      const config = vscode.workspace.getConfiguration('vscode-snapshots');
      const semanticSearchEnabled = config.get<boolean>(
        'semanticSearch.enabled',
        true,
      );

      if (!semanticSearchEnabled) {
        const enable = await vscode.window.showInformationMessage(
          'Semantic search is disabled in settings. Would you like to enable it?',
          'Enable',
          'Cancel',
        );

        if (enable === 'Enable') {
          config.update(
            'semanticSearch.enabled',
            true,
            vscode.ConfigurationTarget.Global,
          );
        } else {
          return;
        }
      }

      try {
        await semanticSearchService.indexAllSnapshots();
      } catch (error) {
        // A user-initiated cancel is not a failure. The indexing run now stops
        // at a cancellation boundary instead of running to completion behind a
        // toast, so it reaches here as a CancellationError.
        if (isCancellationError(error)) {
          vscode.window.showInformationMessage('Indexing cancelled');
          return;
        }
        vscode.window.showErrorMessage(`Indexing failed: ${error}`);
      }
    },
  );

  context.subscriptions.push(indexCmd);
  log('semanticIndex command registered successfully');
}

function registerSemanticSearchCommand({
  context,
  semanticSearchWebview,
}: CommandDependencies): void {
  log('Registering semanticSearch command...');
  const searchCmd = vscode.commands.registerCommand(
    'vscode-snapshots.searchSnapshots',
    async () => {
      log('searchSnapshots command executed');

      // Check if semantic search is enabled
      const config = vscode.workspace.getConfiguration('vscode-snapshots');
      const semanticSearchEnabled = config.get<boolean>(
        'semanticSearch.enabled',
        true,
      );

      if (!semanticSearchEnabled) {
        vscode.window
          .showInformationMessage(
            'Semantic search is disabled in settings. Would you like to enable it?',
            'Enable',
            'Cancel',
          )
          .then((selection) => {
            if (selection === 'Enable') {
              config.update(
                'semanticSearch.enabled',
                true,
                vscode.ConfigurationTarget.Global,
              );
              vscode.window.showInformationMessage(
                'Semantic search enabled. Please run the search command again.',
              );
            }
          });
        return;
      }

      // Show the search UI
      semanticSearchWebview.show();
    },
  );

  context.subscriptions.push(searchCmd);
  log('semanticSearch command registered successfully');
}

// --- Git Integration Command ---

function registerCreateGitCommitCommand({
  context,
  snapshotManager,
  gitApi,
}: CommandDependencies): void {
  log('Registering createGitCommitFromSnapshot command...');

  const createCommitCmd = vscode.commands.registerCommand(
    'vscode-snapshots.createGitCommitFromSnapshot',
    async (item: SnapshotTreeItem) => {
      // 1. Check prerequisites
      const commitEnabled =
        vscode.workspace
          .getConfiguration('vscode-snapshots.git')
          .get<boolean>('commitFromSnapshotEnabled', true) ?? true;

      if (!commitEnabled) {
        log('Create commit from snapshot command disabled by configuration.');
        vscode.window.showInformationMessage(
          'Creating Git commits from snapshots is disabled in settings.',
        );
        return;
      }

      if (!gitApi) {
        log('Create commit command called but Git API is not available.');
        vscode.window.showErrorMessage(
          'Git API is not available. Cannot create commit.',
        );
        return;
      }

      if (!item || !item.snapshot || item.contextValue !== 'snapshotItem') {
        log('createGitCommitFromSnapshot called with invalid item.');
        vscode.window.showErrorMessage(
          'Run this command from a snapshot in the CodeLapse view.',
        );
        return;
      }

      const { snapshot } = item;
      const workspaceRoot = snapshotManager.getWorkspaceRoot();
      if (!workspaceRoot) {
        log('Cannot create commit: No workspace folder open.');
        vscode.window.showErrorMessage(
          'Cannot create commit: No workspace folder open.',
        );
        return;
      }

      // Find the Git repository for this workspace
      const repo = gitApi.getRepository(vscode.Uri.file(workspaceRoot));
      if (!repo) {
        log('Cannot create commit: Git repository not found for workspace.');
        vscode.window.showErrorMessage(
          'Cannot create commit: Git repository not found for this workspace.',
        );
        return;
      }

      log(
        `createGitCommitFromSnapshot command executed for snapshot ID: ${snapshot.id}`,
      );

      // 2. Get Commit Message
      const defaultCommitMessage = `Snapshot ${snapshot.id}: ${
        snapshot.description || new Date(snapshot.timestamp).toLocaleString()
      }`;
      const commitMessage = await vscode.window.showInputBox({
        prompt: 'Enter commit message',
        value: defaultCommitMessage,
        placeHolder: 'Commit message describing the snapshot state',
      });

      if (commitMessage === undefined) {
        log('Commit message input cancelled by user.');
        vscode.window.showInformationMessage('Commit creation cancelled.');
        return;
      }

      if (!commitMessage.trim()) {
        log('Commit message cannot be empty.');
        vscode.window.showErrorMessage('Commit message cannot be empty.');
        return;
      }

      // 3. Restore Snapshot - avoid relying on command return value
      try {
        log(
          `Triggering restore operation via jumpToSnapshot for ${snapshot.id} before commit.`,
        );

        // Execute jumpToSnapshot command which handles UI/confirmation. It is
        // awaited, and the restore writes the index before it returns, so
        // there is nothing left to "wait for" afterwards.
        await vscode.commands.executeCommand(
          'vscode-snapshots.jumpToSnapshot',
          snapshot.id,
        );

        // Verify the restoration happened by asking which snapshot the
        // workspace now reflects, rather than comparing array positions that a
        // concurrent prune could invalidate.
        const isRestored = snapshotManager.isSnapshotActive(snapshot.id);
        const targetIndex = snapshotManager
          .getSnapshots()
          .findIndex((s) => s.id === snapshot.id);

        // If the workspace is not at the target snapshot, restoration failed or was cancelled
        if (!isRestored) {
          log(
            `Restore verification failed. Active snapshot: ${
              snapshotManager.getActiveSnapshot()?.id ?? 'none'
            }, target index: ${targetIndex}`,
          );
          vscode.window.showInformationMessage(
            'Restore operation cancelled or failed. No commit created.',
          );
          return;
        }

        log(
          `Snapshot ${snapshot.id} restored successfully. Verified by index change.`,
        );
      } catch (restoreError: unknown) {
        // jumpToSnapshot should show its own errors, but log here too.
        log(
          `Restore operation failed or was cancelled during commit creation: ${
            restoreError instanceof Error ? restoreError.message : restoreError
          }`,
        );
        // Don't show another error message if jumpToSnapshot already did.
        return; // Stop commit process if restore failed/cancelled
      }

      // 4. Stage and Commit
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating Git commit from snapshot ${snapshot.id.substring(
            0,
            8,
          )}...`,
          cancellable: false,
        },
        async (progress) => {
          try {
            progress.report({ message: 'Committing...' });
            log('Committing all changes after restore...');

            // Additional logging to help diagnose any issues
            try {
              await stageAndCommit(repo, commitMessage);
              log(`Git commit operation completed successfully`);
            } catch (commitErr: unknown) {
              log(
                `Git commit specific error: ${
                  commitErr instanceof Error ? commitErr.message : commitErr
                }`,
              );
              throw commitErr; // Re-throw to be caught by outer catch
            }

            log(`Successfully created Git commit from snapshot ${snapshot.id}`);
            vscode.window.showInformationMessage(
              `Successfully created Git commit from snapshot.`,
            );
          } catch (commitError: unknown) {
            log(
              `Error during Git stage or commit: ${
                commitError instanceof Error ? commitError.message : commitError
              }`,
            );
            vscode.window.showErrorMessage(
              `Failed to create Git commit: ${
                commitError instanceof Error ? commitError.message : commitError
              }`,
            );
          }
        },
      );
    },
  );

  context.subscriptions.push(createCommitCmd);
  log('createGitCommitFromSnapshot command registered successfully');
}

// Helper functions for preserving editor state during transitions
async function preserveEditorViewStates(): Promise<Map<string, EditorState>> {
  const states = new Map<string, EditorState>();

  for (const editor of vscode.window.visibleTextEditors) {
    // Only track file documents
    if (editor.document.uri.scheme !== 'file') continue;

    states.set(editor.document.uri.toString(), {
      uri: editor.document.uri,
      viewColumn: editor.viewColumn,
      selection: editor.selection,
      visibleRanges: editor.visibleRanges,
      options: editor.options,
    });
  }

  return states;
}

async function restoreEditorViewStates(
  states: Map<string, EditorState>,
): Promise<void> {
  for (const [uriString, state] of states.entries()) {
    try {
      // Check if the document is still open
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === uriString,
      );

      if (editor) {
        // Document is still open, restore state
        editor.selection = state.selection;
        editor.revealRange(
          state.visibleRanges[0],
          vscode.TextEditorRevealType.Default,
        );
      } else {
        // Document was closed, reopen it
        const document = await vscode.workspace.openTextDocument(state.uri);
        const newEditor = await vscode.window.showTextDocument(
          document,
          state.viewColumn || vscode.ViewColumn.Active,
        );

        // Then restore state
        newEditor.selection = state.selection;
        newEditor.revealRange(
          state.visibleRanges[0],
          vscode.TextEditorRevealType.Default,
        );
      }
    } catch (error) {
      // Log but continue with other editors
      log(`Error restoring editor state: ${error}`);
    }
  }
}

/**
 * Registers a command to show the extension logs in the output channel
 */
function registerShowLogsCommand({ context }: CommandDependencies): void {
  log('Registering showLogs command...');
  const showLogsCmd = vscode.commands.registerCommand(
    'vscode-snapshots.showLogs',
    () => {
      log('showLogs command executed');
      showOutputChannel();
    },
  );
  context.subscriptions.push(showLogsCmd);
  log('showLogs command registered successfully');
}

// Type for storing editor state
interface EditorState {
  uri: vscode.Uri;
  viewColumn?: vscode.ViewColumn;
  selection: vscode.Selection;
  visibleRanges: readonly vscode.Range[];
  options: vscode.TextEditorOptions;
}

/**
 * Stages the working tree and commits it.
 *
 * Uses `commit(message, { all: true })` rather than `add([])`. The Git
 * extension's `add` maps to `git add -- <pathspecs>`, and with no pathspecs git
 * prints "Nothing specified, nothing added" -- verified against real git. So a
 * commit following `add([])` recorded only whatever was already staged, which is
 * either nothing or unrelated files. `CommitOptions.all` is the API's own way to
 * say "commit the working tree" and does not depend on how an empty array is
 * interpreted.
 *
 * Note the scope: `all` covers changes to tracked files. Files the snapshot
 * restored that git has never seen are untracked, and `git commit -a` does not
 * include those -- also verified against real git. Selecting untracked files
 * would need an explicit pathspec, which is a behaviour change this fix does not
 * make.
 *
 * Extracted from the command so the staging contract is testable without a real
 * repository; the parameter type is the real `CommitOptions`, so a double that
 * satisfies it is proof the call shape is right.
 */
export async function stageAndCommit(
  repo: { commit: (message: string, opts?: CommitOptions) => Promise<void> },
  message: string,
): Promise<void> {
  await repo.commit(message, { all: true });
}
