# CodeLapse - User Guide

CodeLapse is a lightweight companion to Git that focuses on your personal development workflow. This extension allows you to take point-in-time snapshots of your code and easily navigate between them, providing a frictionless safety net alongside traditional version control systems.

## Getting Started

### Installation

1. Install the "CodeLapse" extension from the VS Code Marketplace.
2. Reload VS Code when prompted.
3. Open a workspace folder you want to take snapshots in. The extension primarily works at the workspace level.
4. The extension activates automatically. You should see a history icon (`$(history)`) and snapshot status in the bottom-left status bar.

<!-- TODO: Add screenshot of the status bar indicator here -->
![Status Bar Indicator Screenshot](images/status-bar-indicator.png)

No complex setup or initialization (`git init`-like command) is required.

### Basic Usage

#### Taking Snapshots

1. Make changes to your code.
2. Press `Ctrl+Alt+S` (or `Cmd+Alt+S` on Mac), or run the "Snapshots: Take Snapshot" command from the Command Palette (`Ctrl+Shift+P`).
3. You'll be prompted to select the type of snapshot:

<!-- TODO: Add screenshot of the snapshot type Quick Pick here -->
![Snapshot Type Quick Pick Screenshot](images/snapshot-type-quick-pick.png)

- **Quick Snapshot**: Fastest option. Only asks for a brief description. Includes all non-ignored files.
- **Detailed Snapshot**: Lets you add tags, notes, task references, and mark it as a favorite, in addition to the description. Includes all non-ignored files.
- **Selective Snapshot**: Lets you choose _specific files_ to include, then prompts for detailed context (description, tags, etc.).

4. Follow the prompts based on your choice:

- **Description**: (All types) Enter a brief summary (e.g., "Implemented login feature"). Press Enter.
- **Select Files**: (Selective only) A multi-select list appears. Check the files/folders you want to include. Press Enter.

<!-- TODO: Add screenshot of the selective snapshot file selection Quick Pick here -->
![Selective Snapshot File Selection Screenshot](images/selective-snapshot-file-selection.png)
- **Tags**: (Detailed/Selective) Enter comma-separated tags (e.g., `feature, login, wip`). Press Enter.
- **Task Reference**: (Detailed/Selective) Enter an issue ID (e.g., `JIRA-123`, `GH-45`). Press Enter.
- **Notes**: (Detailed/Selective) Enter longer notes about the snapshot. Press Enter.
- **Favorite**: (Detailed/Selective) Choose "Yes" or "No" to mark as favorite.

5. A progress notification appears briefly while the snapshot is saved.
6. The status bar and Snapshot Explorer view will update.

#### Viewing Snapshots (Snapshot Explorer)

The main way to interact with your snapshots is through the **Snapshot Explorer** view in the Activity Bar (usually on the left, look for the history icon `$(history)`)).

<!-- TODO: Add screenshot of the Snapshot Explorer view here -->
![Snapshot Explorer View Screenshot](images/snapshot-explorer-view.png)

The Explorer has two main sections (tree views):

1. **My Snapshots**: Shows snapshots you created manually (Quick, Detailed, Selective).
2. **Auto Snapshots**: Shows snapshots created automatically (Time-based, Rule-based, Git pre-operation).

Within each view:

- **Grouping**: Snapshots are grouped by relative time (Today, Yesterday, This Week, etc.). Groups are collapsible.
- **Snapshot Items**:
- Label shows the **time** the snapshot was taken (e.g., `05:40:00`).
- Favorite snapshots are prefixed with a **star** (`$(star-full)`).
- Selective snapshots are indicated with `(Selective)`.
- The **description** shows your summary, task reference (`[...]`), tag count (`$(tag) N`), and Git info (`$(git-branch)`, `$(git-commit)`) if available.
- The **currently restored snapshot** is marked with a distinct icon (`$(debug-step-back)`) and color.
- Other snapshot icons (`$(history)`) are color-coded based on the number of changes relative to the previous snapshot (Subtle -> Blue -> Yellow -> Red).
- **Expanding Snapshots**: Click the arrow next to a snapshot's time to see the files included in it.

<!-- TODO: Add screenshot of an expanded snapshot showing files here -->
![Expanded Snapshot Screenshot](images/expanded-snapshot.png)

