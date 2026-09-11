import * as vscode from 'vscode';
import { resolveSetting } from './configSource';

const CONFIG_SECTION = 'vscode-snapshots';

export function getSnapshotLocation(): string {
  return resolveSetting('snapshotLocation', '.snapshots').value;
}

export function getMaxSnapshots(): number {
  return resolveSetting('maxSnapshots', 50).value;
}

// Note: Logging config is handled directly in logger.ts for simplicity
// as it needs to react to changes immediately. If more complex config
// interactions are needed later, this could be centralized here.

// `getGitAutoSnapshotEnabled` was removed along with `git.autoSnapshotBeforeOperation`
// and the unreachable command interception it fed. Nothing invoked the wrapper
// commands, so the setting could never have an effect. See docs/KNOWN_ISSUES.md.

// Add a type for auto-snapshot rules
export interface AutoSnapshotRule {
  pattern: string;
  intervalMinutes: number;
}

export function getAutoSnapshotRules(): AutoSnapshotRule[] {
  return resolveSetting<AutoSnapshotRule[]>('autoSnapshot.rules', []).value;
}

export function getShowOnlyChangedFiles(): boolean {
  return resolveSetting('showOnlyChangedFiles', true).value;
}

export interface UxSettings {
  showWelcomeOnStartup: boolean;
  confirmRestoreOperations: boolean;
  useAnimations: boolean;
  showKeyboardShortcutHints: boolean;
}

/**
 * Reads a boolean setting, ignoring a stored value of the wrong type.
 *
 * settings.json can be hand-edited, and a truthy string or a 0 would otherwise
 * decide whether a confirmation dialog appears.
 */
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * The `ux.*` settings.
 *
 * All four were declared, documented in the user guide and surfaced as editable
 * rows in the Settings tree while no code read any of them, so turning off the
 * restore confirmation still prompted.
 *
 * Read at call time rather than cached, so toggling a setting takes effect on
 * the next action instead of requiring a window reload. The keys are written
 * inline so the manifest-consistency guard can see each one being read.
 */
export function getUxSettings(): UxSettings {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    showWelcomeOnStartup: asBoolean(
      config.get<boolean>('ux.showWelcomeOnStartup', true),
      true,
    ),
    confirmRestoreOperations: asBoolean(
      config.get<boolean>('ux.confirmRestoreOperations', true),
      true,
    ),
    useAnimations: asBoolean(
      config.get<boolean>('ux.useAnimations', true),
      true,
    ),
    showKeyboardShortcutHints: asBoolean(
      config.get<boolean>('ux.showKeyboardShortcutHints', true),
      true,
    ),
  };
}

// Add functions for any other configuration settings as needed
