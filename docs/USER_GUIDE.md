# CodeLapse - User Guide

CodeLapse is a lightweight companion to Git that focuses on your personal development workflow. This extension allows you to take point-in-time snapshots of your code and easily navigate between them, providing a frictionless safety net alongside traditional version control systems.

## Getting Started

### Installation

1. Install the "CodeLapse" extension from the VS Code Marketplace.
2. Reload VS Code when prompted.
3. Open a workspace folder you want to take snapshots in. The extension primarily works at the workspace level.
4. The extension activates automatically. You should see a history icon (`$(history)`) and snapshot status in the bottom-left status bar.


No complex setup or initialization (`git init`-like command) is required.

### First-Time Setup

When you first open a workspace with CodeLapse, you may see a welcome message offering to take a tour of the extension. This guided tour will walk you through:

1. Taking your first snapshot (`Ctrl+Alt+S` or `Cmd+Alt+S` on Mac)
2. Viewing snapshots in the CodeLapse sidebar (Activity Bar)
3. Navigating between snapshots

You can always access this tour later using the "Snapshots: Getting Started" command from the Command Palette.

### Basic Usage

#### Taking Snapshots

1. Make changes to your code.
2. Press `Ctrl+Alt+S` (or `Cmd+Alt+S` on Mac), or run the "Snapshots: Take Snapshot" command from the Command Palette (`Ctrl+Shift+P`).
3. You'll be prompted to select the type of snapshot:


- **Quick Snapshot**: Fastest option. Only asks for a brief description. Includes all non-ignored files.
- **Detailed Snapshot**: Lets you add tags, notes, task references, and mark it as a favorite, in addition to the description. Includes all non-ignored files.
- **Selective Snapshot**: Lets you choose _specific files_ to include, then prompts for detailed context (description, tags, etc.).

4. Follow the prompts based on your choice:

- **Description**: (All types) Enter a brief summary (e.g., "Implemented login feature"). Press Enter.
- **Select Files**: (Selective only) A multi-select list appears. Check the files/folders you want to include. Press Enter.

- **Tags**: (Detailed/Selective) Enter comma-separated tags (e.g., `feature, login, wip`). Press Enter.
- **Task Reference**: (Detailed/Selective) Enter an issue ID (e.g., `JIRA-123`, `GH-45`). Press Enter.
- **Notes**: (Detailed/Selective) Enter longer notes about the snapshot. Press Enter.
- **Favorite**: (Detailed/Selective) Choose "Yes" or "No" to mark as favorite.

5. A progress notification appears briefly while the snapshot is saved.
6. The status bar and Snapshot Explorer view will update.

#### Viewing Snapshots (Snapshot Explorer)

The main way to interact with your snapshots is through the **Snapshot Explorer** view in the Activity Bar (usually on the left, look for the history icon `$(history)`).


The Explorer has three main sections (tree views):

1. **My Snapshots**: Shows snapshots you created manually (Quick, Detailed, Selective).
2. **Auto Snapshots**: Shows snapshots created automatically (Time-based, Rule-based, Git pre-operation).
3. **Settings**: Provides quick access to configuration options and extension settings.

Within the snapshot views:

- **Grouping**: Snapshots are grouped by relative time (Today, Yesterday, This Week, etc.). Groups are collapsible.
- **Snapshot Items**:
- Label shows the **time** the snapshot was taken (e.g., `05:40:00`).
- Favorite snapshots are prefixed with a **star** (`$(star-full)`).
- Selective snapshots are indicated with `(Selective)`.
- The **description** shows your summary, task reference (`[...]`), tag count (`$(tag) N`), and Git info (`$(git-branch)`, `$(git-commit)`) if available.
- The **currently restored snapshot** is marked with a distinct icon (`$(debug-step-back)`) and color.
- Other snapshot icons (`$(history)`) are color-coded based on the number of changes relative to the previous snapshot (Subtle -> Blue -> Yellow -> Red).
- **Expanding Snapshots**: Click the arrow next to a snapshot's time to see the files included in it.


