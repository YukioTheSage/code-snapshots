import * as vscode from 'vscode';
import * as path from 'path';
import { SnapshotManager } from './snapshotManager';
import { log, logVerbose } from './logger';
import { getAutoSnapshotRules } from './config';
import { pathMatchesPattern } from './utils/pathMatching';

const NOTIFICATION_THRESHOLD_MINUTES = 15; // Configurable? For now, 15 minutes
const CHECK_INTERVAL_MINUTES = 5; // Check every 5 minutes

/**
 * Monitors file saves and snapshot events, prompting the user
 * if changes go unsnapshotted past a threshold.
 */
export class ChangeNotifier implements vscode.Disposable {
  private snapshotManager: SnapshotManager;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  private lastSnapshotTimestamp: number | null = null;
  private firstSaveTimestampAfterLastSnapshot: number | null = null;
  private notificationShownSinceLastSnapshot = false;
  private notificationTimer: NodeJS.Timeout | null = null;
  private rulesCheckTimer: NodeJS.Timeout | null = null;

  // Add tracking for rule-based snapshots
  private lastRuleBasedSnapshotTimes: Map<string, number> = new Map();

  constructor(
    context: vscode.ExtensionContext,
    snapshotManager: SnapshotManager,
  ) {
    this.context = context;
    this.snapshotManager = snapshotManager;

    this.initialize();

    log(
      `ChangeNotifier initialized. Notification threshold: ${NOTIFICATION_THRESHOLD_MINUTES} min, Check interval: ${CHECK_INTERVAL_MINUTES} min.`,
    );
  }

  /**
   * Set up event listeners and timers for change notifications and rules.
   */
  private initialize(): void {
    // Initialize state based on current snapshots
    this.updateLastSnapshotTimestamp();

    // Register listeners
    this.disposables.push(
      this.snapshotManager.onDidChangeSnapshots(() => {
        this.handleSnapshotChange();
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        this.handleDocumentSave(document);
      }),
    );

    // Start periodic check timer
    this.notificationTimer = setInterval(() => {
      this.checkAndShowNotification();
    }, CHECK_INTERVAL_MINUTES * 60 * 1000); // Check interval

    this.rulesCheckTimer = setInterval(() => {
      this.checkAllRuleBasedAutoSnapshots();
    }, 60 * 1000); // Check rules every minute

    this.disposables.push({
      dispose: () => {
        if (this.notificationTimer) {
          clearInterval(this.notificationTimer);
          this.notificationTimer = null;
          log('ChangeNotifier notification timer cleared.');
        }
        if (this.rulesCheckTimer) {
          clearInterval(this.rulesCheckTimer);
          this.rulesCheckTimer = null;
          log('ChangeNotifier rules check timer cleared.');
        }
      },
    });
  }

  /**
   * Evaluate all configured auto-snapshot rules and trigger snapshots when matched.
   */
  private async checkAllRuleBasedAutoSnapshots(): Promise<void> {
    const workspaceRoot = this.snapshotManager.getWorkspaceRoot();
    if (!workspaceRoot) {
      logVerbose('Cannot check rule-based auto-snapshot: No workspace root');
      return;
    }

    // Get configured auto-snapshot rules
    const rules = getAutoSnapshotRules();
    if (rules.length === 0) {
      // No rules configured, skip processing
      return;
    }

    const now = Date.now();
    logVerbose(`Periodically checking ${rules.length} auto-snapshot rules`);

    // Process each rule
    for (const rule of rules) {
      try {
        const lastSnapshotTime =
          this.lastRuleBasedSnapshotTimes.get(rule.pattern) || 0;
        const minutesSinceLastSnapshot = (now - lastSnapshotTime) / (1000 * 60);

        logVerbose(
          `Checking rule pattern ${
            rule.pattern
          }. Minutes since last snapshot: ${minutesSinceLastSnapshot.toFixed(
            1,
          )}`,
        );

        // Check if enough time has passed for this rule
        if (minutesSinceLastSnapshot >= rule.intervalMinutes) {
          // Find files matching pattern
          const matchingFiles = await this.findFilesMatchingRule(
            workspaceRoot,
            rule.pattern,
          );

          if (matchingFiles.length === 0) {
            logVerbose(
              `No files found matching pattern: ${rule.pattern}, skipping auto-snapshot`,
            );
            continue;
          }

          log(
            `Time-based auto-snapshot triggered for pattern: ${rule.pattern}`,
          );

          try {
            // Take a snapshot with rule information
            await this.snapshotManager.takeSnapshot(
              `Auto-snapshot for ${rule.pattern}`,
              {
                tags: ['auto', 'rule-based', 'time-triggered'],
                notes: `Automatically triggered by rule: ${
                  rule.pattern
                } after ${minutesSinceLastSnapshot.toFixed(1)} minutes`,
                isSelective: true,
                selectedFiles: matchingFiles, // Snapshot only matching files
              },
            );

            // Update last snapshot time for this rule
            this.lastRuleBasedSnapshotTimes.set(rule.pattern, now);
            this.resetNotificationState(); // Reset normal notification state as well

            log(`Rule-based auto-snapshot taken for pattern: ${rule.pattern}`);

            // Show unobtrusive notification
            vscode.window
              .showInformationMessage(
                `Auto-snapshot taken for pattern: ${rule.pattern}`,
                'View Rules',
              )
              .then((selection) => {
                if (selection === 'View Rules') {
                  vscode.commands.executeCommand(
                    'vscode-snapshots.manageAutoSnapshotRules',
                  );
                }
              });
          } catch (error) {
            log(`Error taking rule-based auto-snapshot: ${error}`);
            // Don't show error to user to avoid disrupting their workflow
          }
        }
      } catch (error) {
        // Log error but continue checking other rules
        log(`Error processing auto-snapshot rule ${rule.pattern}: ${error}`);
      }
    }
  }

