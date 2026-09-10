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
    const currentIndex = this.snapshotManager.getCurrentSnapshotIndex();
    const totalSnapshots = snapshots.length;

    if (totalSnapshots === 0) {
      this.statusBarItem.text = '$(history) No Snapshots';
      this.statusBarItem.tooltip =
        'No snapshots taken yet.\nClick to view snapshots (if any appear).';
      return;
    }

    const lastSnapshot = snapshots[totalSnapshots - 1];
    const timeAgo = formatTimeAgo(lastSnapshot.timestamp);

    const currentSnapshot = currentIndex >= 0 ? snapshots[currentIndex] : null;

    if (currentSnapshot) {
      // Currently viewing a specific snapshot
      const currentTimestamp = new Date(currentSnapshot.timestamp);
      const formattedTime = currentTimestamp.toLocaleTimeString();
      this.statusBarItem.text = `$(history) ${timeAgo} | ${
        currentIndex + 1
      }/${totalSnapshots}`;
      this.statusBarItem.tooltip = `Last snapshot: ${timeAgo}\nViewing snapshot ${
        currentIndex + 1
      }/${totalSnapshots} (taken at ${formattedTime})\n${
        currentSnapshot.description || 'No description'
      }\nClick to view all snapshots`;
    } else {
      // Not viewing a specific snapshot (index is -1)
      this.statusBarItem.text = `$(history) ${timeAgo} | ${totalSnapshots} Snapshots`;
      this.statusBarItem.tooltip = `Last snapshot taken ${timeAgo}\nTotal snapshots: ${totalSnapshots}\nClick to view all snapshots`;
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
