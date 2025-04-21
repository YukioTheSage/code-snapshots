# Code Snapshots Extension

A dead-simple snapshot system for VS Code that works alongside Git. Take code snapshots with a single keystroke and navigate between them without any complexity.

## Why Code Snapshots?

**Not a Git replacement, but a perfect companion**. Git excels at formal version control and team collaboration, while Code Snapshots excels at personal development workflow:

- **One-Key Snapshots**: Create instant point-in-time backups with a single key press
- **Zero Mental Overhead**: No staging, no commit messages, no branches to manage
- **Frictionless Exploration**: Try ideas without worrying about "messing up" your Git history
- **Development Safety Net**: Create snapshots between Git commits for personal checkpoints
- **Instant Restoration**: Jump back to any snapshot instantly - no stashing, no cherry-picking

Code Snapshots is the missing tool between the autosave feature of your IDE and the formal commits of Git.

## Documentation

- **[User Guide](docs/USER_GUIDE.md)** - How to use the extension, settings, and troubleshooting.
- **[Git Companion Guide](docs/GIT_COMPANION.md)** - How to use Code Snapshots alongside Git.
- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** - Technical details, architecture, and contribution guidelines.
- **[Roadmap](docs/ROADMAP.md)** - Planned features and improvements.

## Features

Code Snapshots offers a robust set of features, categorized as follows:

#### Snapshot Basics:

- [x] One-key snapshot creation (`Ctrl+Alt+S`)
- [x] Snapshot navigation (forward/backward: `Ctrl+Alt+N`/`Ctrl+Alt+B`)
- [x] Time-based grouping in "My Snapshots" & "Auto Snapshots" Explorer views
- [x] Status bar indicator (time since last snapshot, current index)

#### Working with Snapshots:

- [x] File comparison (Diff View) between snapshots and current workspace
- [x] Single file restoration
- [x] Selective snapshots (choose specific files)

#### Automation & Efficiency:

- [x] Basic time-based auto-snapshots (`autoSnapshotInterval`)
- [x] Rule-based auto-snapshots for specific file patterns (`autoSnapshot.rules`)
- [x] UI for managing auto-snapshot rules
- [x] Editor Gutter Indicators for changed lines since last snapshot
- [x] Efficient differential storage for text files
- [x] Content Caching for faster diffs and restores
- [x] Asynchronous file I/O for improved performance

#### Context & Organization:

- [x] Enhanced snapshot context: Tags, Notes, Task References, Favorites
- [x] Editing snapshot context via Tree View context menu
- [x] Filtering by Date, Tags, Favorites, File Path (View Title icons)
- [x] Filter Status Bar indicator
- [x] `.gitignore` / `.snapshotignore` support for file exclusion

#### Git Integration:

- [x] Storing branch/commit info (`git.addCommitInfo`)
- [x] Create Git Commit from Snapshot command (`git.commitFromSnapshotEnabled`)
- [x] Auto-snapshot before pull/merge/rebase (`git.autoSnapshotBeforeOperation`)

#### Getting Started:

- [x] Welcome Experience / Tour / Getting Started command

## Configuration

Code Snapshots offers several settings to customize its behavior:

- `vscode-snapshots.snapshotLocation`: Where to store snapshot data (default: `.snapshots`).
- `vscode-snapshots.maxSnapshots`: Maximum number of snapshots to keep (default: `50`).
- `vscode-snapshots.autoSnapshotInterval`: Interval for automatic snapshots in minutes (default: `0` - disabled).
- `vscode-snapshots.loggingEnabled`: Enable detailed logging (default: `true`).
- `vscode-snapshots.git.addCommitInfo`: Store Git branch/commit with snapshots (default: `true`).
- `vscode-snapshots.git.commitFromSnapshotEnabled`: Enable the "Create Git Commit from Snapshot" command (default: `true`).
- `vscode-snapshots.git.autoSnapshotBeforeOperation`: Automatically snapshot before Git pull/merge/rebase (default: `false`).

See the **[User Guide](docs/USER_GUIDE.md)** for more details on configuration.

## When to Use Code Snapshots vs. Git

| If you want to...                           | Use Code Snapshots                     | Use Git                                                     |
| ------------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| Try an experimental approach quickly        | ✅ Perfect for rapid iteration         | ❌ Too formal for experiments                               |
| Save work-in-progress state                 | ✅ One keystroke, no commit message    | ❌ Requires WIP commits or stashing                         |
| Track logical feature development           | ❌ Not designed for this               | ✅ Designed for logical commits                             |
| Collaborate with others                     | ❌ Local snapshots only                | ✅ Built for collaboration                                  |
| Keep a clean project history                | ❌ Not designed for this               | ✅ Supports squashing, rebasing, etc.                       |
| Create multiple save points between commits | ✅ Perfect use case                    | ❌ Would create messy history                               |
| Organize changes with meaningful context    | ✅ Tags and notes provide rich context | ❌ Requires complex branch names or verbose commit messages |
| Maintain a formal version control record    | ❌ Not designed for this               | ✅ Exactly what Git is for                                  |
| Protect against accidental changes          | ✅ Quick protection with no overhead   | ✅ More formal protection                                   |

**Both tools together provide the best experience**: Use Git for formal version control and team collaboration, and use Code Snapshots for your personal development workflow.

## Quick Start

1. Install the extension from the VS Code Marketplace.
2. Open a project/workspace.
3. Press `Ctrl+Alt+S` (or `Cmd+Alt+S` on Mac) to take your first snapshot.
4. Choose between **Quick Snapshot** or **Detailed Snapshot** with tags and notes.
5. Add a description and any context information if using a Detailed Snapshot.
6. Use `Ctrl+Alt+B` / `Ctrl+Alt+N` to navigate between snapshots.
7. Use the **Snapshots** view in the Activity Bar to browse, compare, restore, or delete snapshots.
8. Right-click on snapshots to edit tags, notes, or toggle favorite status.
9. Use filtering commands to find snapshots by date, tags, or favorite status.
10. Run diagnostics (`Ctrl+Alt+D`) if needed.

For detailed usage, settings, and troubleshooting, see the **[User Guide](docs/USER_GUIDE.md)**.

## System Requirements

- VS Code 1.60.0 or higher
- Works on all platforms supported by VS Code