  private async findFilesMatchingRule(
    workspaceRoot: string,
    pattern: string,
  ): Promise<string[]> {
    try {
      // Use vscode API to find files matching the pattern
      let files: vscode.Uri[];

      // For patterns that look like glob patterns
      if (
        pattern.includes('*') ||
        pattern.includes('?') ||
        pattern.includes('{')
      ) {
        files = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
      } else {
        // For exact file paths or directory paths
        files = await vscode.workspace.findFiles(
          `**/${pattern}/**`,
          '**/node_modules/**',
        );

        // If no files found, try as a direct file path
        if (files.length === 0) {
          files = await vscode.workspace.findFiles(
            `**/${pattern}`,
            '**/node_modules/**',
          );
        }
      }

      // Convert to relative paths
      return files.map((file) => path.relative(workspaceRoot, file.fsPath));
    } catch (error) {
      log(`Error finding files for pattern ${pattern}: ${error}`);
      return [];
    }
  }

  private updateLastSnapshotTimestamp(): void {
    const snapshots = this.snapshotManager.getSnapshots();
    this.lastSnapshotTimestamp =
      snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : null;
    log(
      `ChangeNotifier: Initial last snapshot timestamp: ${this.lastSnapshotTimestamp}`,
    );
  }

  private handleSnapshotChange(): void {
    const snapshots = this.snapshotManager.getSnapshots();
    const newLastTimestamp =
      snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : null;

    if (newLastTimestamp !== this.lastSnapshotTimestamp) {
      log(
        `ChangeNotifier: Detected snapshot change. Resetting notification state. Old: ${this.lastSnapshotTimestamp}, New: ${newLastTimestamp}`,
      );
      this.lastSnapshotTimestamp = newLastTimestamp;
      this.resetNotificationState();
    }
  }

  private handleDocumentSave(document: vscode.TextDocument): void {
    // Ignore saves in .snapshot directories or non-workspace files
    if (
      document.uri.scheme !== 'file' ||
      document.uri.fsPath.includes('.snapshots') // TODO: Use config/gitignore parser?
    ) {
      return;
    }

    // Only track if a snapshot exists and we haven't tracked a save since the last one
    if (
      (this.lastSnapshotTimestamp !== null ||
        this.lastSnapshotTimestamp === null) &&
      this.firstSaveTimestampAfterLastSnapshot === null
    ) {
      this.firstSaveTimestampAfterLastSnapshot = Date.now();
      log(
        `ChangeNotifier: First save detected${
          this.lastSnapshotTimestamp
            ? ' after last snapshot'
            : ' (no snapshots yet)'
        }. Timestamp: ${this.firstSaveTimestampAfterLastSnapshot}`,
      );
    }
    // Also check rule-based snapshots
    this.checkRuleBasedAutoSnapshot(document);
  }

  private checkAndShowNotification(): void {
    if (
      this.firstSaveTimestampAfterLastSnapshot &&
      !this.notificationShownSinceLastSnapshot
    ) {
      const now = Date.now();
      const minutesSinceFirstSave =
        (now - this.firstSaveTimestampAfterLastSnapshot) / (1000 * 60);

      if (minutesSinceFirstSave >= NOTIFICATION_THRESHOLD_MINUTES) {
        log(
          `ChangeNotifier: Threshold reached (${minutesSinceFirstSave.toFixed(
            1,
          )} min). Showing notification.`,
        );
        this.notificationShownSinceLastSnapshot = true; // Set flag to prevent repeat until next snapshot
        vscode.window
          .showInformationMessage(
            `It's been over ${NOTIFICATION_THRESHOLD_MINUTES} minutes since your last snapshot and changes were saved. Consider taking one now.`,
            'Take Snapshot',
          )
          .then((selection) => {
            if (selection === 'Take Snapshot') {
              // Execute command - assumes command is registered
              vscode.commands.executeCommand('vscode-snapshots.takeSnapshot');
              // Note: takeSnapshot command handler should ideally call resetNotificationState
            }
          });
      }
    }
  }

