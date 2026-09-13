import {
  isBaseResolvable,
  scanSnapshotIntegrity,
  getUnrecoverableFiles,
} from '../snapshotVerification';
import type { Snapshot } from '../snapshotManager';

function snapshot(
  id: string,
  files: Snapshot['files'],
  timestamp = 1000,
): Snapshot {
  return { id, timestamp, description: id, files };
}

describe('isBaseResolvable', () => {
  it('returns true when the base snapshot is present', () => {
    const all = [snapshot('snap-a', {}), snapshot('snap-b', {})];
    expect(isBaseResolvable('snap-a', all)).toBe(true);
  });

  it('returns false when the base snapshot is missing', () => {
    const all = [snapshot('snap-b', {})];
    expect(isBaseResolvable('snap-a', all)).toBe(false);
  });
});

describe('getUnrecoverableFiles', () => {
  it('returns an empty array when every base resolves', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
    ];
    expect(getUnrecoverableFiles(all[1], all)).toEqual([]);
  });

  it('detects a file whose base snapshot is absent from the index', () => {
    const snap = snapshot('snap-b', {
      'a.ts': { baseSnapshotId: 'snap-gone' },
    });
    expect(getUnrecoverableFiles(snap, [snap])).toEqual(['a.ts']);
  });

  it('does not treat file content as a base reference', () => {
    const snap = snapshot('snap-b', { 'a.ts': { content: 'x' } });
    expect(getUnrecoverableFiles(snap, [snap])).toEqual([]);
  });

  it('does not treat a deleted marker as a base reference', () => {
    const snap = snapshot('snap-b', { 'a.ts': { deleted: true } });
    expect(getUnrecoverableFiles(snap, [snap])).toEqual([]);
  });

  it('does not treat a binary marker as a base reference', () => {
    const snap = snapshot('snap-b', { 'a.ts': { isBinary: true } });
    expect(getUnrecoverableFiles(snap, [snap])).toEqual([]);
  });

  it('follows a two-level chain to a missing root', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
      snapshot('snap-c', {
        'a.ts': { diff: 'p', baseSnapshotId: 'snap-gone' },
      }),
    ];
    expect(getUnrecoverableFiles(all[2], all)).toEqual(['a.ts']);
  });

  it('terminates and reports a file on a cycle instead of hanging', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { baseSnapshotId: 'snap-b' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
    ];
    expect(getUnrecoverableFiles(all[0], all)).toEqual(['a.ts']);
  });

  it('reports a self-referencing file', () => {
    const snap = snapshot('snap-a', { 'a.ts': { baseSnapshotId: 'snap-a' } });
    expect(getUnrecoverableFiles(snap, [snap])).toEqual(['a.ts']);
  });

  it('stops at MAX_SNAPSHOT_RESOLUTION_DEPTH and reports the file', () => {
    const all: Snapshot[] = [snapshot('snap-0', { 'a.ts': { content: 'x' } })];
    for (let i = 1; i <= 70; i++) {
      all.push(
        snapshot(`snap-${i}`, {
          'a.ts': { baseSnapshotId: `snap-${i - 1}` },
        }),
      );
    }
    expect(getUnrecoverableFiles(all[70], all)).toEqual(['a.ts']);
  });

  it('reports a file whose base snapshot exists but has no entry for it', () => {
    // The base is present, so a shallow "is the base on disk?" check passes,
    // but it carries nothing for this path and the content is still lost.
    const all = [
      snapshot('snap-a', { 'other.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
    ];
    expect(getUnrecoverableFiles(all[1], all)).toEqual(['a.ts']);
  });

  it('reports a file whose base records it as deleted', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { deleted: true } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
    ];
    expect(getUnrecoverableFiles(all[1], all)).toEqual(['a.ts']);
  });

  it('resolves a chain deeper than one level', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
      snapshot('snap-c', { 'a.ts': { baseSnapshotId: 'snap-b' } }),
    ];
    expect(getUnrecoverableFiles(all[2], all)).toEqual([]);
  });

  it('treats null content with no base as unrecoverable', () => {
    const snap = snapshot('snap-a', { 'a.ts': { content: null } });
    expect(getUnrecoverableFiles(snap, [snap])).toEqual(['a.ts']);
  });
});

describe('scanSnapshotIntegrity', () => {
  it('reports zero breakage for a healthy store', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
    ];
    const report = scanSnapshotIntegrity(all);
    expect(report.unrecoverableFileCount).toBe(0);
    expect(report.brokenSnapshotIds).toEqual([]);
    expect(report.missingBaseSnapshotIds).toEqual([]);
  });

  it('counts unrecoverable files and lists the broken snapshots', () => {
    const all = [
      snapshot('snap-a', {
        'a.ts': { baseSnapshotId: 'snap-gone' },
        'b.ts': { baseSnapshotId: 'snap-gone' },
        'ok.ts': { content: 'x' },
      }),
    ];
    const report = scanSnapshotIntegrity(all);
    expect(report.unrecoverableFileCount).toBe(2);
    expect(report.brokenSnapshotIds).toEqual(['snap-a']);
    expect(report.missingBaseSnapshotIds).toEqual(['snap-gone']);
    expect(report.perSnapshot['snap-a']).toEqual(['a.ts', 'b.ts']);
  });

  it('sorts per-snapshot file lists for stable output', () => {
    const all = [
      snapshot('snap-a', {
        'z.ts': { baseSnapshotId: 'snap-gone' },
        'a.ts': { baseSnapshotId: 'snap-gone' },
      }),
    ];
    expect(scanSnapshotIntegrity(all).perSnapshot['snap-a']).toEqual([
      'a.ts',
      'z.ts',
    ]);
  });

  it('deduplicates missing base ids across snapshots', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { baseSnapshotId: 'snap-gone' } }),
      snapshot('snap-b', { 'b.ts': { baseSnapshotId: 'snap-gone' } }),
    ];
    expect(scanSnapshotIntegrity(all).missingBaseSnapshotIds).toEqual([
      'snap-gone',
    ]);
  });

  it('attributes a transitively broken file to the snapshot that holds it', () => {
    // snap-c is not itself referencing anything missing; it is broken because
    // snap-b is. The report must blame snap-c for its own copy of the file.
    const all = [
      snapshot('snap-a', { 'a.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-gone' } }),
      snapshot('snap-c', { 'a.ts': { baseSnapshotId: 'snap-b' } }),
    ];
    const report = scanSnapshotIntegrity(all);
    expect(report.brokenSnapshotIds).toEqual(['snap-b', 'snap-c']);
    expect(report.perSnapshot['snap-c']).toEqual(['a.ts']);
    // Only the direct reference counts as a missing base id.
    expect(report.missingBaseSnapshotIds).toEqual(['snap-gone']);
    expect(report.unrecoverableFileCount).toBe(2);
  });

  it('omits healthy snapshots from perSnapshot entirely', () => {
    const all = [
      snapshot('snap-a', { 'a.ts': { content: 'x' } }),
      snapshot('snap-b', { 'a.ts': { baseSnapshotId: 'snap-a' } }),
    ];
    expect(Object.keys(scanSnapshotIntegrity(all).perSnapshot)).toEqual([]);
  });
});
