import * as vscode from 'vscode';

const CONFIG_SECTION = 'vscode-snapshots';

export function getSnapshotLocation(): string {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<string>('snapshotLocation', '.snapshots');
}

export function getMaxSnapshots(): number {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>('maxSnapshots', 50);
}

// Note: Logging config is handled directly in logger.ts for simplicity
// as it needs to react to changes immediately. If more complex config
// interactions are needed later, this could be centralized here.

export function getGitAutoSnapshotEnabled(): boolean {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<boolean>('git.autoSnapshotBeforeOperation', false); // Default to false
}

// Add a type for auto-snapshot rules
export interface AutoSnapshotRule {
  pattern: string;
  intervalMinutes: number;
}

export function getAutoSnapshotRules(): AutoSnapshotRule[] {
  return vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<AutoSnapshotRule[]>('autoSnapshot.rules', []);
}

export function getShowOnlyChangedFiles(): boolean {
  return vscode.workspace
    .getConfiguration('vscode-snapshots')
    .get<boolean>('showOnlyChangedFiles', true); // true as default - show only changed files
}

// Add functions for any other configuration settings as needed
