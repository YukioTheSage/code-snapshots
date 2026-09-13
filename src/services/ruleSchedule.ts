import * as vscode from 'vscode';
import { log } from '../logger';

const STATE_KEY = 'codeSnapshots.ruleSchedule';

/**
 * Whether a rule whose last snapshot was taken at `lastFiredAt` is due again.
 *
 * A non-positive interval never fires: an interval of zero would otherwise be
 * permanently "due", turning a misconfiguration into a snapshot loop.
 */
export function shouldFireRule(
  lastFiredAt: number,
  intervalMinutes: number,
  now: number,
): boolean {
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return false;
  }
  const elapsedMinutes = (now - lastFiredAt) / (1000 * 60);
  return elapsedMinutes >= intervalMinutes;
}

/**
 * Persists the last-fired time per rule pattern.
 *
 * Previously this was an in-memory Map defaulting to 0, so every configured
 * rule was immediately "due" on each activation and fired a snapshot within a
 * minute of every window reload. `workspaceState` survives the reload, so a
 * rule that just ran waits its full interval.
 */
export class RuleScheduleStore {
  private readonly timestamps: { [pattern: string]: number };

  constructor(private context: vscode.ExtensionContext) {
    const persisted = context.workspaceState.get<unknown>(STATE_KEY);
    if (
      persisted &&
      typeof persisted === 'object' &&
      !Array.isArray(persisted)
    ) {
      this.timestamps = { ...(persisted as { [pattern: string]: number }) };
    } else {
      if (persisted !== undefined) {
        log(
          `Rule schedule state was not a valid object; starting from an empty schedule.`,
        );
      }
      this.timestamps = {};
    }
  }

  get(pattern: string): number {
    const value = this.timestamps[pattern];
    return Number.isFinite(value) ? value : 0;
  }

  async set(pattern: string, at: number): Promise<void> {
    this.timestamps[pattern] = at;
    await this.context.workspaceState.update(STATE_KEY, this.timestamps);
  }

  async clear(pattern: string): Promise<void> {
    delete this.timestamps[pattern];
    await this.context.workspaceState.update(STATE_KEY, this.timestamps);
  }

  /**
   * Forgets every pattern that is no longer configured.
   *
   * Renaming a rule would otherwise leave its timestamp in workspace state
   * forever, and a later rule reusing the name would inherit it. Pruning is
   * safe in the other direction too: a *new* name has no timestamp, so it is
   * due immediately, which is what a freshly added rule should be.
   */
  async pruneTo(configuredPatterns: string[]): Promise<void> {
    const configured = new Set(configuredPatterns);
    const stale = Object.keys(this.timestamps).filter(
      (pattern) => !configured.has(pattern),
    );
    if (stale.length === 0) {
      return;
    }
    for (const pattern of stale) {
      await this.clear(pattern);
    }
    log(
      `Dropped ${stale.length} auto-snapshot rule schedule(s) for rules that no longer exist.`,
    );
  }
}
