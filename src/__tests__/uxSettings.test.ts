import { getUxSettings } from '../config';
import { WelcomeView } from '../ui/welcomeView';
import { AnimationHelpers } from '../utils';
import { registerCommands } from '../commands';
import { resolveNavigationTarget } from '../snapshotSelection';
import * as vscode from 'vscode';
import * as path from 'path';

const ROOT = process.platform === 'win32' ? 'C:\\ws' : '/ws';

function withConfig(values: Record<string, unknown>) {
  (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
    get: (key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    update: jest.fn(),
  });
}

function globalStateStub() {
  return {
    get: jest.fn(() => undefined),
    update: jest.fn(),
  };
}

describe('getUxSettings', () => {
  it('returns the declared defaults', () => {
    withConfig({});
    expect(getUxSettings()).toEqual({
      showWelcomeOnStartup: true,
      confirmRestoreOperations: true,
      useAnimations: true,
      showKeyboardShortcutHints: true,
    });
  });

  it('reflects configured values', () => {
    withConfig({
      'ux.confirmRestoreOperations': false,
      'ux.useAnimations': false,
    });
    const settings = getUxSettings();
    expect(settings.confirmRestoreOperations).toBe(false);
    expect(settings.useAnimations).toBe(false);
    // Untouched keys keep their defaults rather than becoming undefined.
    expect(settings.showWelcomeOnStartup).toBe(true);
    expect(settings.showKeyboardShortcutHints).toBe(true);
  });

  it('re-reads on every call so a change needs no reload', () => {
    withConfig({ 'ux.useAnimations': true });
    expect(getUxSettings().useAnimations).toBe(true);
    withConfig({ 'ux.useAnimations': false });
    expect(getUxSettings().useAnimations).toBe(false);
  });

  it('treats a non-boolean stored value as the default', () => {
    // A hand-edited settings.json can hold anything; a truthy string here
    // would silently enable a dialog the user turned off.
    withConfig({ 'ux.confirmRestoreOperations': 'nope' });
    expect(getUxSettings().confirmRestoreOperations).toBe(true);
  });
});

