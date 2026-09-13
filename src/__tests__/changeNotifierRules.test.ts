import { ChangeNotifier } from '../changeNotifier';
import * as vscode from 'vscode';

/**
 * A notifier whose snapshot manager and workspace are stubs, so the rule paths
 * can be exercised without a host.
 */
function buildNotifier(options: {
  intervalMinutes: number;
  lastFiredAt: number;
  takeSnapshot: jest.Mock;
}) {
  const state = new Map<string, unknown>();
  if (options.lastFiredAt > 0) {
    state.set('codeSnapshots.ruleSchedule', {
      'src/**': options.lastFiredAt,
    });
  }

  const context = {
    subscriptions: [],
    workspaceState: {
      get: (key: string, fallback?: unknown) =>
        state.has(key) ? state.get(key) : fallback,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;

  const snapshotManager = {
    getSnapshots: () => [],
    getWorkspaceRoot: () => '/ws',
    takeSnapshot: options.takeSnapshot,
    onDidChangeSnapshots: () => ({ dispose: jest.fn() }),
  } as never;

  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: (key: string, fallback?: unknown) =>
      key === 'autoSnapshot.rules'
        ? [{ pattern: 'src/**', intervalMinutes: options.intervalMinutes }]
        : fallback,
  });
  (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles = jest
    .fn()
    .mockResolvedValue([vscode.Uri.file('/ws/src/a.ts')]);

  const notifier = new ChangeNotifier(context, snapshotManager);
  return { notifier, state };
}

function savedDocument(): vscode.TextDocument {
  return {
    uri: vscode.Uri.file('/ws/src/a.ts'),
    fileName: '/ws/src/a.ts',
  } as unknown as vscode.TextDocument;
}

/**
 * The rule paths are private; a narrow, typed view of them keeps the casts
 * explicit instead of reaching for `any` at every call site.
 */
function internals(notifier: ChangeNotifier): {
  checkRuleBasedAutoSnapshot(document: vscode.TextDocument): Promise<void>;
  runRulePass(): void;
  rulesCheckInFlight: boolean;
} {
  return notifier as unknown as {
    checkRuleBasedAutoSnapshot(document: vscode.TextDocument): Promise<void>;
    runRulePass(): void;
    rulesCheckInFlight: boolean;
  };
}

describe('ChangeNotifier rule scheduling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not fire a rule that ran inside its interval', async () => {
    const takeSnapshot = jest.fn();
    const { notifier } = buildNotifier({
      intervalMinutes: 10,
      lastFiredAt: Date.now() - 60 * 1000,
      takeSnapshot,
    });

    await internals(notifier).checkRuleBasedAutoSnapshot(savedDocument());

    // Before the schedule was persisted, this timestamp did not survive
    // activation, so the rule was immediately due on every reload.
    expect(takeSnapshot).not.toHaveBeenCalled();
    notifier.dispose();
  });

  it('fires a rule whose interval has elapsed', async () => {
    const takeSnapshot = jest.fn().mockResolvedValue({
      created: true,
      snapshot: { id: 'snap-1' },
    });
    const { notifier } = buildNotifier({
      intervalMinutes: 10,
      lastFiredAt: Date.now() - 20 * 60 * 1000,
      takeSnapshot,
    });

    await internals(notifier).checkRuleBasedAutoSnapshot(savedDocument());

    expect(takeSnapshot).toHaveBeenCalled();
    notifier.dispose();
  });

  it('does not consume the interval when nothing changed', async () => {
    const takeSnapshot = jest.fn().mockResolvedValue({
      created: false,
      reason: 'no-changes',
    });
    const lastFiredAt = Date.now() - 20 * 60 * 1000;
    const { notifier, state } = buildNotifier({
      intervalMinutes: 10,
      lastFiredAt,
      takeSnapshot,
    });

    await internals(notifier).checkRuleBasedAutoSnapshot(savedDocument());

    // Recording a skipped attempt as a fire suppressed the next real one for a
    // full interval.
    expect(state.get('codeSnapshots.ruleSchedule')).toEqual({
      'src/**': lastFiredAt,
    });
    notifier.dispose();
  });

  it('records the fire when a snapshot was created', async () => {
    const takeSnapshot = jest.fn().mockResolvedValue({
      created: true,
      snapshot: { id: 'snap-1' },
    });
    const { notifier, state } = buildNotifier({
      intervalMinutes: 10,
      lastFiredAt: Date.now() - 20 * 60 * 1000,
      takeSnapshot,
    });

    await internals(notifier).checkRuleBasedAutoSnapshot(savedDocument());

    const schedule = state.get('codeSnapshots.ruleSchedule') as Record<
      string,
      number
    >;
    expect(schedule['src/**']).toBeGreaterThan(Date.now() - 5000);
    notifier.dispose();
  });

  it('skips a pass while the previous one is still running', async () => {
    let release: (value: unknown) => void = () => undefined;
    const takeSnapshot = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { notifier } = buildNotifier({
      intervalMinutes: 1,
      lastFiredAt: 0,
      takeSnapshot,
    });

    // The interval callback was an un-awaited async function, so a slow pass
    // ran concurrently with the next tick and both could fire the same rule.
    const rules = internals(notifier);
    rules.runRulePass();
    rules.runRulePass();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(takeSnapshot).toHaveBeenCalledTimes(1);

    release({ created: true, snapshot: { id: 'snap-1' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The guard must clear, or one slow pass would stop every later one.
    expect(internals(notifier).rulesCheckInFlight).toBe(false);

    notifier.dispose();
  });
});
