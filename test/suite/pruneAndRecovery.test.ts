import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * `maxSnapshots` pruning and corrupted-index recovery.
 *
 * Contracts verified in source before asserting them:
 *
 *  - `enforceSnapshotLimit` in `src/snapshotManager.ts` -- runs after every
 *    `takeSnapshot`, reads the setting live, and removes the snapshots
 *    `selectPrunableSnapshots` selects. Each removal goes through
 *    `purgeSnapshot` -> `SnapshotStorage.deleteSnapshotData`, which deletes the
 *    snapshot's directory.
 *  - the delta shape `selectPrunableSnapshots` protects
 *    (`src/snapshotManager.ts`) -- snapshots are deltas: an entry holding only a
 *    `baseSnapshotId` is readable only while that base exists. The selector
 *    therefore refuses to delete a candidate a SURVIVING snapshot references,
 *    which on its own left a plain delta chain growing past `maxSnapshots`
 *    forever. `enforceSnapshotLimit` now repairs those survivors first -- it
 *    rewrites every entry pointing into the pruned prefix into full content,
 *    resolved while the chain is still intact, and persists them -- and only
 *    then deletes, so the limit is reached without losing the data. When a
 *    dependency cannot be resolved nothing is persisted, and the safety selector
 *    refuses the candidate a surviving snapshot still references, so the limit
 *    may then be reached only in part (the partial-prune log in
 *    `enforceSnapshotLimit`). That path is covered by the unit tests in
 *    `src/__tests__/snapshotPruneIntegrity.test.ts`; the pruning tests below
 *    assert the reachable outcome end to end: the limit is met without losing
 *    the content it would have cost.
 *  - `loadSnapshotIndexAndMetadata` in `src/snapshotStorage.ts` -- an unparsable
 *    `index.json` is quarantined into
 *    `<store>/quarantine/index.json.quarantine-<iso>` and the store is rebuilt
 *    by `recoverSnapshotsFromFileSystem`, which reads every `snapshot-*` payload
 *    directory. The rewritten index records the recovered state as detached:
 *    the recovery branch passes `null` for `activeSnapshotId`, where a legacy
 *    index omits the field entirely.
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
 * A selective snapshot of a file the base does not contain: it records full
 * content with no `baseSnapshotId`, so it is self-contained by construction
 * (since the selective-capture fix it records no `{deleted:true}` markers for
 * files it never selected either). Pruning has nothing to repair in it, which
 * is what makes it worth mixing into the delta chain under test: a prune that
 * keeps it proves self-contained captures survive alongside repaired deltas,
 * rather than only the shape the repair knows how to rewrite.
 */
const BREAKER_REL = "prune-breaker.txt";
const BREAKER_FILE = path.join(FIXTURE_ROOT ?? "", BREAKER_REL);
/** Workspace-relative path of the fixture file every test changes; snapshot
 *  file keys carry the platform separator on Windows, so it is passed to the
 *  manager's lookup (which normalizes) rather than joined into a filesystem
 *  path. */
