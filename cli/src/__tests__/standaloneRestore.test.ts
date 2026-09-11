/**
 * Regression guard for the standalone restore of a LEGACY selective snapshot
 * (Critical A).
 *
 * Selective snapshots persisted before the extension's capture guard carry a
 * `{ deleted: true, baseSnapshotId }` tombstone for every file the selection
 * never included: the pre-guard deletion pass compared the previous snapshot
 * against a scan the selective filter had already narrowed, so every unselected
 * file looked gone and was tombstoned.
 *
 * `SnapshotManager.restoreSnapshot` (the PUBLISHED `codelapse-core`, which is
 * what the CLI resolves) walks `options.selectedFiles || Object.keys(files)` and
 * unlinks every tombstoned path, so `codelapse snapshot restore <legacy-id>`
 * deleted exactly the files the snapshot never captured -- with no backup unless
 * `--backup` was passed. The extension's restore and preview were fixed; the
 * standalone surface is fixed here, by handing the core the captured list the
 * snapshot itself recorded.
 *
 * These tests drive the real published core against a real temporary workspace,
 * so "the uncaptured file survives" is a statement about shipped behavior
 * rather than about a mock. `useRealFileSystem` is required: the shared jest
 * setup replaces `writeFileSync`/`existsSync` with no-ops.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SnapshotManager, SnapshotStorage } from 'codelapse-core';
import { StandaloneHandler } from '../standaloneHandler';
import { useRealFileSystem } from './realFs';

const CAPTURED_REL = 'captured.txt';
const UNCAPTURED_REL = 'uncaptured.txt';

function filePath(root: string, relativePath: string): string {
  return path.join(root, relativePath);
}

describe('standalone restore scope', () => {
  let root: string;
  let manager: SnapshotManager;
  let handler: StandaloneHandler;

  beforeEach(async () => {
    useRealFileSystem();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-restore-'));

    fs.writeFileSync(filePath(root, CAPTURED_REL), 'captured v1\n', 'utf8');
    fs.writeFileSync(
      filePath(root, UNCAPTURED_REL),
      'never captured\n',
      'utf8',
    );

    manager = new SnapshotManager(root);
    await manager.initialize();

    handler = new StandaloneHandler();
    (
      handler as unknown as { snapshotManager: SnapshotManager }
    ).snapshotManager = manager;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * A whole-tree snapshot first, then a selective capture of ONE file: the
   * second snapshot is the legacy shape, because the published core compares the
   * previous snapshot against the narrowed scan.
   */
  async function takeLegacySelectiveSnapshot(): Promise<string> {
    await manager.takeSnapshot({ description: 'base' });
    // Changed after the base, so the captured entry is a real delta: restoring
    // it has to resolve through the base snapshot to be observable at all.
    fs.writeFileSync(filePath(root, CAPTURED_REL), 'captured v2\n', 'utf8');

    const selective = await manager.takeSnapshot({
      description: 'legacy selective',
      isSelective: true,
      selectedFiles: [CAPTURED_REL],
    });

    // Preconditions: this really is the shape the fix exists for. Without the
    // tombstone the restore below would be proving something else.
    const stored = await manager.getSnapshot(selective.id);
    expect(stored?.isSelective).toBe(true);
    expect(stored?.selectedFiles).toEqual([CAPTURED_REL]);
    expect(stored?.files[UNCAPTURED_REL]).toEqual(
      expect.objectContaining({ deleted: true }),
    );
    expect(stored?.files[CAPTURED_REL]?.deleted).toBeUndefined();

    return selective.id;
  }

  it('does not delete a file the selective capture never included', async () => {
    const selectiveId = await takeLegacySelectiveSnapshot();
    fs.writeFileSync(filePath(root, CAPTURED_REL), 'drifted v3\n', 'utf8');
    const restoreSpy = jest.spyOn(manager, 'restoreSnapshot');

    await handler.restoreSnapshot(selectiveId, { backup: false });

    // The data loss comes first: the core's walk reaches the tombstone for the
    // uncaptured file and unlinks it.
    expect(fs.existsSync(filePath(root, UNCAPTURED_REL))).toBe(true);
    expect(fs.readFileSync(filePath(root, UNCAPTURED_REL), 'utf8')).toBe(
      'never captured\n',
    );
    // ... which is the captured list the snapshot recorded being handed to the
    // core, so a later refactor that drops it fails here rather than silently.
    expect(restoreSpy).toHaveBeenCalledWith(
      selectiveId,
      expect.objectContaining({ selectedFiles: [CAPTURED_REL] }),
    );
    // The captured file was still restored, so the survival above is the narrow
    // scope and not a restore that did nothing.
    expect(fs.readFileSync(filePath(root, CAPTURED_REL), 'utf8')).toBe(
      'captured v2\n',
    );
  });

  it('still deletes a genuinely deleted file for a whole-tree snapshot', async () => {
    await manager.takeSnapshot({ description: 'base' });
    fs.rmSync(filePath(root, UNCAPTURED_REL));
    const wholeTree = await manager.takeSnapshot({
      description: 'whole tree, one file gone',
    });

    // Precondition: the deletion is recorded, so the restore has a real marker
    // to act on.
    const stored = await manager.getSnapshot(wholeTree.id);
    expect(stored?.isSelective).toBe(false);
    expect(stored?.files[UNCAPTURED_REL]).toEqual(
      expect.objectContaining({ deleted: true }),
    );

    // The file comes back after the capture, as it would for a user who recreated
    // it: the snapshot still says it is gone.
    fs.writeFileSync(filePath(root, UNCAPTURED_REL), 'recreated\n', 'utf8');

    await handler.restoreSnapshot(wholeTree.id, { backup: false });

    expect(fs.existsSync(filePath(root, UNCAPTURED_REL))).toBe(false);
    expect(fs.existsSync(filePath(root, CAPTURED_REL))).toBe(true);
  });

  it('honours an explicit caller selection instead of the captured list', async () => {
    const selectiveId = await takeLegacySelectiveSnapshot();
    fs.writeFileSync(filePath(root, CAPTURED_REL), 'drifted v3\n', 'utf8');
    const restoreSpy = jest.spyOn(manager, 'restoreSnapshot');

    await handler.restoreSnapshot(selectiveId, {
      backup: false,
      selectedFiles: [UNCAPTURED_REL],
    });

    // A caller that narrowed the restore deliberately is not overridden.
    expect(restoreSpy).toHaveBeenCalledWith(
      selectiveId,
      expect.objectContaining({ selectedFiles: [UNCAPTURED_REL] }),
    );
    // ... which is observable: the file the caller did not name was not written.
    expect(fs.readFileSync(filePath(root, CAPTURED_REL), 'utf8')).toBe(
      'drifted v3\n',
    );
  });

  /**
   * Persist a selection claim onto an already-stored snapshot, the way a legacy
   * record carries one.
   */
  async function storeSelection(
    snapshotId: string,
    selectedFiles: string[],
  ): Promise<void> {
    const storage = new SnapshotStorage(root);
    const record = await storage.loadSnapshot(snapshotId);
    if (!record) {
      throw new Error(`stored snapshot ${snapshotId} could not be re-read`);
    }

    record.isSelective = true;
    record.selectedFiles = selectedFiles;
    await storage.saveSnapshot(record);

    // Precondition: the handler really reads the rewritten record, so a store
    // location mismatch cannot make the restores below pass vacuously.
    const stored = await manager.getSnapshot(snapshotId);
    expect(stored?.isSelective).toBe(true);
    expect(stored?.selectedFiles).toEqual(selectedFiles);
  }

  it('restores a whole-tree snapshot whose recorded selection is all junk', async () => {
    const snapshot = await manager.takeSnapshot({ description: 'whole tree' });

    // `codelapse snapshot create --selective --files ""` persists exactly this:
    // a selection holding one empty string, which names no file. The published
    // core still loads it (it only requires an array of strings), so this is a
    // legacy junk selection a real store can hold.
    await storeSelection(snapshot.id, ['']);

    fs.writeFileSync(
      filePath(root, CAPTURED_REL),
      'drifted after capture\n',
      'utf8',
    );
    const restoreSpy = jest.spyOn(manager, 'restoreSnapshot');

    await handler.restoreSnapshot(snapshot.id, { backup: false });

    // A junk list is not a selection: this snapshot captured the whole tree, so
    // the core must not be handed a restriction that names nothing. Core reads
    // `options.selectedFiles || Object.keys(files)`, so a truthy all-junk array
    // makes it look up a non-existent entry and write nothing -- a silent no-op
    // that reports success while the workspace stays drifted.
    expect(fs.readFileSync(filePath(root, CAPTURED_REL), 'utf8')).toBe(
      'captured v1\n',
    );
    // ... which is the restriction being dropped rather than the core being
    // asked to walk a list of nothing.
    expect(restoreSpy.mock.calls[0][1]?.selectedFiles).toBeUndefined();
  });

  it('drops non-string entries from a legacy selection instead of restoring nothing', async () => {
    const snapshot = await manager.takeSnapshot({ description: 'whole tree' });
    const stored = await manager.getSnapshot(snapshot.id);
    if (!stored) {
      throw new Error('snapshot was not stored');
    }

    // `[42]` cannot survive the published core's own disk validation
    // (`assertStringArray` quarantines the record on read), so the junk record
    // is supplied through the read the handler makes. The restore itself is the
    // real core against the real store; only the record it inspects is legacy.
    jest.spyOn(manager, 'getSnapshot').mockResolvedValue({
      ...stored,
      isSelective: true,
      selectedFiles: [42] as unknown as string[],
    });

    fs.writeFileSync(
      filePath(root, CAPTURED_REL),
      'drifted after capture\n',
      'utf8',
    );
    const restoreSpy = jest.spyOn(manager, 'restoreSnapshot');

    await handler.restoreSnapshot(snapshot.id, { backup: false });

    expect(fs.readFileSync(filePath(root, CAPTURED_REL), 'utf8')).toBe(
      'captured v1\n',
    );
    expect(restoreSpy.mock.calls[0][1]?.selectedFiles).toBeUndefined();
  });

  it('keeps a usable entry in a partly junk selection and restores selectively', async () => {
    const selectiveId = await takeLegacySelectiveSnapshot();
    const stored = await manager.getSnapshot(selectiveId);
    if (!stored) {
      throw new Error('selective snapshot was not stored');
    }

    jest.spyOn(manager, 'getSnapshot').mockResolvedValue({
      ...stored,
      selectedFiles: [CAPTURED_REL, 42, null, ''] as unknown as string[],
    });

    fs.writeFileSync(filePath(root, CAPTURED_REL), 'drifted v3\n', 'utf8');
    const restoreSpy = jest.spyOn(manager, 'restoreSnapshot');

    await handler.restoreSnapshot(selectiveId, { backup: false });

    // Normalizing must not turn a usable selection into a whole-tree restore:
    // this snapshot is genuinely selective, so the core receives only the
    // entries that name a file and the tombstoned uncaptured file survives.
    expect(restoreSpy.mock.calls[0][1]?.selectedFiles).toEqual([CAPTURED_REL]);
    expect(fs.existsSync(filePath(root, UNCAPTURED_REL))).toBe(true);
    expect(fs.readFileSync(filePath(root, CAPTURED_REL), 'utf8')).toBe(
      'captured v2\n',
    );
  });
});
