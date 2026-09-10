import { selectPrunableSnapshots } from '../snapshotManager';
import type { Snapshot } from '../snapshotManager';

function snapshot(
  id: string,
  files: Snapshot['files'],
  timestamp: number,
): Snapshot {
  return { id, timestamp, description: id, files };
}

describe('selectPrunableSnapshots', () => {
  it('returns nothing when under the limit', () => {
    const all = [snapshot('a', {}, 1), snapshot('b', {}, 2)];
    expect(selectPrunableSnapshots(all, 5)).toEqual([]);
  });

  it('selects oldest snapshots first when nothing references them', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 2)).toEqual(['a']);
  });

  it('never selects a snapshot that another snapshot references', () => {
    // 'b' is the base for 'c', so deleting 'b' would break 'c'.
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 2)).toEqual(['a']);
  });

  it('stops early rather than orphaning references', () => {
    // Under a limit of 1, the only prune candidates are 'a' and 'b', but 'b'
    // is referenced by 'c'. Pruning must stop after 'a' rather than exceed
    // safety.
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 1)).toEqual(['a']);
  });

  it('returns nothing when every candidate is referenced', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
    ];
    expect(selectPrunableSnapshots(all, 1)).toEqual([]);
  });

  it('ignores a reference from a snapshot that is itself being pruned', () => {
    // 'b' references 'a', but 'b' is also pruned, so 'a' becomes free.
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    // Limit 1 => need to remove 2. 'c' is referenced by nobody and is newest,
    // so selection must go oldest-first: 'a' then 'b'.
    expect(selectPrunableSnapshots(all, 1)).toEqual(['a', 'b']);
  });

  it('orders by timestamp, not array position', () => {
    const all = [
      snapshot('newer', { 'x.ts': { content: 'n' } }, 30),
      snapshot('older', { 'x.ts': { content: 'o' } }, 10),
    ];
    expect(selectPrunableSnapshots(all, 1)).toEqual(['older']);
  });

  // Guards on the property the tests above imply but do not state outright:
  // pruning must never take from the newest end.
  it('never selects the newest snapshot while an older one is selectable', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
      snapshot('d', { 'x.ts': { content: 'd' } }, 4),
    ];
    const selected = selectPrunableSnapshots(all, 2);
    expect(selected).toEqual(['a', 'b']);
    expect(selected).not.toContain('d');
  });

  it('returns a prefix of the oldest-first order', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
      snapshot('d', { 'x.ts': { content: 'd' } }, 4),
    ];
    // excess 2, but 'b' is held by surviving 'c', so only 'a' is safe.
    expect(selectPrunableSnapshots(all, 2)).toEqual(['a']);
  });

  it('stops at the target rather than pruning more than required', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { content: 'b' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    expect(selectPrunableSnapshots(all, 2)).toHaveLength(1);
  });

  it('terminates when every snapshot transitively references the oldest', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'x.ts': { baseSnapshotId: 'b' } }, 3),
      snapshot('d', { 'x.ts': { baseSnapshotId: 'c' } }, 4),
    ];
    // A chain: nothing below 'd' can be dropped without breaking the newest.
    expect(selectPrunableSnapshots(all, 1)).toEqual([]);
  });

  it('allows pruning a whole removable prefix of a chain', () => {
    const all = [
      snapshot('a', { 'x.ts': { content: 'a' } }, 1),
      snapshot('b', { 'x.ts': { baseSnapshotId: 'a' } }, 2),
      snapshot('c', { 'x.ts': { content: 'c' } }, 3),
    ];
    // 'a' and 'b' can both go: nothing surviving references either.
    expect(selectPrunableSnapshots(all, 1)).toEqual(['a', 'b']);
  });
});