const APP_REL = "src/app.ts";
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

  test("the tightest limit (1) is reached by repairing the survivor before its bases are pruned", async () => {
    await drainStore();
    // Two snapshots may coexist while the delta is set up: at one, enforcement
    // would repair the reference before this test could observe it, and the
    // precondition below would be unprovable. The limit is tightened after.
    await setMaxSnapshots(2);

    const first = await takeSnapshot("guard-1");
    const marker = `// prune guard marker ${Date.now()}`;
    appendFixtureChange(marker);
    const second = await takeSnapshot("guard-2");

    // Precondition that gives the repair meaning: the second snapshot is a
    // delta on the first, so a limit of one is reachable only by rewriting that
    // delta before the first snapshot's payload is deleted.
    const secondSnapshot = (await api.getSnapshots()).find(
      (s: any) => s.id === second.id,
    );
    assert.ok(secondSnapshot, `snapshot ${second.id} vanished from the store`);
    assert.ok(
      Object.values(secondSnapshot.files).some(
        (file: any) => file.baseSnapshotId === first.id,
      ),
      `precondition: ${second.id} does not reference ${first.id}; the repair assertion below would be vacuous`,
    );

    await setMaxSnapshots(1);
    appendFixtureChange(`// prune guard marker two ${Date.now()}`);
    const third = await takeSnapshot("guard-3");

    // The limit is reached: neither older snapshot remains, on the list or on
    // disk...
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [third.id],
      `the limit (1) was not enforced: ${JSON.stringify(
        (await api.getSnapshots()).map((s: any) => s.id),
      )}`,
    );
    assert.deepStrictEqual(
      storeSnapshotDirs(),
      [third.id],
      "a pruned snapshot still has its payload directory on disk",
    );

    // ...without losing what they held: the survivor carries the change that
    // only the deleted snapshots recorded.
    const resolved = await manager.getSnapshotFileContentPublic(
      third.id,
      APP_REL,
    );
    assert.strictEqual(
      typeof resolved,
      "string",
      `the surviving snapshot's copy of ${APP_REL} is no longer readable after its bases were pruned`,
    );
    assert.ok(
      (resolved as string).includes(marker),
      `the survivor's content lost the change captured before the prune: ${JSON.stringify(
        resolved,
      )}`,
    );
  });

  test("maxSnapshots prunes the oldest snapshots from the list and from disk, repairing the survivors", async () => {
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

    // Precondition: the breaker really is self-contained, so the prunes below
    // exercise both capture shapes -- a repaired delta chain and a snapshot
    // with nothing to repair. If it referenced an older snapshot the assertion
    // would be describing a different store than the one it names.
    const referencingEntries = Object.entries(breaker.files).filter(
      ([, file]: [string, any]) => file.baseSnapshotId !== undefined,
    );
    assert.deepStrictEqual(
      referencingEntries.map(([key]) => key),
      [],
      `the breaker snapshot references a base; it is not the self-contained shape this test needs: ${JSON.stringify(
        breaker.files,
      )}`,
    );

    const fourth = await takeSnapshot("prune-4");
    // With four snapshots and a limit of three, the oldest goes: the second
    // snapshot's delta on it is materialized first, so the survivor keeps its
    // content while the base's payload is deleted.
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [second.id, breaker.id, fourth.id],
      `the oldest snapshot was not pruned once its only dependants were repaired: ${JSON.stringify(
        (await api.getSnapshots()).map((s: any) => s.id),
      )}`,
    );
    assert.strictEqual(
      fs.existsSync(path.join(STORE_DIR, first.id)),
      false,
      `pruned snapshot ${first.id} still has a directory on disk`,
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

  /**
   * The defect this suite is named for: with `maxSnapshots` set, a plain chain
   * of snapshots grew without bound, because every survivor of the chain
   * references the snapshot the limit wanted to delete and the safety selector
   * then refused every candidate. The limit can only be reached by repairing
   * the survivors first, and the repair is what has to survive a reload -- an
   * in-memory rewrite that never reached disk would lose the data on the next
   * session.
   */
  test("maxSnapshots is enforced, and the surviving deltas are materialized on disk", async () => {
    await drainStore();
    await setMaxSnapshots(2);

    const first = await takeSnapshot("materialize-1");
    appendFixtureChange(`// materialize-2 marker ${Date.now()}`);
    const second = await takeSnapshot("materialize-2");
    appendFixtureChange(`// materialize-3 marker ${Date.now()}`);
    const third = await takeSnapshot("materialize-3");

    // Precondition that gives the repair meaning: the third snapshot is a delta
    // on the second, which the limit now wants to delete. Without a surviving
    // reference the assertion below would prove nothing.
    const thirdSnapshot = (await api.getSnapshots()).find(
      (s: any) => s.id === third.id,
    );
    assert.ok(thirdSnapshot, `snapshot ${third.id} vanished from the store`);
    assert.ok(
      Object.values(thirdSnapshot.files).some(
        (file: any) => file.baseSnapshotId === second.id,
      ),
      `precondition: ${third.id} does not reference ${second.id}; the repair assertion below would be vacuous`,
    );

    // What the survivor records now, to be compared after its base is gone.
    const expectedContent = await manager.getSnapshotFileContentPublic(
      third.id,
      APP_REL,
    );
    assert.strictEqual(
      typeof expectedContent,
      "string",
      `precondition: ${third.id} cannot read ${APP_REL} while its base still exists`,
    );

    appendFixtureChange(`// materialize-4 marker ${Date.now()}`);
    const fourth = await takeSnapshot("materialize-4");

    // Four snapshots, limit two: the two oldest can go only once the second's
    // dependants have been rewritten, and no survivor may be lost doing it.
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [third.id, fourth.id],
      `the limit (2) was not enforced: ${JSON.stringify(
        (await api.getSnapshots()).map((s: any) => s.id),
      )}`,
    );
    assert.deepStrictEqual(
      storeSnapshotDirs(),
      [third.id, fourth.id].sort(),
      "the payload directories on disk disagree with the pruned list",
    );
    for (const pruned of [first.id, second.id]) {
      assert.strictEqual(
        fs.existsSync(path.join(STORE_DIR, pruned)),
        false,
        `pruned snapshot ${pruned} still has a directory on disk`,
      );
    }

    // The repair reached disk, not just memory: the survivor's payload must not
    // still name the deleted snapshot as a base.
    const persisted = JSON.parse(fs.readFileSync(payloadPath(third.id), "utf8"));
    const dangling = Object.entries(persisted.files).filter(
      ([, file]: [string, any]) => file.baseSnapshotId === second.id,
    );
    assert.deepStrictEqual(
      dangling.map(([key]) => key),
      [],
      `the surviving snapshot still references the pruned base on disk: ${JSON.stringify(
        dangling,
      )}`,
    );

    // Re-read the store the way the next session does. In-memory objects carry
    // their own diffs, so only a reload can show whether the base's content was
    // really materialized into the survivor.
    await manager.loadSnapshots();
    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [third.id, fourth.id],
      "the repaired snapshots no longer load from the store",
    );
    const resolved = await manager.getSnapshotFileContentPublic(
      third.id,
      APP_REL,
    );
    assert.strictEqual(
      resolved,
      expectedContent,
      `the survivor's ${APP_REL} did not survive pruning its base`,
    );
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
