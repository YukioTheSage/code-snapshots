import * as assert from "assert";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
/** `ACTIVE_NONE` from src/snapshotSelection.ts: "the workspace is at no snapshot". */
const ACTIVE_NONE = -1;

/**
 * Navigation between snapshots. The observable contract is
 *
 *   - `getCurrentSnapshotIndex()` is derived from the ACTIVE SNAPSHOT ID, not
 *     from a stored position, and is `ACTIVE_NONE` (-1) when the workspace does
 *     not correspond to any snapshot.
 *   - `takeSnapshot` makes the snapshot it just created the active one.
 *   - `navigateToPreviousSnapshot()` / `navigateToNextSnapshot()` return whether
 *     they moved, and move exactly one position.
 *   - At either end of the list they report `false` instead of wrapping.
 *   - From the DETACHED state (no active snapshot) BOTH directions attach to the
 *     newest snapshot. "Previous" is not "index - 1" there: with no active
 *     index there is no index to subtract from, and the nearest snapshot to move
 *     to is the most recent one.
 *   - The two COMMANDS that expose this to the user, `previousSnapshot` and
 *     `nextSnapshot`, are non-interactive wrappers over those same manager
 *     calls; the tests at the end of this suite execute them for real and assert
 *     the effect they have on the manager.
 *
 * Navigation restores files as a side effect (`applySnapshotRestore`), which is
 * what makes the workspace reflect the snapshot it landed on. These tests
 * therefore assert on indices, ids and return values only -- never on file
 * contents, which the navigation itself rewrites.
 *
 * The suite drains the store first and then creates the snapshots it navigates,
 * so "oldest" and "newest" name exactly the snapshots it made. Existing
 * snapshots would not be enough: the extension suite deletes its store from
 * disk at teardown, so an inherited snapshot can be a metadata-only entry whose
 * content no longer resolves.
 *
 * HISTORICAL BUG (fixed; regression-tested in `storeExclusion.test.ts`): the
 * store lived inside the scanned workspace and was not excluded from it, so a
 * snapshot captured the store's own `snapshot.json` payloads, and a restore
 * deleted every workspace file the snapshot does not contain. Navigating
 * therefore deleted the payload file of the snapshot it moved to -- written
 * after that snapshot's own file scan, so it counted as "extraneous" to itself
 * -- and the payloads of every snapshot newer than it, while still reporting
 * success. Observed directly in this fixture: `Restore Apply summary: 5
 * restored, 2 deleted`, after which the two newer snapshots'
 * `.snapshots-test/<id>/snapshot.json` files were gone while the index still
 * listed them. See task-345-report.md (finding F1) for the reproduction and
 * task-15-report.md for the fix.
 */
