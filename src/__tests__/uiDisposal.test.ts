import { StatusBarController } from '../statusBarController';
import { SnapshotTreeDataProvider, SnapshotType } from '../ui/treeView';
import { FilterStatusBar } from '../ui/filterStatusBar';
import { SnapshotManager } from '../snapshotManager';

describe('UI component disposal', () => {
  it('StatusBarController registers no interval and disposes its item', () => {
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const manager = new SnapshotManager(null);
    const controller = new StatusBarController(manager);

    expect(setIntervalSpy).not.toHaveBeenCalled();

    const item = (controller as any).statusBarItem;
    const disposeSpy = jest.spyOn(item, 'dispose');
    controller.dispose();
    expect(disposeSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
  });

  it('SnapshotTreeDataProvider disposes its configuration listener', () => {
    const manager = new SnapshotManager(null);
    const provider = new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
    const disposables: Array<{ dispose: () => void }> = (provider as any)
      .disposables;

    expect(disposables.length).toBeGreaterThan(0);

    // The mock's EventEmitter returns a real unsubscribe function, so spy before
    // disposing rather than expecting a pre-made jest mock.
    const spies = disposables.map((d) => jest.spyOn(d, 'dispose'));
    provider.dispose();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalled();
    }
  });

  it('FilterStatusBar disposes its tree-data subscription', () => {
    const manager = new SnapshotManager(null);
    const provider = new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
    const filterBar = new FilterStatusBar(provider, 'My Snapshots');
    const subscription = (filterBar as any).treeDataSubscription;

    expect(subscription).toBeDefined();
    const disposeSpy = jest.spyOn(subscription, 'dispose');
    filterBar.dispose();
    expect(disposeSpy).toHaveBeenCalled();
  });

  // The three assertions above are the plan's. These extend them to the
  // behaviour that makes disposal worth having: a disposed provider must stop
  // reacting to the events it was subscribed to.
  it('stops refreshing after the tree provider is disposed', () => {
    const manager = new SnapshotManager(null);
    const provider = new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
    const refreshSpy = jest.spyOn(provider as any, 'refresh');

    // Before disposal the provider reacts.
    (manager as any)._onDidChangeSnapshots.fire();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    provider.dispose();

    // After disposal it must not, or it keeps a dead tree (and everything it
    // references) alive.
    (manager as any)._onDidChangeSnapshots.fire();
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes the controller subscription so it stops updating', () => {
    const manager = new SnapshotManager(null);
    const controller = new StatusBarController(manager);
    const updateSpy = jest.spyOn(controller as any, 'updateStatusBar');

    (manager as any)._onDidChangeSnapshots.fire();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    controller.dispose();

    (manager as any)._onDidChangeSnapshots.fire();
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('disposes the tree event emitter, not just its listeners', () => {
    const manager = new SnapshotManager(null);
    const provider = new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
    const emitter = (provider as any)._onDidChangeTreeData;
    const disposeSpy = jest.spyOn(emitter, 'dispose');

    provider.dispose();

    expect(disposeSpy).toHaveBeenCalled();
  });

  it('is safe to dispose twice', () => {
    const manager = new SnapshotManager(null);
    const provider = new SnapshotTreeDataProvider(manager, SnapshotType.MANUAL);
    const controller = new StatusBarController(manager);
    const filterBar = new FilterStatusBar(provider, 'My Snapshots');

    provider.dispose();
    controller.dispose();
    filterBar.dispose();

    // VS Code can dispose a subscription list more than once in practice, so
    // a second call must not throw.
    expect(() => provider.dispose()).not.toThrow();
    expect(() => controller.dispose()).not.toThrow();
    expect(() => filterBar.dispose()).not.toThrow();
  });
});