describe('ux.showWelcomeOnStartup is wired to the welcome experience', () => {
  beforeEach(() => {
    (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage = jest.fn().mockResolvedValue(undefined);
  });

  it('shows the welcome when enabled and not yet shown', async () => {
    withConfig({ 'ux.showWelcomeOnStartup': true });
    const show = (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage;

    await WelcomeView.showWelcomeExperience({
      globalState: globalStateStub(),
    } as never);

    expect(show).toHaveBeenCalled();
  });

  it('shows nothing when the setting is off', async () => {
    withConfig({ 'ux.showWelcomeOnStartup': false });
    const show = (
      vscode.window as unknown as { showInformationMessage: jest.Mock }
    ).showInformationMessage;

    await WelcomeView.showWelcomeExperience({
      globalState: globalStateStub(),
    } as never);

    // The bug: the setting was declared and documented but read by nothing,
    // so unchecking it still showed the welcome on the next activation.
    expect(show).not.toHaveBeenCalled();
  });
});

describe('ux.useAnimations is wired to the transition indicator', () => {
  function buildNavHarness() {
    const handlers: Record<string, (arg?: unknown) => Promise<void>> = {};
    (
      vscode.commands as unknown as { registerCommand: jest.Mock }
    ).registerCommand = jest.fn((id: string, fn: never) => {
      handlers[id] = fn;
      return { dispose: jest.fn() };
    });

    (vscode.window as unknown as { withProgress: jest.Mock }).withProgress =
      jest.fn(
        async (_options: unknown, task: (p: unknown, t: unknown) => unknown) =>
          task(
            { report: jest.fn() },
            {
              isCancellationRequested: false,
              onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
            },
          ),
      );

    const snapshotList = [
      { id: 's1', timestamp: 1000, description: 'one', files: {} },
      { id: 's2', timestamp: 2000, description: 'two', files: {} },
    ];
    const activeIndex = 1;

    const snapshotManager = {
      getSnapshots: () => snapshotList,
      getCurrentSnapshotIndex: () => activeIndex,
      // Delegates to the real resolver rather than restating its arithmetic,
      // so this harness cannot drift from the manager it stands in for.
      getNavigationTargetIndex: (direction: 'previous' | 'next') =>
        resolveNavigationTarget(snapshotList, activeIndex, direction),
      navigateToPreviousSnapshot: async () => true,
      navigateToNextSnapshot: async () => true,
    };

    registerCommands({
      context: { subscriptions: [] },
      snapshotManager,
      snapshotQuickPick: {},
    } as never);

    return handlers['vscode-snapshots.previousSnapshot'];
  }

  it('shows the direction indicator when enabled', async () => {
    withConfig({ 'ux.useAnimations': true });
    const spy = jest
      .spyOn(AnimationHelpers, 'showTransitionIndicators')
      .mockReturnValue({ dispose: jest.fn() });

    await buildNavHarness()();

    expect(spy).toHaveBeenCalledWith('backward');
    spy.mockRestore();
  });

  it('shows nothing when disabled', async () => {
    withConfig({ 'ux.useAnimations': false });
    const spy = jest
      .spyOn(AnimationHelpers, 'showTransitionIndicators')
      .mockReturnValue({ dispose: jest.fn() });

    await buildNavHarness()();

    // The bug: the setting had no implementation at all -- animationHelpers
    // was dead code imported nowhere.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('ux.confirmRestoreOperations is wired to the restore prompt', () => {
  interface RestoreHarness {
    run: () => Promise<void>;
    showQuickPick: jest.Mock;
    applySnapshotRestore: jest.Mock;
  }

  function buildRestoreHarness(): RestoreHarness {
    const handlers: Record<string, (arg?: unknown) => Promise<void>> = {};
    (
      vscode.commands as unknown as { registerCommand: jest.Mock }
    ).registerCommand = jest.fn((id: string, fn: never) => {
      handlers[id] = fn;
      return { dispose: jest.fn() };
    });

    const applySnapshotRestore = jest.fn().mockResolvedValue({
      restored: ['a.ts'],
      deleted: [],
      skipped: [],
    });
    const showQuickPick = jest.fn().mockResolvedValue(undefined);
    (vscode.window as unknown as { showQuickPick: jest.Mock }).showQuickPick =
      showQuickPick;
    (vscode.window as unknown as { withProgress: jest.Mock }).withProgress =
      jest.fn(
        async (_options: unknown, task: (p: unknown, t: unknown) => unknown) =>
          task(
            { report: jest.fn() },
            {
              isCancellationRequested: false,
              onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
            },
          ),
      );

    const snapshotManager = {
      getSnapshotById: () => ({
        id: 'snap1',
        timestamp: Date.now(),
        description: 'a snapshot',
      }),
      getWorkspaceRoot: () => ROOT,
      calculateRestoreChanges: async () => [
        {
          relativePath: 'a.ts',
          label: '~ a.ts',
          description: 'modified',
          isDirty: false,
        },
      ],
      getUnrecoverableFilesFor: () => [],
      applySnapshotRestore,
      // Every restore now takes a protective snapshot before it applies.
      takeSnapshot: jest.fn().mockResolvedValue({
        created: true,
        snapshot: { id: 'snapshot-backup' },
      }),
    };

    registerCommands({
      context: { subscriptions: [] },
      snapshotManager,
      snapshotQuickPick: {},
    } as never);

    const handler = handlers['vscode-snapshots.jumpToSnapshot'];
    return {
      run: () => handler('snap1'),
      showQuickPick,
      applySnapshotRestore,
    };
  }

  it('prompts for confirmation when enabled', async () => {
    withConfig({ 'ux.confirmRestoreOperations': true });
    const harness = buildRestoreHarness();

    await harness.run();

    expect(harness.showQuickPick).toHaveBeenCalled();
  });

  it('restores without prompting when disabled', async () => {
    withConfig({ 'ux.confirmRestoreOperations': false });
    const harness = buildRestoreHarness();

    await harness.run();

    // The bug: the confirmation was unconditional, so turning the setting off
    // still prompted.
    expect(harness.showQuickPick).not.toHaveBeenCalled();
    expect(harness.applySnapshotRestore).toHaveBeenCalled();
  });

  it('keeps the data-loss prompt ungated', async () => {
    withConfig({ 'ux.confirmRestoreOperations': false });
    const harness = buildRestoreHarness();
    // A dirty editor covering a file the restore would touch.
    (
      vscode.window as unknown as { visibleTextEditors: unknown[] }
    ).visibleTextEditors = [
      {
        document: {
          isDirty: true,
          uri: { fsPath: path.join(ROOT, 'a.ts') },
        },
      },
    ];
    const showWarning = (
      vscode.window as unknown as { showWarningMessage: jest.Mock }
    ).showWarningMessage;
    showWarning.mockResolvedValue('Cancel');

    await harness.run();

    // confirmRestoreOperations is a convenience prompt. This one protects
    // unsaved work and must survive the setting being off.
    expect(showWarning).toHaveBeenCalled();
    expect(harness.applySnapshotRestore).not.toHaveBeenCalled();

    (
      vscode.window as unknown as { visibleTextEditors: unknown[] }
    ).visibleTextEditors = [];
  });
});
