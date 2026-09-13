import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Filter coverage for the manual snapshot tree provider.
 *
 * The provider's real API is `setFilter(options)` (src/ui/treeView.ts:273) plus
 * read-only getters. There is no `clearFilters()` and no `setTagsFilter()`; the
 * plan's scaffold guessed both. Two consequences drive this file:
 *
 * 1. `setFilter` applies ONLY the keys that are not `undefined` (lines 281-317).
 *    Omitting a key does not clear it, so resetting requires an explicit
 *    `null` / `[]` / `false` for every key -- what the "Snapshots: Clear All
 *    Filters" command passes (src/commands.ts:2150). `clearFilters()` below is
 *    the test's own helper, not a provider method.
 * 2. Snapshots are NOT the provider's root children: the root holds relative
 *    date groups (`contextValue === 'snapshotGroup'`) and the snapshots hang one
 *    level below as `'snapshotItem'` rows. Every assertion walks that structure.
 *
 * Filters are state on the SHARED provider instance, so this suite clears them
 * after every test (`teardown`) and again at `suiteTeardown`. Clearing only at
 * the end of a test body is not enough: the RED run of this file left a tag
 * filter behind after an assertion failed and the later `Tree views` suite came
 * up with a filtered tree and four unrelated failures.
 */
const EXPECTED_ID = process.env.CODELAPSE_EXPECTED_ID as string;

/** The tag only this suite's seed snapshot carries. */
const TAG = "uniquetag-42";

type FilterOptions = {
  startDate?: number | null;
  endDate?: number | null;
  tags?: string[];
  favoritesOnly?: boolean;
  filePattern?: string | null;
};

type Provider = {
  getChildren(element?: any): Thenable<any[]>;
  getTreeItem(element: any): any;
  setFilter(options: FilterOptions): void;
  getActiveFilterCount(): number;
  onDidChangeTreeData(listener: (element?: any) => void): vscode.Disposable;
};

/**
 * Every filter key at a neutral value. Passing this is the only way to clear:
 * `setFilter` ignores keys whose value is `undefined`.
 */
const NO_FILTERS: FilterOptions = {
  startDate: null,
  endDate: null,
  tags: [],
  favoritesOnly: false,
  filePattern: null,
};

/** Snapshot items reachable from the provider root, one date group deep. */
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

/** Ids of every snapshot reachable from the provider root. */
async function reachableSnapshotIds(provider: Provider): Promise<string[]> {
  return (await reachableSnapshotItems(provider)).map(
    (item) => item.snapshotId ?? item.snapshot?.id,
  );
}