- **File Items**:
- Show the filename and relative directory.
- Icons indicate if the file was **added** (`$(diff-added)`), **modified** (`$(diff-modified)`), or **deleted** (`$(diff-removed)`) _in that specific snapshot_ compared to the previous one. Unchanged files have a standard file icon.
- (You can toggle between showing _only changed_ files or _all_ files via the `vscode-snapshots.showOnlyChangedFiles` setting or the "Toggle Changed Files View" command).

#### Settings View

The **Settings** view in the Snapshot Explorer provides quick access to all CodeLapse configuration options, organized by category:

**General Settings:**
- **Snapshot Location**: Configure where snapshots are stored
- **Max Snapshots**: Set the maximum number of snapshots to keep
- **Auto Snapshot Interval**: Configure time-based auto-snapshots (in minutes)
- **Enable Logging**: Toggle extension logging for troubleshooting
- **Enable Verbose Logging**: Toggle detailed debug logging
- **Auto Snapshot Before Git Operations**: Automatically snapshot before Git operations
- **Auto Snapshot Rules**: Configure file-pattern-based auto-snapshot rules
- **Show Only Changed Files**: Toggle between showing all files or only changed files in snapshots

**UX Settings:**
- **Show Welcome On Startup**: Control whether the welcome message appears for new users
- **Show Keyboard Shortcut Hints**: Toggle display of keyboard shortcut hints and tips
- **Use Animations**: Enable/disable smooth animations for transitions
- **Confirm Restore Operations**: Control whether confirmation is required before restoring snapshots

**API Keys:** (for Semantic Search)
- **Pinecone API Key**: Configure API key for vector database storage
- **Gemini API Key**: Configure API key for semantic code analysis

To modify any setting, simply click on it in the Settings view. The extension will prompt you with the appropriate input method (text input, boolean selection, etc.) and save your changes automatically.

#### Filtering Snapshots

You can filter the snapshots shown in _each view independently_ using the icons in the view's title bar:


- **Filter by Date** (`$(calendar)`): Choose a time range (Last 24 Hours, Last 7 Days, etc.).
- **Filter by Tags** (`$(tag)`): Select one or more tags from a list of tags used in your snapshots.
- **Filter by Favorites** (`$(star)`): Toggle to show only favorite snapshots.
- **Filter by File Path** (`$(file)`): Enter a path or glob pattern to show only snapshots affecting matching files.
- **Clear All Filters** (`$(clear-all)`): Resets all active filters for that specific view.

When filters are active, a **Filter Status Bar** item appears on the right side of the main status bar, indicating the number of active filters for that view (e.g., `$(filter) My Snapshots: 2 filters`). Clicking it runs the "Clear All Filters" command for that view.

#### Semantic Search

> ⚠️ **EXPERIMENTAL FEATURE**: Semantic search is currently an experimental feature. Use it at your own risk. The functionality may change or have limitations in future releases.

CodeLapse offers powerful semantic search capabilities to find code across all your snapshots using natural language queries:

1. Press `Ctrl+Alt+Shift+F` (or `Cmd+Alt+Shift+F` on Mac), or run the "Snapshots: Semantic Search" command from the Command Palette.
2. A search interface will open in the editor area.
3. Enter your natural language query (e.g., "find the login function that uses JWT" or "where is the database connection code").
4. Optionally, use the filters to narrow your search:
   - Date range
   - Programming languages
   - Specific snapshots
   - Relevance threshold
5. Click "Search" or press Enter.
6. Results will display with:
   - Highlighted code snippets with syntax highlighting
   - Source file path and location
   - Snapshot details (timestamp, description)
   - Relevance score
   - Actions to open the file, compare with current version, or jump to the snapshot

##### Managing API Keys for Semantic Search

> ⚠️ **EXPERIMENTAL FEATURE**: This API key management is part of the experimental semantic search feature. Use it at your own risk.

Semantic search requires two API keys to function:

- **Pinecone API Key**: Used for vector storage and retrieval
- **Gemini API Key**: Used for semantic code analysis

You can manage these keys directly from the Settings view in the Snapshot Explorer:

