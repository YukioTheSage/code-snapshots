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
});
