import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;
const FIXTURE_ROOT = process.env.CODELAPSE_FIXTURE_ROOT as string;
const SRC_FILE = path.join(FIXTURE_ROOT ?? "", "src", "app.ts");

/**
 * The tree providers are `SnapshotTreeDataProvider` instances from
 * `src/ui/treeView.ts`. Their contract is NOT "top-level children are
 * snapshots" (which is what the plan's scaffold assumed):
 *
 *   - `getChildren()` with no element returns top-level GROUP items
 *     (`contextValue === 'snapshotGroup'`), one per non-empty relative-date
 *     bucket, ordered by `GROUP_ORDER`. Empty groups are filtered out.
 *   - Snapshots live one level down: `getChildren(groupItem)` returns the
 *     snapshot items (`contextValue === 'snapshotItem'`).
 *   - An empty view returns exactly ONE `emptyState` item whose label depends
 *     on why it is empty: 'No snapshots yet' (manual), 'No auto snapshots yet'
 *     (auto), or 'No snapshots match the active filters'.
 *
 * These helpers walk that real structure so every assertion can be bound to a
 * specific snapshot id the test itself created or destroyed.
 *
 * Every test also establishes its own preconditions: the empty-state tests drain
 * the store with `emptyStore(api)`, and the auto-snapshot test edits the fixture
 * source itself, because an auto-tagged snapshot is refused when nothing changed
 * and must therefore never depend on incidental churn elsewhere in the tree.
 */
type Provider = {
  getChildren(element?: any): Thenable<any[]>;
  getTreeItem(element: any): any;
};

/** Every snapshot item reachable from the provider's root, flattened. */
async function reachableSnapshotItems(provider: Provider): Promise<any[]> {
  const roots = await provider.getChildren();
  const found: any[] = [];
  for (const root of roots) {
    if (root.contextValue === "snapshotGroup") {
      found.push(...(await provider.getChildren(root)));
    }
  }
  return found;
}

/** Ids of every snapshot reachable from the provider's root. */
async function reachableSnapshotIds(provider: Provider): Promise<string[]> {
  return (await reachableSnapshotItems(provider)).map(
    (item) => item.snapshotId ?? item.snapshot?.id,
  );
}

/** Root-level contextValue strings, for asserting the empty/populated shape. */
async function rootContextValues(provider: Provider): Promise<string[]> {
  const roots = await provider.getChildren();
  return roots.map((r) => provider.getTreeItem(r).contextValue);
}

/** Root-level labels, for asserting the exact empty-state text. */
async function rootLabels(provider: Provider): Promise<any[]> {
  const roots = await provider.getChildren();
  return roots.map((r) => provider.getTreeItem(r).label);
}

/** Delete every snapshot in the store so the views start from a known-empty state. */
async function emptyStore(api: any): Promise<void> {
  const all: any[] = await api.getSnapshots();
  for (const snap of all) {
    await api.deleteSnapshot(snap.id, { skipConfirm: true });
  }
  const remaining: any[] = await api.getSnapshots();
  assert.equal(
    remaining.length,
    0,
    `failed to empty the store; ${remaining.length} snapshot(s) remain`,
  );
}

/**
 * Assert that a provider reaches exactly this set of snapshot ids.
 *
 * `ids.includes(x)` / `!ids.includes(x)` accept a provider that additionally
 * renders a duplicate row, a stale snapshot, or a snapshot of the other type.
 * Comparing sorted id sets rejects all three while staying insensitive to group
 * order and to newest/oldest-first order inside a group.
 */
