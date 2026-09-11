import * as vscode from 'vscode';
import { ConfigManager } from 'codelapse-core';

const CONFIG_SECTION = 'vscode-snapshots';

export type SettingSource = 'settings' | 'codelapse.json' | 'default';

/**
 * Where a setting's effective value came from.
 *
 * The CLI writes `.vscode/codelapse.json` in both its modes; the extension's
 * Settings UI writes `settings.json`. Both are legitimate, so instead of
 * picking a winner by accident the precedence is explicit: a value the user
 * *explicitly set* in VS Code wins, then the shared workspace file, then the
 * caller's default.
 */
export function resolveSetting<T>(
  key: string,
  fallback: T,
): { value: T; source: SettingSource } {
  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const inspection =
    typeof configuration?.inspect === 'function'
      ? configuration.inspect<T>(key)
      : undefined;

  if (inspection && typeof inspection === 'object') {
    if (inspection.workspaceFolderValue !== undefined) {
      return { value: inspection.workspaceFolderValue, source: 'settings' };
    }
    if (inspection.workspaceValue !== undefined) {
      return { value: inspection.workspaceValue, source: 'settings' };
    }
    if (inspection.globalValue !== undefined) {
      return { value: inspection.globalValue, source: 'settings' };
    }
  } else if (
    typeof configuration?.get === 'function' &&
    inspection === undefined
  ) {
    // A test double or an older API surface without `inspect()`. The real VS
    // Code API always returns an inspection object, so this compatibility
    // branch cannot blur the settings-over-file precedence in production.
    const configured = configuration.get<T>(key, fallback);
    if (configured !== undefined) {
      return { value: configured, source: 'settings' };
    }
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  if (workspaceRoot) {
    try {
      const shared = new ConfigManager(workspaceRoot).getNested(key);
      if (shared !== undefined) {
        return { value: shared as T, source: 'codelapse.json' };
      }
    } catch {
      // A malformed or unreadable shared file must not make every setting read
      // fail; the caller's fallback is still a valid effective value.
    }
  }

  return { value: fallback, source: 'default' };
}