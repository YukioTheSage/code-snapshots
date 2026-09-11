import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * Auto snapshots: the interval setting, the rule list, and the one behaviour
 * that is specific to auto-tagged snapshots -- the no-changes skip.
 *
 * Contracts verified in source before asserting them:
 *
 *  - `src/extension.ts:272-349` -- `setupAutoSnapshotTimer()` clears the
 *    existing handle and re-registers with `autoSnapshotInterval * 60 * 1000`
 *    whenever `vscode-snapshots.autoSnapshotInterval` changes. The unit is
 *    MINUTES and 0 disables the timer.
 *  - `src/snapshotManager.ts:631-649` -- a snapshot tagged `auto` whose file
 *    entries show no change returns `{created:false, reason:'no-changes'}`.
 *    Manual snapshots (no `auto` tag) never take that branch, but the
 *    pre-restore backup does: `src/services/terminalApiService.ts:201-210`
 *    tags it `['backup','auto']`, so an unchanged workspace can skip it too.
 *  - `src/services/terminalApiService.ts:65-79` -- the skip surfaces as
 *    `{success:false, noChanges:true, error:'Nothing to snapshot: ...'}`.
 *  - `src/changeNotifier.ts:379-440` -- a rule is evaluated when a matching
 *    document is SAVED, fires immediately for a pattern with no recorded fire
 *    time (`RuleScheduleStore.get` -> 0, `shouldFireRule` -> true) and creates
 *    a SELECTIVE auto snapshot tagged `['auto','rule-based','save-triggered']`.
 *
 * What is deliberately NOT automated: the timer FIRING. The minimum legal
 * interval is one minute and this suite may not wait 60 s, so the clear +
 * re-register path is asserted instead, at the only observable boundary it has
 * (the global timer functions the bundle calls). The rule evaluator is NOT
 * reachable from `api.testHooks` -- the host exports only
 * `manualTreeProvider, autoTreeProvider, snapshotManager, editorDecorator,
 * statusBarController` -- which is why rule evaluation is driven end to end
 * through a document save rather than by calling the evaluator directly.
 */
const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const SECTION = "vscode-snapshots";
/** `vscode-snapshots.autoSnapshotInterval` from test/runTest.ts's fixture settings. */
const FIXTURE_INTERVAL = 0;
const APP_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");
/** A file this suite owns, matched by the single rule it configures. */
const RULE_SIGNAL_REL = "auto-rule-signal.ts";
const RULE_SIGNAL_FILE = path.join(FIXTURE_ROOT ?? "", RULE_SIGNAL_REL);

const config = () => vscode.workspace.getConfiguration(SECTION);

/**
 * Append a line to the fixture's `src/app.ts` and prove the change landed.
 *
 * An auto-tagged snapshot is refused when nothing changed, so a test that takes
 * one has to own a real workspace change instead of relying on incidental churn
 * elsewhere in the scanned tree. The file is recreated if an earlier suite's
 * restore removed it, so this suite is self-sufficient in any file order.
 */
function appendFixtureChange(marker: string): void {
  assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
  if (!fs.existsSync(APP_FILE)) {
    fs.writeFileSync(APP_FILE, "// fixture file recreated by the auto-snapshot suite\n");
  }
  const before = fs.readFileSync(APP_FILE, "utf8");
  fs.appendFileSync(APP_FILE, `\n${marker}\n`);
  const after = fs.readFileSync(APP_FILE, "utf8");
  assert.notStrictEqual(
    after,
    before,
    `fixture file ${APP_FILE} did not change after appending ${JSON.stringify(marker)}`,
  );
  assert.ok(
    after.includes(marker),
    `marker ${JSON.stringify(marker)} missing from ${APP_FILE} after the append`,
  );
}

