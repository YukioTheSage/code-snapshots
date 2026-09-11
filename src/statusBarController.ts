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

// Time-ago text is a function of the wall clock, not of snapshot events, so
// something has to wake the controller even when nothing happens. A 60s poll is
// the coarse compromise: the old 5s poll woke the host 12 times a minute for
// mostly-unchanged text, while 60s keeps the "5m ago" semantics honest at worst
// one minute stale and costs one recompute per minute while idle.
const CLOCK_POLL_INTERVAL_MS = 60_000;

export class StatusBarController implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private snapshotManager: SnapshotManager;
  private disposables: vscode.Disposable[] = [];
  private clockTimer: ReturnType<typeof setInterval> | undefined;

  constructor(snapshotManager: SnapshotManager) {
    this.snapshotManager = snapshotManager;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );

    // Register commands
    const viewSnapshotsCommand = 'vscode-snapshots.viewSnapshots';
    this.statusBarItem.command = viewSnapshotsCommand;

    // Hybrid refresh: the subscription handles list changes exactly when they
    // happen, and a coarse clock tick exists only so the "time ago" text does
    // not freeze between events. Neither half is sufficient on its own -- a
    // subscription alone leaves "5m ago" on screen forever until some unrelated
    // event fires, and the 5-second poll this replaced rewrote the item 12
    // times a minute whether or not anything had changed.
    this.disposables.push(
      this.snapshotManager.onDidChangeSnapshots(() => this.updateStatusBar()),
    );

    // Time-ago freshness only: one recompute a minute, unconditionally, so the
    // empty state refreshes too.
    this.clockTimer = setInterval(() => {
      this.updateStatusBar();
    }, CLOCK_POLL_INTERVAL_MS);

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
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = undefined;
    }
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