suite("snapshot navigation", function () {
  this.timeout(60000);

  let api: any;
  let manager: any;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");

    await drainStore();

    // Manual snapshots always create, so no workspace change is needed for the
    // three positions below; each one is appended as the newest and becomes
    // active, which the first test then asserts explicitly.
    const created: string[] = [];
    for (const description of ["nav-1", "nav-2", "nav-3"]) {
      const outcome = await api.takeSnapshot({ description, silent: true });
      assert.ok(
        outcome.success,
        `takeSnapshot(${description}) failed: ${JSON.stringify(outcome)}`,
      );
      created.push(outcome.snapshot.id);
    }
    assert.deepStrictEqual(
      snapshotIds(),
      created,
      "the store should hold exactly the snapshots this suite created, oldest first",
    );
  });

  /** Ids of every snapshot, oldest first. */
  function snapshotIds(): string[] {
    return manager.getSnapshots().map((s: any) => s.id);
  }

  /** Position of a snapshot id in the manager's own list. */
  function indexOf(id: string): number {
    return snapshotIds().indexOf(id);
  }

  /** Delete every snapshot, so the list this suite navigates is one it owns. */
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
    assert.equal(
      snapshotIds().length,
      0,
      "the store should be empty after draining it",
    );
  }

  /** Restore a snapshot and prove it became the active one. */
  async function activateSnapshot(id: string): Promise<void> {
    const result = await manager.applySnapshotRestore(id);
    assert.equal(
      result.success,
      true,
      `applySnapshotRestore(${id}) failed: ${JSON.stringify(result)}`,
    );
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      indexOf(id),
      `restoring ${id} did not make it the active snapshot`,
    );
  }

  /** Drop the active-snapshot claim and prove the workspace is detached. */
  async function detach(): Promise<void> {
    await manager.clearActiveSnapshot();
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      ACTIVE_NONE,
      "a detached workspace should report ACTIVE_NONE",
    );
    assert.strictEqual(
      manager.getActiveSnapshot(),
      undefined,
      "a detached workspace should have no active snapshot",
    );
  }

  test("takeSnapshot appends the new snapshot and makes it the active one", async () => {
    const before = snapshotIds();

    const outcome = await api.takeSnapshot({
      description: "nav-4",
      silent: true,
    });
    assert.ok(
      outcome.success,
      `takeSnapshot failed: ${JSON.stringify(outcome)}`,
    );
    const newId = outcome.snapshot.id;

    const after = snapshotIds();
    assert.equal(
      after.length,
      before.length + 1,
      "takeSnapshot should append exactly one snapshot",
    );
    assert.equal(
      after[after.length - 1],
      newId,
      "the new snapshot should be the newest entry in the list",
    );
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      after.length - 1,
      "the new snapshot should be the active index",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newId,
      "getActiveSnapshot should report the snapshot just created",
    );
    assert.equal(
      manager.getActiveSnapshot()?.description,
      "nav-4",
      "the active snapshot should carry the description it was created with",
    );
    assert.equal(
      manager.isSnapshotActive(newId),
      true,
      "isSnapshotActive should accept the snapshot just created",
    );
  });

  test("navigateToPreviousSnapshot moves back exactly one snapshot", async () => {
    const list = snapshotIds();
    const newest = list.length - 1;
    const newestId = list[newest];
    const previousId = list[newest - 1];
    assert.ok(
      newest > 0,
      "precondition: navigation needs at least two snapshots",
    );
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest,
      "precondition: the newest snapshot should be active here",
    );

    const ok = await manager.navigateToPreviousSnapshot();
    assert.equal(ok, true, "navigateToPreviousSnapshot reported failure");

    const after = manager.getCurrentSnapshotIndex();
    assert.equal(
      after,
      newest - 1,
      "the active index should move back exactly one",
    );
    assert.equal(
      manager.getSnapshots()[after].id,
      previousId,
      "the active snapshot should be the one immediately before the newest",
    );
    assert.equal(
      manager.getSnapshots()[after].description,
      "nav-3",
      `expected the snapshot recorded as nav-3 at index ${after}`,
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      previousId,
      "getActiveSnapshot should report the snapshot that was navigated to",
    );
    assert.equal(manager.isSnapshotActive(previousId), true);
    assert.equal(
      manager.isSnapshotActive(newestId),
      false,
      "the snapshot navigated away from should no longer be active",
    );
  });

  test("navigateToNextSnapshot moves forward exactly one and then reports failure at the newest", async () => {
    const list = snapshotIds();
    const newest = list.length - 1;
    const newestId = list[newest];
    const previousId = list[newest - 1];

    // Start from a named position instead of whatever the test above left.
    await activateSnapshot(previousId);

    const ok = await manager.navigateToNextSnapshot();
    assert.equal(ok, true, "navigateToNextSnapshot reported failure");
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest,
      "the active index should move forward exactly one",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newestId,
      "the newest snapshot should be active after stepping forward",
    );

    // There is nothing beyond the newest snapshot: report failure rather than
    // wrapping around to the oldest or throwing.
    const okAgain = await manager.navigateToNextSnapshot();
    assert.equal(
      okAgain,
      false,
      "stepping past the newest snapshot should report failure",
    );
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest,
      "a refused step must not move the active index",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newestId,
      "a refused step must not change the active snapshot",
    );
  });

  test("navigateToPreviousSnapshot reports failure at the oldest instead of wrapping", async () => {
    const oldestId = snapshotIds()[0];
    await activateSnapshot(oldestId);
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      0,
      "precondition: the oldest snapshot should be active here",
    );

    const ok = await manager.navigateToPreviousSnapshot();
    assert.equal(
      ok,
      false,
      "there is nothing before the oldest snapshot, so this must report failure",
    );
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      0,
      "a refused step must not move the active index",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      oldestId,
      "a refused step must not change the active snapshot",
    );
  });

  test("detached, previous attaches to the newest snapshot rather than to index - 1", async () => {
    await detach();
    const list = snapshotIds();
    const newest = list.length - 1;
    const newestId = list[newest];
    const secondNewestId = list[newest - 1];
    assert.ok(
      newest > 0,
      "precondition: the newest and second-newest snapshots must differ",
    );

    const ok = await manager.navigateToPreviousSnapshot();
    assert.equal(
      ok,
      true,
      "detached, a previous step should attach to the newest snapshot, not report failure",
    );

    const after = manager.getCurrentSnapshotIndex();
    assert.equal(
      after,
      newest,
      "detached, previous should land on the newest snapshot",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newestId,
      "detached, the newest snapshot should become active",
    );
    // The naive "always one index back" model would land on the second-newest,
    // or on nothing at all -- there is no active index to subtract from.
    assert.notEqual(
      after,
      newest - 1,
      "detached, previous must not be resolved as 'index - 1'",
    );
    assert.notEqual(
      manager.getActiveSnapshot()?.id,
      secondNewestId,
      "detached, previous must not land on the second-newest snapshot",
    );
  });

  test("detached, next attaches to the newest snapshot rather than to the oldest", async () => {
    await detach();
    const list = snapshotIds();
    const newest = list.length - 1;
    const newestId = list[newest];
    const oldestId = list[0];
    assert.notStrictEqual(
      newestId,
      oldestId,
      "precondition: the newest and oldest snapshots must differ",
    );

    const ok = await manager.navigateToNextSnapshot();
    assert.equal(
      ok,
      true,
      "detached, a next step should attach to the newest snapshot, not report failure",
    );
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest,
      "detached, next should land on the newest snapshot",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newestId,
      "detached, next should make the newest snapshot active",
    );
    // Resolving "next" against a detached index used to name the oldest
    // snapshot, which is the further end of the history from where the user is.
    assert.notEqual(
      manager.getActiveSnapshot()?.id,
      oldestId,
      "detached, next must not resolve to the oldest snapshot",
    );
  });

  /**
   * The two navigation COMMANDS, executed as the keybindings do.
   *
   * `src/commands.ts:1364-1497` (`previousSnapshot`) and `:1499-1624`
   * (`nextSnapshot`) are not interactive: each resolves its target with
   * `snapshotManager.getNavigationTargetIndex(direction)` -- no quick pick, no
   * modal -- returns early when that is `ACTIVE_NONE`, and otherwise runs the
   * very same `navigateTo*Snapshot()` call the tests above drive directly,
   * wrapped in a `withProgress` notification. They therefore run in this
   * headless host, and `CODELAPSE_DISABLE_INTERACTIVE_UI` cannot turn them into
   * silent no-ops: neither handler reaches the guarded picker in
   * `src/ui/quickPick.ts`.
   *
   * Both handlers return `undefined` (they report through notifications), so
   * these tests assert the EFFECT on the manager -- index, active id and active
   * flags -- and never the command's return value.
   */
  test("previousSnapshot command moves the active snapshot back exactly one", async () => {
    const created = await api.takeSnapshot({
      description: "nav-cmd-previous",
      silent: true,
    });
    assert.ok(
      created.success,
      `takeSnapshot(nav-cmd-previous) failed: ${JSON.stringify(created)}`,
    );

    const list = snapshotIds();
    const newest = list.length - 1;
    const newestId = list[newest];
    const previousId = list[newest - 1];
    assert.ok(
      newest > 0,
      "precondition: command navigation needs at least two snapshots",
    );
    assert.equal(
      newestId,
      created.snapshot.id,
      "precondition: the snapshot just created should be the newest",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newestId,
      "precondition: takeSnapshot should have made the new snapshot active",
    );
    assert.notEqual(
      previousId,
      newestId,
      "precondition: the newest and the one before it must differ",
    );

    // No return value is asserted: the handler reports through notifications and
    // resolves to `undefined`, so the only thing that proves it navigated is the
    // manager state below.
    await vscode.commands.executeCommand("vscode-snapshots.previousSnapshot");

    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest - 1,
      "the command should move the active index back exactly one",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      previousId,
      "the command should make the snapshot before the newest the active one",
    );
    assert.equal(
      manager.isSnapshotActive(previousId),
      true,
      "the snapshot the command navigated to should be active",
    );
    assert.equal(
      manager.isSnapshotActive(newestId),
      false,
      "the snapshot the command navigated away from should no longer be active",
    );
  });

  test("nextSnapshot command moves the active snapshot forward exactly one", async () => {
    // The snapshot this test moves ONTO is one it creates, so a stale index
    // inherited from another suite cannot satisfy the assertion below.
    const created = await api.takeSnapshot({
      description: "nav-cmd-next",
      silent: true,
    });
    assert.ok(
      created.success,
      `takeSnapshot(nav-cmd-next) failed: ${JSON.stringify(created)}`,
    );

    const list = snapshotIds();
    const newest = list.length - 1;
    const targetId = list[newest];
    const fromId = list[newest - 1];
    assert.equal(
      targetId,
      created.snapshot.id,
      "precondition: the snapshot just created should be the newest",
    );
    assert.notEqual(
      fromId,
      targetId,
      "precondition: the newest and the one before it must differ",
    );

    // Start from a named position instead of whatever the test above left.
    await activateSnapshot(fromId);
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest - 1,
      "precondition: the command should start one before the newest snapshot",
    );

    await vscode.commands.executeCommand("vscode-snapshots.nextSnapshot");

    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest,
      "the command should move the active index forward exactly one",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      targetId,
      "the command should make the snapshot after the active one the active one",
    );
    assert.equal(
      manager.isSnapshotActive(targetId),
      true,
      "the snapshot the command navigated to should be active",
    );
    assert.equal(
      manager.isSnapshotActive(fromId),
      false,
      "the snapshot the command navigated away from should no longer be active",
    );
  });

  test("previousSnapshot command refuses at the oldest snapshot without moving", async () => {
    const oldestId = snapshotIds()[0];
    await activateSnapshot(oldestId);
    assert.equal(
      manager.getCurrentSnapshotIndex(),
      0,
      "precondition: the oldest snapshot should be active here",
    );

    await vscode.commands.executeCommand("vscode-snapshots.previousSnapshot");

    assert.equal(
      manager.getCurrentSnapshotIndex(),
      0,
      "the command must not move (or wrap) past the oldest snapshot",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      oldestId,
      "the command must not change the active snapshot at the oldest position",
    );
  });

  test("previousSnapshot command attaches to the newest snapshot when detached", async () => {
    await detach();
    const list = snapshotIds();
    const newest = list.length - 1;
    const newestId = list[newest];
    const secondNewestId = list[newest - 1];
    assert.ok(
      newest > 0,
      "precondition: the newest and second-newest snapshots must differ",
    );

    await vscode.commands.executeCommand("vscode-snapshots.previousSnapshot");

    assert.equal(
      manager.getCurrentSnapshotIndex(),
      newest,
      "detached, the command should attach to the newest snapshot rather than report failure",
    );
    assert.equal(
      manager.getActiveSnapshot()?.id,
      newestId,
      "detached, the command should make the newest snapshot active",
    );
    assert.notEqual(
      manager.getActiveSnapshot()?.id,
      secondNewestId,
      "detached, the command must not resolve 'previous' as 'index - 1'",
    );
  });
});
