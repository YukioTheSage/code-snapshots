import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  measureSnapshotStore,
  selectSizePruneCandidates,
  type SnapshotStoreSizes,
} from '../snapshotStoreSize';

describe('measureSnapshotStore', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-store-size-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('sums every file in a snapshot directory and the store own files', () => {
    fs.mkdirSync(path.join(root, 'snapshot-a'), { recursive: true });
    fs.writeFileSync(path.join(root, 'snapshot-a', 'snapshot.json'), 'aaaa');
    fs.mkdirSync(path.join(root, 'snapshot-b', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'snapshot-b', 'snapshot.json'), 'bb');
    fs.writeFileSync(
      path.join(root, 'snapshot-b', 'nested', 'extra.json'),
      'ccc',
    );
    fs.writeFileSync(path.join(root, 'index.json'), 'iiiiii');

    const sizes = measureSnapshotStore(root);

    expect(sizes.perSnapshotBytes).toEqual({ 'snapshot-a': 4, 'snapshot-b': 5 });
    expect(sizes.snapshotBytes).toBe(9);
    expect(sizes.storeBytes).toBe(6);
    expect(sizes.totalBytes).toBe(15);
  });

  it('does not count quarantined artifacts or any other directory', () => {
    fs.mkdirSync(path.join(root, 'quarantine'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'quarantine', 'index.json.quarantine-1'),
      'xxxxxxxx',
    );
    fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'readme.md'), 'xxxx');

    // A prune cannot remove either of these, so counting them would keep the
    // store over its limit with nothing left to trim.
    expect(measureSnapshotStore(root).totalBytes).toBe(0);
  });

  it('reports zero for a store directory that does not exist', () => {
    expect(measureSnapshotStore(path.join(root, 'missing'))).toEqual({
      snapshotBytes: 0,
      storeBytes: 0,
      totalBytes: 0,
      perSnapshotBytes: {},
    });
  });
});

describe('selectSizePruneCandidates', () => {
  function sizes(perSnapshotBytes: Record<string, number>): SnapshotStoreSizes {
    let snapshotBytes = 0;
    for (const bytes of Object.values(perSnapshotBytes)) {
      snapshotBytes += bytes;
    }
    return {
      snapshotBytes,
      storeBytes: 100,
      totalBytes: snapshotBytes + 100,
      perSnapshotBytes,
    };
  }

  const store = [
    { id: 'oldest', timestamp: 1 },
    { id: 'middle', timestamp: 2 },
    { id: 'active', timestamp: 3 },
  ];

  it('takes only the oldest snapshots the excess needs', () => {
    // 2000 bytes against a 1400 limit: 600 bytes must go, and the oldest
    // snapshot alone holds 700 of them.
    expect(
      selectSizePruneCandidates(
        store,
        sizes({ oldest: 700, middle: 200, active: 1000 }),
        1400,
        'active',
      ),
    ).toEqual(['oldest']);
  });

  it('keeps taking the next oldest while the excess is not covered', () => {
    expect(
      selectSizePruneCandidates(
        store,
        sizes({ oldest: 400, middle: 400, active: 1000 }),
        1100,
        'active',
      ),
    ).toEqual(['oldest', 'middle']);
  });

  it('never selects the active snapshot, even when the store cannot fit without it', () => {
    expect(
      selectSizePruneCandidates(
        store,
        sizes({ oldest: 1100, middle: 200, active: 1000 }),
        1200,
        'active',
      ),
    ).toEqual(['oldest', 'middle']);
  });

  it('selects nothing when the active snapshot alone exceeds the limit', () => {
    // The store is 9200 bytes against a 1000 limit, and 9000 of them are the
    // active snapshot. Removing the 100-byte 'oldest' would still leave the
    // store over its limit, so the history would be gone for nothing.
    expect(
      selectSizePruneCandidates(
        store,
        sizes({ oldest: 100, middle: 100, active: 9000 }),
        1000,
        'active',
      ),
    ).toEqual([]);
  });

  it('selects nothing when an unindexed snapshot directory holds the excess', () => {
    // An orphan 'snapshot-*' directory the index does not list: the walk counts
    // its bytes, the selector cannot select it, and no snapshot can be removed
    // to cover it.
    const sizesWithOrphan: SnapshotStoreSizes = {
      ...sizes({ oldest: 100, middle: 100, active: 100 }),
      perSnapshotBytes: {
        oldest: 100,
        middle: 100,
        active: 100,
        'snapshot-orphan': 5000,
      },
      snapshotBytes: 5300,
      totalBytes: 5400,
    };

    expect(
      selectSizePruneCandidates(store, sizesWithOrphan, 1000, 'active'),
    ).toEqual([]);
  });

  it('selects nothing when no snapshot is active and the removable bytes fall short', () => {
    // An activation with no current pointer protects nothing, so every snapshot
    // is removable -- and still the store bytes (index, quarantine) hold the
    // excess. Emptying the store would not fit it.
    const storeBytesHoldTheExcess: SnapshotStoreSizes = {
      snapshotBytes: 200,
      storeBytes: 5000,
      totalBytes: 5200,
      perSnapshotBytes: { oldest: 100, middle: 100 },
    };

    expect(
      selectSizePruneCandidates(
        [
          { id: 'oldest', timestamp: 1 },
          { id: 'middle', timestamp: 2 },
        ],
        storeBytesHoldTheExcess,
        1000,
        null,
      ),
    ).toEqual([]);
  });

  it('returns nothing when the store is within the limit', () => {
    expect(
      selectSizePruneCandidates(store, sizes({ oldest: 1, middle: 1, active: 1 }), 1000, null),
    ).toEqual([]);
  });

  it('follows the caller order, never the timestamps, when the clock steps backwards', () => {
    // The store is oldest-first by construction, so the caller's array order is
    // the only truthful record of age. A clock that steps backwards between
    // takes leaves the newest entry holding the smallest timestamp.
    const backwardsClock = [
      { id: 'oldest', timestamp: 1 },
      { id: 'middle', timestamp: 2 },
      { id: 'newest', timestamp: -60_000 },
    ];

    // 1200 bytes against a 1000 limit: 200 must go, and the array's first
    // entry alone covers it. Sorting by timestamp would pick 'newest' instead,
    // deleting the snapshot that was just written.
    expect(
      selectSizePruneCandidates(
        backwardsClock,
        sizes({ oldest: 300, middle: 400, newest: 500 }),
        1000,
        null,
      ),
    ).toEqual(['oldest']);
  });
});
