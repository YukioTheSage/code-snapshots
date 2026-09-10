import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager';

// Helper function to format time difference
function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffSeconds = Math.round((now - timestamp) / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  if (diffSeconds < 60) {
    return 'now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
}

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private snapshotManager: SnapshotManager;
  private disposables: vscode.Disposable[] = [];

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );

    // Register commands
    const viewSnapshotsCommand = 'vscode-snapshots.viewSnapshots';
    this.statusBarItem.command = viewSnapshotsCommand;

    // Update on change rather than on a timer.
    //
    // The previous implementation polled every 5 seconds -- rewriting the item
    // 12 times a minute whether or not anything had changed, and still leaving
    // the "time ago" text up to 5 seconds stale. A subscription updates exactly
    // when the snapshot list changes, and the interval that kept the extension
    // host awake is gone.
    this.disposables.push(
      this.snapshotManager.onDidChangeSnapshots(() => this.updateStatusBar()),
    );

    // Update the status bar immediately
    this.updateStatusBar();

    // Show the status bar item
    this.statusBarItem.show();
  }

  /**
   * Update the status bar with current snapshot info
   */
  private updateStatusBar(): void {
    const snapshots = this.snapshotManager.getSnapshots();
    const totalSnapshots = snapshots.length;

    if (totalSnapshots === 0) {
      this.statusBarItem.text = '$(history) No Snapshots';
      this.statusBarItem.tooltip =
        'No snapshots taken yet.\nClick to take or view snapshots.';
      this.statusBarItem.accessibilityInformation = {
        label: 'CodeLapse: no snapshots',
      };
      return;
    }

    const lastSnapshot = snapshots[totalSnapshots - 1];
    const timeAgo = formatTimeAgo(lastSnapshot.timestamp);
    const active = this.snapshotManager.getActiveSnapshot();

    if (active) {
      const index = snapshots.findIndex((s) => s.id === active.id);
      this.statusBarItem.text = `$(history) ${timeAgo} | snapshot ${
        index + 1
      }/${totalSnapshots}`;
      this.statusBarItem.tooltip = `Last snapshot: ${timeAgo}\nWorkspace is at snapshot ${
        index + 1
      }/${totalSnapshots} (taken at ${new Date(
        active.timestamp,
      ).toLocaleTimeString()})\n${
        active.description || 'No description'
      }\nClick to view all snapshots`;
      this.statusBarItem.accessibilityInformation = {
        label: `CodeLapse: workspace is at snapshot ${
          index + 1
        } of ${totalSnapshots}, last snapshot ${timeAgo}`,
      };
    } else {
      // Detached: snapshots exist, but the workspace does not correspond to
      // one of them. This is the state a fresh window is in, and the state
      // after the active snapshot is deleted or pruned.
      this.statusBarItem.text = `$(history) ${timeAgo} | ${totalSnapshots} snapshots`;
      this.statusBarItem.tooltip = `Last snapshot taken ${timeAgo}\nWorkspace is not at any snapshot (${totalSnapshots} available)\nClick to view all snapshots`;
      this.statusBarItem.accessibilityInformation = {
        label: `CodeLapse: workspace is not at a snapshot, ${totalSnapshots} snapshots available, last taken ${timeAgo}`,
      };
    }
  }

  /**
   * Dispose of this controller
   */
  public dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
