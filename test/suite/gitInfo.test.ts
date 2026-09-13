import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Git metadata gating in a workspace that is NOT a git repository.
 *
 * Contracts verified in source before asserting them:
 *
 *  - `src/snapshotManager.ts:322-353` -- `gitBranch` / `gitCommitHash` start as
 *    `undefined` and are assigned only when the Git API resolves a repository
 *    whose `state.HEAD` exists. `vscode-snapshots.git.addCommitInfo` (default
 *    true, scope `resource`) is read at snapshot time, so flipping it needs no
 *    reload. Errors from the Git API are logged and the snapshot is taken
 *    without git info.
 *  - `src/snapshotManager.ts:29-32` -- the fields are optional
 *    (`gitBranch?: string`, `gitCommitHash?: string`), and
 *    `src/validation/snapshotValidation.ts:59-66` only validates them when they
 *    are present, so "absent" is the documented shape.
 *  - The fixture (`test/runTest.ts`) creates the workspace under `%TEMP%` and
 *    sets `git.addCommitInfo: false`; nothing there is inside a repository.
 *
 * The failure this guards against is a snapshot that carries a FABRICATED git
 * value -- `NaN`, an empty string, `"undefined"` -- or that fails outright when
 * the Git API cannot resolve a repository. Absence is asserted exactly
 * (`undefined` in memory, key absent from the persisted payload), not with a
 * regex over `JSON.stringify`, which passes for a value of `null` or `""` and
 * would also pass if the fields were simply misnamed.
 */
const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const GIT_SECTION = "vscode-snapshots.git";
/** `vscode-snapshots.snapshotLocation` from test/runTest.ts's fixture settings. */
const STORE_DIR = path.join(FIXTURE_ROOT ?? "", ".snapshots-test");
/** `vscode-snapshots.git.addCommitInfo` from test/runTest.ts's fixture settings. */
const FIXTURE_ADD_COMMIT_INFO = false;

const gitConfig = () => vscode.workspace.getConfiguration(GIT_SECTION);

/** The nearest `.git` entry at or above `start`, or undefined for none. */
function gitDirAtOrAbove(start: string): string | undefined {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, ".git");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

function payloadPath(snapshotId: string): string {
  return path.join(STORE_DIR, snapshotId, "snapshot.json");
}