- **File Items**:
- Show the filename and relative directory.
- Icons indicate if the file was **added** (`$(diff-added)`), **modified** (`$(diff-modified)`), or **deleted** (`$(diff-removed)`) _in that specific snapshot_ compared to the previous one. Unchanged files have a standard file icon.
- (You can toggle between showing _only changed_ files or _all_ files via the `vscode-snapshots.showOnlyChangedFiles` setting or the "Toggle Changed Files View" command).

#### Filtering Snapshots

You can filter the snapshots shown in _each view independently_ using the icons in the view's title bar:

<!-- TODO: Add screenshot of the filter icons in the view title bar here -->
![Filter Icons Screenshot](images/filter-icons.png)

- **Filter by Date** (`$(calendar)`): Choose a time range (Last 24 Hours, Last 7 Days, etc.).
- **Filter by Tags** (`$(tag)`): Select one or more tags from a list of tags used in your snapshots.
- **Filter by Favorites** (`$(star)`): Toggle to show only favorite snapshots.
- **Filter by File Path** (`$(file)`): Enter a path or glob pattern to show only snapshots affecting matching files.
- **Clear All Filters** (`$(clear-all)`): Resets all active filters for that specific view.

When filters are active, a **Filter Status Bar** item appears on the right side of the main status bar, indicating the number of active filters for that view (e.g., `$(filter) My Snapshots: 2 filters`). Clicking it runs the "Clear All Filters" command for that view.

#### Navigating Between Snapshots

You can restore your workspace to a previous state (snapshot):

- **Keyboard Shortcuts**:
- `Ctrl+Alt+B` (Back): Restore the previous snapshot.
- `Ctrl+Alt+N` (Next): Restore the next snapshot.
- **Tree View**:
- Right-click a snapshot item -> **Restore**.
- **Quick Pick**:
- Run "Snapshots: View Snapshots" command (`Ctrl+Alt+V`).
- Select a snapshot from the list. It will be restored.

**Restore Process**:
**Restore Process**:

1. **Preview**: Before restoring, a Quick Pick shows a summary of files to be Added (`+`), Modified (`~`), or Deleted (`-`). Files with unsaved changes are marked (`*`).

<!-- TODO: Add screenshot of the Snapshot Preview Quick Pick here -->
![Snapshot Preview Quick Pick Screenshot](images/snapshot-preview-quick-pick.png)

2. **Confirm**: Select "Restore Snapshot" to proceed or "Cancel".
3. **Conflict Check**: If restoring would overwrite unsaved changes, you'll get a final prompt:

<!-- TODO: Add screenshot of the Conflict Resolution dialog here -->
![Conflict Resolution Dialog Screenshot](images/conflict-resolution-dialog.png)

- "Restore (Overwrite Unsaved)": Discards unsaved changes in conflicting files.
- "Take Snapshot & Restore": Saves current state (including unsaved changes) first, then restores.
- "Cancel": Aborts the restore.

4. Your workspace files are updated to match the snapshot state.

#### Comparing Files

- **Tree View**:
- Expand a snapshot.
- Right-click a file item -> **Compare File with Workspace**.
- Opens a diff view showing changes between the snapshot version and your current file.

<!-- TODO: Add screenshot of a diff view here -->
![Diff View Screenshot](images/diff-view.png)

- **Clicking Snapshot Node**: Clicking the main snapshot item (the time entry) in the Tree View opens a Quick Pick showing only the files _changed_ in that snapshot. Selecting a file from this list directly opens the diff view.

#### Restoring Single Files

- **Tree View**:
- Expand a snapshot.
- Right-click a file item -> **Restore This File**.
- Confirm the action.
- The selected file in your workspace is overwritten with the version from the snapshot.

#### Editing Snapshot Context

You can modify the tags, notes, task reference, or favorite status after a snapshot is created:

1. Right-click the desired snapshot in the Tree View.
2. Choose "Edit Tags", "Edit Notes", "Edit Task Reference", or "Toggle Favorite Status".
3. Follow the input prompts to make your changes.

#### Deleting Snapshots

- **Tree View**:
- Right-click a snapshot item -> **Delete**.
- Confirm the deletion (this cannot be undone).

