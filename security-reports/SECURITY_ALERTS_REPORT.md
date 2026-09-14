# GitHub Security Alerts — `YukioTheSage/code-snapshots`

**Remediation status report.** Both alert surfaces were re-fetched from the GitHub REST
API on **2026-09-14 00:21 UTC** (`state=open`) after Tasks 1–7 of the security-alert
remediation were committed to `fix/security-alert-remediation`.

> **Post-merge result: code scanning is 0, Dependabot is 10, and CI on `main` is green.**
> Everything below was written *before* the merge, when both surfaces still reported their
> pre-merge state; it is kept as the analysis of record. The outcome, and the one prediction
> this document got wrong, are recorded under "Post-merge result" immediately below.

| | |
| --- | --- |
| Repository | `YukioTheSage/code-snapshots` |
| Analysis branch | `fix/security-alert-remediation` @ `fa9afb3` (gate results at `33022ec`) |
| Merge base | `17b7586` (merge of PR #5) |
| Merged and pushed | `6b722ca`, follow-up `ee5233b` |
| **Code scanning, open now** | **0** (was 9) |
| **Dependabot, open now** | **10** (was 78) — the accepted residual of §3 |

## Post-merge result

Numbers taken from the API after the push, not from the predictions below.

| Surface | Before | After | How it closed |
| --- | ---: | ---: | --- |
| Code scanning | 9 open | **0 open** | `#1`–`#3` permissions, `#4` ReDoS, `#6` comment terminator, `#7`–`#9` prototype, and `#5` plus the re-raised `#10`–`#12` by the follow-up commit |
| Dependabot | 78 open | **10 open** | 66 by the Task 7 lockfile refresh, 2 by the Task 6 `uuid` removal, 0 introduced |
| CI on `main` | — | green | all three jobs: `extension`, `shared`, `cli` |

### The prediction this document got wrong

Two of the four findings it called *hardening* did **not** close on the first merge, and the
reason is the same for both: the analyser does not follow a check into another function, and it
models a **bounded** value rather than a **rejected** one.

- `js/resource-exhaustion` (`#5`) survived the `throw`-guard added at the sink in `withTimeout`.
  It closed only once the delay handed to `setTimeout` was also clamped with `Math.min`.
- `js/prototype-polluting-assignment` (`#10`–`#12`) survived the `assertSafeKeySegment` calls,
  and were re-raised at the new line numbers. They closed once the three names were compared
  inline ahead of the writes.

So "move the guard to the sink" was necessary but not sufficient: the guard must be in the same
function **and** in a form the query models. `#5` satisfied the first condition and not the
second. Both were fixed in `ee5233b`, whose verification is why this section exists rather than
an assumption that they had closed.

### A test that had never run caught a real defect

Adding the `shared` Test step to CI — the gap §7.1 proposes closing — failed on its **first**
run, on a pre-existing test: `pathSecurityRoots.test.ts` built its root as
`` `C:${path.sep}proj` ``, which is absolute on Windows and a *relative* path on POSIX, so
`path.resolve` anchored it to the working directory and containment correctly refused. It had
passed for years because the suite never executed in CI. The fixtures are now built per
platform, and CI is green.



## 1. What the API returns today

```powershell
pwsh -File security-reports/fetch-github-alerts.ps1 -State open
```

| Surface | Total | Critical | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dependabot alerts | 78 | 1 | 39 | 29 | 9 |
| Code scanning alerts | 9 | — | 3 | 6 | 0 |

Every one of the 87 alerts reports `state: open`; none carries an `auto_dismissed_at`.
Of the 78 Dependabot alerts, 9 are `dependency.relationship: direct` and 69 are
`transitive`, spread across three lockfiles: `package-lock.json` 51,
`cli/package-lock.json` 18, `shared/package-lock.json` 9.

### Why a re-fetch after the fixes looks unchanged

This is the single most easily misread result in the document, so it is stated separately:

- Every code-scanning alert carries `most_recent_instance.ref: refs/heads/main`. The
  alerts are not describing this branch at all.
- The seven commits on this branch are not ancestors of `main` —
  `git merge-base --is-ancestor a8ed9c3 main` exits 1 — so `main` still contains the
  vulnerable code the alerts point at.
- The alert set is unchanged from the payload archived before the remediation commits were
  written. Three of the four files (`dependabot-open.json`, `dependabot-open.csv`,
  `code-scanning-open.csv`) are byte-identical to that capture. The fourth,
  `code-scanning-open.json`, differs in exactly one field: every alert's
  `most_recent_instance.commit_sha` now reads `b584bef` — the current tip of `main` — where
  the archived capture recorded `c2c717c`, the previous tip, because CodeQL re-analysed
  `main` after PR #6 landed. No alert number, `state`, `ref`, `location`, `message` or
  severity changed: the analysis that produced the alert set moved, the set itself did not.
  Current SHA-256 (first 8 bytes): `CD1BDB5F2179EE9A` (`dependabot-open.json`),
  `CEFB77D37EE6505F` (`code-scanning-open.json`), `5D7CA19139B5C853`
  (`dependabot-open.csv`), `D3D00C841DE7F62A` (`code-scanning-open.csv`).

An unchanged count here means "not merged yet", never "not fixed".

## 2. Code scanning — 9 of 9 have committed fixes, closure needs the merge

All nine findings have a fix committed on this branch. GitHub is expected to close them on
the next CodeQL run against `main` after the merge — §6 is where that gets confirmed, and
nothing closes before it. The right-hand column is the current GitHub state, which is `open`
for all nine.

| Alert(s) | Severity | Rule | Location | Fix commit | Status |
| ---: | --- | --- | --- | --- | --- |
| [#1](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/1) [#2](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/2) [#3](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/3) | medium | `actions/missing-workflow-permissions` | `.github/workflows/ci.yml:22`, `:44`, `:109` | `a8ed9c3` — workflow-level `permissions: contents: read` | Open at `refs/heads/main` |
| [#6](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/6) | high | `js/bad-tag-filter` | `src/services/codeChunker.ts:1036` | `c067386` — `blockCommentEndRegex` is now `/--!?>/`, so it matches `-->` and `--!>` | Open at `refs/heads/main` |
| [#4](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/4) | high | `js/polynomial-redos` | `shared/src/utils/gitignoreParser.ts:16` | `84dc7ba` — normaliser, no backtracking regex | Open at `refs/heads/main` |
| [#5](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/5) | high | `js/resource-exhaustion` | `src/services/cliConnectorService.ts:156` | `1f75c8b` — the inline guard at `cliConnectorService.ts:157` rejects a delay above the 2^31-1 timer ceiling at the sink | Open at `refs/heads/main` |
| [#7](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/7) [#8](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/8) [#9](https://github.com/YukioTheSage/code-snapshots/security/code-scanning/9) | medium | `js/prototype-pollution-utility`, `js/prototype-polluting-assignment` | `shared/src/config/configManager.ts:98`, `:103` | `c1dc541` — `assertSafeKeySegment` guard | Open at `refs/heads/main` |

Reachability is recorded so that a hardening change is not mistaken for a live exploit:

- **#1/#2/#3 — reachable.** `ci.yml` had no `permissions:` block, so the token carried the
  repository default. It now declares `permissions: contents: read` at workflow level.
- **#6 — reachable; a real correctness bug.** A comment closed with `--!>` never closed, so
  the comment ratio was inflated. The fix is behavioural, not defensive.
- **#4 — reachable, low impact.** The input is the user's own `snapshotLocation` setting.
- **#5 — not reachable; hardening only.** `assertValidTimeout` already guards both handlers
  before all four `withTimeout` calls.
- **#7/#8/#9 — not reachable; hardening only.** `setNested` → `assertValidKeyPath` →
  `hasOwnProperty.call(this.configSchema, keyPath)` already refused `__proto__`, because it
  is not a schema key. The new guard makes the writer self-sufficient rather than relying
  on a check in another function that CodeQL cannot follow.

## 3. Dependabot — offline evaluation of the dependency work

### Method

GitHub cannot confirm this work before the merge, so the dependency refresh was evaluated
offline: for each of the 78 open alerts, intersect the alert's
`security_vulnerability.vulnerable_version_range` with the version actually installed in
the lockfile the alert names (`dependency.manifest_path`). An alert whose range no longer
matches any installed version has nothing left to fix.

**Range syntax, and why it is normalised.** Dependabot's ranges use a comma form that npm
`semver` silently rejects: `semver.validRange('>= 4.0.0, <= 4.17.23')` returns `null`, so
`semver.satisfies('4.17.21', '>= 4.0.0, <= 4.17.23')` returns **false** rather than throwing —
and a range that matches nothing reads as "patched". **38 of the 78 payload ranges use that
form.** Every range was therefore normalised (`,` → space) before evaluation. A reader
re-implementing this method must normalise the same way, or the residual set below is
under-reported.

**Bound on this method.** It is limited to the advisory snapshot already pinned in this
data. It cannot see a newly published advisory, and it measures "is a vulnerable version
still installed", not "has GitHub closed the alert". GitHub remains the authority, and
GitHub reports against `main` (§6).

### Result

| Offline evaluation step | Count |
| --- | ---: |
| Open alerts reported by the API | 78 |
| Alerts whose range still matched an installed version before the Task 7 refresh | 76 |
| Alerts already cleared by the `uuid` removal (Task 6) — `#13`, `#111` | 2 |
| Alerts the refresh left no installed vulnerable version for | 66 |
| Alerts the refresh introduced | **0** |
| **Alerts still matching an installed version** | **10** |

Of the 68 alerts whose range no longer matches anything installed, 66 are accounted for by
the lockfile refresh and 2 are the `uuid` alerts (`#13` in `cli/package-lock.json`, `#111`
in `shared/package-lock.json`) cleared earlier by removing the unused dependency. GitHub has
closed none of them: the alerts are still open, because the evaluation is against `main`.

### The 9 direct alerts — no installed vulnerable version left

These are the alerts that were actionable at the manifest level. The offline evaluation
finds no vulnerable version installed for any of them; the live API still reports them
open because they are evaluated against `main`.

| # | Severity | Package | Manifest | Vulnerable | Fixed in |
| ---: | --- | --- | --- | --- | --- |
| [15](https://github.com/YukioTheSage/code-snapshots/security/dependabot/15) | high | `ws` | `cli/package-lock.json` | `>= 8.0.0, < 8.21.0` | `8.21.0` |
| [104](https://github.com/YukioTheSage/code-snapshots/security/dependabot/104) | high | `minimatch` | `shared/package-lock.json` | `>= 10.0.0, < 10.2.1` | `10.2.1` |
| [106](https://github.com/YukioTheSage/code-snapshots/security/dependabot/106) | high | `minimatch` | `shared/package-lock.json` | `>= 10.0.0, < 10.2.3` | `10.2.3` |
| [108](https://github.com/YukioTheSage/code-snapshots/security/dependabot/108) | high | `minimatch` | `shared/package-lock.json` | `>= 10.0.0, < 10.2.3` | `10.2.3` |
| [12](https://github.com/YukioTheSage/code-snapshots/security/dependabot/12) | medium | `ws` | `cli/package-lock.json` | `>= 8.0.0, < 8.20.1` | `8.20.1` |
| [13](https://github.com/YukioTheSage/code-snapshots/security/dependabot/13) | medium | `uuid` | `cli/package-lock.json` | `< 11.1.1` | `11.1.1` |
| [111](https://github.com/YukioTheSage/code-snapshots/security/dependabot/111) | medium | `uuid` | `shared/package-lock.json` | `< 11.1.1` | `11.1.1` |
| [36](https://github.com/YukioTheSage/code-snapshots/security/dependabot/36) | low | `diff` | `package-lock.json` | `>= 5.0.0, < 5.2.2` | `5.2.2` |
| [102](https://github.com/YukioTheSage/code-snapshots/security/dependabot/102) | low | `diff` | `shared/package-lock.json` | `>= 5.0.0, < 5.2.2` | `5.2.2` |

### The 10 remaining alerts — accepted residual

All 10 are `transitive`, all sit in the root `package-lock.json`, and all 10 are held
there deliberately (§4.1).

| Alert(s) | Severity | Package | Vulnerable range | Floor | Scope | Why it stays |
| ---: | --- | --- | --- | --- | --- | --- |
| #37, #38 | medium | `lodash`, `lodash-es` | `>= 4.0.0, <= 4.17.22` | 4.17.23 | runtime | `java-parser@2.3.4` pins lodash `4.17.21` exactly; the chevrotain family pins lodash-es `4.17.21` exactly |
| #62, #63 | medium | `lodash`, `lodash-es` | `<= 4.17.23` | 4.18.0 | runtime | same exact pins block the 4.18.0 line |
| #64, #65 | high | `lodash`, `lodash-es` | `>= 4.0.0, <= 4.17.23` | 4.18.0 | runtime | same exact pins block the 4.18.0 line |
| #67 | medium | `uuid` | `< 11.1.1` | 11.1.1 | runtime | `gaxios@6.7.1` requires `uuid ^9.0.1` |
| #73 | medium | `markdown-it` | `<= 14.1.1` | 14.2.0 | development | `vsce@2.15.0` requires `markdown-it ^12.3.2`; dev-only |
| #86 | high | `linkify-it` | `<= 5.0.1` | 5.0.2 | development | `markdown-it@12.3.2` requires `linkify-it ^3.0.1`; dev-only |
| #26 | medium | `xml2js` | `< 0.5.0` | 0.5.0 | development | `vsce@2.15.0` requires `xml2js ^0.4.23`; dev-only |

Floors are quoted from the alert payload: the lodash/lodash-es floors for #37/#38 are
**4.17.23** (`>= 4.0.0, <= 4.17.22`), not 4.18.0 — the ruling is unchanged either way,
because `java-parser` and the chevrotain family pin the installed lodash and lodash-es at
`4.17.21` exactly and an override would have to cross those pins.

## 4. Accepted residual, and the limits of the local evidence

### 4.1 No `overrides` were added — deviation ratified

The dependency step contemplated forcing the residual packages up with npm `overrides`.
None were added, and the controller has **ratified that deviation** rather than leaving the
residual list silently contradicting the plan. The evidence behind the ruling:

- **Every blocking ancestor pins an exact version or a major line an override would cross.**
  `java-parser@2.3.4` pins lodash `"4.17.21"` exactly; `chevrotain`, `@chevrotain/gast` and
  `@chevrotain/cst-dts-gen@11.0.3` pin `lodash-es "4.17.21"` exactly; `gaxios@6.7.1`
  declares `uuid ^9.0.1` against a floor of 11.1.1; `vsce@2.15.0` declares
  `markdown-it ^12.3.2` and `xml2js ^0.4.23`; `markdown-it@12.3.2` declares
  `linkify-it ^3.0.1`.
- **The flagged code paths were checked and are unreachable.** `java-parser` imports only
  `lodash/findLast.js` (`node_modules/java-parser/src/comments.js:1`) and
  `lodash/camelCase.js` (`src/tokens.js:2`); an exhaustive grep for `unset|omit|template(`
  across the chevrotain family returns 0 matches; gaxios's only `uuid` call site is `v4()`
  (`build/src/gaxios.js:417`), and the advisory covers the `buf` bounds check in v3/v5/v6,
  which `v4()` does not use.
- **Three of the six packages never ship.** `markdown-it`, `linkify-it` and `xml2js` are
  `dependency.scope: development` behind `vsce`, the packaging tool.
- The Task 7 report's remark that "all 27 lodash-es import statements" were checked was an
  undercount: it is ~31 unique brace-import statements plus 9 per-method `lodash-es/x.js`
  imports. The conclusion is unaffected — the exhaustive grep above finds no `unset`,
  `omit` or `template` usage anywhere.

### 4.2 Shipped-surface moves in the refresh — a stated limit

The lockfile refresh moved 32 entries that are not dev-only. Derivation: for each lockfile,
compare `git show 1da0b28:<lockfile>` with `git show 33022ec:<lockfile>` and take every entry
added, removed, or whose `version` changed, and which the lockfile does not mark `dev: true`.

- `package-lock.json` — 16: `zod` 3.24.3→3.25.76, `zod-to-json-schema` 3.24.5→3.25.2,
  `web-tree-sitter` 0.25.3→0.25.10, `@google/generative-ai` 0.24.0→0.24.1, `agent-base`
  7.1.3→7.1.4, `bignumber.js` 9.3.0→9.3.1, `debug` 4.4.0→4.4.3, `balanced-match`
  1.0.2→4.0.4, `brace-expansion` 1.1.11→5.0.9, `diff` 5.2.0→5.2.2, `java-parser`
  2.3.3→2.3.4, `jwa` 2.0.0→2.0.1, `jws` 4.0.0→4.0.1, `ws` 8.18.1→8.21.3, plus two
  nested duplicates removed when the same hoist moved them to the root
  (`minimatch/node_modules/balanced-match` 4.0.4 and
  `minimatch/node_modules/brace-expansion` 5.0.9).
- `cli/package-lock.json` — 10: `chardet` 0.7.0→2.2.0, `iconv-lite` 0.4.24→0.7.3,
  `lodash` 4.17.21→4.18.1, `ws` 8.18.3→8.21.3, `inquirer` 8.2.6→8.2.7, `@types/node`
  20.19.7→20.19.43, `@inquirer/external-editor` added at 1.0.3, and three removals:
  `external-editor` 3.1.0, `os-tmpdir` 1.0.2, `tmp` 0.0.33.
- `shared/package-lock.json` — 6: `minimatch` 10.1.1→10.2.6, `balanced-match` 1.0.2→4.0.4,
  `brace-expansion` 2.0.2→5.0.9, `diff` 5.2.0→5.2.2, and two removals:
  `@isaacs/balanced-match` 4.0.1, `@isaacs/brace-expansion` 5.0.0.

Each is the version npm resolved against the ranges its dependents declare. The rest of the
churn is dev-only and does not ship: a further 232 entries in `package-lock.json`, 55 in
`cli/package-lock.json` and 8 in `shared/package-lock.json`.

Of the entries above, `web-tree-sitter` is the only package this repository imports directly
(`src/services/codeChunker.ts:4`), and its only call site is a guarded stub that falls back to
regex (`src/services/codeChunker.ts:131-141`). No source file imports `zod`, `zod-to-json-schema`
or `ws`; the remaining entries moved as transitive dependencies of packages the extension does
import — `@google/genai` (`src/services/embeddingService.ts:1`), `@pinecone-database/pinecone`
(`src/services/vectorDatabaseService.ts:1`), `java-parser` (`src/services/codeChunker.ts:3`),
`diff` (`src/snapshotDiff.ts:1`) and `minimatch` (`src/utils/pathMatching.ts:1`). The derivation
above enumerates lockfile entries, which is a wider set than the imported surface.

**Limit of this evidence:** `npm run compile` cannot run in this sandbox (§5.3), so no
bundle was emitted locally and the bundle's behaviour is verified in CI only. The local
gate covers type-checks, lint, formatting and the three test suites — not the built
artifact.

### 4.3 Install scripts suppressed during dependency work

Every npm command in this work ran with `--ignore-scripts`. That suppressed install scripts
for `esbuild@0.25.12`, `fsevents@2.3.3` and `keytar@7.9.0`. `keytar` arrives via
`vsce ^7.7.0`, is development-only, and is referenced by no gated test.

## 5. Gate results on this branch

Every command below was run on `33022ec`. Counts are from these runs.

| Command | Result | Counts |
| --- | --- | --- |
| `npx jest --runInBand --forceExit` (extension) | PASS, exit 0 | 99/99 suites, 764/764 tests, 55.3 s |
| `npx jest --runInBand` (from `shared/`) | PASS, exit 0 | 13/13 suites, 68/68 tests, 5.1 s |
| `npm run test:ci` (from `cli/`) | 2 suites fail, exit 1 | 38/40 suites passed, 289/302 tests passed; all 13 failures are the known `spawnSync git EPERM` boundary (§5.2) |
| `npm run lint` | PASS, exit 0 | 449 problems: **0 errors, 449 warnings** (budget is 0 errors / ≤ 449 warnings) |
| `npm run lint:budget` | PASS, exit 0 | 1/1 test — "does not exceed the recorded warning ceiling" |
| `npm run format:check` | PASS, exit 0 | all matched files use Prettier code style |
| `npm run format:check` (from `cli/`) | PASS, exit 0 | all matched files use Prettier code style |
| `npm run check-types` | PASS, exit 0 | `tsc --noEmit` clean |
| `npm run check-types` (from `cli/`) | PASS, exit 0 | `tsc --noEmit` clean |
| `npm run check-types:test` (from `cli/`) | PASS, exit 0 | `tsc -p tsconfig.test.json --noEmit` clean |
| `npm run build` (from `shared/`) | PASS, exit 0 | `rimraf dist && tsc`, 64 files emitted |
| `npm run build` (from `cli/`) | PASS, exit 0 | `tsc` clean |
| `npm run compile` | **blocked by the sandbox**, exit 1 | `check-types` passes; `node esbuild.js` dies with `spawn EPERM` (§5.3) |

### 5.2 The 13 CLI failures are one sandbox boundary, by name

Both failing suites and all 13 failing tests were compared **by name**, not by count. They
are exactly the `standaloneGitCompare` and `standaloneGitCommit` suites, and every failure
carries the identical error `spawnSync git EPERM` — the sandbox denies the piped stdio
those tests need to shell out to a real `git`:

- `standalone compareSnapshotWithGitCommit`: "classifies added, modified and deleted files
  against a real commit"; "omits per-file line counts when includeFileList is false";
  "reads the commit it was given, not the working tree"; "resolves an abbreviated commit
  hash to the same tree"; "rejects a malformed hash before reading anything, with the
  integration's own message"; "skips a file the store cannot reconstruct instead of
  guessing"; "names the snapshot that does not exist".
- `standalone git commit from a snapshot`: "refuses to write over a dirty working tree";
  "removes files the snapshot records as deleted"; "leaves untracked files out of the
  commit by default"; "includes untracked files when asked"; "refuses over untracked
  clutter, because git status counts it"; "commits onto a branch it creates when asked".

No other suite or test failed, so nothing in this list is a regression from these fixes.
These tests do run in CI on a normal runner.

### 5.3 `npm run compile` is a sandbox boundary, not a branch failure

`compile` is `npm run check-types && node esbuild.js`. The type-check step passes. The
bundle step fails inside esbuild:

```
Error: spawn EPERM
    at ChildProcess.spawn (node:internal/child_process:458:11)
    at ensureServiceIsRunning (.../node_modules/esbuild/lib/main.js:1978:29)
    at Object.context (.../node_modules/esbuild/lib/main.js:1877:33)
    at main (.../esbuild.js:7:29)
  errno: -4048, code: 'EPERM', syscall: 'spawn'
```

esbuild's Node API starts its native service with piped stdio, which this sandbox denies to
every program. The binary itself is present and healthy, so the fault is the environment
rather than the branch:

- `node -p "require('./node_modules/esbuild/package.json').version"` → `0.25.12`
- `node_modules/@esbuild/win32-x64/esbuild.exe` exists (10,617,344 bytes)
- running it directly prints `0.25.12` and exits 0

`dist/extension.js` is therefore not produced locally; bundle verification is CI-only. The
same boundary is why every npm command in this work passes `--ignore-scripts`: the root
`npm ci` postinstall spawns a process with piped stdio and fails the same way.

## 6. What still has to happen — the owner's verification step

Nothing above closes by itself. Closure happens when this branch reaches `main` and the
next CodeQL run and Dependabot re-scan evaluate it there.

Merge facts as of `33022ec`:

- This branch is 7 commits ahead of the merge base `17b7586`; `main` has meanwhile advanced
  6 commits to `b584bef`, so the merge is not a fast-forward.
- Both sides touch `src/services/cliConnectorService.ts`. A trial merge is clean —
  `git merge-tree --write-tree HEAD main` exits 0 — but a clean textual merge is not a
  substitute for CI on the merged tree, and the gate results in §5 were recorded on this
  branch, not on a merged result.

After the merge, run exactly these:

```powershell
gh api "repos/YukioTheSage/code-snapshots/code-scanning/alerts?state=open&per_page=100" --jq 'length'
```

```powershell
gh api "repos/YukioTheSage/code-snapshots/dependabot/alerts?state=open&per_page=100" --jq 'length'
```

`per_page=100` is load-bearing on the Dependabot call: the default page is 30, so `length`
would report `30` for any total above it and read as a pass.

**Then re-run `pwsh -File security-reports/fetch-github-alerts.ps1 -State open -OutDir <scratch>`**
with `-OutDir` pointed at a scratch directory, and read the new §1 from the copy written there.
Do not run it without `-OutDir`: the script rewrites the whole document, so a default run would
replace this report with the generator's plain listing (§8). Expected after the merge and the next
CodeQL run:

- Code scanning: **0** open alerts. Alert **#6** is the one with no documented fallback if it
  survives that run anyway: #5 keeps both the caller-side `assertValidTimeout` check and the
  inline guard at the sink (`cliConnectorService.ts:157`), while the `--!>` fix is a single
  behavioural change with no second lever. Record a surviving #6 here with its alert number and
  re-open the task — it is not a dismissal candidate.
- Dependabot: the **10** accepted residual alerts of §3.
- Any alert that survives a fix demonstrably on `main` is **not** to be dismissed as
  cleanup: record it here with its alert number and re-open the task. Dismissal is an owner
  decision.

## 7. Follow-ups outside this remediation

Recorded so they are not lost, not fixed here:

1. **`shared/`'s 13 test suites did not run in CI.** The `shared` job in
   `.github/workflows/ci.yml` ran `npm ci`, `npx tsc --noEmit` and `npm run build`, with
   no jest step, and all three jest configs root at their own `src`
   (`jest.config.js`, `cli/jest.config.js`, `shared/jest.config.js` all set
   `roots: ['<rootDir>/src']`). Three of this remediation's regression tests were therefore
   local-only: `shared/src/__tests__/noUnusedUuidDependency.test.ts`,
   `shared/src/config/__tests__/configManager.setNestedProtoGuard.test.ts`,
   `shared/src/utils/__tests__/gitignoreParser.snapshotLocation.test.ts`.
   **Resolved in the final fix wave:** the job now installs the root toolchain, because jest
   and ts-jest live in the root package, and runs `npx jest --runInBand --ci` — so all three
   are gates from this branch onward.
2. **`@types/vscode` had drifted ahead of the declared engine.** It resolved to `1.137.0`
   from the declared `^1.85.0`, while `engines.vscode` stays `^1.85.0` (root
   `package.json:28`). `vsce`'s compatibility check reads the declared range, so nothing
   caught the extension being type-checked against a newer API surface than it claims to
   support. **Resolved in the final fix wave:** `@types/vscode` is pinned to `1.85.0` exactly
   and the root lockfile resolves that version again, so `tsc` rejects an API newer than the
   declared floor.
3. **`shared/README.md` listed `uuid` under its Dependencies heading**, although Task 6
   removed the dependency. **Resolved in the final fix wave:** the line is gone, leaving
   `minimatch` and `diff`, which is what `shared/package.json` declares.
4. **`ConfigManager.getNested` validates nothing.** `shared/src/config/configManager.ts:150`
   guards only empty or non-string input and then walks `current[key]`, so
   `getNested('__proto__')` returns `Object.prototype`. It is a read, it is outside the
   alerts fixed here (those were about assignment), and it is recorded so reads can be
   considered separately.
5. **`ws` and `@google/generative-ai` are declared but imported nowhere.** `ws` is declared at
   `cli/package.json:63` (with `@types/ws` at `:67`) and `@google/generative-ai` at
   `package.json:667`; no `.ts` or `.js` file outside `node_modules` imports either, and the
   code uses `@google/genai` instead (`src/services/embeddingService.ts:1`). This is the same
   class of declaration Task 6 removed for `uuid`. It was left in place deliberately: deleting
   them closes no alert (#15 and #12 already close through the 8.21.3 `ws` bump) and would
   rewrite lockfiles that have already been verified, so the finding is recorded rather than
   acted on in this branch.
6. **Alert #6 has no documented fallback if it survives on `main`.** §6 records the
   post-merge expectation and the reason: unlike #5, the `--!>` fix is a single change with no
   contingency behind it, so a survivor needs its own task rather than a dismissal.

## 8. Data files and regeneration

Committed alongside this report:

- `security-reports/fetch-github-alerts.ps1` — the fetch and report generator.

Generated by that script and deliberately **not** committed, because this report already
carries every row and the raw JSON is ~580 KB of regenerable snapshot
(`.gitignore`: `security-reports/*.json`, `security-reports/*.csv` — every `-State` value,
not only `open`):

- `security-reports/dependabot-open.json` / `.csv` — 78 alerts
- `security-reports/code-scanning-open.json` / `.csv` — 9 alerts

Regenerate all of it with:

```powershell
pwsh -File security-reports/fetch-github-alerts.ps1 -Repo YukioTheSage/code-snapshots -State open
```

Pass `-State auto_dismissed`, `-State fixed`, or `-State all` for the other buckets.
Dependabot endpoints require admin/security access to the repository; code scanning returns
404 when the feature is not enabled on the repository. Regenerating overwrites this file
with the generator's plain listing, so re-apply the surrounding analysis afterwards.

### Integrity check of the alert appendix

The appendix was machine-checked against `security-reports/dependabot-open.json`:

| Check | Result |
| --- | --- |
| Rows matching the alert-row pattern in the whole document | 87 (78 appendix rows + the 9 rows of §3) |
| Alerts in the JSON | 78 |
| Alert rows in the appendix | 78 |
| Duplicate alert numbers in the appendix | 0 |
| Alert numbers missing from the appendix | 0 |
| Alert numbers in the appendix that the JSON does not have | 0 |

### Appendix — all 78 open alerts

Every alert GitHub reports as open at `refs/heads/main` after the remediation commits, with
the alert's own package, manifest, relationship and patched floor.

| # | Sev | Package | Manifest | Relation | Fixed in | Advisory |
| ---: | --- | --- | --- | --- | --- | --- |
| [70](https://github.com/YukioTheSage/code-snapshots/security/dependabot/70) | critical | `shell-quote` | `package-lock.json` | transitive | `1.8.4` | shell-quote quote() does not escape newlines in object .op values |
| [6](https://github.com/YukioTheSage/code-snapshots/security/dependabot/6) | high | `minimatch` | `cli/package-lock.json` | transitive | `3.1.3` | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| [11](https://github.com/YukioTheSage/code-snapshots/security/dependabot/11) | high | `lodash` | `cli/package-lock.json` | transitive | `4.18.0` | lodash vulnerable to Code Injection via `_.template` imports key names |
| [14](https://github.com/YukioTheSage/code-snapshots/security/dependabot/14) | high | `tmp` | `cli/package-lock.json` | transitive | `0.2.6` | tmp has Path Traversal via unsanitized prefix/postfix that enables directory escape |
| [15](https://github.com/YukioTheSage/code-snapshots/security/dependabot/15) | high | `ws` | `cli/package-lock.json` | direct | `8.21.0` | ws: Memory exhaustion DoS from tiny fragments and data chunks |
| [18](https://github.com/YukioTheSage/code-snapshots/security/dependabot/18) | high | `brace-expansion` | `cli/package-lock.json` | transitive | `1.1.16` | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| [19](https://github.com/YukioTheSage/code-snapshots/security/dependabot/19) | high | `js-yaml` | `cli/package-lock.json` | transitive | `3.15.0` | js-yaml: YAML merge-key chains can force quadratic CPU consumption |
| [22](https://github.com/YukioTheSage/code-snapshots/security/dependabot/22) | high | `js-yaml` | `cli/package-lock.json` | transitive | `3.15.1` | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| [23](https://github.com/YukioTheSage/code-snapshots/security/dependabot/23) | high | `browserslist` | `cli/package-lock.json` | transitive | `4.28.7` | Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) |
| [25](https://github.com/YukioTheSage/code-snapshots/security/dependabot/25) | high | `js-yaml` | `cli/package-lock.json` | transitive | `3.15.2` | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| [27](https://github.com/YukioTheSage/code-snapshots/security/dependabot/27) | high | `tar-fs` | `package-lock.json` | transitive | `2.1.3` | tar-fs can extract outside the specified dir with a specific tarball |
| [30](https://github.com/YukioTheSage/code-snapshots/security/dependabot/30) | high | `tar-fs` | `package-lock.json` | transitive | `2.1.4` | tar-fs has a symlink validation bypass if destination directory is predictable with a specific tarball |
| [33](https://github.com/YukioTheSage/code-snapshots/security/dependabot/33) | high | `jws` | `package-lock.json` | transitive | `4.0.1` | auth0/node-jws Improperly Verifies HMAC Signature |
| [47](https://github.com/YukioTheSage/code-snapshots/security/dependabot/47) | high | `minimatch` | `package-lock.json` | transitive | `9.0.7` | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| [48](https://github.com/YukioTheSage/code-snapshots/security/dependabot/48) | high | `minimatch` | `package-lock.json` | transitive | `5.1.8` | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| [49](https://github.com/YukioTheSage/code-snapshots/security/dependabot/49) | high | `minimatch` | `package-lock.json` | transitive | `3.1.3` | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| [53](https://github.com/YukioTheSage/code-snapshots/security/dependabot/53) | high | `undici` | `package-lock.json` | transitive | `6.24.0` | Undici: Malicious WebSocket 64-bit length overflows parser and crashes the client |
| [57](https://github.com/YukioTheSage/code-snapshots/security/dependabot/57) | high | `flatted` | `package-lock.json` | transitive | `3.4.2` | Prototype Pollution via parse() in NodeJS flatted |
| [64](https://github.com/YukioTheSage/code-snapshots/security/dependabot/64) | high | `lodash` | `package-lock.json` | transitive | `4.18.0` | lodash vulnerable to Code Injection via `_.template` imports key names |
| [65](https://github.com/YukioTheSage/code-snapshots/security/dependabot/65) | high | `lodash-es` | `package-lock.json` | transitive | `4.18.0` | lodash vulnerable to Code Injection via `_.template` imports key names |
| [69](https://github.com/YukioTheSage/code-snapshots/security/dependabot/69) | high | `tmp` | `package-lock.json` | transitive | `0.2.6` | tmp has Path Traversal via unsanitized prefix/postfix that enables directory escape |
| [71](https://github.com/YukioTheSage/code-snapshots/security/dependabot/71) | high | `ws` | `package-lock.json` | transitive | `8.21.0` | ws: Memory exhaustion DoS from tiny fragments and data chunks |
| [81](https://github.com/YukioTheSage/code-snapshots/security/dependabot/81) | high | `brace-expansion` | `package-lock.json` | transitive | `1.1.16` | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| [82](https://github.com/YukioTheSage/code-snapshots/security/dependabot/82) | high | `brace-expansion` | `package-lock.json` | transitive | `2.1.2` | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| [83](https://github.com/YukioTheSage/code-snapshots/security/dependabot/83) | high | `js-yaml` | `package-lock.json` | transitive | `3.15.0` | js-yaml: YAML merge-key chains can force quadratic CPU consumption |
| [84](https://github.com/YukioTheSage/code-snapshots/security/dependabot/84) | high | `js-yaml` | `package-lock.json` | transitive | `4.3.0` | js-yaml: YAML merge-key chains can force quadratic CPU consumption |
| [85](https://github.com/YukioTheSage/code-snapshots/security/dependabot/85) | high | `shell-quote` | `package-lock.json` | transitive | `1.9.0` | shell-quote: Quadratic-complexity Denial of Service in `parse()` (CWE-407) |
| [86](https://github.com/YukioTheSage/code-snapshots/security/dependabot/86) | high | `linkify-it` | `package-lock.json` | transitive | `5.0.2` | linkify-it: Quadratic-complexity DoS via the `mailto:` validator scan-loop on attacker text |
| [94](https://github.com/YukioTheSage/code-snapshots/security/dependabot/94) | high | `js-yaml` | `package-lock.json` | transitive | `4.3.1` | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| [95](https://github.com/YukioTheSage/code-snapshots/security/dependabot/95) | high | `js-yaml` | `package-lock.json` | transitive | `3.15.1` | JS-YAML: Quadratic CPU consumption in !!omap resolution (3.x and 4.x) — CVE-2026-59870 fix not backported |
| [96](https://github.com/YukioTheSage/code-snapshots/security/dependabot/96) | high | `browserslist` | `package-lock.json` | transitive | `4.28.7` | Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) |
| [99](https://github.com/YukioTheSage/code-snapshots/security/dependabot/99) | high | `js-yaml` | `package-lock.json` | transitive | `4.3.2` | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| [100](https://github.com/YukioTheSage/code-snapshots/security/dependabot/100) | high | `js-yaml` | `package-lock.json` | transitive | `3.15.2` | js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| [101](https://github.com/YukioTheSage/code-snapshots/security/dependabot/101) | high | `glob` | `shared/package-lock.json` | transitive | `10.5.0` | glob CLI: Command injection via -c/--cmd executes matches with shell:true |
| [103](https://github.com/YukioTheSage/code-snapshots/security/dependabot/103) | high | `@isaacs/brace-expansion` | `shared/package-lock.json` | transitive | `5.0.1` | @isaacs/brace-expansion has Uncontrolled Resource Consumption |
| [104](https://github.com/YukioTheSage/code-snapshots/security/dependabot/104) | high | `minimatch` | `shared/package-lock.json` | direct | `10.2.1` | minimatch has a ReDoS via repeated wildcards with non-matching literal in pattern |
| [106](https://github.com/YukioTheSage/code-snapshots/security/dependabot/106) | high | `minimatch` | `shared/package-lock.json` | direct | `10.2.3` | minimatch ReDoS: nested *() extglobs generate catastrophically backtracking regular expressions |
| [108](https://github.com/YukioTheSage/code-snapshots/security/dependabot/108) | high | `minimatch` | `shared/package-lock.json` | direct | `10.2.3` | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| [109](https://github.com/YukioTheSage/code-snapshots/security/dependabot/109) | high | `minimatch` | `shared/package-lock.json` | transitive | `9.0.7` | minimatch has ReDoS: matchOne() combinatorial backtracking via multiple non-adjacent GLOBSTAR segments |
| [112](https://github.com/YukioTheSage/code-snapshots/security/dependabot/112) | high | `brace-expansion` | `shared/package-lock.json` | transitive | `2.1.2` | brace-expansion: DoS via exponential-time expansion of consecutive non-expanding {} groups |
| [2](https://github.com/YukioTheSage/code-snapshots/security/dependabot/2) | medium | `js-yaml` | `cli/package-lock.json` | transitive | `3.14.2` | js-yaml has prototype pollution in merge (<<) |
| [3](https://github.com/YukioTheSage/code-snapshots/security/dependabot/3) | medium | `lodash` | `cli/package-lock.json` | transitive | `4.17.23` | Lodash has Prototype Pollution Vulnerability in `_.unset` and `_.omit` functions |
| [8](https://github.com/YukioTheSage/code-snapshots/security/dependabot/8) | medium | `picomatch` | `cli/package-lock.json` | transitive | `2.3.2` | Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching |
| [10](https://github.com/YukioTheSage/code-snapshots/security/dependabot/10) | medium | `lodash` | `cli/package-lock.json` | transitive | `4.18.0` | lodash vulnerable to Prototype Pollution via array path bypass in `_.unset` and `_.omit` |
| [12](https://github.com/YukioTheSage/code-snapshots/security/dependabot/12) | medium | `ws` | `cli/package-lock.json` | direct | `8.20.1` | ws: Uninitialized memory disclosure |
| [13](https://github.com/YukioTheSage/code-snapshots/security/dependabot/13) | medium | `uuid` | `cli/package-lock.json` | direct | `11.1.1` | uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided |
| [17](https://github.com/YukioTheSage/code-snapshots/security/dependabot/17) | medium | `js-yaml` | `cli/package-lock.json` | transitive | `3.15.0` | JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases |
| [26](https://github.com/YukioTheSage/code-snapshots/security/dependabot/26) | medium | `xml2js` | `package-lock.json` | transitive | `0.5.0` | xml2js is vulnerable to prototype pollution |
| [31](https://github.com/YukioTheSage/code-snapshots/security/dependabot/31) | medium | `js-yaml` | `package-lock.json` | transitive | `4.1.1` | js-yaml has prototype pollution in merge (<<) |
| [32](https://github.com/YukioTheSage/code-snapshots/security/dependabot/32) | medium | `js-yaml` | `package-lock.json` | transitive | `3.14.2` | js-yaml has prototype pollution in merge (<<) |
| [34](https://github.com/YukioTheSage/code-snapshots/security/dependabot/34) | medium | `qs` | `package-lock.json` | transitive | `6.14.1` | qs's arrayLimit bypass in its bracket notation allows DoS via memory exhaustion |
| [37](https://github.com/YukioTheSage/code-snapshots/security/dependabot/37) | medium | `lodash` | `package-lock.json` | transitive | `4.17.23` | Lodash has Prototype Pollution Vulnerability in `_.unset` and `_.omit` functions |
| [38](https://github.com/YukioTheSage/code-snapshots/security/dependabot/38) | medium | `lodash-es` | `package-lock.json` | transitive | `4.17.23` | Lodash has Prototype Pollution Vulnerability in `_.unset` and `_.omit` functions |
| [52](https://github.com/YukioTheSage/code-snapshots/security/dependabot/52) | medium | `undici` | `package-lock.json` | transitive | `6.24.0` | Undici has an HTTP Request/Response Smuggling issue |
| [54](https://github.com/YukioTheSage/code-snapshots/security/dependabot/54) | medium | `undici` | `package-lock.json` | transitive | `6.24.0` | Undici has CRLF Injection in undici via `upgrade` option |
| [59](https://github.com/YukioTheSage/code-snapshots/security/dependabot/59) | medium | `picomatch` | `package-lock.json` | transitive | `2.3.2` | Picomatch: Method Injection in POSIX Character Classes causes incorrect Glob Matching |
| [62](https://github.com/YukioTheSage/code-snapshots/security/dependabot/62) | medium | `lodash` | `package-lock.json` | transitive | `4.18.0` | lodash vulnerable to Prototype Pollution via array path bypass in `_.unset` and `_.omit` |
| [63](https://github.com/YukioTheSage/code-snapshots/security/dependabot/63) | medium | `lodash-es` | `package-lock.json` | transitive | `4.18.0` | lodash vulnerable to Prototype Pollution via array path bypass in `_.unset` and `_.omit` |
| [66](https://github.com/YukioTheSage/code-snapshots/security/dependabot/66) | medium | `ws` | `package-lock.json` | transitive | `8.20.1` | ws: Uninitialized memory disclosure |
| [67](https://github.com/YukioTheSage/code-snapshots/security/dependabot/67) | medium | `uuid` | `package-lock.json` | transitive | `11.1.1` | uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided |
| [68](https://github.com/YukioTheSage/code-snapshots/security/dependabot/68) | medium | `qs` | `package-lock.json` | transitive | `6.15.2` | qs has a remotely triggerable DoS: qs.stringify crashes with TypeError on null/undefined entries in comma-format arrays when encodeValuesOnly is set |
| [73](https://github.com/YukioTheSage/code-snapshots/security/dependabot/73) | medium | `markdown-it` | `package-lock.json` | transitive | `14.2.0` | markdown-it: Quadratic complexity DoS in smartquotes rule via replaceAt string operations |
| [76](https://github.com/YukioTheSage/code-snapshots/security/dependabot/76) | medium | `undici` | `package-lock.json` | transitive | `6.27.0` | undici vulnerable to HTTP header injection via Set-Cookie percent-decoding |
| [79](https://github.com/YukioTheSage/code-snapshots/security/dependabot/79) | medium | `js-yaml` | `package-lock.json` | transitive | `4.2.0` | JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases |
| [80](https://github.com/YukioTheSage/code-snapshots/security/dependabot/80) | medium | `js-yaml` | `package-lock.json` | transitive | `3.15.0` | JS-YAML: Quadratic-complexity DoS in merge key handling via repeated aliases |
| [91](https://github.com/YukioTheSage/code-snapshots/security/dependabot/91) | medium | `undici` | `package-lock.json` | transitive | `6.28.0` | undici vulnerable to downstream response desynchronization via retry interceptor |
| [92](https://github.com/YukioTheSage/code-snapshots/security/dependabot/92) | medium | `undici` | `package-lock.json` | transitive | `6.28.0` | undici vulnerable to cookie attribute injection via unsanitized domain and unparsed setCookie fields |
| [93](https://github.com/YukioTheSage/code-snapshots/security/dependabot/93) | medium | `undici` | `package-lock.json` | transitive | `6.28.0` | undici vulnerable to CRLF Injection via blob-like body 'type' property |
| [111](https://github.com/YukioTheSage/code-snapshots/security/dependabot/111) | medium | `uuid` | `shared/package-lock.json` | direct | `11.1.1` | uuid: Missing buffer bounds check in v3/v5/v6 when buf is provided |
| [1](https://github.com/YukioTheSage/code-snapshots/security/dependabot/1) | low | `tmp` | `cli/package-lock.json` | transitive | `0.2.4` | tmp allows arbitrary temporary file / directory write via symbolic link `dir` parameter |
| [16](https://github.com/YukioTheSage/code-snapshots/security/dependabot/16) | low | `@babel/core` | `cli/package-lock.json` | transitive | `7.29.6` | @babel/core: Arbitrary File Read via sourceMappingURL Comment |
| [29](https://github.com/YukioTheSage/code-snapshots/security/dependabot/29) | low | `tmp` | `package-lock.json` | transitive | `0.2.4` | tmp allows arbitrary temporary file / directory write via symbolic link `dir` parameter |
| [36](https://github.com/YukioTheSage/code-snapshots/security/dependabot/36) | low | `diff` | `package-lock.json` | direct | `5.2.2` | jsdiff has a Denial of Service vulnerability in parsePatch and applyPatch |
| [39](https://github.com/YukioTheSage/code-snapshots/security/dependabot/39) | low | `qs` | `package-lock.json` | transitive | `6.14.2` | qs's arrayLimit bypass in comma parsing allows denial of service |
| [72](https://github.com/YukioTheSage/code-snapshots/security/dependabot/72) | low | `@babel/core` | `package-lock.json` | transitive | `7.29.6` | @babel/core: Arbitrary File Read via sourceMappingURL Comment |
| [74](https://github.com/YukioTheSage/code-snapshots/security/dependabot/74) | low | `undici` | `package-lock.json` | transitive | `6.27.0` | undici vulnerable to HTTP response queue poisoning via keep-alive socket reuse |
| [77](https://github.com/YukioTheSage/code-snapshots/security/dependabot/77) | low | `undici` | `package-lock.json` | transitive | `6.27.0` | undici vulnerable to Set-Cookie SameSite attribute downgrade via permissive substring matching |
| [102](https://github.com/YukioTheSage/code-snapshots/security/dependabot/102) | low | `diff` | `shared/package-lock.json` | direct | `5.2.2` | jsdiff has a Denial of Service vulnerability in parsePatch and applyPatch |
