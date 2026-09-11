import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * `maxSnapshots` pruning and corrupted-index recovery.
 *
 * Contracts verified in source before asserting them:
 *
 *  - `src/snapshotManager.ts:1755-1807` -- `enforceSnapshotLimit()` runs after
 *    every `takeSnapshot`, reads the setting live, and removes the snapshots
 *    `selectPrunableSnapshots` selects. Each removal goes through
 *    `purgeSnapshot` -> `storage.deleteSnapshotData`, which deletes the
 *    snapshot's directory (`src/snapshotStorage.ts:608-656`).
 *  - `src/snapshotManager.ts:105-134` -- snapshots are deltas: an entry holding
 *    only a `baseSnapshotId` is readable only while that base exists. Pruning
 *    is therefore refused for any candidate a SURVIVING snapshot references,
 *    and from the oldest end, so a plain chain of snapshots can legitimately
 *    keep more than `maxSnapshots`. The tests below distinguish that guard from
 *    real pruning instead of assuming the limit is always reached.
 *  - `src/snapshotStorage.ts:296-320` -- an unparsable `index.json` is
 *    quarantined into `<store>/quarantine/index.json.quarantine-<iso>` and the
 *    store is rebuilt by `recoverSnapshotsFromFileSystem` (`:480-513`), which
 *    reads every `snapshot-*` payload directory. The rewritten index records
 *    the recovered state as detached (`activeSnapshotId: null`, `:141-149`).
 *
 * This suite drains the store first, so "oldest" and "newest" always name
 * snapshots it created itself; the `Tree views` and store-exclusion suites do
 * the same. Pruning deletes snapshots other suites made -- that is the feature
 * under test -- so nothing here may assume an inherited snapshot still exists.
 */
const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const SECTION = "vscode-snapshots";
/** `vscode-snapshots.snapshotLocation` / `maxSnapshots` from test/runTest.ts. */
const STORE_DIR = path.join(FIXTURE_ROOT ?? "", ".snapshots-test");
const FIXTURE_MAX_SNAPSHOTS = 20;
/**
 * The file that makes a snapshot survivable while everything older is pruned.
 *
 * A selective snapshot of a file the base does not contain records full content
 * (and `{deleted:true}` markers for the base's other files), so none of its
 * entries carries a `baseSnapshotId` and no surviving snapshot depends on an
 * older one through it. Without such a snapshot the delta guard correctly
 * refuses to prune at all -- that is the first test below.
 */
const BREAKER_REL = "prune-breaker.txt";
const BREAKER_FILE = path.join(FIXTURE_ROOT ?? "", BREAKER_REL);
const APP_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");

const config = () => vscode.workspace.getConfiguration(SECTION);

/** Every `snapshot-*` directory the store holds, by name, sorted. */
function storeSnapshotDirs(): string[] {
  if (!fs.existsSync(STORE_DIR)) {
    return [];
  }
  return fs
    .readdirSync(STORE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("snapshot-"))
    .map((entry) => entry.name)
    .sort();
}

function payloadPath(snapshotId: string): string {
  return path.join(STORE_DIR, snapshotId, "snapshot.json");
}

