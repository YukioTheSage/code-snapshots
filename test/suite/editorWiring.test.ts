import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
/** The file the fixture workspace is created with (test/runTest.ts:13-18). */
const APP_REL = "src/app.ts";
const APP_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");

/**
 * One line, inserted at the top of the fixture file to force a real edit, then
 * deleted again. The edit is what exercises the decorator's debounced
 * document-change path (src/editorDecorator.ts:59-72 + :96).
 */
const EDIT_MARKER = "// editor-wiring probe\n";

/**
 * The exact status-bar strings, read out of `src/statusBarController.ts:64-99`:
 *
 *   0 snapshots                    -> '$(history) No Snapshots'
 *   snapshots, workspace detached  -> '$(history) <timeAgo> | <N> snapshots'
 *   workspace at snapshot i of N   -> '$(history) <timeAgo> | snapshot <i>/<N>'
 *
 * `<timeAgo>` is `formatTimeAgo` (`src/statusBarController.ts:5-21`), which
 * answers 'now' for anything less than a minute old. Every snapshot asserted on
 * below is created inside the test that asserts on it, and `assertFreshNewest`
 * proves the age is inside that window first, so 'now' is the exact expected
 * text rather than a wildcard.
 */
const EMPTY_STORE_TEXT = "$(history) No Snapshots";
const FRESH_TIME_AGO = "now";

/**
 * BUG (observed while writing this suite; NOT fixed here -- this task is
 * test-only and `src/` is out of scope):
 *
 * `<timeAgo>` is computed from `Date.now()` at the moment the item's text is
 * written (src/statusBarController.ts:74-75), and that text is written from
 * exactly two places: the constructor (`:51`) and the `onDidChangeSnapshots`
 * subscription (`:47`). There is no timer anywhere in the class, so once the
 * store stops changing the relative age in the status bar is frozen -- an item
 * reading "5m ago" still reads "5m ago" an hour later, which is a claim about
 * the clock that has become false. The comment at `:39-48` records that the
 * previous 5-second poll was removed because it left the text "up to 5 seconds
 * stale"; the replacement has *unbounded* staleness instead. The assertions
 * below pin the exact strings (including the frozen 'now'); they cannot observe
 * the drift itself without waiting out the 60-second window, which this suite
 * deliberately does not do. Reported as finding F5 in task-12-report.md.
 */
const detachedText = (total: number): string =>
  `$(history) ${FRESH_TIME_AGO} | ${total} snapshots`;
const atSnapshotText = (index: number, total: number): string =>
  `$(history) ${FRESH_TIME_AGO} | snapshot ${index}/${total}`;

/** `formatTimeAgo` only answers 'now' below this age (src/statusBarController.ts:7-13). */
const FRESH_WINDOW_MS = 60000;
/** `triggerUpdateDecorations(true)` delays by this much (src/editorDecorator.ts:96). */
const DECORATION_DEBOUNCE_MS = 500;
/** The command StatusBarController points its item at (src/statusBarController.ts:36-37). */
const STATUS_BAR_COMMAND = "vscode-snapshots.viewSnapshots";

/** How one invocation of the decorator's private update path is observed. */
type DecoratorProbe = {
  updateCalls: number;
  inFlight: Promise<void>[];
  restore(): void;
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `check` until it holds; the final evaluation is the failure.
 *
 * `describe` is a thunk so the failure message is built at failure time, with
 * the values the host actually produced, rather than when the wait started.
 */
async function waitFor(
  check: () => boolean,
  timeoutMs: number,
  describe: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await delay(50);
  }
  assert.ok(check(), describe());
}

/** Await a promise the host produced, so a hang is reported as a failure. */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** A human-readable name for whatever editor the decorator is tracking. */
function describeEditor(editor: vscode.TextEditor | undefined): string {
  if (!editor) {
    return "no editor";
  }
  return `${editor.document.uri.toString()} (${editor.document.uri.scheme})`;
}

/**
 * The status bar text the extension currently shows.
 *
 * `StatusBarController.statusBarItem` is a private field
 * (`src/statusBarController.ts:24`) and VS Code offers no API to read a status
 * bar item an extension created -- `createStatusBarItem` hands the item to the
 * extension and nothing else can see it. The item's `text` is nevertheless the
 * user-visible contract of this class (`:64-99`), so the field is reached
 * deliberately, through the same Task-1 `testHooks` object that
 * `pruneAndRecovery.test.ts` already uses to reach `loadSnapshots`. The two
 * extra assertions prove this is the real CodeLapse item -- the field name
 * still exists and the item is wired to the documented command -- rather than
 * an unrelated object whose `text` happens to be compared.
 */
