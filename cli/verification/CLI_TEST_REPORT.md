# codelapse CLI — Full Test & Review Report

> **Copies:** this report and `verify-fixes.ps1` also live in the test sandbox
> (`cli-test-sandbox/`, which is a *nested* git repository so that standalone
> mode treats it as its own workspace). The outer repository cannot track files
> inside that nested repo, so they are mirrored here — treat this directory as
> the canonical tracked copy.

**Tested:** `cli/dist/cli.js` (codelapse-cli 2.0.0), isolated sandbox `cli-test-sandbox/` (own git repo, own `.snapshots/`, standalone mode).
**Method:** Black-box execution of every command group + targeted source review. The CLI's own jest suite (137 tests, 12 suites) passes, so everything below is a gap the unit tests don't cover.

**Legend:** 🔴 High (wrong data/crash) · 🟠 Medium (misleading/correctness) · 🟡 Low (UX/docs) · ⚪ Untestable here

---

## ✅ Fix wave status (branch `fix/cli-bugfixes`)

All fixes below are implemented, each with regression tests written first. Final state:

| Gate | Result |
|---|---|
| `shared` build (`codelapse-core`) | clean |
| `cli` build + `tsc --noEmit -p tsconfig.test.json` | clean |
| jest suite | **23 suites / 204 tests passing** (was 12 / 137) |
| `cli-test-sandbox/verify-fixes.ps1` black-box battery | **32 checks, 0 failures** |

| Bug | Fix | Commit |
|---|---|---|
| BUG-1 standalone rejected in subfolders | shared `findWorkspaceRootFrom()` walk used by both entry points | `00f0aaf` |
| BUG-2 phantom delete success | core `deleteSnapshot` throws on a missing id; pruning stays best-effort | `c73deaa` |
| BUG-3 `snapshot show --files/--content` | `getSnapshotChanges` accepts `{snapshotId}` and `{id}` | `16fccd1` |
| BUG-4 `filter date` RangeError crash | vocabulary validated (`1h/2d/1w/3m/1y`, `today`, ISO, `from..to`), failure payload + exit 1 | `08251c0` |
| BUG-5 `api` failures exited 0 | behaviour extracted to `commands/api.ts` and marks failure | `b90871b` |
| BUG-6 list filters ignored | `normalizeListFilter()` maps CLI→core filter shape, multi-tag/limit applied locally | `2393da7` |
| BUG-11 false "extension connected" banner | status awaits the client-proxy mode and names it (also fixes `mode:{}` in JSON) | `10309ba` |
| BUG-8 batch wrapper rejected | validator accepts bare array and `{"commands":[...]}` | `e552015` |
| BUG-9 `git info` printed `undefined` | `isGitAvailable()` distinguishes "git unusable" from "no commits"; empty values print `(none)` | `25760f3` |
| BUG-10 snapshot pollution | defaults ignore `.vscode/codelapse.json`, `.snapshotignore`, `*.backup-*`, `*.codelapse-tmp*` | `b60a45e` |
| files-export absolute path refused | absolute destinations inside the workspace are converted; outside ones refused with the real reason | `0d800da` |
| LOW-1 no short ids | unique prefix/fragment resolves across snapshot and file commands; ambiguous ids list candidates | `9109052` |
| LOW-6 `status` showed `Current snapshot: None` | pointer exposed/persisted, `navigate` records it, `status` reports it | `8ea028a` |
| docs (BUG-7 md, LOW-2, LOW-5) | HELP/API/README/AI_GUIDE aligned with real behaviour | `e701742` |

**Not fixed, deliberately:** LOW-3 (raw core error text on stderr) and LOW-4 (verbose
"not supported in standalone mode" refusals) are cosmetic; changing them would touch
eight command modules for no behavioural gain.

**Still environment-blocked here:** end-to-end `git commit`/`branch`/`checkout`
execution (this sandbox denies child-process spawning from Node, so `git` is
unrunnable and the new code correctly reports "git is not available"), and `watch`
(needs a live extension session).

Re-run everything: `pwsh -File cli-test-sandbox/verify-fixes.ps1` plus
`cd shared; npm run build` → `cd ../cli; npx jest --runInBand`.

---

## 🔴 High-severity bugs

### BUG-1 — Standalone mode wrongly rejected in subfolders (silent dead-end)
`src/standaloneHandler.ts``isStandaloneModeAvailable()` only checks `.git`, `package.json`, `.snapshots`, `tsconfig.json` **in the current directory**, while the actual standalone handler's `findWorkspaceRoot()` walks **up to 10 parent levels** (and also accepts `.vscode`). Result: run the CLI in any subfolder of a project (or any fresh folder under a project root) and standalone is refused, the CLI falls back to IPC, and it dies with *"IPC mode not available - extension not running"* — even though the standalone handler initializes **successfully** and reports the correct workspace root when probed directly.
- Fix: have `isStandaloneModeAvailable()` call/reuse `findWorkspaceRoot()` (or share the same walk-up logic).
- Distillation test: identical probe found workspace root = parent; CLI said "Standalone mode not available".

