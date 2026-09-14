# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.6] - 2026-09-14

The VS Code extension and `codelapse-core` 0.9.6, with `codelapse-cli` 2.0.0.
The three artifacts are versioned and released independently, so the notes
below are grouped by artifact.

`codelapse-cli` 2.0.0 reaches `codelapse-core` through a semver range, so the
core is published first. npm does not rewrite `file:` specifiers when it packs,
so a `file:` link that reached the registry would produce a package no consumer
could install.

### VS Code extension and codelapse-core (0.9.6)

#### Added

- Result ranking and quality scoring for search results.
- Snapshot retention by total store size (`maxSnapshotStoreBytes`).

#### Fixed

- Snapshots are no longer silently lost when the storage directory cannot be
  written; the failure is reported instead of swallowed.
- Semantic-search cleanup no longer reports success when nothing was removed.
- Restoring over IPC no longer overwrites files with unsaved editor changes
  without being told to: the restore is refused and the affected files are
  named, with no dialog raised, so a headless caller cannot hang. The CLI's
  `-y/--yes` accepts the loss.
- `codelapse-core` no longer writes its storage notices to stdout: the
  fresh-store notice, the uninitialized-storage notice and the retention-trim
  report go to stderr, so a first run no longer corrupts `--json` output with
  a prose line.
- The packaged extension no longer ships the repository's internal planning
  documents, agent review diffs and local editor settings, all of which the
  0.9.5 VSIX included and the Marketplace served for download.

#### Changed

- The `git.autoSnapshotBeforeOperation` setting was removed. Nothing ever
  invoked the interception it configured, so no setting takes a snapshot before
  a Git operation; take the snapshot explicitly.
- `codelapse-core` moves from a `file:` link to a semver range, so the
  published manifests resolve the core from the registry. After that change
  `npm ci` installs the published core instead of linking `shared/`.

### codelapse-cli (2.0.0)

#### Added

- Standalone mode: the CLI runs without the VS Code extension for snapshot
  create, list, restore, compare, delete, config, git and `workspace info`.

#### Fixed

- The CLI exits non-zero when a command's payload reports failure, so a script
  that branches on the exit status can no longer read a failure as success.
- `snapshot restore --backup` and `--files` now reach the extension: the CLI
  flattened them to the top level of the IPC payload while the extension reads
  them from `options`, so both were silently dropped.
- `snapshot delete -y/--yes` now reaches the extension: the CLI built the flags
  but its IPC layer forwarded only the id, so the confirmation appeared even
  with the flag.
- `snapshot restore -y/--yes` now has an effect: a restore that would discard
  unsaved editor changes is refused with the file list unless the flag is
  passed; previously the flag was accepted and ignored.
- Test-only helpers no longer ship in the package. `cli/tsconfig.json` excluded
  `**/*.test.ts` but not `src/**/__tests__/**`, so `setup.ts` and `realFs.ts`
  were compiled into `dist/__tests__/` and published; `setup.js` calls
  `jest.mock` and `beforeEach` at module scope and throws when loaded.
- `minimatch` is a declared dependency. The standalone rules handler imported
  it without declaring it, so the version it received depended on the
  consumer's hoisting: the development tree resolved an unrelated major
  through jest rather than the one the core uses.

#### Changed

- The CLI build hook is `prepack` rather than `prepublish`: npm runs
  `prepublish` on a local install, which broke `npm ci` before the linked core
  existed, and no longer runs it on publish.
- `codelapse-core` moves from a `file:` link to a semver range. npm does not
  rewrite `file:` specifiers at publish time, so the previous form would have
  shipped a manifest that no consumer could install.
- The CLI build removes `dist/` before compiling, so a removed or renamed
  source file can no longer keep shipping in the package.
- The unused `inquirer` and `ws` dependencies were removed. The IPC transport
  is a plain `net` socket, and neither package was imported anywhere in the
  CLI's shipped output.

## [0.9.5] - 2025-08-07

Released: the VS Code extension and `codelapse-core` 0.9.5. No version tag was
made for either release and no per-change record was kept, so this entry is not
reconstructed from guesswork. The extension reached the VS Code Marketplace on
2025-08-07; `codelapse-core` 0.9.5 reached npm later, on 2026-02-21.
`package.json` declared 0.9.5 from `ad4a26e` (2025-08-07) until the next
version was declared.

## [codelapse-cli 1.0.1] - 2025-07-17

Released: `codelapse-cli` 1.0.1. No per-change record was kept, so this entry
lists no changes rather than inventing them. It reached npm on 2025-07-17
(1.0.0 was published 2025-07-12). The CLI in this repository is already ahead
of it, at 2.0.0.

## [0.9.4] - 2025-07-18

### Added

- The `codelapse-cli` package, a terminal client that drives the extension over
  its IPC connector.
