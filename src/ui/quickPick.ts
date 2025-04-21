import * as vscode from 'vscode';
import { SnapshotManager } from '../snapshotManager'; // Adjust path

// Class for Quick Pick UI
export class SnapshotQuickPick {
  private snapshotManager: SnapshotManager;

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;
  }

  /**
   * Show quick pick UI to select a snapshot.
   * @returns The selected snapshot ID, or undefined if cancelled.
   */
  public async show(): Promise<string | undefined> {
    const snapshots = this.snapshotManager.getSnapshots();
    const currentIndex = this.snapshotManager.getCurrentSnapshotIndex();

    if (snapshots.length === 0) {
      vscode.window.showInformationMessage('No snapshots available');
      return;
    }

    // Format snapshots for quick pick with enhanced context
    const items = snapshots.map((snapshot, index) => {
      const date = new Date(snapshot.timestamp);
      const formattedDate = date.toLocaleString();

      // Get change summary
      const summary = this.snapshotManager.getSnapshotChangeSummary(
        snapshot.id,
      );
      const changeSummary = `+${summary.added} ~${summary.modified} -${summary.deleted}`;

      // Build rich description with context
      let description = snapshot.description || 'No description';

      // Add task reference if available
      if (snapshot.taskReference) {
        description = `[${snapshot.taskReference}] ${description}`;
      }

      // Add tags if available
      if (snapshot.tags && snapshot.tags.length > 0) {
        description = `${description} | Tags: ${snapshot.tags.join(', ')}`;
      }

      // Add favorite indicator
      const favoritePrefix = snapshot.isFavorite ? '★ ' : '';

      // Build detail with change summary and git info
      let detail = `${changeSummary} | ID: ${snapshot.id.substring(0, 8)}...`;

      if (snapshot.gitBranch) {
        detail += ` | Branch: ${snapshot.gitBranch}`;
      }

      if (snapshot.gitCommitHash) {
        detail += ` | Commit: ${snapshot.gitCommitHash.substring(0, 7)}`;
      }

      // Add notes preview if available and not too long
      if (snapshot.notes) {
        const notesPreview =
          snapshot.notes.length > 50
            ? snapshot.notes.substring(0, 47) + '...'
            : snapshot.notes;
        detail += `\n${notesPreview}`;
      }

      return {
        label: `${favoritePrefix}${
          index === currentIndex ? '● ' : ''
        }${formattedDate}`,
        description,
        detail,
        snapshotId: snapshot.id,
      };
    });

    // Show quick pick
    const selected = await vscode.window.showQuickPick(items.reverse(), {
      // Show newest first
      placeHolder: 'Select a snapshot to restore',
      matchOnDescription: true,
      matchOnDetail: true,
    });

    // Return the selected snapshot ID or undefined if cancelled
    return selected?.snapshotId;
  }
}
