import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const APP_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");
/** Relative path of the file under test, spelled the way a URI spells it. */
const APP_REL = "src/app.ts";

/**
 * The `snapshot-diff` content provider (`src/snapshotContentProvider.ts`,
 * registered in `src/extension.ts`) is the only thing that can serve a
 * snapshot's copy of a file to a diff editor. Its URI contract is
 *
 *   snapshot-diff://<snapshotId>/<relativePath>?nonce=<n>
 *
 * where `uri.authority` is the snapshot id, the one leading `/` is stripped
 * from `uri.path`, and `nonce` exists purely so VS Code treats each open as
 * fresh content. `provideTextDocumentContent` never rejects: an unknown file,
 * an invalid URI and an internal error all resolve to `''`, so the diff editor
 * shows an empty side instead of a broken one.
 *
 * The snapshot is created from a change THIS suite makes and asserts. A marker
 * that was already on disk would let these assertions pass against a snapshot
 * that never captured the file at all -- the store's own `index.json` lives
 * inside the scanned tree, so its churn alone is enough to make a snapshot
 * "changed" even when nothing else moved.
 */
suite("snapshot-diff content provider", function () {
  this.timeout(60000);

  let api: any;
  let snapshotId: string;
  /** Content of src/app.ts at the moment the snapshot was taken. */
  let contentAtSnapshot: string;

  const SNAPSHOT_MARKER = "// diff-provider marker";
  /** Written to disk AFTER the snapshot: it must never appear in the document. */
  const LIVE_ONLY_MARKER = "// diff-provider live-only change";

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    assert.ok(
      api?.testHooks?.snapshotManager,
      "api.testHooks.snapshotManager missing (test hook)",
    );
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");

    fs.appendFileSync(APP_FILE, `\n${SNAPSHOT_MARKER}\n`);
    contentAtSnapshot = fs.readFileSync(APP_FILE, "utf8");
    assert.ok(
      contentAtSnapshot.includes(SNAPSHOT_MARKER),
      `the fixture edit did not land: ${SNAPSHOT_MARKER} missing from ${APP_FILE}`,
    );
    assert.ok(
      !contentAtSnapshot.includes(LIVE_ONLY_MARKER),
      "the live-only marker already exists before the snapshot; the test below could not fail",
    );

    const outcome = await api.takeSnapshot({
      description: "diff-prov",
      silent: true,
    });
    assert.ok(
      outcome.success,
      `takeSnapshot failed: ${JSON.stringify(outcome)}`,
    );
    snapshotId = outcome.snapshot.id;
    assert.ok(snapshotId, "takeSnapshot returned a snapshot without an id");

    // The provider resolves content through exactly this call, so prove the
    // snapshot really holds the file before asserting on what the provider
    // serves from it. Without this, a snapshot that captured nothing would look
    // like a content-provider failure further down.
    const stored =
      await api.testHooks.snapshotManager.getSnapshotFileContentPublic(
        snapshotId,
        APP_REL,
      );
    assert.equal(
      stored,
      contentAtSnapshot,
      "the snapshot did not capture src/app.ts verbatim",
    );
  });

  test("openTextDocument on a snapshot-diff URI serves the snapshot's copy of the file", async () => {
    const uri = vscode.Uri.parse(
      `snapshot-diff://${snapshotId}/${APP_REL}?nonce=1`,
    );
    // The two parts of the URI contract the provider depends on.
    assert.equal(uri.authority, snapshotId, "authority must carry the snapshot id");
    assert.equal(uri.path, `/${APP_REL}`, "path must carry the leading-slash relative path");

    const doc = await vscode.workspace.openTextDocument(uri);
    assert.equal(doc.uri.scheme, "snapshot-diff");
    assert.equal(
      doc.getText(),
      contentAtSnapshot,
      "the snapshot-diff document did not reproduce the snapshot's content verbatim",
    );
  });

  test("the document shows the snapshot, not the live file", async () => {
    // Change the file on disk after the snapshot. A provider that read the
    // workspace (or that resolved nothing and returned ''), would not match.
    fs.appendFileSync(APP_FILE, `\n${LIVE_ONLY_MARKER}\n`);
    const live = fs.readFileSync(APP_FILE, "utf8");
    assert.ok(
      live.includes(LIVE_ONLY_MARKER),
      "the live edit did not land, so this test could not detect a live read",
    );

    // A fresh nonce is what the diff command uses, and it is what forces VS Code
    // to ask the provider again instead of reusing the document above.
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(`snapshot-diff://${snapshotId}/${APP_REL}?nonce=2`),
    );
    assert.equal(
      doc.getText(),
      contentAtSnapshot,
      "the document did not match the snapshotted content",
    );
    assert.ok(
      !doc.getText().includes(LIVE_ONLY_MARKER),
      "the document leaked a change made after the snapshot was taken",
    );
    assert.ok(
      doc.getText().includes(SNAPSHOT_MARKER),
      "the document lost content that existed at snapshot time",
    );
  });

  test("a backslash-separated relative path resolves to the same snapshot file", async () => {
    // Snapshots record Windows keys as `src\app.ts` (path.relative on Windows)
    // while a URI spells the same file `src/app.ts`. Both must resolve to the
    // one stored entry -- that normalization is what makes the diff view work
    // at all on Windows.
    const uri = vscode.Uri.parse(
      `snapshot-diff://${snapshotId}/src\\app.ts?nonce=3`,
    );
    assert.equal(
      uri.path,
      "/src\\app.ts",
      "the URI no longer carries a backslash, so this test would prove nothing",
    );

    const doc = await vscode.workspace.openTextDocument(uri);
    assert.equal(
      doc.getText(),
      contentAtSnapshot,
      "a backslash-separated path did not resolve to the snapshot's copy",
    );
  });

  test("a path that is not in the snapshot renders as an empty document", async () => {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(
        `snapshot-diff://${snapshotId}/nonexistent/xyz.ts?nonce=4`,
      ),
    );
    assert.equal(
      doc.getText(),
      "",
      "an unknown path should render as empty content, not as an error",
    );
  });

  test("a URI without a snapshot id renders as an empty document", async () => {
    // `provideTextDocumentContent` rejects the empty authority explicitly
    // rather than resolving it as "some snapshot".
    const uri = vscode.Uri.parse("snapshot-diff:///src/app.ts?nonce=5");
    assert.equal(uri.authority, "", "the URI under test must have no authority");

    const doc = await vscode.workspace.openTextDocument(uri);
    assert.equal(
      doc.getText(),
      "",
      "a URI without a snapshot id should render as empty content",
    );
  });
});
