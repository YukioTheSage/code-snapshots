import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const APP_REL = "src/app.ts";
const APP_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");
/** A second tracked file, used to prove a per-file restore stays per-file. */
const OTHER_REL = ".vscode/settings.json";
const OTHER_FILE = path.join(FIXTURE_ROOT ?? "", ".vscode", "settings.json");
/** The change this suite makes after the snapshot and expects back out. */
const NOISE = "// per-file noise";
/**
 * A file this suite owns: created inside one test and deleted inside it, so the
 * fixture is left as it was found.
 */
const DELETION_PROBE_REL = "per-file-deletion-probe.txt";
const DELETION_PROBE_FILE = path.join(FIXTURE_ROOT ?? "", DELETION_PROBE_REL);
/**
 * Two more files this suite owns, both created and deleted inside the one test
 * that uses them. `DELETED` is gone before the empty-selection snapshot is
 * taken, so that snapshot records its deletion; `KEPT` is captured by it and
 * removed afterwards, so a restore has to put it back.
 */
const EMPTY_SELECTION_DELETED_REL = "empty-selection-deleted-probe.txt";
const EMPTY_SELECTION_DELETED_FILE = path.join(
  FIXTURE_ROOT ?? "",
  EMPTY_SELECTION_DELETED_REL,
);
const EMPTY_SELECTION_KEPT_REL = "empty-selection-kept-probe.txt";
const EMPTY_SELECTION_KEPT_FILE = path.join(
  FIXTURE_ROOT ?? "",
  EMPTY_SELECTION_KEPT_REL,
);
/**
 * A file the restore-preview test owns: created after the whole-tree capture it
 * is absent from, and deleted inside that test, so the fixture is left as it was
 * found.
 */
const PREVIEW_PROBE_REL = "preview-scope-probe.txt";
const PREVIEW_PROBE_FILE = path.join(FIXTURE_ROOT ?? "", PREVIEW_PROBE_REL);

/**
 * The key a snapshot records `rel` under.
 *
 * Snapshots key their files by `path.relative(workspaceRoot, file.fsPath)`
 * (`takeSnapshotInternal`), so the separator is the platform's own: `src\app.ts`
 * on Windows. Looking an entry up by its forward-slash spelling would find
 * nothing on Windows and make the selective-capture assertion below pass no
 * matter what was recorded -- the lookup is therefore built the same way the
 * extension builds the key, and every use is preceded by a precondition that
 * the key really resolves in a snapshot known to contain the file.
 */
function snapshotKey(rel: string): string {
  return path.relative(FIXTURE_ROOT, path.join(FIXTURE_ROOT, rel));
}

/**
 * Wait, with a bounded deadline, for the host to see a file this test created.
 *
 * `takeSnapshot` scans with `workspace.findFiles`, which does not necessarily
 * list a file the instant it is written; without this the capture below could
 * miss the probe file and the deletion assertion would prove nothing.
 */