suite("snapshot pruning and recovery", function () {
  this.timeout(120000);

  let api: any;
  let manager: any;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
    assert.strictEqual(
      path.dirname(STORE_DIR),
      path.resolve(FIXTURE_ROOT),
      "the store should live inside the fixture workspace",
    );
  });

  // Both globals this suite touches are restored after EVERY test -- including
  // one that failed halfway -- and the store is left non-degenerate for the
  // suites that run after this one: pruning can empty it down to a single
  // snapshot, which would make a later suite's "the newest snapshot" meaningless.
  teardown(async () => {
    await setMaxSnapshots(FIXTURE_MAX_SNAPSHOTS);
    const outcome = await api.takeSnapshot({
      description: "prune-teardown-restore",
      silent: true,
    });
    assert.strictEqual(
      outcome.success,
      true,
      `teardown snapshot failed: ${JSON.stringify(outcome)}`,
    );
  });

  async function setMaxSnapshots(value: number): Promise<void> {
    await config().update(
      "maxSnapshots",
      value,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(
      config().get("maxSnapshots"),
      value,
      `the workspace override of maxSnapshots did not round-trip (${value})`,
    );
  }

  /** Delete every snapshot, so a test can own the list it inspects. */
  async function drainStore(): Promise<void> {
    for (const snapshot of await api.getSnapshots()) {
      const deleted = await api.deleteSnapshot(snapshot.id, {
        skipConfirm: true,
      });
      assert.strictEqual(
        deleted,
        true,
        `could not delete ${snapshot.id} while draining the store`,
      );
    }
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [],
      "the store should be empty after draining it",
    );
  }

  async function takeSnapshot(description: string): Promise<any> {
    const outcome = await api.takeSnapshot({ description, silent: true });
    assert.strictEqual(
      outcome.success,
      true,
      `takeSnapshot(${description}) failed: ${JSON.stringify(outcome)}`,
    );
    assert.ok(
      fs.existsSync(payloadPath(outcome.snapshot.id)),
      `no payload written for ${outcome.snapshot.id}`,
    );
    return outcome.snapshot;
  }

  function appendFixtureChange(marker: string): void {
    if (!fs.existsSync(APP_FILE)) {
      // An earlier suite's restore may have removed it; this suite must be able
      // to own the change it depends on in any file order.
      fs.writeFileSync(APP_FILE, "// fixture file recreated by the pruning suite\n");
    }
    const before = fs.readFileSync(APP_FILE, "utf8");
    fs.appendFileSync(APP_FILE, `\n${marker}\n`);
    assert.notStrictEqual(
      fs.readFileSync(APP_FILE, "utf8"),
      before,
      `fixture file ${APP_FILE} did not change after appending ${marker}`,
    );
  }

  test("the limit is not enforced by deleting a snapshot a surviving snapshot references", async () => {
    await drainStore();
    await setMaxSnapshots(1);

    const first = await takeSnapshot("guard-1");
    appendFixtureChange(`// prune guard marker ${Date.now()}`);
    const second = await takeSnapshot("guard-2");

    // Precondition that gives the guard meaning: the second snapshot is a delta
    // on the first, so pruning the first would make the second unreadable.
    const secondSnapshot = (await api.getSnapshots()).find(
      (s: any) => s.id === second.id,
    );
    assert.ok(
      secondSnapshot,
      `snapshot ${second.id} vanished from the store`,
    );
    assert.ok(
      Object.values(secondSnapshot.files).some(
        (file: any) => file.baseSnapshotId === first.id,
      ),
      `precondition: ${second.id} does not reference ${first.id}; the guard assertion below would be vacuous`,
    );

    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [first.id, second.id],
      `the limit (1) was enforced by deleting a snapshot the newest snapshot depends on: ${JSON.stringify(
        (await api.getSnapshots()).map((s: any) => s.id),
      )}`,
    );
    assert.deepStrictEqual(
      storeSnapshotDirs(),
      [first.id, second.id].sort(),
      "both snapshots must still have their payload directory on disk",
    );
  });

  test("maxSnapshots prunes the unreferenced oldest snapshots from the list and from disk", async () => {
    await drainStore();
    await setMaxSnapshots(3);

    const first = await takeSnapshot("prune-1");
    appendFixtureChange(`// prune-2 marker ${Date.now()}`);
    const second = await takeSnapshot("prune-2");

    // The breaker: a selective snapshot of a file the base does not contain.
    fs.writeFileSync(BREAKER_FILE, `// prune breaker ${Date.now()}\n`, "utf8");
    assert.ok(
      fs.readFileSync(BREAKER_FILE, "utf8").length > 0,
      `the breaker file ${BREAKER_FILE} was not written`,
    );
    const breakerOutcome = await api.takeSnapshot({
      description: "prune-3-breaker",
      isSelective: true,
      selectedFiles: [BREAKER_REL],
      silent: true,
    });
    assert.strictEqual(
      breakerOutcome.success,
      true,
      `the breaker snapshot failed: ${JSON.stringify(breakerOutcome)}`,
    );
    const breaker = breakerOutcome.snapshot;

    // Precondition: the breaker really is self-contained. If it referenced an
    // older snapshot, the guard would refuse the pruning below and this test
    // would prove nothing.
    const referencingEntries = Object.entries(breaker.files).filter(
      ([, file]: [string, any]) => file.baseSnapshotId !== undefined,
    );
    assert.deepStrictEqual(
      referencingEntries.map(([key]) => key),
      [],
      `the breaker snapshot references a base; pruning cannot pass it: ${JSON.stringify(
        breaker.files,
      )}`,
    );

    const fourth = await takeSnapshot("prune-4");
    // With four snapshots and a limit of three, the oldest is still referenced
    // by the second, so the delta guard keeps everything (src/snapshotManager.ts:105-134).
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [first.id, second.id, breaker.id, fourth.id],
      "nothing may be pruned while a surviving snapshot references the oldest one",
    );

    const fifth = await takeSnapshot("prune-5");
    const survivors = [breaker.id, fourth.id, fifth.id];
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      survivors,
      `pruning kept ${JSON.stringify(
        (await api.getSnapshots()).map((s: any) => s.id),
      )}, expected the newest three ${JSON.stringify(survivors)}`,
    );
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.description),
      ["prune-3-breaker", "prune-4", "prune-5"],
      "the surviving snapshots are not the three newest ones",
    );

    // The list and the store on disk must agree: a pruned snapshot whose
    // directory survives is exactly the orphaned-directory bug.
    assert.deepStrictEqual(
      storeSnapshotDirs(),
      [...survivors].sort(),
      `snapshot directories on disk disagree with the pruned list: ${JSON.stringify(
        storeSnapshotDirs(),
      )}`,
    );
    for (const pruned of [first.id, second.id]) {
      assert.strictEqual(
        fs.existsSync(path.join(STORE_DIR, pruned)),
        false,
        `pruned snapshot ${pruned} still has a directory on disk`,
      );
    }
  });

  test("a corrupt index.json is quarantined and the next load rebuilds the store from disk", async () => {
    const before = (await api.getSnapshots()).map((s: any) => s.id);
    assert.ok(
      before.length >= 2,
      `precondition: expected snapshots to recover, saw ${JSON.stringify(before)}`,
    );

    const indexPath = path.join(STORE_DIR, "index.json");
    assert.ok(fs.existsSync(indexPath), `no index to corrupt: ${indexPath}`);
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(indexPath, "utf8")).snapshots.map(
        (s: any) => s.id,
      ),
      before,
      "precondition: the index should describe the snapshots in the store",
    );

    const quarantineDir = path.join(STORE_DIR, "quarantine");
    const quarantinedBefore = fs.existsSync(quarantineDir)
      ? fs.readdirSync(quarantineDir)
      : [];

    const corrupted = "{ this is not json";
    fs.writeFileSync(indexPath, corrupted, "utf8");
    assert.strictEqual(
      fs.readFileSync(indexPath, "utf8"),
      corrupted,
      "the corruption did not land on disk",
    );

    // The load path a new session takes. It must resolve, not reject.
    let failure: unknown;
    try {
      await manager.loadSnapshots();
    } catch (error) {
      failure = error;
    }
    assert.strictEqual(
      failure,
      undefined,
      `loading a corrupt index rejected instead of recovering: ${String(
        failure,
      )}`,
    );

    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      before,
      "recovery did not rebuild the snapshot list from the payload directories",
    );
    assert.deepStrictEqual(
      storeSnapshotDirs(),
      [...before].sort(),
      "every snapshot should still have its payload directory after recovery",
    );

    // The invalid file was preserved rather than silently overwritten.
    assert.ok(
      fs.existsSync(quarantineDir),
      `no quarantine directory at ${quarantineDir}`,
    );
    const quarantinedAfter = fs.readdirSync(quarantineDir);
    const newQuarantineEntries = quarantinedAfter.filter(
      (name) => !quarantinedBefore.includes(name),
    );
    assert.deepStrictEqual(
      newQuarantineEntries.length,
      1,
      `expected exactly one newly quarantined artifact, saw ${JSON.stringify(
        newQuarantineEntries,
      )}`,
    );
    assert.ok(
      newQuarantineEntries[0].startsWith("index.json.quarantine-"),
      `unexpected quarantine artifact name: ${JSON.stringify(
        newQuarantineEntries[0],
      )}`,
    );

    // The index was rewritten as valid JSON, listing exactly the recovered
    // snapshots, and records the recovered state as detached: a scan of the
    // store is no evidence that the workspace reflects any of these snapshots.
    const rewritten = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.deepStrictEqual(
      rewritten.snapshots.map((s: any) => s.id),
      before,
      "the rewritten index does not list the recovered snapshots",
    );
    assert.strictEqual(
      rewritten.activeSnapshotId,
      null,
      `a recovered store must be recorded as detached, saw ${JSON.stringify(
        rewritten.activeSnapshotId,
      )}`,
    );
    assert.strictEqual(
      manager.getActiveSnapshot(),
      undefined,
      "the manager still claims the workspace reflects a snapshot after recovery",
    );
    assert.strictEqual(manager.getCurrentSnapshotIndex(), -1);
  });

  test("a snapshot taken while index.json is corrupt still succeeds and rewrites a valid index", async () => {
    const indexPath = path.join(STORE_DIR, "index.json");
    const corrupted = "!! not json either";
    fs.writeFileSync(indexPath, corrupted, "utf8");
    assert.strictEqual(fs.readFileSync(indexPath, "utf8"), corrupted);

    const outcome = await api.takeSnapshot({
      description: "after-corruption",
      silent: true,
    });
    // A manual snapshot is never skipped, so a writable store must accept it;
    // anything else here is a crash or a silent refusal.
    assert.strictEqual(
      outcome.success,
      true,
      `a snapshot while the index was corrupt failed: ${JSON.stringify(
        outcome,
      )}`,
    );

    const ids = (await api.getSnapshots()).map((s: any) => s.id);
    assert.ok(
      ids.includes(outcome.snapshot.id),
      `the snapshot taken after corruption is not in the store: ${JSON.stringify(
        ids,
      )}`,
    );
    assert.ok(
      fs.existsSync(payloadPath(outcome.snapshot.id)),
      `no payload written for ${outcome.snapshot.id}`,
    );

    const rewritten = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    assert.deepStrictEqual(
      rewritten.snapshots.map((s: any) => s.id),
      ids,
      "the rewritten index does not describe the current store",
    );
  });
});