#### Editor Change Indicators

As you modify files after taking a snapshot, colored bars appear in the editor's gutter (left of line numbers):

<!-- TODO: Add screenshot of editor gutter change indicators here -->
![Editor Gutter Indicators Screenshot](images/editor-gutter-indicators.png)

- **Green Bar**: Line added since the _last_ snapshot.
- **Blue Bar**: Line modified since the _last_ snapshot.

These indicators help you track recent changes locally. They reset when you take a new snapshot.

#### Unsaved Changes Notification

If you save changes and haven't taken a snapshot in a while (default > 15 minutes), a notification may appear suggesting you take one. Click "Take Snapshot" on the notification or ignore it. It only appears once per snapshot period.

#### Status Bar Indicator

The main status bar item (bottom-left) shows: `$(history) <Time Ago> | <Current/Total> Snapshots`.

- `<Time Ago>`: Time since the _very last_ snapshot was taken (e.g., `5m ago`).
- `<Current/Total>`: Index of the currently restored snapshot and total count (e.g., `3/10`), or just the total count if viewing the latest workspace state (e.g., `10 Snapshots`).
- Clicking it opens the "View Snapshots" Quick Pick. Hovering shows more details.

#### Diagnostics

Run "Snapshots: Run Diagnostics" (`Ctrl+Alt+D`) to check extension status and log details to the Output panel (select "CodeLapse" in the dropdown).

## Automatic Snapshots

### Time-Based Auto-Snapshots

Configure snapshots to be taken automatically at regular intervals:

1. Go to Settings (`Ctrl+,`).
2. Search for `snapshot interval`.
3. Set `CodeLapse: Auto Snapshot Interval` to a number of minutes (e.g., `30`).
4. Set to `0` to disable.
5. These appear in the "Auto Snapshots" view.

### Rule-Based Auto-Snapshots

Define rules to automatically snapshot specific files or patterns when they change:

1. Run the command "Snapshots: Manage Auto-Snapshot Rules".
2. Choose "Add New Rule".
3. Enter a **file pattern** (glob syntax, e.g., `src/**/*.ts`, `config/*.json`).
4. Enter the minimum **interval in minutes** between snapshots for this pattern (e.g., `15`).

**How it works:**

- **On Save:** When you save a file matching a rule's pattern, if the specified interval has passed since the _last auto-snapshot for that specific rule_, a new selective snapshot (including all files matching the pattern) is taken.
- **Periodic Check:** The extension also checks rules periodically (approx. every minute). If the interval has passed for a rule, it takes a selective snapshot for that pattern.
- These snapshots appear in the "Auto Snapshots" view and are tagged `auto`, `rule-based`, etc.
- Use the "Manage Auto-Snapshot Rules" command to view, edit, or delete existing rules. Rules are stored in your workspace settings (`settings.json`).

### Auto-Snapshot Before Git Operations

As a safety net, you can enable automatic snapshots before certain Git operations:

1. Go to Settings (`Ctrl+,`).
2. Search for `snapshot git operation`.
3. Enable `CodeLapse › Git: Auto Snapshot Before Operation`.
4. When enabled, a snapshot is automatically taken before `git pull`, `git merge`, or `git rebase` executed via VS Code. These appear in the "Auto Snapshots" view.

## Integration with Git

CodeLapse is designed to complement Git.

- **Use Snapshots for:** Frequent local checkpoints, experiments, pre-refactoring saves, debugging states.
- **Use Git for:** Meaningful logical commits, team collaboration, branching, releases, backup.

### Create Git Commit from Snapshot

Promote a snapshot state to a formal Git commit:

1. Ensure the feature is enabled in settings (`vscode-snapshots.git.commitFromSnapshotEnabled`).
2. Right-click the desired snapshot in the Tree View -> "Create Git Commit from Snapshot".
3. Edit the pre-filled commit message.
4. Confirm the snapshot restore process (preview, conflict resolution).
5. If restore succeeds, the extension automatically stages all changes and creates the Git commit.

See the [Git Companion Guide](GIT_COMPANION.md) for detailed workflows.

## Understanding Snapshots

### How Snapshots Work

