import * as vscode from 'vscode';
import { resolveSetting } from './configSource';

const CONFIG_SECTION = 'vscode-snapshots';

export function getSnapshotLocation(): string {
  return resolveSetting('snapshotLocation', '.snapshots').value;
}

/**
 * Maximum snapshots to keep. Never below 1.
 *
 * 0 (or a negative value) would make the prune guard's safety loop exit
 * immediately, so the snapshot just taken would be pruned with nothing left to
 * reference it -- the data loss this floor exists to prevent. A hand-edited
 * settings.json can hold either, and the manifest's `minimum` only constrains
 * the Settings UI, so the read is clamped rather than trusted. Values at or
 * above 1 are returned unchanged, and a wrong-typed value falls back to the
 * same default the setting declares.
 */
export function getMaxSnapshots(): number {
  const resolved = resolveSetting<unknown>('maxSnapshots', 50).value;
  return typeof resolved === 'number' && Number.isFinite(resolved)
    ? Math.max(1, resolved)
    : 50;
}

/** Fallbacks for the chunker settings; they match the schema defaults in `package.json`. */
export const DEFAULT_SEMANTIC_SEARCH_CHUNK_SIZE = 200;
export const DEFAULT_SEMANTIC_SEARCH_CHUNK_OVERLAP = 50;

/**
 * Reads a numeric setting, ignoring a stored value of the wrong type.
 *
 * `.vscode/codelapse.json` is written by the CLI and can be hand-edited, and
 * `resolveSetting` casts a shared-file value to the caller's type without
 * checking it. A string would reach the chunker's clamp, and
 * `Math.max(10, NaN)` is `NaN`: a chunk size of `NaN` produces no chunks at all.
 */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The semantic-search chunker's line-count settings.
 *
 * Read through `resolveSetting` rather than a raw `getConfiguration` call, so a
 * value explicitly set in VS Code keeps winning over `.vscode/codelapse.json`
 * (the D1 precedence) and so `manifestConsistency.test.ts` can see the declared
 * key being read.
 */
export function getSemanticSearchChunkSize(): number {
  return asNumber(
    resolveSetting(
      'semanticSearch.chunkSize',
      DEFAULT_SEMANTIC_SEARCH_CHUNK_SIZE,
    ).value,
    DEFAULT_SEMANTIC_SEARCH_CHUNK_SIZE,
  );
}

export function getSemanticSearchChunkOverlap(): number {
  return asNumber(
    resolveSetting(
      'semanticSearch.chunkOverlap',
      DEFAULT_SEMANTIC_SEARCH_CHUNK_OVERLAP,
    ).value,
    DEFAULT_SEMANTIC_SEARCH_CHUNK_OVERLAP,
  );
}

/**
 * Reads a byte count, ignoring a stored value of the wrong type.
 *
 * settings.json can be hand-edited, and "1GB" or -1 would otherwise reach the
 * arithmetic in the retention path. A negative limit reads as "disabled".
 */
function asByteLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

/**
 * Maximum bytes the snapshot store may occupy; 0 means no limit.
 *
 * Read at call time rather than cached, so changing the setting takes effect on
 * the next snapshot instead of requiring a window reload. The literal key is
 * what the manifest-consistency guard matches against the declared setting.
 */
export function getMaxSnapshotStoreBytes(): number {
  return asByteLimit(
    resolveSetting<unknown>('maxSnapshotStoreBytes', 0).value,
    0,
  );
}

// Note: Logging config is handled directly in logger.ts for simplicity
// as it needs to react to changes immediately. If more complex config
// interactions are needed later, this could be centralized here.

// `getGitAutoSnapshotEnabled` was removed along with `git.autoSnapshotBeforeOperation`
// and the unreachable command interception it fed. Nothing invoked the wrapper
// commands, so the setting could never have an effect.

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