  private async checkRuleBasedAutoSnapshot(
    document: vscode.TextDocument,
  ): Promise<void> {
    // Skip non-file documents and files in snapshot directory
    if (
      document.uri.scheme !== 'file' ||
      document.uri.fsPath.includes('.snapshots')
    ) {
      return;
    }

    const workspaceRoot = this.snapshotManager.getWorkspaceRoot();
    if (!workspaceRoot) {
      logVerbose('Cannot check rule-based auto-snapshot: No workspace root');
      return;
    }

    // Get relative path for matching rules
    const relativePath = path.relative(workspaceRoot, document.uri.fsPath);
    if (!relativePath || relativePath.startsWith('..')) {
      logVerbose(
        `File ${document.uri.fsPath} is outside workspace, skipping rule check`,
      );
      return;
    }

    // Get configured auto-snapshot rules
    const rules = getAutoSnapshotRules();
    if (rules.length === 0) {
      // No rules configured, skip processing
      return;
    }

    logVerbose(
      `Checking ${rules.length} auto-snapshot rules for ${relativePath}`,
    );

    // Process each rule
    for (const rule of rules) {
      try {
        // Check if file matches this rule's pattern using pathMatchesPattern helper
        if (this.pathMatchesPattern(relativePath, rule.pattern)) {
          const now = Date.now();
          const lastSnapshotTime =
            this.lastRuleBasedSnapshotTimes.get(rule.pattern) || 0;
          const minutesSinceLastSnapshot =
            (now - lastSnapshotTime) / (1000 * 60);

          logVerbose(
            `File ${relativePath} matches rule pattern ${
              rule.pattern
            }. Minutes since last snapshot: ${minutesSinceLastSnapshot.toFixed(
              1,
            )}`,
          );

          // Check if enough time has passed for this rule
          if (minutesSinceLastSnapshot >= rule.intervalMinutes) {
            log(`Save-triggered auto-snapshot for pattern: ${rule.pattern}`);

            try {
              // Find all files matching this rule's pattern
              const matchingFiles = await this.findFilesMatchingRule(
                workspaceRoot,
                rule.pattern,
              );

              // Take a snapshot with rule information
              await this.snapshotManager.takeSnapshot(
                `Auto-snapshot for ${rule.pattern}`,
                {
                  tags: ['auto', 'rule-based', 'save-triggered'],
                  notes: `Automatically triggered by save of file matching rule: ${rule.pattern}`,
                  isSelective: true,
                  selectedFiles: matchingFiles, // Snapshot all matching files, not just the triggering one
                },
              );

              // Update last snapshot time for this rule
              this.lastRuleBasedSnapshotTimes.set(rule.pattern, now);
              this.resetNotificationState(); // Reset normal notification state as well

              log(
                `Rule-based auto-snapshot taken for pattern: ${rule.pattern}`,
              );

              // Show unobtrusive notification
              vscode.window
                .showInformationMessage(
                  `Auto-snapshot taken for '${relativePath}' matching pattern: ${rule.pattern}`,
                  'View Rules',
                )
                .then((selection) => {
                  if (selection === 'View Rules') {
                    vscode.commands.executeCommand(
                      'vscode-snapshots.manageAutoSnapshotRules',
                    );
                  }
                });
            } catch (error) {
              log(`Error taking rule-based auto-snapshot: ${error}`);
              // Don't show error to user to avoid disrupting their workflow
            }
          } else {
            logVerbose(
              `Not enough time elapsed for rule ${rule.pattern}. Needs ${
                rule.intervalMinutes
              } minutes, but only ${minutesSinceLastSnapshot.toFixed(
                1,
              )} minutes passed.`,
            );
          }
        }
      } catch (error) {
        // Log error but continue checking other rules
        log(`Error processing auto-snapshot rule ${rule.pattern}: ${error}`);
      }
    }
  }

  // Helper to match file paths against patterns (simple string or glob)
  private pathMatchesPattern(filePath: string, pattern: string): boolean {
    return pathMatchesPattern(filePath, pattern, { allowSubstring: false });
  }

  /**
   * Resets the notification state, typically after a snapshot is taken.
   */
  public resetNotificationState(): void {
    log('ChangeNotifier: Resetting notification state.');
    this.firstSaveTimestampAfterLastSnapshot = null;
    this.notificationShownSinceLastSnapshot = false;
  }

  dispose() {
    log('Disposing ChangeNotifier...');
    vscode.Disposable.from(...this.disposables).dispose();
    log('ChangeNotifier disposed.');
  }
}