- Captures workspace state (or selected files for selective snapshots).
- Uses **differential storage**: only changes between snapshots are stored for text files, saving space.
- Maintains a simple linear history for easy navigation.
- Respects `.gitignore` and `.snapshotignore` files.

### Snapshot Storage

- Stored in `.snapshots/` directory in your workspace root (path configurable).
- Includes an `index.json` and individual folders for each snapshot (`snapshot-<timestamp>-<random>/snapshot.json`).
- Uses efficient diffs and base references. Context metadata (tags, etc.) is stored in `snapshot.json`.

### File Exclusion

CodeLapse automatically excludes:

- The `.snapshots/` directory itself.
- Binary files (images, executables, archives, etc., based on common extensions).
- Files matched by `.gitignore` patterns.
- Files matched by `.snapshotignore` patterns (takes precedence over `.gitignore`).
- Common directories like `node_modules/`, `.git/`, `venv/`, `.venv/`.

Use `.snapshotignore` (same format as `.gitignore`) in your workspace root for snapshot-specific exclusions.

## Settings Reference

Configure via VS Code Settings (`Ctrl+,`):

| Setting                                            | Description                                                      | Default      |
| :------------------------------------------------- | :--------------------------------------------------------------- | :----------- |
| `vscode-snapshots.snapshotLocation`                | Storage path relative to workspace root                          | `.snapshots` |
| `vscode-snapshots.maxSnapshots`                    | Max number of snapshots to keep (oldest are deleted)             | 50           |
| `vscode-snapshots.autoSnapshotInterval`            | Minutes between time-based auto-snapshots (0=disable)            | 0            |
| `vscode-snapshots.autoSnapshot.rules`              | Array of rules for rule-based auto-snapshots                     | `[]`         |
| `vscode-snapshots.loggingEnabled`                  | Enable Output channel logging                                    | `true`       |
| `vscode-snapshots.verboseLogging`                  | Enable detailed debug logs in Output channel                     | `false`      |
| `vscode-snapshots.showOnlyChangedFiles`            | Show only changed files when expanding snapshots in Tree View    | `true`       |
| `vscode-snapshots.git.addCommitInfo`               | Store Git branch/commit hash with snapshots                      | `true`       |
| `vscode-snapshots.git.commitFromSnapshotEnabled`   | Enable "Create Git Commit from Snapshot" command                 | `true`       |
| `vscode-snapshots.git.autoSnapshotBeforeOperation` | Automatically snapshot before Git pull/merge/rebase (via VSCode) | `false`      |

## Troubleshooting

- **Snapshots Not Created/Restored**: Check Output panel ("CodeLapse" channel), run Diagnostics (`Ctrl+Alt+D`), check file permissions, check ignore files.
- **Performance Issues**: Reduce `maxSnapshots`, check ignore files, ensure large binary directories (`node_modules`) are ignored. Report issues if problems persist.
- **Filtering Issues**: Ensure correct filter selection (Date, Tags, Favorites, File). Check filter status bar. Use "Clear All Filters". Tags are case-sensitive.
- **Rule-based Auto-Snapshots Not Triggering**: Verify rule patterns and intervals in settings. Check Output panel for rule processing logs (enable verbose logging if needed). Ensure files are being saved if expecting save-triggered rules.
- **Editor Decorators Not Showing**: Ensure you've taken at least one snapshot. Decorators show changes _since the last snapshot_. Check Output panel for errors.

## Tips and Best Practices

- Use meaningful descriptions, tags, and task references.
- Snapshot frequently during development.
- Use snapshots before risky operations (refactoring, Git merges).
- Utilize filtering to find relevant snapshots quickly.
- Configure auto-snapshot rules for critical files.
- Use selective snapshots for focused changes.
- Clean up old/unneeded snapshots periodically.
- Combine Snapshots with Git for a robust workflow (see [Git Companion Guide](GIT_COMPANION.md)).

## Getting Help

1. Run "Snapshots: Run Diagnostics".
2. Check the Output panel ("CodeLapse" channel).
3. Review this User Guide and the [Git Companion Guide](GIT_COMPANION.md).
4. Check the extension's GitHub repository for known issues.
5. Report bugs or request features via GitHub Issues.

## Future Updates

Check the [Roadmap](ROADMAP.md) for planned features like enhanced comparison, visual timeline, search, and more.
