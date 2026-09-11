/**
 * Regression guard for short snapshot ids (LOW-1).
 *
 * Snapshot ids look like `snapshot-1789120661991-fe3a3996`. Nothing resolved a
 * prefix, so `codelapse snapshot show 1789120661991` -- and every README example
 * that writes `snapshot-123` -- failed with
 * "Snapshot file not found: <root>\\.snapshots\\1789120661991\\snapshot.json".
 * A prefix that matches exactly one snapshot now resolves; an ambiguous or
 * unknown prefix keeps a clear error.
 */

import { StandaloneHandler, bestSnapshotIdMatch } from '../standaloneHandler';

const IDS = [
  'snapshot-1789120661991-fe3a3996',
  'snapshot-1789120733212-471f9d9a',
];

describe('bestSnapshotIdMatch', () => {
  it('returns an exact id unchanged', () => {
    expect(bestSnapshotIdMatch(IDS[0], IDS)).toBe(IDS[0]);
  });

  it('resolves an unambiguous prefix', () => {
    expect(bestSnapshotIdMatch('1789120661991', IDS)).toBe(IDS[0]);
    expect(bestSnapshotIdMatch('snapshot-1789120733212', IDS)).toBe(IDS[1]);
  });

  it('resolves an unambiguous suffix fragment', () => {
    expect(bestSnapshotIdMatch('471f9d9a', IDS)).toBe(IDS[1]);
  });

  it('returns null for an ambiguous prefix', () => {
    expect(bestSnapshotIdMatch('snapshot-1', IDS)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(bestSnapshotIdMatch('nope', IDS)).toBeNull();
  });
});

describe('standalone handler id resolution', () => {
  function handlerWithIndex(ids: string[]): {
    handler: StandaloneHandler;
    requested: string[];
  } {
    const requested: string[] = [];
    const handler = new StandaloneHandler();

    (handler as unknown as { snapshotManager: unknown }).snapshotManager = {
      getSnapshots: async () => ids.map((id) => ({ id })),
      getSnapshot: async (id: string) => {
        requested.push(id);
        return id === ids[0] ? { id } : null;
      },
    };

    return { handler, requested };
  }

  it('loads a snapshot addressed by a unique prefix', async () => {
    const { handler, requested } = handlerWithIndex(IDS);

    const snapshot = await handler.getSnapshot('1789120661991');

    expect(requested).toEqual([IDS[0]]);
    expect(snapshot).toEqual({ id: IDS[0] });
  });

  it('refuses an ambiguous prefix with an actionable message', async () => {
    const { handler } = handlerWithIndex(IDS);

    await expect(handler.getSnapshot('snapshot-1')).rejects.toThrow(
      /ambiguous/i,
    );
  });

  it('passes an unknown id through so the storage error still names it', async () => {
    const { handler, requested } = handlerWithIndex(IDS);

    await expect(handler.getSnapshot('nope')).resolves.toBeNull();
    expect(requested).toEqual(['nope']);
  });
});
