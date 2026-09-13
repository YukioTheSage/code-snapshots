# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Not published yet. The VS Code extension and `codelapse-core` declare 0.9.6,
and `codelapse-cli` declares 2.0.0. The three artifacts are versioned and
released independently, so the notes below are grouped by artifact.

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

#### Changed

- The `git.autoSnapshotBeforeOperation` setting was removed. Nothing ever
  invoked the interception it configured, so no setting takes a snapshot before
  a Git operation; take the snapshot explicitly.
- `codelapse-core` is built from the linked `shared/` directory: `npm ci`
  links the checkout but does not compile it.

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

#### Changed

- The CLI build hook is `prepack` rather than `prepublish`: npm runs
  `prepublish` on a local install, which broke `npm ci` before the linked core
  existed, and no longer runs it on publish.

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