1. Navigate to the Snapshot Explorer in the Activity Bar.
2. Expand the "Settings" view.
3. Expand the "API Keys" section.
4. Click on either "Pinecone API Key" or "Gemini API Key" to update it.
5. Enter your API key in the secure input dialog that appears.
6. The key will be securely stored and masked in the UI.

Benefits of the Settings view interface for API key management:

- Update keys at any time without needing to restart the extension
- No need to wait for authentication errors to update keys
- Clearly see which keys are set and which need to be configured
- API keys are securely stored using VS Code's Secret Storage

**First-time Setup**: On first use, you'll be prompted to provide API keys for the semantic search services. These keys are stored securely using VS Code's built-in SecretStorage.

**Indexing**: Before using semantic search, you need to index your snapshots. Use the "Snapshots: Index All Snapshots for Search" command to build the search index. This process analyzes your code and creates searchable embeddings.


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

1. **Preview**: Before restoring, a Quick Pick shows a summary of files to be Added (`+`), Modified (`~`), or Deleted (`-`). Files with unsaved changes are marked (`*`).


2. **Confirm**: Select "Restore Snapshot" to proceed or "Cancel".
3. **Conflict Check**: If restoring would overwrite unsaved changes, you'll get a final prompt:


- "Restore (Overwrite Unsaved)": Discards unsaved changes in conflicting files.
- "Take Snapshot & Restore": Saves current state (including unsaved changes) first, then restores.
- "Cancel": Aborts the restore.

4. Your workspace files are updated to match the snapshot state.

#### Comparing Files

- **Tree View**:
- Expand a snapshot.
- Right-click a file item -> **Compare File with Workspace**.
- Opens a diff view showing changes between the snapshot version and your current file.


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

#### Diagnostics and Logging

Run "Snapshots: Run Diagnostics" (`Ctrl+Alt+D`) to check extension status and log details to the Output panel (select "CodeLapse" in the dropdown).

For more detailed troubleshooting, use "Snapshots: Show Extension Logs" to view comprehensive log information directly.

## Automatic Snapshots

### Time-Based Auto-Snapshots

Configure snapshots to be taken automatically at regular intervals:

1. Go to Settings (`Ctrl+,`) or use the Settings view in the Snapshot Explorer.
2. Search for `snapshot interval` or find "Auto Snapshot Interval (min)" in the Settings view.
3. Set `CodeLapse: Auto Snapshot Interval` to a number of minutes (e.g., `30`).
4. Set to `0` to disable.
5. These appear in the "Auto Snapshots" view.

### Rule-Based Auto-Snapshots

Define rules to automatically snapshot specific files or patterns when they change:

#### Using the Auto-Snapshot Rules UI

1. Run the command "Snapshots: Manage Auto-Snapshot Rules" or click the gear icon in the Auto Snapshots view title bar.
2. Choose from the following options:

**Add New Rule:**
- Select "Add New Rule"
- Enter a **file pattern** (glob syntax, e.g., `src/**/*.ts`, `config/*.json`)
- Enter the minimum **interval in minutes** between snapshots for this pattern (e.g., `15`)

**Edit Rules:**
- Select "Edit Rules"
- Choose an existing rule from the list
- Modify the file pattern or interval as needed

**Delete Rules:**
- Select "Delete Rules"  
- Choose rules to remove from the list

**View All Rules:**
- Select "View All Rules"
- See all configured auto-snapshot rules with their patterns and intervals

#### How Rule-Based Auto-Snapshots Work

- **On Save:** When you save a file matching a rule's pattern, if the specified interval has passed since the _last auto-snapshot for that specific rule_, a new selective snapshot (including all files matching the pattern) is taken.
- **Periodic Check:** The extension also checks rules periodically (approx. every minute). If the interval has passed for a rule, it takes a selective snapshot for that pattern.
- These snapshots appear in the "Auto Snapshots" view and are tagged `auto`, `rule-based`, etc.
- Rules are stored in your workspace settings (`settings.json`).

### Auto-Snapshot Before Git Operations

As a safety net, you can enable automatic snapshots before certain Git operations:

1. Go to Settings (`Ctrl+,`) or use the Settings view in the Snapshot Explorer.
2. Search for `snapshot git operation` or find "Auto Snapshot Before Git Operations" in the Settings view.
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