/**
 * Wait, with a bounded deadline, for an event-driven side effect.
 *
 * This waits for work the host performs in response to an event (a
 * configuration change, a document save) -- never for a timer tick.
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

suite("auto snapshots", function () {
  this.timeout(60000);

  let api: any;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    assert.ok(api?.testHooks, "api.testHooks missing");
  });

  // The interval timer is global to the host: leaving it running would make
  // every later suite race a one-minute auto snapshot. The rule list is global
  // too, and a configured rule is due immediately, so both are restored after
  // every test -- including a test that failed halfway through.
  teardown(async () => {
    await config().update(
      "autoSnapshot.rules",
      [],
      vscode.ConfigurationTarget.Workspace,
    );
    await config().update(
      "autoSnapshotInterval",
      FIXTURE_INTERVAL,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(
      config().get("autoSnapshotInterval"),
      FIXTURE_INTERVAL,
      "teardown: the auto-snapshot interval timer must be left disabled",
    );
    assert.deepStrictEqual(
      config().get("autoSnapshot.rules"),
      [],
      "teardown: no auto-snapshot rule may be left configured",
    );
  });

  test("changing autoSnapshotInterval clears the timer and registers one new timer", async function () {
    // The handle lives in a closure inside `activate()`, so the reconfiguration
    // is observed at its only observable boundary: the global timer functions
    // the bundle calls (`dist/extension.js` registers the interval with a plain
    // `setInterval`). The wrappers delegate to the real functions, so host
    // timing is unchanged, and they are restored in `finally`.
    const minuteRegistrations: unknown[] = [];
    const cleared: unknown[] = [];
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    (globalThis as any).setInterval = (
      fn: any,
      delay?: number,
      ...rest: any[]
    ) => {
      const handle = (realSetInterval as any)(fn, delay, ...rest);
      if (delay === 60_000) {
        minuteRegistrations.push(handle);
      }
      return handle;
    };
    (globalThis as any).clearInterval = (handle: any) => {
      cleared.push(handle);
      (realClearInterval as any)(handle);
    };
    const liveMinuteTimers = () =>
      minuteRegistrations.filter((handle) => !cleared.includes(handle));

    try {
      assert.strictEqual(
        config().get("autoSnapshotInterval"),
        FIXTURE_INTERVAL,
        "precondition: the fixture ships with the interval timer disabled",
      );

      await config().update(
        "autoSnapshotInterval",
        1,
        vscode.ConfigurationTarget.Workspace,
      );
      assert.strictEqual(
        config().get("autoSnapshotInterval"),
        1,
        "the workspace override of autoSnapshotInterval did not round-trip",
      );

      await waitFor(
        "the configuration listener to register the 1-minute timer",
        () => (minuteRegistrations.length > 0 ? true : undefined),
      );
      assert.strictEqual(
        liveMinuteTimers().length,
        1,
        `exactly one 1-minute timer must be live after the change, saw ${liveMinuteTimers().length} of ${minuteRegistrations.length} registration(s)`,
      );

      await config().update(
        "autoSnapshotInterval",
        0,
        vscode.ConfigurationTarget.Workspace,
      );
      assert.strictEqual(config().get("autoSnapshotInterval"), 0);
      await waitFor(
        "the 1-minute timer to be cleared when the interval is set back to 0",
        () => (liveMinuteTimers().length === 0 ? true : undefined),
      );
      assert.ok(
        cleared.includes(minuteRegistrations[0]),
        "the handle registered for the 1-minute interval was not the one cleared",
      );
    } finally {
      (globalThis as any).setInterval = realSetInterval;
      (globalThis as any).clearInterval = realClearInterval;
    }
  });

  test("a reconfigured interval leaves snapshotting functional", async () => {
    await config().update(
      "autoSnapshotInterval",
      1,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(config().get("autoSnapshotInterval"), 1);
    await config().update(
      "autoSnapshotInterval",
      0,
      vscode.ConfigurationTarget.Workspace,
    );
    assert.strictEqual(config().get("autoSnapshotInterval"), 0);

    const outcome = await api.takeSnapshot({
      description: "auto-interval-reconfigured",
      silent: true,
    });
    assert.strictEqual(
      outcome.success,
      true,
      `snapshot after reconfiguring the interval: ${JSON.stringify(outcome)}`,
    );
    const ids = (await api.getSnapshots()).map((s: any) => s.id);
    assert.ok(
      ids.includes(outcome.snapshot.id),
      `the snapshot taken after the reconfiguration is not in the store: ${JSON.stringify(
        ids,
      )}`,
    );
  });

  test("an auto snapshot of an unchanged workspace is skipped while a manual one is created", async () => {
    const before = (await api.getSnapshots()).map((s: any) => s.id);

    appendFixtureChange(`// auto-snapshot change marker ${Date.now()}`);
    const first = await api.takeSnapshot({
      description: "auto-changed",
      tags: ["auto"],
      silent: true,
    });
    assert.strictEqual(
      first.success,
      true,
      `an auto snapshot with a real change must be created: ${JSON.stringify(
        first,
      )}`,
    );
    const autoId: string = first.snapshot.id;
    assert.deepStrictEqual(
      first.snapshot.tags,
      ["auto"],
      `the auto tag did not survive the round-trip: ${JSON.stringify(
        first.snapshot.tags,
      )}`,
    );

    // Nothing in the workspace changes between these two calls, so the second
    // auto snapshot has nothing to record. (The store itself is excluded from
    // the scan, so its rewritten `index.json` is not a change either.)
    const second = await api.takeSnapshot({
      description: "auto-unchanged",
      tags: ["auto"],
      silent: true,
    });
    assert.strictEqual(
      second.success,
      false,
      `the second auto snapshot should have been skipped: ${JSON.stringify(
        second,
      )}`,
    );
    assert.strictEqual(
      second.noChanges,
      true,
      `the skip must be reported as noChanges: ${JSON.stringify(second)}`,
    );
    assert.strictEqual(
      second.error,
      "Nothing to snapshot: the workspace is unchanged since the previous snapshot.",
    );
    assert.strictEqual(
      second.snapshot,
      undefined,
      "a skipped snapshot must not report a snapshot payload",
    );

    // The asymmetry that makes the skip specific to auto snapshots: the very
    // same unchanged workspace still produces a manual snapshot.
    const manual = await api.takeSnapshot({
      description: "manual-in-unchanged-workspace",
      silent: true,
    });
    assert.strictEqual(
      manual.success,
      true,
      `a manual snapshot of the unchanged workspace must be created: ${JSON.stringify(
        manual,
      )}`,
    );
    const manualId: string = manual.snapshot.id;
    assert.notStrictEqual(
      manualId,
      autoId,
      "the manual snapshot reused the auto snapshot's id",
    );

    assert.deepStrictEqual(
      (await api.getSnapshots()).map((s: any) => s.id),
      [...before, autoId, manualId],
      "the store should hold exactly the snapshots this test created, in order",
    );
  });

  test("autoSnapshot.rules round-trips and a saved matching file fires the rule", async () => {
    const rule = { pattern: RULE_SIGNAL_REL, intervalMinutes: 1 };
    await config().update(
      "autoSnapshot.rules",
      [rule],
      vscode.ConfigurationTarget.Workspace,
    );
    assert.deepStrictEqual(
      config().get("autoSnapshot.rules"),
      [rule],
      "the workspace override of autoSnapshot.rules did not round-trip",
    );

    // A file this test owns, and that only this rule matches.
    const marker = `// auto-rule signal ${Date.now()}`;
    fs.writeFileSync(RULE_SIGNAL_FILE, `${marker}\n`, "utf8");
    assert.strictEqual(fs.readFileSync(RULE_SIGNAL_FILE, "utf8"), `${marker}\n`);
    // The snapshot scan and the rule's own file search both go through
    // `workspace.findFiles`; wait until the new file is visible to it.
    await waitFor(
      `${RULE_SIGNAL_REL} to become visible to workspace.findFiles`,
      async () =>
        (await vscode.workspace.findFiles(`**/${RULE_SIGNAL_REL}`)).length === 1
          ? true
          : undefined,
    );

    // Rules are evaluated on save, so the document has to be saved through the
    // editor rather than only written to disk.
    const document = await vscode.workspace.openTextDocument(RULE_SIGNAL_FILE);
    const editor = await vscode.window.showTextDocument(document);
    const editApplied = await editor.edit((builder) =>
      builder.insert(
        new vscode.Position(0, 0),
        `// saved by the rule test ${Date.now()}\n`,
      ),
    );
    assert.strictEqual(editApplied, true, "the editor edit did not apply");
    assert.strictEqual(
      document.isDirty,
      true,
      "precondition: the signal document should be dirty before saving",
    );
    const saved = await document.save();
    assert.strictEqual(saved, true, "the signal document did not save");
    assert.strictEqual(document.isDirty, false);

    const expectedDescription = `Auto-snapshot for ${rule.pattern}`;
    const created = await waitFor(
      `the rule-based snapshot for ${rule.pattern}`,
      async () =>
        (await api.getSnapshots()).find(
          (s: any) => s.description === expectedDescription,
        ),
      15000,
    );

    assert.deepStrictEqual(
      created.tags,
      ["auto", "rule-based", "save-triggered"],
      `the rule's own tags did not survive: ${JSON.stringify(created.tags)}`,
    );
    assert.strictEqual(
      created.isSelective,
      true,
      "a rule-based snapshot is selective",
    );
    assert.deepStrictEqual(
      created.selectedFiles,
      [RULE_SIGNAL_REL],
      `the rule selected ${JSON.stringify(
        created.selectedFiles,
      )} for pattern ${rule.pattern}`,
    );
    const entry = created.files[RULE_SIGNAL_REL];
    assert.ok(
      entry,
      `the matched file is missing from the snapshot; recorded keys: ${JSON.stringify(
        Object.keys(created.files),
      )}`,
    );
    assert.strictEqual(
      typeof entry.content,
      "string",
      `the matched file's content was not recorded: ${JSON.stringify(entry)}`,
    );
    assert.ok(
      entry.content.includes(marker),
      `the recorded content is not the file this test saved: ${JSON.stringify(
        entry.content,
      )}`,
    );

    // A rule-based snapshot with a NON-EMPTY selection records only the files
    // the rule selected: the scan is filtered to `selectedFiles`
    // (src/snapshotManager.ts:430-451) and `currentWorkspaceFiles` is built from
    // that filtered list (:499-507). The deletion pass is gated on the same
    // predicate that filter carries (`isSelective` with a non-empty
    // `selectedFiles`, guard at :606-609), so a rule that matched nothing --
    // `findFilesMatchingRule` returns `[]` on error
    // (src/changeNotifier.ts:261-263) or when the pattern matches no file --
    // falls back to a whole-tree capture, whose deletion markers are real
    // (perFileOperations.test.ts, "an empty-selection rule snapshot behaves as
    // a whole-tree capture on restore"). This test's rule matches one file and
    // the assertions above pin that (`selectedFiles` deep-equals
    // `[RULE_SIGNAL_REL]`), so the guarded selective path is what it exercises.
    //
    // The pass that follows the scan (:606-629) used to run unconditionally and
    // wrote `{deleted:true}` for every base-snapshot file missing from the
    // filtered list, so this snapshot also recorded [".vscode/settings.json",
    // ".vscode/codelapse-connection.json", "src/app.ts"] and restoring it
    // deleted files the rule had never captured (reported as F1 in
    // task-8910-report.md; the selective-capture guard fixed it). The marker-free
    // shape is asserted directly in perFileOperations.test.ts ("selective capture
    // does not mark unselected files as deleted"); the assertions above stay
    // scoped to the matched file and to the metadata the rule itself sets.
  });
});