async function waitFor<T>(
  what: string,
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 10000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * `SnapshotManager.restoreSingleFile(snapshotId, relativePath)` is the per-file
 * counterpart of a full restore: it must write the snapshot's copy of exactly
 * one file back into the workspace and leave everything else alone.
 *
 * Every assertion here compares FULL file contents. "the marker is gone" alone
 * would also pass if the restore truncated the file, wrote an empty file, or
 * removed the marker by rewriting something that merely resembles the snapshot.
 * The exact-content comparison is what binds the result to the snapshot.
 *
 * The suite is self-sufficient: it snapshots the state it finds, records that
 * state itself, and asserts the snapshot really captured it before testing the
 * restore path. Nothing here depends on snapshots other suites created -- the
 * `Tree views` suite drains the store, and the navigation suite restores files
 * as a side effect of moving between snapshots.
 */
suite("per-file snapshot operations", function () {
  this.timeout(60000);

  let api: any;
  let manager: any;
  let baseId: string;
  /** src/app.ts as it was when the snapshot was taken. */
  let appAtSnapshot: string;
  /** .vscode/settings.json as it was when the snapshot was taken. */
  let otherAtSnapshot: string;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
    assert.ok(fs.existsSync(APP_FILE), `fixture file missing: ${APP_FILE}`);
    assert.ok(fs.existsSync(OTHER_FILE), `fixture file missing: ${OTHER_FILE}`);

    appAtSnapshot = fs.readFileSync(APP_FILE, "utf8");
    otherAtSnapshot = fs.readFileSync(OTHER_FILE, "utf8");

    const outcome = await api.takeSnapshot({
      description: "per-file base",
      silent: true,
    });
    assert.ok(
      outcome.success,
      `takeSnapshot failed: ${JSON.stringify(outcome)}`,
    );
    baseId = outcome.snapshot.id;
    assert.ok(baseId, "takeSnapshot returned a snapshot without an id");

    // restoreSingleFile reads through exactly this call. Proving it here keeps
    // "the snapshot never captured the file" from being reported as "the
    // restore is broken" by every test below.
    const stored = await manager.getSnapshotFileContentPublic(baseId, APP_REL);
    assert.equal(
      stored,
      appAtSnapshot,
      "the 'per-file base' snapshot does not hold src/app.ts verbatim",
    );
  });

  /**
   * Append the noise marker to src/app.ts and prove the write landed.
   *
   * The restore assertions below are only meaningful if the file really changed
   * first: without this, `restored === appAtSnapshot` would hold even if
   * restoreSingleFile did nothing at all.
   */
  function dirtyAppFile(): void {
    fs.appendFileSync(APP_FILE, `\n${NOISE}\n`);
    const dirtied = fs.readFileSync(APP_FILE, "utf8");
    assert.ok(
      dirtied.includes(NOISE),
      `the fixture edit did not land: ${NOISE} missing from ${APP_FILE}`,
    );
    assert.notStrictEqual(
      dirtied,
      appAtSnapshot,
      "src/app.ts is unchanged, so the restore below could not be detected",
    );
  }

  /** Precondition shared by the restore tests: the file matches the snapshot. */
  function assertAppMatchesSnapshot(prefix: string): void {
    assert.equal(
      fs.readFileSync(APP_FILE, "utf8"),
      appAtSnapshot,
      `${prefix}: src/app.ts does not match the snapshot this suite recorded`,
    );
  }

  test("restoreSingleFile writes the snapshot's content back and touches nothing else", async () => {
    assertAppMatchesSnapshot("precondition");
    dirtyAppFile();

    await manager.restoreSingleFile(baseId, APP_REL);

    const restored = fs.readFileSync(APP_FILE, "utf8");
    assert.equal(
      restored,
      appAtSnapshot,
      "restoreSingleFile did not reproduce the snapshot's content byte for byte",
    );
    assert.ok(
      !restored.includes(NOISE),
      "the change made after the snapshot survived the restore",
    );
    assert.equal(
      fs.readFileSync(OTHER_FILE, "utf8"),
      otherAtSnapshot,
      `restoreSingleFile modified ${OTHER_REL}, which is not the path it was given`,
    );
  });

  test("restoreSingleFile rejects a path the snapshot does not contain, with the documented message", async () => {
    const missingRel = "no/such/file.ts";
    const expected = `Cannot restore file '${missingRel}' as it might have been deleted or content is unavailable in the snapshot.`;

    await assert.rejects(
      () => manager.restoreSingleFile(baseId, missingRel),
      (error: Error) => error instanceof Error && error.message === expected,
      `expected the manager's exact error message: ${expected}`,
    );
  });

  test("restoreSingleFile accepts the backslash-separated key the snapshot recorded", async () => {
    // Snapshots record Windows keys as `src\app.ts`; callers normally pass the
    // forward-slash form. Both must resolve to the one stored entry.
    assertAppMatchesSnapshot("precondition");
    dirtyAppFile();

    await manager.restoreSingleFile(baseId, "src\\app.ts");

    assert.equal(
      fs.readFileSync(APP_FILE, "utf8"),
      appAtSnapshot,
      "a backslash-separated path did not resolve to the snapshot entry for src/app.ts",
    );
  });

  test("restoreSingleFile recreates a file that is missing from the workspace", async () => {
    assertAppMatchesSnapshot("precondition");
    fs.rmSync(APP_FILE);
    assert.equal(
      fs.existsSync(APP_FILE),
      false,
      "precondition: the target file must be gone before the restore",
    );

    await manager.restoreSingleFile(baseId, APP_REL);

    assert.ok(
      fs.existsSync(APP_FILE),
      "restoreSingleFile did not recreate the deleted file",
    );
    assert.equal(
      fs.readFileSync(APP_FILE, "utf8"),
      appAtSnapshot,
      "the recreated file does not hold the snapshot's content",
    );
  });

  test("selective capture does not mark unselected files as deleted", async () => {
    const appKey = snapshotKey(APP_REL);
    const otherKey = snapshotKey(OTHER_REL);

    // Precondition: the suite's full snapshot is the diff base for the
    // selective capture below, and it really holds both files. Without this the
    // deletion pass would have nothing to mark wrongly, and the assertion at
    // the end would pass for a reason that is not selective capture. It also
    // proves the keys above resolve the way the extension writes them.
    const base = (await api.getSnapshots()).find((s: any) => s.id === baseId);
    assert.ok(base, `the suite's base snapshot ${baseId} is gone`);
    assert.ok(
      base.files[appKey],
      `the base snapshot does not hold ${APP_REL} under '${appKey}': ${JSON.stringify(
        Object.keys(base.files),
      )}`,
    );
    assert.ok(
      base.files[otherKey],
      `the base snapshot does not hold ${OTHER_REL} under '${otherKey}': ${JSON.stringify(
        Object.keys(base.files),
      )}`,
    );

    // Capture a selective snapshot of ONE file. `isSelective` is not derived
    // from `selectedFiles`: the snapshot is built as
    // `isSelective: contextOptions.isSelective || false`, so both must be given.
    const outcome = await api.takeSnapshot({
      description: "selective capture",
      isSelective: true,
      selectedFiles: [appKey],
      silent: true,
    });
    assert.strictEqual(
      outcome.success,
      true,
      `the selective snapshot failed: ${JSON.stringify(outcome)}`,
    );

    const snap = outcome.snapshot;
    assert.strictEqual(
      snap.isSelective,
      true,
      "precondition: the snapshot is not selective, so it was a full capture",
    );
    assert.deepStrictEqual(
      snap.selectedFiles,
      [appKey],
      "precondition: the snapshot did not record the file this test selected",
    );

    // Captured file is present...
    const captured = snap.files[appKey];
    assert.ok(
      captured,
      `the selected file is missing from the snapshot; recorded keys: ${JSON.stringify(
        Object.keys(snap.files),
      )}`,
    );
    assert.ok(
      !captured.deleted,
      `the selected file was recorded as deleted: ${JSON.stringify(captured)}`,
    );

    // ...and the other tracked file is NOT recorded as deleted -- it is simply
    // not tracked by this snapshot. The capture never looked at it, so it
    // cannot report it gone; a `{deleted:true}` marker here is what made restore
    // delete files the user never selected.
    assert.strictEqual(
      snap.files[otherKey],
      undefined,
      `${OTHER_REL} was recorded as ${JSON.stringify(
        snap.files[otherKey],
      )} by a snapshot that never captured it; recorded keys: ${JSON.stringify(
        Object.keys(snap.files),
      )}`,
    );
  });

  test("a full snapshot still records a file that really was deleted", async () => {
    const probeKey = snapshotKey(DELETION_PROBE_REL);
    const marker = `deletion probe ${Date.now()}`;
    fs.writeFileSync(DELETION_PROBE_FILE, `${marker}\n`, "utf8");
    assert.strictEqual(
      fs.readFileSync(DELETION_PROBE_FILE, "utf8"),
      `${marker}\n`,
      "precondition: the probe file was not written",
    );
    await waitFor(
      `${DELETION_PROBE_REL} to become visible to workspace.findFiles`,
      async () =>
        (await vscode.workspace.findFiles(`**/${DELETION_PROBE_REL}`)).length ===
        1
          ? true
          : undefined,
    );

    const before = await api.takeSnapshot({
      description: "deletion probe base",
      silent: true,
    });
    assert.strictEqual(
      before.success,
      true,
      `the full snapshot failed: ${JSON.stringify(before)}`,
    );
    // Precondition: the probe file really is in the base. The deletion pass has
    // nothing to report otherwise, and the assertion below would be vacuous.
    assert.ok(
      before.snapshot.files[probeKey],
      `the full snapshot did not capture ${DELETION_PROBE_REL}; recorded keys: ${JSON.stringify(
        Object.keys(before.snapshot.files),
      )}`,
    );

    fs.rmSync(DELETION_PROBE_FILE);
    assert.strictEqual(
      fs.existsSync(DELETION_PROBE_FILE),
      false,
      "precondition: the probe file must be gone before the second capture",
    );

    const after = await api.takeSnapshot({
      description: "deletion probe gone",
      silent: true,
    });
    assert.strictEqual(
      after.success,
      true,
      `the second full snapshot failed: ${JSON.stringify(after)}`,
    );
    // A whole-tree capture is the one that may report deletions; this is the
    // behaviour the selective guard above must not switch off.
    assert.deepStrictEqual(
      after.snapshot.files[probeKey],
      { deleted: true },
      `a full snapshot no longer records the deletion of ${DELETION_PROBE_REL}: ${JSON.stringify(
        after.snapshot.files[probeKey],
      )}`,
    );
  });

  /**
   * A selective snapshot is an explicit claim about SOME files and never a
   * statement about the rest of the workspace, so restoring it must write back
   * the files it captured and touch nothing else.
   *
   * Its capture has no entry at all -- not even a `{deleted:true}` marker -- for
   * the files it never looked at, and that absence is what the restore's
   * deletion phase used to read as "extraneous": it deleted every workspace file
   * the snapshot did not mention.
   */
  test("restoring a selective snapshot leaves files it never captured untouched", async () => {
    const appKey = snapshotKey(APP_REL);
    const otherKey = snapshotKey(OTHER_REL);
    const drift = `${otherAtSnapshot}\n// drifted after the selective capture\n`;

    // Preconditions: the fixture is exactly what this suite recorded, so the
    // assertions below can only be satisfied by the snapshot and by leaving the
    // fixture alone.
    assertAppMatchesSnapshot("precondition");
    assert.strictEqual(
      fs.readFileSync(OTHER_FILE, "utf8"),
      otherAtSnapshot,
      `precondition: ${OTHER_REL} is not in the state this suite recorded`,
    );

    // A full snapshot first: the selective capture below needs a base that
    // really holds both files, and the restore of a diff-only entry resolves
    // through that chain.
    const full = await api.takeSnapshot({
      description: "restore scope base",
      silent: true,
    });
    assert.strictEqual(
      full.success,
      true,
      `the full snapshot failed: ${JSON.stringify(full)}`,
    );
    assert.ok(
      full.snapshot.files[otherKey],
      `precondition: the full snapshot does not hold ${OTHER_REL} under '${otherKey}': ${JSON.stringify(
        Object.keys(full.snapshot.files),
      )}`,
    );

    // Capture a selective snapshot of ONE file. `isSelective` is not derived
    // from `selectedFiles`: the snapshot is built as
    // `isSelective: contextOptions.isSelective || false`, so both must be given.
    const scope = await api.takeSnapshot({
      description: "selective restore scope",
      isSelective: true,
      selectedFiles: [appKey],
      silent: true,
    });
    assert.strictEqual(
      scope.success,
      true,
      `the selective snapshot failed: ${JSON.stringify(scope)}`,
    );
    const selectiveId = scope.snapshot.id;

    // Preconditions: this really is the selective capture the test is about, it
    // holds the selected file, and the file it never looked at has no entry at
    // all in it. Without the last one the deletion phase would have a marker to
    // act on and the restore below would be testing something else.
    assert.strictEqual(
      scope.snapshot.isSelective,
      true,
      "precondition: the snapshot is not selective, so it was a full capture",
    );
    assert.deepStrictEqual(
      scope.snapshot.selectedFiles,
      [appKey],
      "precondition: the snapshot did not record the file this test selected",
    );
    assert.ok(
      scope.snapshot.files[appKey],
      `precondition: the selected file is missing from the snapshot; recorded keys: ${JSON.stringify(
        Object.keys(scope.snapshot.files),
      )}`,
    );
    assert.strictEqual(
      scope.snapshot.files[otherKey],
      undefined,
      `precondition: the selective snapshot has an entry for ${OTHER_REL} (${JSON.stringify(
        scope.snapshot.files[otherKey],
      )}); recorded keys: ${JSON.stringify(Object.keys(scope.snapshot.files))}`,
    );

    // Change both files after the capture: the captured one has to come back,
    // the uncaptured one has to stay as it is.
    fs.appendFileSync(APP_FILE, `\n${NOISE}\n`);
    fs.writeFileSync(OTHER_FILE, drift, "utf8");
    assert.ok(
      fs.readFileSync(APP_FILE, "utf8").includes(NOISE),
      "precondition: the edit to src/app.ts did not land",
    );
    assert.strictEqual(
      fs.readFileSync(OTHER_FILE, "utf8"),
      drift,
      `precondition: the edit to ${OTHER_REL} did not land`,
    );

    const result = await manager.applySnapshotRestore(selectiveId);

    assert.strictEqual(
      result.success,
      true,
      `the restore reported failure: ${JSON.stringify(result)}`,
    );
    // The bug: "absent from the snapshot" was read as "extraneous", so this
    // restore deleted every workspace file the selective capture never looked
    // at -- the whole workspace minus the one file it captured.
    assert.deepStrictEqual(
      result.deleted,
      [],
      `restoring a snapshot whose entire scope was ${JSON.stringify(
        scope.snapshot.selectedFiles,
      )} deleted ${JSON.stringify(result.deleted)}`,
    );
    assert.equal(
      fs.readFileSync(APP_FILE, "utf8"),
      appAtSnapshot,
      "the captured file was not restored to the snapshot's content",
    );
    assert.ok(
      fs.existsSync(OTHER_FILE),
      `restoring the selective snapshot deleted ${OTHER_REL}, which it never captured`,
    );
    assert.equal(
      fs.readFileSync(OTHER_FILE, "utf8"),
      drift,
      `${OTHER_REL} was modified by a restore of a snapshot that never captured it`,
    );
  });

  /**
   * The restore predicate is load-bearing, so pin the case it exists for.
   *
   * `isSelective: true` with an EMPTY `selectedFiles` is what the rule-based
   * producers emit when a rule matches nothing (`src/changeNotifier.ts`), and
   * the capture side treats it as a whole-tree capture -- the else branch runs,
   * so its `{deleted:true}` markers are real. A restore that keyed its skip on
   * `isSelective` alone would leave files the user really deleted sitting in the
   * workspace, which is why the test below asserts the deletion, not just the
   * restoration.
   */
  test("an empty-selection rule snapshot behaves as a whole-tree capture on restore", async () => {
    const deletedKey = snapshotKey(EMPTY_SELECTION_DELETED_REL);
    const keptKey = snapshotKey(EMPTY_SELECTION_KEPT_REL);
    const deletedContent = "// captured, then deleted before the rule snapshot\n";
    const keptContent = "// captured by the rule snapshot\n";
    const recreatedContent = "// recreated after the rule snapshot\n";

    try {
      fs.writeFileSync(EMPTY_SELECTION_DELETED_FILE, deletedContent, "utf8");
      fs.writeFileSync(EMPTY_SELECTION_KEPT_FILE, keptContent, "utf8");
      await waitFor(
        `${EMPTY_SELECTION_DELETED_REL} and ${EMPTY_SELECTION_KEPT_REL} to become visible to workspace.findFiles`,
        async () =>
          (
            await vscode.workspace.findFiles("**/empty-selection-*-probe.txt")
          ).length === 2
            ? true
            : undefined,
      );

      const base = await api.takeSnapshot({
        description: "empty selection base",
        silent: true,
      });
      assert.strictEqual(
        base.success,
        true,
        `the base snapshot failed: ${JSON.stringify(base)}`,
      );
      // Precondition: both probes are captured under the keys this test looks
      // them up by, so the deletion marker and the restore below are about the
      // files this test created.
      for (const [rel, key] of [
        [EMPTY_SELECTION_DELETED_REL, deletedKey],
        [EMPTY_SELECTION_KEPT_REL, keptKey],
      ]) {
        assert.ok(
          base.snapshot.files[key],
          `precondition: the base snapshot does not hold ${rel} under '${key}'; recorded keys: ${JSON.stringify(
            Object.keys(base.snapshot.files),
          )}`,
        );
      }

      // Gone before the rule-based capture, so that capture can record it.
      fs.rmSync(EMPTY_SELECTION_DELETED_FILE);

      const rule = await api.takeSnapshot({
        description: "rule with no matches",
        isSelective: true,
        selectedFiles: [],
        silent: true,
      });
      assert.strictEqual(
        rule.success,
        true,
        `the empty-selection snapshot failed: ${JSON.stringify(rule)}`,
      );
      const ruleId = rule.snapshot.id;

      assert.strictEqual(
        rule.snapshot.isSelective,
        true,
        "precondition: the snapshot does not carry isSelective: true",
      );
      assert.deepStrictEqual(
        rule.snapshot.selectedFiles,
        [],
        "precondition: the selection is not empty, so this is not the case the restore predicate must let through",
      );
      // The deletion marker is the whole point: an empty selection is a
      // whole-tree capture, so it really reports the probe gone.
      assert.deepStrictEqual(
        rule.snapshot.files[deletedKey],
        { deleted: true },
        `precondition: the empty-selection snapshot did not record ${EMPTY_SELECTION_DELETED_REL} as deleted: ${JSON.stringify(
          rule.snapshot.files[deletedKey],
        )}`,
      );
      assert.ok(
        rule.snapshot.files[keptKey] && !rule.snapshot.files[keptKey].deleted,
        `precondition: the empty-selection snapshot did not capture ${EMPTY_SELECTION_KEPT_REL}: ${JSON.stringify(
          rule.snapshot.files[keptKey],
        )}`,
      );

      // The workspace moves on: the deleted file is back, the captured one is
      // gone.
      fs.writeFileSync(EMPTY_SELECTION_DELETED_FILE, recreatedContent, "utf8");
      fs.rmSync(EMPTY_SELECTION_KEPT_FILE);

      const result = await manager.applySnapshotRestore(ruleId);

      assert.strictEqual(
        result.success,
        true,
        `the restore reported failure: ${JSON.stringify(result)}`,
      );
      // The deletion phase must still run for this snapshot: it describes the
      // whole tree, and it says the probe is deleted.
      assert.ok(
        result.deleted.includes(deletedKey),
        `the restore skipped the deletion bookkeeping of a whole-tree capture: deleted ${JSON.stringify(
          result.deleted,
        )}, restored ${JSON.stringify(result.restored)}`,
      );
      assert.strictEqual(
        fs.existsSync(EMPTY_SELECTION_DELETED_FILE),
        false,
        `${EMPTY_SELECTION_DELETED_REL} is recorded as deleted in the snapshot but survived the restore`,
      );
      // And it restores what it captured rather than treating it as untracked.
      assert.ok(
        result.restored.includes(keptKey),
        `the restore did not restore ${EMPTY_SELECTION_KEPT_REL}: restored ${JSON.stringify(
          result.restored,
        )}, skipped ${JSON.stringify(result.skipped)}`,
      );
      assert.strictEqual(
        fs.readFileSync(EMPTY_SELECTION_KEPT_FILE, "utf8"),
        keptContent,
        "the restored file does not hold the snapshot's content",
      );
    } finally {
      // Both probes belong to this test: the fixture is left as it was found.
      fs.rmSync(EMPTY_SELECTION_DELETED_FILE, { force: true });
      fs.rmSync(EMPTY_SELECTION_KEPT_FILE, { force: true });
    }
  });

  /**
   * The preview the restore confirmation dialog renders is a promise about what
   * applying the restore will do, so it must not advertise deletions that apply
   * will not perform.
   *
   * `applySnapshotRestoreInternal` skips its deletion phase for a genuinely
   * selective snapshot: such a capture holds no entry at all for the files it
   * never looked at, so their absence is no evidence that they are extraneous.
   * `calculateRestoreChanges` still read that same absence as a deletion and
   * listed every uncaptured workspace file as `- file` / "Deleted", so the user
   * was told N files would go and then none did.
   */
  test("the restore preview does not promise deletions a selective restore will not perform", async () => {
    const appKey = snapshotKey(APP_REL);
    const otherKey = snapshotKey(OTHER_REL);

    assertAppMatchesSnapshot("precondition");
    assert.ok(
      fs.existsSync(OTHER_FILE),
      `precondition: ${OTHER_REL} is missing, so there is no uncaptured file for the preview to over-report`,
    );
    const workspaceRoot = manager.getWorkspaceRoot();
    assert.ok(
      workspaceRoot,
      "precondition: the manager reports no workspace root, so no preview can be calculated",
    );

    // A full snapshot first: the selective capture below needs a base that
    // really holds both files, and the preview resolves contents through it.
    const full = await api.takeSnapshot({
      description: "preview scope base",
      silent: true,
    });
    assert.strictEqual(
      full.success,
      true,
      `the full snapshot failed: ${JSON.stringify(full)}`,
    );

    // Capture a selective snapshot of ONE file. `isSelective` is not derived
    // from `selectedFiles`: the snapshot is built as
    // `isSelective: contextOptions.isSelective || false`, so both must be given.
    const scope = await api.takeSnapshot({
      description: "selective preview scope",
      isSelective: true,
      selectedFiles: [appKey],
      silent: true,
    });
    assert.strictEqual(
      scope.success,
      true,
      `the selective snapshot failed: ${JSON.stringify(scope)}`,
    );

    // Preconditions: this really is the selective capture the preview is about,
    // it holds the file it selected, and the file it never looked at has no
    // entry at all in it. That absence is what the preview must stop reading as
    // a deletion -- with a `{deleted:true}` marker present the preview would
    // have something real to report and the assertion below would be vacuous.
    assert.strictEqual(
      scope.snapshot.isSelective,
      true,
      "precondition: the snapshot is not selective, so it was a full capture",
    );
    assert.deepStrictEqual(
      scope.snapshot.selectedFiles,
      [appKey],
      "precondition: the snapshot did not record the file this test selected",
    );
    assert.ok(
      scope.snapshot.files[appKey],
      `precondition: the selected file is missing from the snapshot; recorded keys: ${JSON.stringify(
        Object.keys(scope.snapshot.files),
      )}`,
    );
    assert.strictEqual(
      scope.snapshot.files[otherKey],
      undefined,
      `precondition: the selective snapshot has an entry for ${OTHER_REL} (${JSON.stringify(
        scope.snapshot.files[otherKey],
      )}), so its absence is not what the preview below would be reporting`,
    );

    try {
      // Move the captured file away from the snapshot, so the preview has to
      // report something for it. Without this the preview is legitimately
      // empty once the deletions are gone, and "no deletions reported" would be
      // true for a reason that has nothing to do with the fix.
      fs.appendFileSync(APP_FILE, `\n${NOISE}\n`);
      assert.ok(
        fs.readFileSync(APP_FILE, "utf8").includes(NOISE),
        "precondition: the edit to src/app.ts did not land",
      );

      const changes = await manager.calculateRestoreChanges(
        scope.snapshot,
        workspaceRoot,
      );
      const deleted = changes.filter((c: any) => c.status === "D");

      // The bug: the preview listed every workspace file the selective capture
      // never looked at -- .vscode/settings.json among them -- as "Deleted",
      // and applying that same restore deletes none of them (Task 2).
      assert.strictEqual(
        deleted.length,
        0,
        `the preview promised deletions the selective restore will not perform: ${JSON.stringify(
          deleted,
        )}`,
      );
      // Non-vacuity: the preview did run and did compare the file the snapshot
      // captured against it (`~`, "Modified"), so the result above is not empty
      // for the wrong reason -- an implementation that returned no changes at
      // all would fail here rather than pass the assertion above.
      assert.ok(
        changes.some((c: any) => c.relativePath === appKey && c.status === "M"),
        `the preview did not report the captured file ${APP_REL} as modified, so the assertion above proves nothing: ${JSON.stringify(
          changes,
        )}`,
      );
    } finally {
      // The suite's other tests assert src/app.ts matches the snapshot.
      fs.writeFileSync(APP_FILE, appAtSnapshot, "utf8");
    }
  });

  /**
   * The other half of the preview predicate, and the reason it is not spelled
   * `isSelective` alone: a rule-based producer emits `isSelective: true` with an
   * EMPTY `selectedFiles` when a rule matches nothing, and the capture side
   * treats that as a whole-tree capture -- its restore really does delete files
   * it does not hold. A preview that skipped those would hide deletions the
   * restore performs, which is the same lie in the other direction.
   */
  test("the preview still reports deletions for a whole-tree capture with an empty selection", async () => {
    const probeKey = snapshotKey(PREVIEW_PROBE_REL);
    const probeContent = "// created after the whole-tree capture\n";

    assert.strictEqual(
      fs.existsSync(PREVIEW_PROBE_FILE),
      false,
      `precondition: ${PREVIEW_PROBE_REL} already exists, so this test cannot tell whether it was created after the capture`,
    );
    const workspaceRoot = manager.getWorkspaceRoot();
    assert.ok(
      workspaceRoot,
      "precondition: the manager reports no workspace root, so no preview can be calculated",
    );

    try {
      const rule = await api.takeSnapshot({
        description: "whole-tree preview base",
        isSelective: true,
        selectedFiles: [],
        silent: true,
      });
      assert.strictEqual(
        rule.success,
        true,
        `the empty-selection snapshot failed: ${JSON.stringify(rule)}`,
      );
      assert.strictEqual(
        rule.snapshot.isSelective,
        true,
        "precondition: the snapshot does not carry isSelective: true",
      );
      assert.deepStrictEqual(
        rule.snapshot.selectedFiles,
        [],
        "precondition: the selection is not empty, so the capture below is not the whole-tree case this test is about",
      );

      // Created only now: no capture above can hold it, so "absent from the
      // snapshot" is a deletion this whole-tree snapshot really performs.
      fs.writeFileSync(PREVIEW_PROBE_FILE, probeContent, "utf8");
      await waitFor(
        `${PREVIEW_PROBE_REL} to become visible to workspace.findFiles`,
        async () =>
          (await vscode.workspace.findFiles(`**/${PREVIEW_PROBE_REL}`)).length ===
          1
            ? true
            : undefined,
      );
      assert.strictEqual(
        rule.snapshot.files[probeKey],
        undefined,
        `precondition: the snapshot already holds ${PREVIEW_PROBE_REL}, so its absence is not what the preview reports`,
      );

      const changes = await manager.calculateRestoreChanges(
        rule.snapshot,
        workspaceRoot,
      );
      const deleted = changes.filter((c: any) => c.status === "D");

      assert.ok(
        deleted.some((c: any) => c.relativePath === probeKey),
        `the preview stopped reporting deletions for a whole-tree capture: ${PREVIEW_PROBE_REL} is absent from the snapshot and the restore will delete it, but the preview reported ${JSON.stringify(
          deleted,
        )}`,
      );
    } finally {
      // The probe belongs to this test: the fixture is left as it was found.
      fs.rmSync(PREVIEW_PROBE_FILE, { force: true });
    }
  });
});
