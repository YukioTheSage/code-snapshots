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
});
