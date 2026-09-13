import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;

/** `vscode-snapshots.snapshotLocation` from test/runTest.ts's fixture settings. */
const STORE_REL = ".snapshots-test";
const STORE_DIR = path.join(FIXTURE_ROOT ?? "", STORE_REL);
const APP_REL = "src/app.ts";
const APP_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");

/** Snapshot keys are recorded with the platform separator; compare in POSIX form. */
const toPosix = (p: string): string => p.replace(/\\/g, "/");

/** Workspace-relative POSIX paths of every file the store actually holds. */
function storeFilesOnDisk(): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        found.push(`${STORE_REL}/${rel}`);
      }
    }
  };
  if (fs.existsSync(STORE_DIR)) {
    walk(STORE_DIR, "");
  }
  return found;
}

/** Absolute path of a snapshot's payload file (`<store>/<id>/snapshot.json`). */
function payloadPath(snapshotId: string): string {
  return path.join(STORE_DIR, snapshotId, "snapshot.json");
}

/**
 * The snapshot store is application data that lives inside the scanned
 * workspace (the fixture's `snapshotLocation` is `.snapshots-test`). Two
 * defects follow from building the `GitignoreParser` without that location:
 *
 * 1. Every snapshot captures the store's own `index.json` and payload files, so
 *    snapshots reference themselves and the auto-snapshot "no changes" skip can
 *    never fire (the store's `index.json` changes on every snapshot).
 * 2. A restore deletes every workspace file the target snapshot does not
 *    contain. A snapshot's payload directory is written AFTER that snapshot's
 *    own file scan, so the payload is "extraneous" to the snapshot it belongs
 *    to: navigating backwards deletes the payloads of the snapshot navigated to
 *    and of every newer snapshot, while still reporting success.
 *
 * These tests fail against a build whose parser defaults to `.snapshots`. The
 * data-loss check compares the store on disk and then re-reads it (`the way the
 * next session does`), because in-memory snapshot objects keep serving their
 * content after the payload file behind them has been deleted.
 *
 * The suite drains the store first, so the snapshot list it inspects is one it
 * created (the `CodeLapse Integration` suite deletes its store from disk at
 * teardown, leaving metadata-only entries behind).
 */
