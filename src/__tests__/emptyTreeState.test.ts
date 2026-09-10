import { SnapshotTreeDataProvider, SnapshotType } from '../ui/treeView';
import { SnapshotManager } from '../snapshotManager';

describe('tree empty states', () => {
  function provider(snapshots: any[]) {
    const manager = new SnapshotManager(null);
    (manager as any).snapshots = snapshots;
    return new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
  }

  it('explains when there are no snapshots at all', async () => {
    const children = await provider([]).getChildren();

    expect(children).toHaveLength(1);
    const item = children[0];
    expect(String((item as any).label)).toMatch(/no snapshots/i);
    expect(item.contextValue).toBe('emptyState');
    // No command: clicking it must not run anything.
    expect(item.command).toBeUndefined();
  });

  it('explains when filters exclude everything and names the filters', async () => {
    const p = provider([
      { id: 'a', timestamp: Date.now(), description: 'a', files: {}, tags: [] },
    ]);
    p.setFilter({ tags: ['nonexistent-tag'] });

    const children = await p.getChildren();

    expect(children).toHaveLength(1);
    const item = children[0];
    expect(String((item as any).label)).toMatch(/no snapshots match/i);
    const tooltip = String((item as any).tooltip);
    expect(tooltip).toMatch(/nonexistent-tag/);
  });

  it('returns real groups when snapshots exist and no filter excludes them', async () => {
    const p = provider([
      { id: 'a', timestamp: Date.now(), description: 'a', files: {}, tags: [] },
    ]);
    const children = await p.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].contextValue).toBe('snapshotGroup');
  });

  it('names the auto view when it has no snapshots of its own', async () => {
    const manager = new SnapshotManager(null);
    (manager as any).snapshots = [
      { id: 'm', timestamp: Date.now(), description: 'm', files: {}, tags: [] },
    ];
    const p = new SnapshotTreeDataProvider(manager, SnapshotType.AUTO);

    const children = await p.getChildren();

    expect(children).toHaveLength(1);
    expect(String((children[0] as any).label)).toMatch(/no auto snapshots/i);
  });

  it('offers a way out of the filtered state', async () => {
    const p = provider([
      { id: 'a', timestamp: Date.now(), description: 'a', files: {}, tags: [] },
    ]);
    p.setFilter({ favoritesOnly: true });

    const children = await p.getChildren();

    // Being told the view is empty but not how to un-empty it leaves the user
    // with a blank panel and no next step.
    expect(String((children[0] as any).tooltip)).toMatch(/clear all filters/i);
  });

  it('gives the empty state row an accessible label', async () => {
    const children = await provider([]).getChildren();

    const label = children[0].accessibilityInformation?.label;
    expect(label).toBeTruthy();
    expect(String(label)).toMatch(/no snapshots/i);
  });
});
