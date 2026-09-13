# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.6]

### Added

- Result ranking and quality scoring for search results.
- Snapshot retention by total store size (`maxSnapshotStoreBytes`).

### Fixed

- Snapshots are no longer silently lost when the storage directory cannot be
  written; the failure is reported instead of swallowed.
- The CLI exits non-zero when a command's payload reports failure, so a script
  that branches on the exit status can no longer read a failure as success.
- Semantic-search cleanup no longer reports success when nothing was removed.

### Changed

- The `git.autoSnapshotBeforeOperation` setting was removed. Nothing ever
  invoked the interception it configured, so no setting takes a snapshot before
  a Git operation; take the snapshot explicitly.
- `codelapse-core` is built from the linked `shared/` directory: `npm ci`
  links the checkout but does not compile it.

## [2.0.0]

### Added

- Standalone mode: the CLI runs without the VS Code extension for snapshot
  create, list, restore, compare, delete, config, git and `workspace info`.

### Changed

- The CLI build hook is `prepack` rather than `prepublish`: npm runs
  `prepublish` on a local install, which broke `npm ci` before the linked core
  existed, and no longer runs it on publish.

## [0.9.4] - 2025-07-18

### Added

- The `codelapse-cli` package, a terminal client that drives the extension over
  its IPC connector.