function assertSameIds(
  actual: string[],
  expected: string[],
  message: string,
): void {
  assert.deepStrictEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${message} — expected exactly ${JSON.stringify(
      expected,
    )}, saw ${JSON.stringify(actual)}`,
  );
}

/**
 * Append a line to the fixture's `src/app.ts`, and prove that it changed.
 *
 * An auto-tagged snapshot is refused when nothing changed: `takeSnapshot`
 * returns `{created:false, reason:'no-changes'}` for it. A test that takes one
 * therefore has to own a real workspace change instead of relying on incidental
 * churn elsewhere in the scanned tree. The write is asserted, not assumed, so a
 * silently failing append surfaces here rather than as a confusing
 * `outcome.success` failure in the caller.
 */
function appendFixtureChange(marker: string): void {
  assert.ok(FIXTURE_ROOT, "CODELAPSE_FIXTURE_ROOT is not set");
  const before = fs.readFileSync(SRC_FILE, "utf8");
  fs.appendFileSync(SRC_FILE, `\n${marker}\n`);
  const after = fs.readFileSync(SRC_FILE, "utf8");
  assert.notStrictEqual(
    after,
    before,
    `fixture file ${SRC_FILE} did not change after appending ${JSON.stringify(
      marker,
    )}`,
  );
  assert.ok(
    after.includes(marker),
    `marker ${JSON.stringify(marker)} missing from ${SRC_FILE} after append`,
  );
}

suite("Tree views", function () {
  this.timeout(60000);

  let api: any;
  let manualProvider: Provider;
  let autoProvider: Provider;
  let manualId: string;

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    assert.ok(api?.testHooks, "api.testHooks missing (Task 1 hook)");
    manualProvider = api.testHooks.manualTreeProvider;
    autoProvider = api.testHooks.autoTreeProvider;
    assert.ok(manualProvider, "manualTreeProvider missing");
    assert.ok(autoProvider, "autoTreeProvider missing");
  });

  test("manual provider renders exactly one 'No snapshots yet' empty-state item", async () => {
    await emptyStore(api);

    const labels = await rootLabels(manualProvider);
    assert.deepStrictEqual(
      labels,
      ["No snapshots yet"],
      `empty manual view should render exactly one row, saw ${JSON.stringify(
        labels,
      )}`,
    );
    const contextValues = await rootContextValues(manualProvider);
    assert.deepStrictEqual(contextValues, ["emptyState"]);
  });

  test("auto provider renders exactly one 'No auto snapshots yet' empty-state item", async () => {
    await emptyStore(api);

    const labels = await rootLabels(autoProvider);
    assert.deepStrictEqual(
      labels,
      ["No auto snapshots yet"],
      `empty auto view should render exactly one row, saw ${JSON.stringify(
        labels,
      )}`,
    );
    const contextValues = await rootContextValues(autoProvider);
    assert.deepStrictEqual(contextValues, ["emptyState"]);
  });

  test("empty-state row is inert and carries no snapshot payload", async () => {
    // Establish the precondition here rather than inheriting it from tests 1-2:
    // an inert-row assertion against a populated view would pass while testing
    // the wrong item entirely.
    await emptyStore(api);

    const roots = await manualProvider.getChildren();
    assert.equal(
      roots.length,
      1,
      `expected exactly one empty-state row, saw ${roots.length}`,
    );
    const rendered = manualProvider.getTreeItem(roots[0]);
    assert.equal(rendered.contextValue, "emptyState");
    assert.strictEqual(
      rendered.command,
      undefined,
      "empty-state row should not be clickable",
    );
    // Note: createEmptyStateItem passes `[]`, not `undefined`, so the row
    // carries groupSnapshots even though it is not a group. Assert the
    // observed shape exactly rather than pattern-matching loosely.
    assert.deepStrictEqual(
      roots[0].groupSnapshots,
      [],
      "empty-state row should carry no snapshots",
    );
    assert.equal(
      rendered.collapsibleState,
      vscode.TreeItemCollapsibleState.None,
      "empty-state row should not be expandable",
    );
  });

  test("manual provider shows the snapshot it created, one group deep", async () => {
    const outcome = await api.takeSnapshot({
      description: "tree-manual",
      silent: true,
    });
    assert.ok(
      outcome.success,
      `takeSnapshot failed: ${JSON.stringify(outcome)}`,
    );
    manualId = outcome.snapshot.id;

    const contextValues = await rootContextValues(manualProvider);
    assert.deepStrictEqual(
      contextValues,
      ["snapshotGroup"],
      `a single fresh snapshot should open exactly one date group, saw ${JSON.stringify(
        contextValues,
      )}`,
    );

    const ids = await reachableSnapshotIds(manualProvider);
    assertSameIds(
      ids,
      [manualId],
      "manual view should hold exactly the snapshot this test created",
    );
  });

  test("the created snapshot's tree item is a 'snapshotItem' bound to its id", async () => {
    // Guard: `manualId` is set by the previous test. Without this, a failure
    // there would leave it undefined and every assertion below would silently
    // compare against undefined instead of reporting the real problem.
    assert.ok(
      typeof manualId === "string" && manualId.length > 0,
      "manualId not captured; the preceding takeSnapshot test must run first",
    );
    const items = await reachableSnapshotItems(manualProvider);
    const mine = items.find((i) => i.snapshotId === manualId);
    assert.ok(
      mine,
      `no tree item bound to snapshot ${manualId}; items=${JSON.stringify(
        items.map((i) => i.snapshotId),
      )}`,
    );
    const rendered = manualProvider.getTreeItem(mine);
    assert.equal(rendered.contextValue, "snapshotItem");
    assert.equal(rendered.id, manualId, "tree item id should be the snapshot id");
    assert.strictEqual(
      mine.snapshot?.id,
      manualId,
      "tree item should carry the real snapshot payload",
    );
    assert.ok(
      String(rendered.description).includes("tree-manual"),
      `snapshot item should surface its description, saw ${JSON.stringify(
        rendered.description,
      )}`,
    );
  });

  test("auto provider does not contain the manual snapshot", async () => {
    assert.ok(
      typeof manualId === "string" && manualId.length > 0,
      "manualId not captured; the preceding takeSnapshot test must run first",
    );
    const autoIds = await reachableSnapshotIds(autoProvider);
    assert.ok(
      !autoIds.includes(manualId),
      `manual snapshot ${manualId} leaked into the auto view: ${JSON.stringify(
        autoIds,
      )}`,
    );
    assertSameIds(
      autoIds,
      [],
      "auto view should hold no snapshots while only a manual one exists",
    );
    // At this point the manual snapshot is the only thing in the store, so the
    // auto view must genuinely be in its empty state.
    const labels = await rootLabels(autoProvider);
    assert.deepStrictEqual(
      labels,
      ["No auto snapshots yet"],
      `auto view holding only manual snapshots should show its own empty state, saw ${JSON.stringify(
        labels,
      )}`,
    );
  });

  test("auto provider shows an auto-tagged snapshot and hides it from manual", async () => {
    // The `auto` tag makes `takeSnapshot` refuse a no-op snapshot, returning
    // `{created:false, reason:'no-changes'}`. This test must therefore own the
    // change it depends on. It previously passed only by accident: the
    // fixture's snapshot store lives inside the scanned tree and is not
    // excluded, so the store's own index.json changed between snapshots. That
    // incidental churn disappears the moment the store is ignored properly.
    appendFixtureChange(`// tree-auto change ${Date.now()}`);

    const outcome = await api.takeSnapshot({
      description: "tree-auto",
      tags: ["auto"],
      silent: true,
    });
    assert.ok(
      outcome.success,
      `auto takeSnapshot failed: ${JSON.stringify(outcome)}`,
    );
    const autoId: string = outcome.snapshot.id;

    const autoIds = await reachableSnapshotIds(autoProvider);
    assert.ok(
      autoIds.includes(autoId),
      `auto snapshot ${autoId} not reachable in auto tree; reachable=${JSON.stringify(
        autoIds,
      )}`,
    );
    assertSameIds(
      autoIds,
      [autoId],
      "auto view should hold exactly the auto snapshot",
    );

    const autoItem = (await reachableSnapshotItems(autoProvider)).find(
      (i) => i.snapshotId === autoId,
    );
    assert.ok(autoItem, "no auto tree item bound to the created auto snapshot");
    assert.equal(
      autoProvider.getTreeItem(autoItem).contextValue,
      "snapshotItem",
    );

    const manualIds = await reachableSnapshotIds(manualProvider);
    assert.ok(
      manualIds.includes(manualId),
      "manual view should still hold the manual snapshot",
    );
    assert.ok(
      !manualIds.includes(autoId),
      `auto snapshot ${autoId} leaked into the manual view: ${JSON.stringify(
        manualIds,
      )}`,
    );
    assertSameIds(
      manualIds,
      [manualId],
      "manual view should hold exactly the manual snapshot",
    );
  });

  test("getTreeItem returns a row for the element's own snapshot", async () => {
    const items = await reachableSnapshotItems(autoProvider);
    assert.ok(items.length > 0, "expected the auto view to be populated here");
    for (const item of items) {
      const rendered = autoProvider.getTreeItem(item);
      assert.ok(rendered, "getTreeItem returned nothing");
      // The observable contract: the row the view renders identifies the same
      // snapshot as the element and can be displayed. Object identity is
      // deliberately NOT asserted -- rebuilding an equivalent TreeItem per call
      // is a legitimate implementation that identity would reject.
      assert.equal(
        rendered.id,
        item.snapshotId,
        "rendered row should be identified by the element's snapshot id",
      );
      assert.equal(
        rendered.contextValue,
        "snapshotItem",
        "rendered row should still be a snapshot item",
      );
      assert.equal(
        rendered.contextValue,
        item.contextValue,
        "rendered row should keep the element's contextValue",
      );
      assert.equal(
        typeof rendered.label,
        "string",
        `rendered row should carry a plain label, saw ${JSON.stringify(
          rendered.label,
        )}`,
      );
      assert.ok(
        String(rendered.label).length > 0,
        "rendered row should carry a non-empty label",
      );
      assert.equal(
        rendered.label,
        item.label,
        "rendered row should show the element's label",
      );
    }
  });

  test("deleting the manual snapshot collapses the manual view back to empty", async () => {
    assert.ok(
      typeof manualId === "string" && manualId.length > 0,
      "manualId not captured; the preceding takeSnapshot test must run first",
    );
    assert.ok(
      (await reachableSnapshotIds(manualProvider)).includes(manualId),
      "precondition: manual snapshot should be present before the delete",
    );

    const deleted = await api.deleteSnapshot(manualId, { skipConfirm: true });
    assert.equal(deleted, true, "skipConfirm delete failed");

    const labels = await rootLabels(manualProvider);
    assert.deepStrictEqual(
      labels,
      ["No snapshots yet"],
      `manual view should collapse back to the empty state, saw ${JSON.stringify(
        labels,
      )}`,
    );
    assert.deepStrictEqual(await rootContextValues(manualProvider), [
      "emptyState",
    ]);
  });
});
