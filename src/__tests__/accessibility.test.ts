import {
  SnapshotTreeDataProvider,
  SnapshotTreeItem,
  SnapshotType,
} from '../ui/treeView';
import { SnapshotManager } from '../snapshotManager';
import { StatusBarController } from '../statusBarController';
import { ConfigTreeDataProvider } from '../ui/configTreeView';
import { FilterStatusBar } from '../ui/filterStatusBar';
import * as vscode from 'vscode';

describe('tree item accessibility', () => {
  const manager = new SnapshotManager(null);
  const snapshot = {
    id: 'snap-a',
    timestamp: 1000,
    description: 'added login',
    files: { 'src/auth.ts': { diff: '@@' } },
  } as any;

  it('states the change type in words, not only as an icon', () => {
    const item = new SnapshotTreeItem(
      snapshot,
      false,
      manager,
      'src/auth.ts',
      undefined,
      undefined,
      undefined,
      'modified',
    );

    // The tooltip is hover-only; the accessible name must carry the change.
    expect(item.accessibilityInformation?.label).toMatch(/modified/i);
  });

  it('describes the directory for a file row', () => {
    const item = new SnapshotTreeItem(
      snapshot,
      false,
      manager,
      'src/deep/auth.ts',
      undefined,
      undefined,
      undefined,
      'added',
    );
    expect(item.accessibilityInformation?.label).toMatch(/src\/deep|src\\deep/);
  });

  it('marks the active snapshot as the current one', () => {
    const item = new SnapshotTreeItem(snapshot, true, manager);
    expect(item.accessibilityInformation?.label).toMatch(/current/i);
  });

  it('gives an empty state row an accessible label', async () => {
    const provider = new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
    const children = await provider.getChildren();
    if (children.length === 1 && children[0].contextValue === 'emptyState') {
      expect(children[0].accessibilityInformation?.label).toBeTruthy();
    }
  });

  it('never leaves a row without an accessible label', () => {
    // Every kind of row the tree can build, including the ones whose labels
    // are only an icon or a timestamp.
    const rows = [
      new SnapshotTreeItem(snapshot, false, manager),
      new SnapshotTreeItem(snapshot, false, manager, 'src/auth.ts'),
      new SnapshotTreeItem(snapshot, false, manager, 'auth.ts'),
      new SnapshotTreeItem(
        undefined,
        false,
        manager,
        undefined,
        'Today',
        [snapshot],
        '',
      ),
    ];

    for (const row of rows) {
      expect(row.accessibilityInformation?.label).toBeTruthy();
    }
  });
});

describe('status bar accessibility', () => {
  function statusBarHarness() {
    const item = {
      text: '',
      tooltip: '' as unknown,
      command: undefined as unknown,
      accessibilityInformation: undefined as
        | { label?: string; role?: string }
        | undefined,
      show: jest.fn(),
      hide: jest.fn(),
      dispose: jest.fn(),
    };
    (
      vscode.window as unknown as { createStatusBarItem: jest.Mock }
    ).createStatusBarItem = jest.fn(() => item);
    return item;
  }

  it('announces that the workspace is not at a snapshot', async () => {
    const item = statusBarHarness();
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (manager as any).snapshots = [
      { id: 'a', timestamp: Date.now(), description: 'a', files: {} },
    ];
    (manager as any).activeSnapshotId = null;

    new StatusBarController(manager);

    // The text is `$(history) now | 1 snapshots`, which a screen reader reads
    // verbatim -- codicon and all.
    expect(String(item.accessibilityInformation?.label)).toMatch(
      /not at a snapshot/i,
    );
    expect(item.text).not.toMatch(/1\/1/);
  });

  it('announces which snapshot the workspace is at', async () => {
    const item = statusBarHarness();
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (manager as any).snapshots = [
      { id: 'a', timestamp: Date.now(), description: 'a', files: {} },
    ];
    (manager as any).activeSnapshotId = 'a';

    new StatusBarController(manager);

    expect(String(item.accessibilityInformation?.label)).toMatch(
      /at snapshot 1 of 1/i,
    );
  });

  it('announces an empty store', async () => {
    const item = statusBarHarness();
    const manager = new SnapshotManager(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    (manager as any).snapshots = [];

    new StatusBarController(manager);

    expect(String(item.accessibilityInformation?.label)).toMatch(
      /no snapshots/i,
    );
  });

  it('announces how many filters are active in the view', () => {
    const item = statusBarHarness();
    const provider = {
      getActiveFilterCount: () => 1,
      getActiveFiltersDescription: () => 'Filtered by: Tags: wip',
      onDidChangeTreeData: () => ({ dispose: jest.fn() }),
    };

    new FilterStatusBar(provider as never, 'Manual');

    expect(String(item.accessibilityInformation?.label)).toMatch(
      /1 active filter/i,
    );
    // "1 filters" was the text before this.
    expect(item.text).toContain('1 filter');
    expect(item.text).not.toContain('1 filters');
  });
});

describe('config tree accessibility', () => {
  it('gives every config row an accessible label containing its value', () => {
    const provider = new ConfigTreeDataProvider({
      subscriptions: [],
      globalState: { get: () => undefined, update: async () => undefined },
    } as any);

    return provider
      .getChildren({ label: 'General' } as any)
      .then((items: any[]) => {
        for (const item of items) {
          const treeItem = provider.getTreeItem(item);
          expect(treeItem.accessibilityInformation?.label).toBeTruthy();
        }
      });
  });

  it('renders the auto-snapshot rules as a rule count, not a stringified array', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, fallback?: unknown) =>
        key === 'autoSnapshot.rules'
          ? [{ pattern: 'src/**', intervalMinutes: 10 }]
          : fallback,
    });
    const provider = new ConfigTreeDataProvider({
      subscriptions: [],
      globalState: { get: () => undefined, update: async () => undefined },
    } as any);

    const items = await provider.getChildren({ label: 'General' } as any);
    const rules = items.find((i: any) => i.key === 'autoSnapshot.rules');
    expect(rules).toBeDefined();

    expect(rules?.value).toBe('1 rule');
    const treeItem = provider.getTreeItem(rules as never);
    expect(String(treeItem.tooltip)).toMatch(/1 rule/);
  });

  it('names the settings group in its accessible label', () => {
    const provider = new ConfigTreeDataProvider({
      subscriptions: [],
      globalState: { get: () => undefined, update: async () => undefined },
    } as any);

    const group = provider.getTreeItem({
      key: 'section-UX',
      label: 'UX',
      value: '',
      collapsibleState: 1,
    } as any);

    expect(group.accessibilityInformation?.label).toBe('UX settings group');
  });
});
