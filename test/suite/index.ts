import * as path from "path";
import * as fs from "fs";
import Mocha from "mocha";

/**
 * The integration suites, in the order they must run.
 *
 * Mocha runs files in the order they are added, so this array *is* the run
 * order. It replaces `fs.readdirSync` discovery, whose order is a filesystem
 * implementation detail rather than a decision, while every suite here shares
 * one extension host and one fixture snapshot store: a suite that asserts an
 * empty store, or the exact shape of an empty view, gives a different answer
 * depending on what ran before it. The baseline run puts `Tree views` last,
 * after the suites that prune, delete and corrupt the store -- which is the
 * fragility this list removes.
 *
 * The order is deliberate, not alphabetical:
 *
 *   1. `apiHooks` first: it creates and deletes one snapshot of its own, so it
 *      needs nothing from anyone and leaves the store as it found it.
 *   2. `treeViews` next: it drains the store itself, so it no longer *needs* to
 *      be first, but it is the suite that asserts exact empty-store view shapes.
 *      Keeping the empty-state suites ahead of the heavy mutators keeps those
 *      assertions about an empty store rather than about a store that happens to
 *      be empty at that moment.
 *   3. `extension` early: the activation/smoke suite (extension is active,
 *      every contributed command is registered). It also deletes the store
 *      directory from disk in its own teardown, so every suite after it has to
 *      build the state it needs -- which all of them do.
 *   4-13. the behavioural suites, ordered from "reads what exists" to "destroys
 *      what exists": the diff provider and per-file operations read snapshots,
 *      navigation and metadata walk them, filters and auto snapshots append
 *      their own, and pruning, git metadata, store exclusion and the CLI
 *      connector are the ones that delete, corrupt and rewrite state.
 *      Destructive suites stay last so a failure there cannot be blamed on a
 *      store an earlier suite mangled.
 *  14. `editorWiring` last: it opens a real editor, drives the decorator and the
 *      status bar, closes the editor and empties the store again. Nothing after
 *      it may depend on an open editor or on a non-empty store.
 *
 * A suite added to `test/suite` but not to this list must never be dropped
 * silently: `run()` warns and appends it, so a missing entry degrades the
 * *order* rather than the *coverage*. Add new suites here to place them.
 */
const ORDERED_SUITES = [
  "apiHooks.test.js",
  "treeViews.test.js",
  "extension.test.js",
  "diffContentProvider.test.js",
  "perFileOperations.test.js",
  "navigation.test.js",
  "metadata.test.js",
  "filters.test.js",
  "autoSnapshots.test.js",
  "pruneAndRecovery.test.js",
  "gitInfo.test.js",
  "storeExclusion.test.js",
  "cliConnector.test.js",
  "editorWiring.test.js",
];

/** This runner. It must never be loaded as a suite. */
const RUNNER_FILE = "index.js";

/**
 * Every `*.test.js` under `dir`, recursively.
 *
 * The `*.test.js` filter cannot match this runner (`index.js`), which is why it
 * is safe to keep a directory scan as the fallthrough source: the scan answers
 * "what suites exist on disk", the ordered list above answers "in what order".
 */
function findTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findTestFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      acc.push(full);
    }
  }
  return acc;
}

/** A suite's path relative to the compiled suite root, with `/` separators. */
function suiteName(testsRoot: string, file: string): string {
  return path.relative(testsRoot, file).split(path.sep).join("/");
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "tdd",
    color: true,
    timeout: 60000,
  });

  const testsRoot = path.resolve(__dirname);
  const onDisk = findTestFiles(testsRoot).map((file) =>
    suiteName(testsRoot, file),
  );

  const loaded: string[] = [];
  const missing: string[] = [];
  for (const suite of ORDERED_SUITES) {
    const resolved = path.resolve(testsRoot, suite);
    if (fs.existsSync(resolved)) {
      mocha.addFile(resolved);
      loaded.push(suite);
    } else {
      missing.push(suite);
    }
  }

  // A listed suite that is not on disk means the compiled output does not match
  // the list (a rename, or a stale `test-out`). Fail loudly: silently running
  // thirteen of fourteen suites is exactly the failure mode this file exists to
  // prevent.
  if (missing.length > 0) {
    throw new Error(
      `[suite-order] ${
        missing.length
      } suite file(s) named in ORDERED_SUITES are not on disk: ${missing.join(
        ", ",
      )}. Present: ${onDisk.join(", ")}`,
    );
  }

  // Fallthrough: a suite file that exists but is not in the list above is
  // loaded at the end with a warning. A newly added suite must never be
  // silently ignored -- but it must also not be silently *unnoticed*, so the
  // warning names the file and where to place it.
  const listed = new Set(ORDERED_SUITES);
  const unlisted = onDisk.filter((rel) => !listed.has(rel)).sort();
  for (const rel of unlisted) {
    console.warn(
      `[suite-order] ${rel} is on disk but not in ORDERED_SUITES (test/suite/index.ts); loading it last. Add it to the list to place it deliberately.`,
    );
    mocha.addFile(path.resolve(testsRoot, rel));
    loaded.push(rel);
  }

  // Nothing on disk may be skipped: every suite file that exists must be loaded,
  // whether or not it is in the list above.
  const notLoaded = onDisk.filter((rel) => !loaded.includes(rel));
  if (notLoaded.length > 0 || loaded.length !== onDisk.length) {
    throw new Error(
      `[suite-order] ${onDisk.length} suite file(s) are on disk but ${loaded.length} were loaded; not loaded: ${notLoaded.join(
        ", ",
      )}`,
    );
  }
  if (loaded.includes(RUNNER_FILE)) {
    throw new Error(
      `[suite-order] the runner ${RUNNER_FILE} was added as a suite; it must only ever be the file mocha is run from`,
    );
  }

  console.log(
    `[suite-order] loaded ${loaded.length}/${onDisk.length} suite file(s), in this order: ${loaded.join(
      " -> ",
    )}`,
  );

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