### BUG-2 — `snapshot delete` reports phantom success for nonexistent IDs
`node cli.js snapshot delete 999` → `{"success":true,"message":"Snapshot 999 deleted successfully"}`, exit 0; the snapshot list is unchanged.
Root cause: `codelapse-core/src/storage/snapshotStorage.ts:274-290` wraps the delete in `if (fs.existsSync(snapshotDir))` and **silently returns when the directory doesn't exist**. The CLI (`unifiedClient.deleteSnapshot`, `commands/snapshot.ts`) never validates existence.
Impact: AI agents and scripts can never trust delete results; a typo'd ID "succeeds".

### BUG-3 — `snapshot show <id> --files` and `--content` always fail
`snapshot show <valid-id> --files` → `{"success":false,"error":"Invalid snapshot ID: must be a non-empty string"}`, even for a valid id.
Root cause: `commands/snapshot.ts:156-167` sends `{ snapshotId: id }`, but `unifiedClient.ts:627-631` for `getSnapshotChanges` reads `payload.id || payload` — `payload.id` is `undefined`, so the **entire payload object is passed as the snapshot ID** and core validation rejects it. Key mismatch (`id` vs `snapshotId`) between command layer and unified client.

### BUG-4 — `filter date` crashes with unhandled exception for non-numeric ranges
`filter date today|week|neverland` → `Fatal error: Invalid time value`, exit 1, no help message.
Root cause: `commands/filter.ts:52-84` `parseDate()` only recognizes `\d+[hdwmy]`; anything else goes to `new Date(str).toISOString()` where `.toISOString()` on an Invalid Date throws `RangeError` — thrown **outside the try/catch**, hitting the global "Fatal error" handler. Even the documented-looking word "today" is accepted-looking input that hard-crashes. Numeric ranges (`2d`) do parse correctly.

### BUG-5 — `api` command never sets the failure exit code
Every failed `api` call prints `{"success":false,...}` but **exits 0** (`api getSnapshot` with bad data, `api makeCoffee`, `api` with malformed `-d` JSON all exit 0).
Root cause: `cli.ts:1108-1121` — the `api` action's catch block prints and returns but **never calls `setFailure()`** (all other command groups do). The post-action hook then computes exit 0.
Impact: breaks the contract document in HELP.md ("exit code is 0 when the JSON payload's success is true and 1 when it is false (verified for 30 command/argument combinations)") — `api` silently violates it.

### BUG-6 — `snapshot list` filters are silently ignored in standalone
- `snapshot list --tags a` → returns **both** snapshots, including ones with empty `tags`.
- `snapshot list --favorites` → returns both non-favorite snapshots.
- `snapshot list --limit 1` → returns all snapshots.
- `snapshot list --since 999y` → **shape changes** (`total` key missing from output JSON).
Root cause: `executeApi` → `getSnapshots(filter)` path passes the filter but the standalone snapshot listing/filtering doesn't apply `tags`/`favorites`/`limit`/`since`. Options are advertised in `--help` and documented in API.md/README (incl. "default: 20/50") but do nothing — invisible failure, exit 0.

---

## 🟠 Medium

### BUG-7 — HELP.md says standalone implements `workspace` — code does not
HELP.md (Command Groups) promises standalone supports "snapshot, config, **workspace**, file and git commit operations". Reality: `workspace state` and `workspace files` fail with *"Method getCurrentState not supported in standalone mode"*. Only `workspace info` works. Doc/code mismatch that will trip the documented AI workflows.

