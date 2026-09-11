import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Metadata coverage for the fields the metadata commands write: favorites,
 * tags, notes, task references (and the description through the same call).
 *
 * The manager exposes ONE mutator for all of them -- `updateSnapshotContext`
 * (src/snapshotManager.ts:1815) -- with a partial-update object. The names the
 * plan guessed (`toggleFavoriteStatus`, `updateSnapshotTags`,
 * `updateSnapshotNotes`, `updateTaskReference`) do not exist; the metadata
 * commands in src/commands.ts call `updateSnapshotContext(id, { isFavorite })`
 * (line 1173), `{ tags }` (1234) and `{ taskReference }` (1334).
 *
 * Every assertion is bound to the id `takeSnapshot` returned and is established
 * by this suite, because suites share one extension host and one fixture store.
 * Values are read twice: through `api.getSnapshots()` and from the snapshot's
 * own payload on disk. The API read alone is weak -- `getSnapshots()` returns
 * the live in-memory objects, so a mutator that only touched memory would look
 * correct there. The on-disk payload (`<store>/<id>/snapshot.json`, written by
 * `saveSnapshotData`) is what the next session loads, so it is the honest
 * "survived the write" check.
 */
const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
/** `vscode-snapshots.snapshotLocation` from test/runTest.ts's fixture settings. */
const STORE_DIR = path.join(FIXTURE_ROOT ?? "", ".snapshots-test");

/** The partial update `updateSnapshotContext` accepts. */
type ContextUpdate = {
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  description?: string;
};

type Manager = {
  updateSnapshotContext(id: string, update: ContextUpdate): Promise<boolean>;
};

/** The snapshot as the API reports it, or a failure naming the missing id. */
async function snapshotFromApi(api: any, id: string): Promise<any> {
  const all: any[] = await api.getSnapshots();
  const found = all.find((s: any) => s.id === id);
  assert.ok(
    found,
    `snapshot ${id} created by this suite is missing from api.getSnapshots()`,
  );
  return found;
}