suite("git metadata", function () {
  this.timeout(60000);

  let api: any;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    assert.ok(api, "vscode-snapshots.getApi returned nothing");
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
  });

  // The setting is global to the host and the fixture ships it as `false`;
  // restore it after every test, including one that failed halfway.
  teardown(async () => {
    await gitConfig().update(
      "addCommitInfo",
      FIXTURE_ADD_COMMIT_INFO,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(
      gitConfig().get("addCommitInfo"),
      FIXTURE_ADD_COMMIT_INFO,
      "teardown: git.addCommitInfo must be left at the fixture's value",
    );
  });

  test("the fixture workspace is not inside a git repository", async () => {
    assert.strictEqual(
      gitDirAtOrAbove(FIXTURE_ROOT),
      undefined,
      `the fixture workspace has a git directory at or above it, so the absence assertions below would be vacuous`,
    );

    // Where the built-in Git extension is available, prove that the absence is
    // "no repository for this workspace" rather than "no Git API at all".
    // `getAPI` throws when git is disabled in the host, so the probe is
    // conditional; the filesystem walk above already proves the workspace is
    // not inside a repository either way.
    const gitExtension = vscode.extensions.getExtension<any>("vscode.git");
    let gitApi: any;
    if (gitExtension) {
      try {
        gitApi = (await gitExtension.activate()).getAPI(1);
      } catch {
        gitApi = undefined;
      }
    }
    if (gitApi) {
      // The declared return is `Repository | null`, so normalise before the
      // exact comparison.
      const repository = gitApi.getRepository(vscode.Uri.file(FIXTURE_ROOT));
      assert.strictEqual(
        repository ?? undefined,
        undefined,
        `the Git extension reports a repository for the fixture workspace: ${JSON.stringify(
          repository?.rootUri?.fsPath,
        )}`,
      );
    }
  });

  test("with addCommitInfo=true a non-git workspace yields no git fields and a healthy snapshot", async () => {
    await gitConfig().update(
      "addCommitInfo",
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(
      gitConfig().get("addCommitInfo"),
      true,
      "the workspace override of git.addCommitInfo did not round-trip",
    );

    const outcome = await api.takeSnapshot({
      description: "git-info-enabled",
      silent: true,
    });
    assert.strictEqual(
      outcome.success,
      true,
      `snapshot with git metadata enabled: ${JSON.stringify(outcome)}`,
    );
    const id: string = outcome.snapshot.id;

    const snap = (await api.getSnapshots()).find((s: any) => s.id === id);
    assert.ok(snap, `snapshot ${id} created by this test is missing from the store`);
    assert.strictEqual(
      snap.gitBranch,
      undefined,
      `gitBranch must be absent without a repository, saw ${JSON.stringify(
        snap.gitBranch,
      )}`,
    );
    assert.strictEqual(
      snap.gitCommitHash,
      undefined,
      `gitCommitHash must be absent without a repository, saw ${JSON.stringify(
        snap.gitCommitHash,
      )}`,
    );
    // The snapshot itself is otherwise intact: the absence above is not the
    // side effect of a snapshot that never recorded anything. Keys are recorded
    // with the platform separator, so compare in POSIX form.
    assert.strictEqual(snap.description, "git-info-enabled");
    const recordedKeys = Object.keys(snap.files).map((key) =>
      key.replace(/\\/g, "/"),
    );
    for (const expectedKey of ["src/app.ts", ".vscode/settings.json"]) {
      assert.ok(
        recordedKeys.includes(expectedKey),
        `${expectedKey} is missing from the snapshotted files: ${JSON.stringify(
          recordedKeys,
        )}`,
      );
    }

    // What the next session loads: the payload on disk. `JSON.stringify` drops
    // `undefined`, so an absent field is an absent key -- not `null`, not the
    // string "undefined", not NaN.
    assert.ok(
      fs.existsSync(payloadPath(id)),
      `no persisted payload for ${id}; expected ${payloadPath(id)}`,
    );
    const payload = JSON.parse(fs.readFileSync(payloadPath(id), "utf8"));
    assert.strictEqual(payload.id, id);
    for (const field of ["gitBranch", "gitCommitHash"]) {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(payload, field),
        false,
        `the persisted payload carries ${field}=${JSON.stringify(
          payload[field],
        )} in a non-git workspace`,
      );
    }
  });

  test("with addCommitInfo=false the same workspace is also free of git fields", async () => {
    assert.strictEqual(
      gitConfig().get("addCommitInfo"),
      FIXTURE_ADD_COMMIT_INFO,
      "precondition: the fixture disables git metadata",
    );

    const outcome = await api.takeSnapshot({
      description: "git-info-disabled",
      silent: true,
    });
    assert.strictEqual(
      outcome.success,
      true,
      `snapshot with git metadata disabled: ${JSON.stringify(outcome)}`,
    );
    const id: string = outcome.snapshot.id;
    assert.strictEqual(
      typeof id,
      "string",
      `takeSnapshot returned no usable snapshot id: ${JSON.stringify(
        outcome.snapshot,
      )}`,
    );

    const snap = (await api.getSnapshots()).find((s: any) => s.id === id);
    assert.ok(snap, `snapshot ${id} created by this test is missing from the store`);
    assert.strictEqual(snap.gitBranch, undefined);
    assert.strictEqual(snap.gitCommitHash, undefined);

    const payload = JSON.parse(fs.readFileSync(payloadPath(id), "utf8"));
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(payload, "gitBranch"),
      false,
    );
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(payload, "gitCommitHash"),
      false,
    );
  });
});