/**
 * Compare sorted id sets. `includes`-style checks accept a provider that also
 * renders a duplicate row or a stale snapshot; comparing the whole set does not.
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

suite("tree filters", function () {
  this.timeout(60000);

  let api: any;
  let manager: any;
  let manual: Provider;
  let auto: Provider;
  /** Tagged seed: the only snapshot matching `TAG`. */
  let taggedId: string;
  /** Untagged control: must never match a `TAG` filter. */
  let plainId: string;
  /** Later than every snapshot that existed before this suite; <= both seeds. */
  let seedFloor: number;

  /** Reset every filter key explicitly; omitted keys are not cleared. */
  function clearFilters(): void {
    manual.setFilter(NO_FILTERS);
  }

  suiteSetup(async () => {
    await (vscode.extensions.getExtension(EXPECTED_ID) as any).activate();
    api = await vscode.commands.executeCommand("vscode-snapshots.getApi");
    manager = api?.testHooks?.snapshotManager;
    manual = api?.testHooks?.manualTreeProvider;
    auto = api?.testHooks?.autoTreeProvider;
    assert.ok(manager, "api.testHooks.snapshotManager missing (test hook)");
    assert.ok(manual, "api.testHooks.manualTreeProvider missing (test hook)");
    assert.ok(auto, "api.testHooks.autoTreeProvider missing (test hook)");
    assert.strictEqual(
      typeof manual.setFilter,
      "function",
      "manualTreeProvider.setFilter missing: the filter API this suite exercises",
    );

    // Start from a clean provider and prove it, so a filter left by an earlier
    // suite cannot make the assertions below pass for the wrong reason.
    clearFilters();
    assert.strictEqual(
      manual.getActiveFilterCount(),
      0,
      "precondition: the manual view should start with no active filters",
    );

    // Snapshot ids and payloads are per-run, so both timestamps and ids are read
    // back from the API instead of being constructed.
    const existing: any[] = await api.getSnapshots();
    const newestExisting = existing.reduce(
      (acc: number, s: any) => Math.max(acc, s.timestamp ?? 0),
      0,
    );

    // Manual snapshots: neither seed carries the `auto` tag, so neither can be
    // refused for "no changes".
    const tagged = await api.takeSnapshot({
      description: "filter-match",
      tags: [TAG],
      silent: true,
    });
    assert.ok(
      tagged.success,
      `takeSnapshot failed for the tagged seed: ${JSON.stringify(tagged)}`,
    );
    taggedId = tagged.snapshot.id;

    const plain = await api.takeSnapshot({
      description: "filter-plain",
      silent: true,
    });
    assert.ok(
      plain.success,
      `takeSnapshot failed for the untagged seed: ${JSON.stringify(plain)}`,
    );
    plainId = plain.snapshot.id;

    assert.notStrictEqual(taggedId, plainId, "the two seeds share a snapshot id");
    const seeded: any[] = await api.getSnapshots();
    const timestamps = [taggedId, plainId].map((seedId) => {
      const found = seeded.find((s: any) => s.id === seedId);
      assert.ok(found, `seed ${seedId} missing from api.getSnapshots()`);
      return found.timestamp as number;
    });
    seedFloor = Math.min(...timestamps);
    assert.ok(
      seedFloor > newestExisting,
      `precondition: the seeds (oldest ${seedFloor}) should be newer than every ` +
        `snapshot that already existed (newest ${newestExisting})`,
    );

    const ids = await reachableSnapshotIds(manual);
    assert.ok(
      ids.includes(taggedId) && ids.includes(plainId),
      `precondition: both seeds should be visible while unfiltered, saw ${JSON.stringify(
        ids,
      )}`,
    );
  });

  // Runs even when a test above fails, which is the point: a filter left behind
  // would silently break every later suite that shares this provider.
  teardown(() => {
    if (manual) clearFilters();
  });

  suiteTeardown(() => {
    if (!manual) return;
    clearFilters();
    assert.strictEqual(
      manual.getActiveFilterCount(),
      0,
      "the filters suite must leave the shared manual provider unfiltered",
    );
  });

  test("tag filter shows exactly the tagged snapshot, and clearing restores the baseline", async () => {
    const baseline = await reachableSnapshotIds(manual);
    const autoBaseline = await reachableSnapshotIds(auto);
    assert.ok(
      baseline.includes(taggedId),
      "positive control: the tagged seed must be visible before the filter is applied",
    );

    const events: any[] = [];
    const subscription = manual.onDidChangeTreeData((element) =>
      events.push(element),
    );
    try {
      manual.setFilter({ tags: [TAG] });
    } finally {
      subscription.dispose();
    }
    assert.strictEqual(
      events.length,
      1,
      "applying a filter should refresh the view exactly once",
    );

    const filtered = await reachableSnapshotIds(manual);
    assertSameIds(
      filtered,
      [taggedId],
      `a filter on ${JSON.stringify(TAG)} should leave exactly the tagged seed`,
    );
    assert.ok(
      !filtered.includes(plainId),
      `the untagged seed ${plainId} survived a tag filter it does not match`,
    );

    // Filters are per-provider state: the manual view's filter must not touch
    // the auto view's data.
    assertSameIds(
      await reachableSnapshotIds(auto),
      autoBaseline,
      "a filter set on the manual view changed the auto view",
    );

    clearFilters();
    assert.strictEqual(
      manual.getActiveFilterCount(),
      0,
      "clearing should leave no active filters",
    );
    assertSameIds(
      await reachableSnapshotIds(manual),
      baseline,
      "clearing the tag filter should restore the baseline view",
    );
  });

  test("favoritesOnly follows the favorite flag live, and clearing restores the baseline", async () => {
    const baseline = await reachableSnapshotIds(manual);
    assert.ok(
      baseline.includes(plainId),
      "positive control: the unfavorited seed must be visible before filtering",
    );

    // There is no separate favorite mutator: metadata changes go through
    // updateSnapshotContext (see test/suite/metadata.test.ts).
    assert.strictEqual(
      await manager.updateSnapshotContext(taggedId, { isFavorite: true }),
      true,
      "failed to favorite the tagged seed",
    );

    manual.setFilter({ favoritesOnly: true });
    try {
      const filtered = await reachableSnapshotIds(manual);
      assert.ok(
        filtered.includes(taggedId),
        `the favorited seed ${taggedId} is missing from the favorites-only view: ${JSON.stringify(
          filtered,
        )}`,
      );
      assert.ok(
        !filtered.includes(plainId),
        `the unfavorited seed ${plainId} survived the favorites-only filter`,
      );

      // The filter reads the live flag rather than a copy taken when it was
      // applied: unfavoriting has to remove the row again.
      assert.strictEqual(
        await manager.updateSnapshotContext(taggedId, { isFavorite: false }),
        true,
        "failed to unfavorite the tagged seed",
      );
      const afterUnfavorite = await reachableSnapshotIds(manual);
      assert.ok(
        !afterUnfavorite.includes(taggedId),
        `unfavoriting did not remove ${taggedId} from the favorites-only view`,
      );
    } finally {
      clearFilters();
      // Leave no favorite behind for the suites that follow.
      await manager.updateSnapshotContext(taggedId, { isFavorite: false });
    }

    assertSameIds(
      await reachableSnapshotIds(manual),
      baseline,
      "clearing the favorites filter should restore the baseline view",
    );
  });

  test("date range excludes what falls outside it, and clearing restores the baseline", async () => {
    const baseline = await reachableSnapshotIds(manual);
    assert.ok(
      baseline.includes(taggedId) && baseline.includes(plainId),
      "positive control: both seeds must be visible before filtering",
    );

    // startDate at the oldest seed: the seeds pass (timestamps >= seedFloor),
    // every pre-existing snapshot fails (< seedFloor, asserted in suiteSetup).
    manual.setFilter({ startDate: seedFloor, endDate: null });
    assertSameIds(
      await reachableSnapshotIds(manual),
      [taggedId, plainId],
      "a startDate at the seeds' own timestamp should leave exactly the two seeds",
    );
    clearFilters();

    // endDate one millisecond before the oldest seed: the mirror image.
    manual.setFilter({ startDate: null, endDate: seedFloor - 1 });
    const older = await reachableSnapshotIds(manual);
    assert.ok(
      !older.includes(taggedId) && !older.includes(plainId),
      `an endDate before both seeds still showed them: ${JSON.stringify(older)}`,
    );
    assertSameIds(
      older,
      baseline.filter((seen) => seen !== taggedId && seen !== plainId),
      "an endDate before the seeds should leave every earlier snapshot and nothing newer",
    );

    clearFilters();
    assertSameIds(
      await reachableSnapshotIds(manual),
      baseline,
      "clearing the date filter should restore the baseline view",
    );
  });
});
