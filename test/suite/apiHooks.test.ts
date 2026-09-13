import * as assert from "assert";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;

suite("API test hooks", () => {
  let api: any;
  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
  });

  test("testHooks exposes internals needed by the integration suite", () => {
    assert.ok(api.testHooks, "api.testHooks missing");
    assert.ok(api.testHooks.manualTreeProvider, "manualTreeProvider missing");
    assert.ok(api.testHooks.autoTreeProvider, "autoTreeProvider missing");
    assert.ok(api.testHooks.snapshotManager, "snapshotManager missing");
    assert.ok(api.testHooks.editorDecorator, "editorDecorator missing");
    assert.ok(api.testHooks.statusBarController, "statusBarController missing");
  });

  test("deleteSnapshot honors skipConfirm", async () => {
    const outcome = await api.takeSnapshot({ description: "hook-snap", silent: true });
    assert.ok(outcome.success);
    const ok = await api.deleteSnapshot(outcome.snapshot.id, { skipConfirm: true });
    assert.equal(ok, true, "skipConfirm delete failed");
    const list = await api.getSnapshots();
    assert.ok(!list.find((s: any) => s.id === outcome.snapshot.id));
  });
});