function statusBarText(statusBar: any): string {
  const item = statusBar?.statusBarItem;
  assert.ok(
    item && typeof item === "object",
    "StatusBarController has no private `statusBarItem` (src/statusBarController.ts:24); the field this test reads was renamed",
  );
  assert.strictEqual(
    item.command,
    STATUS_BAR_COMMAND,
    "the status bar item read here is not the one StatusBarController wires up (src/statusBarController.ts:36-37)",
  );
  assert.strictEqual(
    typeof item.text,
    "string",
    `the status bar text is not a string: ${JSON.stringify(item.text)}`,
  );
  return item.text;
}

function assertStatusText(
  statusBar: any,
  expected: string,
  context: string,
): void {
  const actual = statusBarText(statusBar);
  assert.strictEqual(
    actual,
    expected,
    `${context}: the status bar reads ${JSON.stringify(
      actual,
    )}, expected ${JSON.stringify(expected)}`,
  );
}

/**
 * `editorWiring` runs last: `Tree views`, `pruning and recovery` and the
 * store-exclusion suite drain, prune and delete snapshots, and the `extension`
 * suite removes the store directory from disk in its teardown. Nothing here may
 * assume an inherited snapshot still exists, so every test below drains or
 * creates exactly the state it asserts on.
 *
 * What this suite can and cannot prove:
 *
 *   - The status bar item's `text` is an observable contract with three exact
 *     states, asserted below against ids this suite created.
 *   - `EditorDecorator.updateDecorations` (`src/editorDecorator.ts:102`) is
 *     private and driven by event subscriptions plus a 500 ms debounce
 *     (`:89-100`). VS Code has no getter for the decorations an editor carries:
 *     `setDecorations` writes ranges into the renderer and nothing reads them
 *     back, and the decorator's own `decorationTypes` are write-only handles.
 *     The *visual* result (gutter icons on changed lines) is therefore NOT
 *     observable from a test and remains a manual F5 item -- no assertion here
 *     pretends otherwise. What IS observable, and asserted here, is the wiring:
 *     that a snapshot change and a document edit both reach the decorator's
 *     update path, that they reach it with the exact snapshot id and relative
 *     path this suite owns, that the update completes without rejecting, and
 *     that with no editor open the same update runs yet reads nothing.
 */
