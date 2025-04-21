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

export class StatusBarController {
  private statusBarItem: vscode.StatusBarItem;
  private snapshotManager: SnapshotManager;
  private updateInterval: NodeJS.Timeout; // Track the interval for cleanup

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );

    // Update the status bar immediately
    this.updateStatusBar();

    // Register commands
    const viewSnapshotsCommand = 'vscode-snapshots.viewSnapshots';
    this.statusBarItem.command = viewSnapshotsCommand;

    // Show the status bar item
    this.statusBarItem.show();

    // Listen for snapshot changes
    this.updateInterval = setInterval(() => this.updateStatusBar(), 5000);
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
    clearInterval(this.updateInterval); // Clear the interval to prevent memory leak
  }
}