suite("snapshot store exclusion", function () {
  this.timeout(60000);

  let api: any;
  let manager: any;
  /** The snapshots the navigation test created, with the content each held. */
  let navigated: { id: string; content: string }[] = [];

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
    assert.ok(fs.existsSync(APP_FILE), `fixture file missing: ${APP_FILE}`);

    await drainStore();
  });

  /** Delete every snapshot, so a test can own the list it inspects. */
  async function drainStore(): Promise<void> {
    for (const snapshot of await api.getSnapshots()) {
      const deleted = await api.deleteSnapshot(snapshot.id, {
        skipConfirm: true,
      });
      assert.equal(
        deleted,
        true,
        `could not delete snapshot ${snapshot.id} while draining the store`,
      );
    }
    assert.deepStrictEqual(
      manager.getSnapshots().map((s: any) => s.id),
      [],
      "the store should be empty after draining it",
    );
  }

  test("a snapshot does not capture the store it is written into", async () => {
    const outcome = await api.takeSnapshot({
      description: "store-exclusion-capture",
      silent: true,
    });
    assert.equal(
      outcome.success,
      true,
      `takeSnapshot failed: ${JSON.stringify(outcome)}`,
    );

    const snap = manager
      .getSnapshots()
      .find((s: any) => s.id === outcome.snapshot.id);
    assert.ok(snap, `snapshot ${outcome.snapshot.id} is not in the list`);
    const keys: string[] = Object.keys(snap.files).map(toPosix);

    // Falsifiability: the snapshot must have captured real workspace content,
    // otherwise "no store keys" would also hold for an empty file list.
    assert.ok(
      keys.includes(APP_REL),
      `expected ${APP_REL} among the captured keys: ${JSON.stringify(keys)}`,
    );

    // The store is not empty at this point -- it holds the index this snapshot
    // was just written into -- so there is something that could be captured.
    const storeOnDisk = storeFilesOnDisk();
    assert.ok(
      storeOnDisk.length > 0,
      `the fixture store has no files to capture: ${STORE_DIR}`,
    );

    assert.deepStrictEqual(
      keys.filter((k) => storeOnDisk.includes(k)),
      [],
      "snapshot captured its own store",
    );
    // The plan's form of the same assertion: nothing under the configured
    // location, whatever the store happens to contain at this instant.
    assert.deepStrictEqual(
      keys.filter((k) => k.startsWith(`${STORE_REL}/`)),
      [],
      `snapshot captured files under the configured snapshotLocation (${STORE_REL})`,
    );
  });

  test("the store does not defeat the auto-snapshot no-changes skip", async () => {
    // The first auto snapshot needs a change to record, and it has to be one
    // this test owns: the store's own churn is not incidental workspace churn.
    fs.appendFileSync(APP_FILE, "\n// store-exclusion auto marker\n");
    assert.ok(
      fs.readFileSync(APP_FILE, "utf8").includes("store-exclusion auto marker"),
      "the fixture edit did not land",
    );

    const first = await api.takeSnapshot({
      description: "store-exclusion-auto-1",
      tags: ["auto"],
      silent: true,
    });
    assert.equal(
      first.success,
      true,
      `the first auto snapshot recorded a real change but was not created: ${JSON.stringify(first)}`,
    );

    // Nothing in the workspace changes between these two calls, so the second
    // one has nothing to record. While the store is captured, its rewritten
    // `index.json` (and the payload the first call wrote after its own scan)
    // always counts as a change, and this skip can never fire.
    const before = manager.getSnapshots().length;
    const second = await api.takeSnapshot({
      description: "store-exclusion-auto-2",
      tags: ["auto"],
      silent: true,
    });

    assert.equal(
      manager.getSnapshots().length,
      before,
      "an auto snapshot of an unchanged workspace was created",
    );
    assert.equal(
      second.success,
      false,
      `expected the no-changes skip, got: ${JSON.stringify(second)}`,
    );
    assert.equal(
      second.noChanges,
      true,
      `expected noChanges: true, got: ${JSON.stringify(second)}`,
    );
  });

  test("navigating back does not delete the store's snapshot payloads", async () => {
    // The store must hold exactly the snapshots this test creates, so the
    // navigation below moves across a list this test owns end to end.
    await drainStore();
    assert.deepStrictEqual(
      manager.getSnapshots().map((s: any) => s.id),
      [],
      "the store should be empty before this test creates its snapshots",
    );

    const created: { id: string; content: string }[] = [];
    for (const marker of ["nav-payload-1", "nav-payload-2", "nav-payload-3"]) {
      fs.appendFileSync(APP_FILE, `\n// ${marker}\n`);
      const content = fs.readFileSync(APP_FILE, "utf8");
      assert.ok(
        content.includes(`// ${marker}`),
        `fixture edit did not land: ${marker}`,
      );
      const outcome = await api.takeSnapshot({
        description: marker,
        silent: true,
      });
      assert.equal(
        outcome.success,
        true,
        `takeSnapshot(${marker}) failed: ${JSON.stringify(outcome)}`,
      );
      created.push({ id: outcome.snapshot.id, content });
    }

    // Precondition: every payload is on disk before anything is navigated.
    for (const { id } of created) {
      assert.ok(
        fs.existsSync(payloadPath(id)),
        `precondition: ${payloadPath(id)} is missing before navigating`,
      );
    }

    // Recorded before the navigation: the test below asserts on this list, and
    // a failed assertion here must not silently empty it.
    navigated = created;
    assert.deepStrictEqual(
      manager.getSnapshots().map((s: any) => s.id),
      created.map((c) => c.id),
      "precondition: the store should hold exactly the snapshots created here",
    );

    const moved = await manager.navigateToPreviousSnapshot();
    assert.equal(moved, true, "navigateToPreviousSnapshot reported failure");

    // The store is not workspace content: nothing in it may be deleted by a
    // restore, however the workspace file scan behaves.
    const deletedPayloads = created
      .filter(({ id }) => !fs.existsSync(payloadPath(id)))
      .map(({ id }) => id);
    assert.deepStrictEqual(
      deletedPayloads,
      [],
      "navigating to the previous snapshot deleted snapshot payloads from the store",
    );
  });

  test("every snapshot listed in the index still loads from the store after navigating", async () => {
    assert.deepStrictEqual(
      navigated.map((n) => n.id),
      manager.getSnapshots().map((s: any) => s.id),
      "precondition: the navigation test's snapshots should be the whole store",
    );

    // Re-read the store the way the next session does. In-memory snapshot
    // objects still carry their own content and diffs, so resolving content
    // alone cannot see a payload that is gone from disk -- the loss only shows
    // up when the store is read back.
    await (manager as any).loadSnapshots();

    assert.deepStrictEqual(
      manager.getSnapshots().map((s: any) => s.id),
      navigated.map((n) => n.id),
      "snapshots listed in the index no longer load from the store",
    );

    const unresolved: string[] = [];
    for (const { id, content } of navigated) {
      const resolved = await manager.getSnapshotFileContentPublic(id, APP_REL);
      if (resolved !== content) {
        unresolved.push(
          `${id}: expected ${JSON.stringify(content)}, got ${JSON.stringify(resolved)}`,
        );
      }
    }
    assert.deepStrictEqual(
      unresolved,
      [],
      "snapshots listed in the index no longer resolve the content they recorded",
    );
  });
});