suite("editor wiring", function () {
  this.timeout(60000);

  let api: any;
  let manager: any;
  let decorator: any;
  let statusBar: any;
  let probe: DecoratorProbe;

  /** Ids of every snapshot, oldest first. */
  function snapshotIds(): string[] {
    return manager.getSnapshots().map((s: any) => s.id);
  }

  suiteSetup(async () => {
    assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    decorator = api?.testHooks?.editorDecorator;
    statusBar = api?.testHooks?.statusBarController;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");
    assert.ok(decorator, "api.testHooks.editorDecorator missing (test hook)");
    assert.ok(
      statusBar,
      "api.testHooks.statusBarController missing (test hook)",
    );

    // An earlier suite's restore may have deleted the fixture file (this is why
    // `pruneAndRecovery` recreates it too). Recreate it here, so this suite owns
    // the file it opens instead of depending on what ran before it.
    if (!fs.existsSync(APP_FILE)) {
      fs.mkdirSync(path.dirname(APP_FILE), { recursive: true });
      fs.writeFileSync(
        APP_FILE,
        "// fixture file recreated by the editor-wiring suite\n",
      );
    }
    assert.ok(
      fs.existsSync(APP_FILE),
      `the fixture file this suite opens is missing: ${APP_FILE}`,
    );

    // `updateDecorations` is private, so "the decorator reacted" is otherwise
    // unfalsifiable. Counting invocations on the prototype keeps the real
    // implementation in charge while making the wiring observable: if the
    // onDidChangeSnapshots subscription (src/editorDecorator.ts:36-41) or the
    // document-change listener (:59-72) stopped reaching the update path, these
    // counts would stop moving and the assertions below would fail.
    const prototype = Object.getPrototypeOf(decorator);
    const originalUpdate = prototype.updateDecorations;
    assert.strictEqual(
      typeof originalUpdate,
      "function",
      "EditorDecorator.updateDecorations is missing (src/editorDecorator.ts:102); the wiring asserted here does not exist",
    );
    probe = {
      updateCalls: 0,
      inFlight: [],
      restore(): void {
        prototype.updateDecorations = originalUpdate;
      },
    };
    prototype.updateDecorations = function (this: unknown): Promise<void> {
      probe.updateCalls += 1;
      const result = originalUpdate.apply(this) as Promise<void>;
      // Keep the promise so a test can await the decorator's real work, and
      // mark it handled so a rejection surfaces in the awaiting test rather
      // than as an unhandled rejection inside the host.
      result.catch(() => undefined);
      probe.inFlight.push(result);
      return result;
    };
  });

  suiteTeardown(async () => {
    probe?.restore();
    if (!api) {
      return;
    }
    // Leave no editor open and no snapshot behind: this suite runs last, and
    // anything that ever runs after it (a suite appended by the runner's
    // fallthrough) must start from the state a fresh host has.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await drainStore();
    await manager.clearActiveSnapshot();
    assert.deepStrictEqual(
      snapshotIds(),
      [],
      "the editor-wiring suite should not leave snapshots behind",
    );
  });

  /** Delete every snapshot, so the store this suite asserts on is its own. */
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
      snapshotIds(),
      [],
      "the store should be empty after draining it",
    );
  }

  /** Take a manual snapshot and prove it landed in the store. */
  async function take(description: string): Promise<string> {
    const outcome = await api.takeSnapshot({ description, silent: true });
    assert.strictEqual(
      outcome?.success,
      true,
      `takeSnapshot(${description}) failed: ${JSON.stringify(outcome)}`,
    );
    const id: string = outcome.snapshot?.id;
    assert.ok(
      typeof id === "string" && id.length > 0,
      `takeSnapshot(${description}) returned no id: ${JSON.stringify(outcome)}`,
    );
    assert.ok(
      snapshotIds().includes(id),
      `snapshot ${id} is not in the store right after being created`,
    );
    return id;
  }

  /**
   * Prove `id` is the newest snapshot and young enough for the status bar to
   * spell its age as 'now' -- the precondition that makes the exact strings
   * asserted below the correct expectation rather than a guess.
   */
  function assertFreshNewest(id: string): void {
    const list = manager.getSnapshots();
    const snapshot = list.find((s: any) => s.id === id);
    assert.ok(
      snapshot,
      `snapshot ${id} is not in the store: ${JSON.stringify(snapshotIds())}`,
    );
    assert.strictEqual(
      list[list.length - 1].id,
      id,
      `snapshot ${id} should be the newest one; the status bar describes the newest snapshot's age (src/statusBarController.ts:74-75)`,
    );
    const age = Date.now() - snapshot.timestamp;
    assert.ok(
      age < FRESH_WINDOW_MS,
      `snapshot ${id} is ${age}ms old; 'now' is only the expected status bar text inside the first ${FRESH_WINDOW_MS}ms (src/statusBarController.ts:7-13)`,
    );
  }

  /**
   * Watch the decorator's read of the newest snapshot's file content
   * (`src/editorDecorator.ts:132-136`) -- the last observable step before it
   * hands ranges to `setDecorations`. The wrapper delegates to the real method,
   * so the decorator's work itself is unchanged.
   */
  function spyOnContentFetch(): {
    calls: { id: string; rel: string }[];
    restore(): void;
  } {
    const calls: { id: string; rel: string }[] = [];
    const original = manager.getSnapshotFileContentPublic;
    assert.strictEqual(
      typeof original,
      "function",
      "SnapshotManager.getSnapshotFileContentPublic is missing (src/snapshotManager.ts:1548)",
    );
    manager.getSnapshotFileContentPublic = async function (
      id: string,
      rel: string,
      forIndexing?: boolean,
    ): Promise<string | null> {
      calls.push({ id, rel });
      return original.call(manager, id, rel, forIndexing);
    };
    return {
      calls,
      restore(): void {
        delete manager.getSnapshotFileContentPublic;
      },
    };
  }

  test("the status bar spells the empty store exactly, driven by the store change itself", async () => {
    // This test makes the transition its own instead of assuming a store state:
    // drain, create, delete. The final delete fires `onDidChangeSnapshots`, so
    // the item must already read the empty text when it resolves -- there is no
    // manual refresh anywhere below, because the contract under test is that
    // the subscription (src/statusBarController.ts:46-51) drives the text.
    await drainStore();
    const id = await take("wiring-empty-1");
    const deleted = await api.deleteSnapshot(id, { skipConfirm: true });
    assert.strictEqual(deleted, true, `could not delete ${id}`);
    assert.deepStrictEqual(
      snapshotIds(),
      [],
      "the store should be empty here for the empty-state text to be correct",
    );

    assertStatusText(
      statusBar,
      EMPTY_STORE_TEXT,
      "an empty store (src/statusBarController.ts:64-71)",
    );
  });

  test("the status bar names the active snapshot index and total for the ids this test created", async () => {
    await drainStore();

    const first = await take("wiring-sb-1");
    assert.deepStrictEqual(
      snapshotIds(),
      [first],
      "the store should hold exactly the snapshot this test created",
    );
    assertFreshNewest(first);
    assertStatusText(
      statusBar,
      atSnapshotText(1, 1),
      `a new snapshot becomes the active one (src/snapshotManager.ts:644), so the item should name ${first} as 1/1`,
    );

    const second = await take("wiring-sb-2");
    assert.deepStrictEqual(
      snapshotIds(),
      [first, second],
      "the store should hold exactly the two snapshots this test created, oldest first",
    );
    assertFreshNewest(second);
    assertStatusText(
      statusBar,
      atSnapshotText(2, 2),
      `the newest snapshot ${second} is active, so the item should name 2/2`,
    );

    // Detached: snapshots exist, the workspace does not correspond to one.
    await manager.clearActiveSnapshot();
    assert.strictEqual(
      manager.getActiveSnapshot(),
      undefined,
      "precondition: clearing the active snapshot should detach the workspace",
    );
    assertStatusText(
      statusBar,
      detachedText(2),
      "a detached workspace with two snapshots (src/statusBarController.ts:95-104)",
    );

    // Attach again, to the OLDEST snapshot: the index must follow the id, not
    // whatever position the newest snapshot happens to have.
    const restore = await manager.applySnapshotRestore(first);
    assert.strictEqual(
      restore?.success,
      true,
      `applySnapshotRestore(${first}) failed: ${JSON.stringify(restore)}`,
    );
    assert.strictEqual(
      manager.getCurrentSnapshotIndex(),
      0,
      "precondition: the oldest snapshot should be the active one",
    );
    assertStatusText(
      statusBar,
      atSnapshotText(1, 2),
      `the workspace is at the oldest snapshot ${first}, so the item should name 1/2`,
    );
  });

  test("an open editor reaches the decorator for the snapshot just taken, and the host stays healthy", async () => {
    const doc = await vscode.workspace.openTextDocument(APP_FILE);
    assert.strictEqual(
      doc.uri.toString(),
      vscode.Uri.file(APP_FILE).toString(),
      `the document opened is not the fixture file: ${doc.uri.toString()}`,
    );
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    assert.strictEqual(
      vscode.window.activeTextEditor?.document.uri.toString(),
      doc.uri.toString(),
      `showTextDocument did not make ${doc.uri.toString()} the active editor; active is ${describeEditor(
        vscode.window.activeTextEditor,
      )}`,
    );

    // The decorator learns about the editor through
    // `onDidChangeActiveTextEditor` (src/editorDecorator.ts:44-56); event
    // delivery is asynchronous, so wait for the wiring instead of assuming it.
    await waitFor(
      () =>
        decorator.activeEditor?.document.uri.toString() === doc.uri.toString(),
      10000,
      () =>
        `the decorator never picked up the editor opened on ${doc.uri.toString()}; it still tracks ${describeEditor(
          decorator.activeEditor,
        )}`,
    );

    const callsBefore = probe.updateCalls;
    const fetch = spyOnContentFetch();
    let snapshotId = "";
    try {
      // A snapshot change is the event the decorator subscribes to.
      snapshotId = await take("wiring-editor-1");
      assert.ok(
        probe.updateCalls > callsBefore,
        "taking a snapshot did not reach the decorator's update path (src/editorDecorator.ts:36-41)",
      );

      // The decorator compares the active document against the NEWEST snapshot
      // (src/editorDecorator.ts:119-136), so it must read exactly that snapshot
      // and exactly this file out of it.
      await waitFor(
        () =>
          fetch.calls.some(
            (call) => call.id === snapshotId && call.rel === APP_REL,
          ),
        15000,
        () =>
          `the decorator never read ${APP_REL} out of snapshot ${snapshotId}; it read ${JSON.stringify(
            fetch.calls,
          )}`,
      );

      // A real edit goes through the debounced path, which is what actually
      // paints decorations. The read it causes is the observable proof that the
      // debounce fired, and the measured delay proves it went through the timer
      // rather than the immediate snapshot path.
      const originalText = doc.getText();
      const callsBeforeEdit = fetch.calls.length;
      const applied = await editor.edit((builder) =>
        builder.insert(new vscode.Position(0, 0), EDIT_MARKER),
      );
      assert.strictEqual(applied, true, "the probe edit was not applied");
      assert.ok(
        doc.getText().startsWith(EDIT_MARKER),
        "the probe edit is not visible in the document",
      );
      const editedAt = Date.now();
      await waitFor(
        () => fetch.calls.length > callsBeforeEdit,
        10000,
        () =>
          `the version of ${APP_REL} written ${
            Date.now() - editedAt
          }ms ago was never read back by the decorator; reads=${JSON.stringify(
            fetch.calls,
          )}`,
      );
      const debounceElapsed = Date.now() - editedAt;
      assert.ok(
        debounceElapsed >= DECORATION_DEBOUNCE_MS - 100,
        `the decorator read the file ${debounceElapsed}ms after the edit; the ${DECORATION_DEBOUNCE_MS}ms debounce (src/editorDecorator.ts:96) should have delayed it`,
      );

      // The decorator's work is asynchronous: await the update it started, so
      // an internal failure is reported here instead of vanishing into an
      // unhandled rejection.
      const update = probe.inFlight[probe.inFlight.length - 1];
      assert.ok(
        update,
        "no decorator update was in flight right after the snapshot change and the edit",
      );
      await withTimeout(
        update,
        15000,
        "the decorator's update never settled after the snapshot change and the edit",
      );

      // Put the fixture file back the way it was found: the marker is exactly
      // one line, so dropping line 0 restores the original text character for
      // character.
      const reverted = await editor.edit((builder) =>
        builder.delete(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 0)),
        ),
      );
      assert.strictEqual(reverted, true, "the probe edit was not reverted");
      assert.strictEqual(
        doc.getText(),
        originalText,
        "the probe edit was not fully reverted; the fixture file is not as this test found it",
      );
    } finally {
      fetch.restore();
    }

    // Host health: the editor the decorator worked against is still open, and
    // the extension still snapshots.
    assert.ok(
      vscode.workspace.textDocuments.some(
        (open) => open.uri.toString() === doc.uri.toString(),
      ),
      `the document ${doc.uri.toString()} was closed by the decorator's update`,
    );
    const followUp = await take("wiring-editor-2");
    assert.ok(
      snapshotIds().includes(followUp),
      `a snapshot operation after the decorator ran did not succeed: ${followUp} is not in ${JSON.stringify(
        snapshotIds(),
      )}`,
    );

    // Lifecycle: close what this test opened.
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    await waitFor(
      () =>
        !vscode.window.visibleTextEditors.some(
          (visible) => visible.document.uri.toString() === doc.uri.toString(),
        ),
      10000,
      () =>
        `the editor opened on ${doc.uri.toString()} is still visible after workbench.action.closeActiveEditor`,
    );
  });

  test("with no editor open the decorator still updates and reads no file content", async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    // Wait for the decorator's OWN field, not just the API getter: the
    // extension's listener is notified asynchronously, so `activeTextEditor`
    // being undefined is not yet proof that the decorator has seen the event.
    await waitFor(
      () =>
        vscode.window.activeTextEditor === undefined &&
        decorator.activeEditor === undefined,
      10000,
      () =>
        `no-editor precondition not reached: activeTextEditor=${describeEditor(
          vscode.window.activeTextEditor,
        )}, decorator tracks ${describeEditor(decorator.activeEditor)}`,
    );
    assert.strictEqual(
      decorator.activeEditor,
      undefined,
      "the decorator should have dropped the closed editor (src/editorDecorator.ts:44-56)",
    );

    // Negative control for the test above: the same snapshot change, with no
    // editor, must still reach the update path and must read nothing. Without
    // this, "the decorator read the file" could be satisfied by any code path
    // that reads snapshot content when a snapshot is taken.
    const callsBefore = probe.updateCalls;
    const fetch = spyOnContentFetch();
    try {
      const id = await take("wiring-no-editor");
      assert.ok(
        probe.updateCalls > callsBefore,
        "taking a snapshot did not reach the decorator's update path (src/editorDecorator.ts:36-41)",
      );
      await delay(DECORATION_DEBOUNCE_MS + 200);
      assert.deepStrictEqual(
        fetch.calls.filter((call) => call.id === id),
        [],
        `with no active editor the decorator returns before reading anything (src/editorDecorator.ts:103-106); it read ${JSON.stringify(
          fetch.calls,
        )}`,
      );
    } finally {
      fetch.restore();
    }
  });
});