## Additional Commands

### Navigation Commands

- **Focus My Snapshots View**: Brings the My Snapshots view into focus in the sidebar
- **Focus Auto Snapshots View**: Brings the Auto Snapshots view into focus in the sidebar
- **Jump to Snapshot**: Quickly jump to a specific snapshot by selection

### Help and Information

- **Getting Started**: Access the guided tour of CodeLapse features anytime
- **Show Extension Logs**: View detailed extension logs for troubleshooting
- **Run Diagnostics**: Comprehensive system check and diagnostic information

## Settings Reference

Configure via VS Code Settings (`Ctrl+,`) or through the Settings view in the Snapshot Explorer:

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
| `vscode-snapshots.ux.showWelcomeOnStartup`         | Show welcome message for first-time users                        | `true`       |
| `vscode-snapshots.ux.showKeyboardShortcutHints`    | Show keyboard shortcut hints and tips                           | `true`       |
| `vscode-snapshots.ux.useAnimations`                | Use animations for smoother transitions                         | `true`       |
| `vscode-snapshots.ux.confirmRestoreOperations`     | Confirm before restoring snapshots                              | `true`       |
| `vscode-snapshots.semanticSearch.enabled`          | Enable semantic code search across snapshots                     | `true`       |
| `vscode-snapshots.semanticSearch.chunkSize`        | Maximum token size for each code chunk                           | 200          |
| `vscode-snapshots.semanticSearch.chunkOverlap`     | Overlap between adjacent chunks in tokens                        | 50           |
| `vscode-snapshots.semanticSearch.autoIndex`        | Automatically index snapshots in the background                  | `false`      |

## Troubleshooting

- **Snapshots Not Created/Restored**: Check Output panel ("CodeLapse" channel), run Diagnostics (`Ctrl+Alt+D`), check file permissions, check ignore files.
- **Performance Issues**: Reduce `maxSnapshots`, check ignore files, ensure large binary directories (`node_modules`) are ignored. Report issues if problems persist.
- **Filtering Issues**: Ensure correct filter selection (Date, Tags, Favorites, File). Check filter status bar. Use "Clear All Filters". Tags are case-sensitive.
- **Rule-based Auto-Snapshots Not Triggering**: Verify rule patterns and intervals in settings. Check Output panel for rule processing logs (enable verbose logging if needed). Ensure files are being saved if expecting save-triggered rules.
- **Editor Decorators Not Showing**: Ensure you've taken at least one snapshot. Decorators show changes _since the last snapshot_. Check Output panel for errors.
- **Semantic Search Not Working**: Verify API keys were entered correctly using the Settings view. Check the Output panel for any API error messages. Ensure snapshots are indexed by running "Snapshots: Index All Snapshots for Search" command. Make sure you have a stable internet connection for API calls.
- **Settings View Not Loading**: Restart VS Code if the Settings view appears empty or doesn't respond to clicks. Check the Output panel for configuration errors.

## Tips and Best Practices

- Use meaningful descriptions, tags, and task references.
- Snapshot frequently during development.
- Use snapshots before risky operations (refactoring, Git merges).
- Utilize filtering to find relevant snapshots quickly.
- Configure auto-snapshot rules for critical files.
- Use selective snapshots for focused changes.
- Clean up old/unneeded snapshots periodically.
- Combine Snapshots with Git for a robust workflow (see [Git Companion Guide](GIT_COMPANION.md)).
- Take advantage of the Settings view for quick configuration changes.
- Use the Getting Started tour to familiarize new team members with CodeLapse.

## Getting Help

1. Run "Snapshots: Run Diagnostics" (`Ctrl+Alt+D`).
2. Check the Output panel ("CodeLapse" channel) or use "Snapshots: Show Extension Logs".
3. Review this User Guide and the [Git Companion Guide](GIT_COMPANION.md).
4. Use the "Snapshots: Getting Started" command for a guided tour.
5. Check the extension's GitHub repository for known issues.
6. Report bugs or request features via GitHub Issues.

## Future Updates

Check the [Roadmap](ROADMAP.md) for planned features like enhanced comparison, visual timeline, search, and more.