/** The snapshot as the next session reads it: `<store>/<id>/snapshot.json`. */
function snapshotOnDisk(id: string): any {
  const file = path.join(STORE_DIR, id, "snapshot.json");
  assert.ok(
    fs.existsSync(file),
    `no persisted payload for ${id}; expected ${file}`,
  );
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

suite("snapshot metadata", function () {
  this.timeout(60000);

  let api: any;
  let manager: Manager;
  let id: string;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
    assert.strictEqual(
      typeof manager.updateSnapshotContext,
      "function",
      "snapshotManager.updateSnapshotContext missing: the metadata mutator this suite exercises",
    );

    // Manual (untagged) snapshot: only `tags: ['auto']` snapshots can be
    // refused for "no changes", so this one is always created.
    const outcome = await api.takeSnapshot({
      description: "meta-snap",
      silent: true,
    });
    assert.ok(outcome.success, `takeSnapshot failed: ${JSON.stringify(outcome)}`);
    id = outcome.snapshot.id;
    assert.ok(
      typeof id === "string" && id.length > 0,
      "takeSnapshot returned a snapshot without an id",
    );
  });

  test("favorite round-trips on, off, and through the persisted payload", async () => {
    const fresh = await snapshotFromApi(api, id);
    assert.strictEqual(
      fresh.isFavorite,
      false,
      "precondition: a freshly taken snapshot should not be a favorite",
    );

    const favored = await manager.updateSnapshotContext(id, {
      isFavorite: true,
    });
    assert.strictEqual(
      favored,
      true,
      "updateSnapshotContext should report success for the favorite update",
    );
    assert.strictEqual(
      (await snapshotFromApi(api, id)).isFavorite,
      true,
      "favorite=true not visible through api.getSnapshots()",
    );
    assert.strictEqual(
      snapshotOnDisk(id).isFavorite,
      true,
      "favorite=true not persisted to snapshot.json",
    );

    // To keep the tree unfiltered for any later suite, and to prove the update
    // is applied rather than echoed: a mutator that ignored its argument would
    // satisfy the assertions above but not this one.
    const unfavored = await manager.updateSnapshotContext(id, {
      isFavorite: false,
    });
    assert.strictEqual(unfavored, true, "unfavorite should report success");
    assert.strictEqual(
      (await snapshotFromApi(api, id)).isFavorite,
      false,
      "favorite=false was not applied",
    );
    assert.strictEqual(
      snapshotOnDisk(id).isFavorite,
      false,
      "favorite=false not persisted to snapshot.json",
    );
  });

  test("tags, notes and taskReference apply exactly, re-apply, and persist", async () => {
    const fresh = await snapshotFromApi(api, id);
    assert.deepStrictEqual(
      fresh.tags,
      [],
      "precondition: a freshly taken snapshot should carry no tags",
    );
    assert.strictEqual(
      fresh.notes,
      "",
      "precondition: a freshly taken snapshot should carry no notes",
    );
    assert.strictEqual(
      fresh.taskReference,
      "",
      "precondition: a freshly taken snapshot should carry no task reference",
    );

    await manager.updateSnapshotContext(id, {
      tags: ["red", "blue"],
      notes: "note text",
      taskReference: "task-42",
    });

    const set = await snapshotFromApi(api, id);
    assert.deepStrictEqual(set.tags, ["red", "blue"], "tags not applied");
    assert.strictEqual(set.notes, "note text", "notes not applied");
    assert.strictEqual(
      set.taskReference,
      "task-42",
      "taskReference not applied",
    );

    const persisted = snapshotOnDisk(id);
    assert.deepStrictEqual(
      persisted.tags,
      ["red", "blue"],
      "tags not persisted to snapshot.json",
    );
    assert.strictEqual(
      persisted.notes,
      "note text",
      "notes not persisted to snapshot.json",
    );
    assert.strictEqual(
      persisted.taskReference,
      "task-42",
      "taskReference not persisted to snapshot.json",
    );

    // Re-set every field to a different value. The block above passes for a
    // mutator that stores the first write and ignores later ones; this one
    // does not.
    await manager.updateSnapshotContext(id, {
      tags: ["green"],
      notes: "second note",
      taskReference: "task-99",
    });

    const changed = await snapshotFromApi(api, id);
    assert.deepStrictEqual(changed.tags, ["green"], "re-set tags not applied");
    assert.strictEqual(changed.notes, "second note", "re-set notes not applied");
    assert.strictEqual(
      changed.taskReference,
      "task-99",
      "re-set taskReference not applied",
    );

    const changedOnDisk = snapshotOnDisk(id);
    assert.deepStrictEqual(
      changedOnDisk.tags,
      ["green"],
      "re-set tags not persisted to snapshot.json",
    );
    assert.strictEqual(
      changedOnDisk.notes,
      "second note",
      "re-set notes not persisted to snapshot.json",
    );
    assert.strictEqual(
      changedOnDisk.taskReference,
      "task-99",
      "re-set taskReference not persisted to snapshot.json",
    );
  });

  test("a description-only update leaves tags, notes and taskReference untouched", async () => {
    // Precondition established here rather than inherited from the previous
    // test, so this test can fail on its own.
    await manager.updateSnapshotContext(id, {
      tags: ["keep"],
      notes: "keep note",
      taskReference: "keep-task",
    });
    const before = await snapshotFromApi(api, id);
    assert.deepStrictEqual(before.tags, ["keep"], "precondition: tags not set");

    await manager.updateSnapshotContext(id, { description: "meta-snap-renamed" });

    const after = await snapshotFromApi(api, id);
    assert.strictEqual(
      after.description,
      "meta-snap-renamed",
      "description not applied",
    );
    assert.deepStrictEqual(
      after.tags,
      ["keep"],
      "a description-only update changed tags",
    );
    assert.strictEqual(
      after.notes,
      "keep note",
      "a description-only update changed notes",
    );
    assert.strictEqual(
      after.taskReference,
      "keep-task",
      "a description-only update changed taskReference",
    );
  });
});