### BUG-8 — `batch` rejects the documented wrapper shape
`batch1.json` = `{"commands":[{"method":"takeSnapshot",...},{"method":"getSnapshots"}]}` → rejected: *"Batch file must contain an array of command objects"*.
A **bare top-level array** (`[{"method":"getSnapshots"}]`) works. The `"commands"` wrapper is natural (and the error message pushes people toward a `{ "%method%": ... }`-looking shape) — if the wrapper was never supported, the schema should be documented once, explicitly. Also note: mixed files with an unknown method are rejected wholesale (no per-command partial-success mode despite README's "Batch operations fail partially" troubleshooting section).

### BUG-9 — `git info` prints empty/`undefined` values instead of failing
In a repo with commits, `git info` prints `Current branch: ` (empty), `Commit hash: undefined`, `Remote URL: undefined`, and `git branches` prints an empty "Branches:" list — while every *other* git command errors with `spawnSync git EPERM` in this sandbox. The info/branches paths **swallow** the same failure and print misleading output rather than an error.
⚪ Note: direct verification of branch/commit/merge commands was blocked in this test environment (sandbox policy denies `spawnSync` of child processes). Static review shows the CLI shells out via `spawnSync`; recommend verifying `git commit/branch/checkout/delete-branch` manually once.

### BUG-10 — Duplicated-file junk accumulates in snapshots
Second snapshot contains `exported.ts`, `cfg.json`, `sample.ts.backup-2026-09-11T09-58-07-945Z` and even `.vscode\codelapse.json` as snapshot content, and previously-captured files decay into `{"baseSnapshotId":"..."}` stubs. Chained restore/export/backup files pollute subsequent snapshots of the same tree. Missing ignore-list for CLI artifacts (`.snapshots`, `*.backup-*`, cfg/test outputs written explicitly).

### BUG-11 — Misleading success banner in standalone mode
`✓ Connected to CodeLapse extension` is printed by `status` even in **standalone** mode (no extension involved). `--verbose` reveals "Using standalone mode". Should say "Standalone mode active" or "connected (standalone)".

---

## 🟡 Low

### LOW-1 — No short-ID support anywhere
`snapshot show/delete/restore 123456` (or timestamp prefix) fails with `Snapshot file not found: ....snapshots\123456\snapshot.json`. Partial/prefix IDs are a de-facto CLI convention for long snapshot IDs and are implied in README examples ("snapshot-123", "dev-config-snapshot", "abc123").

### LOW-2 — `rules test --file` doesn't exist; API.md/README mention `-f, --file <file-path>` in the same area; the real flag is `--path`. Also HELP.md documents `filter date <range>` without ever mentioning the `^(\d+)([hdwmy])$` restriction (see BUG-4).

### LOW-3 — `snapshot delete nope-dir` messages leak internal paths on stderr (`Snapshot file not found: C:\...`) even when `--json` is used (interleaved stdout/stderr pollution of the JSON plane). Fine per docs ("progress on stderr"), but raw core errors are not localized or pretty.

### LOW-4 — `filter favorites/tags/date/file` and `filter favorite/edit-tags/edit-notes/edit-notes/edit-task` are entirely unsupported in standalone (documented), yet they surface their "not supported" only after the command does half its work — one giant untyped error listing 28 method names, repeated 8× through the session.

### LOW-5 — `--silent` produces an *absolutely silent* listing (nothing printed, exit 0) even without `--json`. Not much value over `--json` and can fool scripted pipelines into guessing "0 snapshots".

### LOW-6 — Nothing prints a snapshot's "current" pointer after `snapshot navigate` (status previously showed `Current snapshot: None`; after navigating it does not update visibly), yet `navigate`'s help and `snapshot show` don't expose current-pointer state.

---

## ⚪ Not testable in this environment
- **Actual git commit / branch / checkout / delete-branch / compare** end-to-end (sandbox policy denies child `spawnSync` of `git.exe` — every git command returned `spawnSync git EPERM`). All git **static** paths error-checked out; full behavioral test pending in an unrestricted shell.
- **`watch`** (long-running; requires a running extension session to deliver events). Verify manually: `codelapse watch --events changes,snapshots,workspace`.
- **IPC-mode behaviors** (search, analyze, chunk, semantic index, rules, diagnostics) — no extension running in this test run; their standalone rejection messages are correct and consistent (exit 1), matching HELP.md's list except "workspace" (see BUG-7).

---

## What works (verified)
| Area | Observations |
|---|---|
| `--version`, `--help`, all 16 group helps | exit 0, correct usage text |
| `snapshot create` | creates snapshot, tags/notes honored |
| `snapshot list` (no filters) | output matches `--json` schema |
| `snapshot restore` (plain) | success, exit 0 |
| `snapshot compare` (incl. `--files`) | correct added/deleted/modified summary, exit 0 |
| `snapshot navigate previous/next` | works; bogus direction validated (`Direction must be "previous" or "next"`, exit 1) |
| `files list/show/history/export/restore` | all correct incl. proper file-not-found error (`exit 1`) and `.backup` file by `restore`; `files export` blocks path traversal yet still writes a relative path (yes -- allowed relative) |
| `config get/set/reset/list/validate/export/import` | correct, incl. reject unknown key (`Invalid configuration key path`, exit 1), type validation (`expects number, received string`, exit 1), import of malformed JSON (exit 1), exported sensitive values redacted |
| `api` (standalone-supported methods) | `api getStatus` / `api getSnapshots` / `api getSnapshot -d '{"id": ...}'` all work |
| `batch` (bare-array format) | executes and reports per-command results |
| Global `--json`, `--silent` | JSON is pure on stdout; warnings correctly on stderr for most paths |
| Error/usage handling | unknown command & missing args → exit 1 with brief message |

## Test-suite status
- `cli` jest suite: **12 suites / 137 tests, all pass** (~6 s). Coverage gaps: no test that standalone `getSnapshots` honors tags/favorites/limit/since (BUG-6); no test that `deleteSnapshot` on a missing ID errors (BUG-2); no standalone-mode integration test that walks a subfolder workspace root (BUG-1); no test that `snapshot show --files/--content` round-trips (BUG-3); no test of `filter date` vocabulary (BUG-4) or `api` exit codes (BUG-5).

## Recommended fix order
1. BUG-6 (silent wrong results) — highest agent-facing risk.
2. BUG-2 (phantom delete success).
3. BUG-1 (standalone fallback dead-end).
4. BUG-5 (api exit codes) — one missing `setFailure()`.
5. BUG-3 + BUG-4 — small, isolated fixes (payload key + guard in parseDate).
6. BUG-7…LOW-6 — docs & polish pass after behavior converges.
