# CodeLapse - User Guide

CodeLapse is a lightweight companion to Git that focuses on your personal development workflow. This extension allows you to take point-in-time snapshots of your code and easily navigate between them, providing a frictionless safety net alongside traditional version control systems.

## Table of Contents

- [Quick Start Guide](#quick-start-guide)
- [Core Features](#core-features)
  - [Snapshot Management](#snapshot-management)
  - [Navigation & Restoration](#navigation--restoration)
  - [File Comparison & Recovery](#file-comparison--recovery)
  - [Automatic Snapshots](#automatic-snapshots)
  - [Semantic Search](#semantic-search)
- [Common Tasks](#common-tasks)
  - [Taking Your First Snapshot](#taking-your-first-snapshot)
  - [Finding and Restoring Code](#finding-and-restoring-code)
  - [Managing Snapshot History](#managing-snapshot-history)
  - [Setting Up Automation](#setting-up-automation)
- [Advanced Features](#advanced-features)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting Guide](#troubleshooting-guide)
  - [Common Issues](#common-issues)
  - [Performance Problems](#performance-problems)
  - [Configuration Issues](#configuration-issues)
  - [Getting Help](#getting-help)
- [Integration with Git](#integration-with-git)
- [Best Practices](#best-practices)
- [Quick Reference](#quick-reference)

## Quick Start Guide

**New to CodeLapse? Start here for a 5-minute setup:**

1. **Install**: Get "CodeLapse" from VS Code Marketplace
2. **Open**: Open any workspace folder
3. **Snapshot**: Press `Ctrl+Alt+S` (or `Cmd+Alt+S` on Mac)
4. **View**: Click the history icon (📜) in the Activity Bar
5. **Navigate**: Use `Ctrl+Alt+B` (Back) and `Ctrl+Alt+N` (Next) to move between snapshots

> 💡 **First Time?** Run "Snapshots: Getting Started" from Command Palette for a guided tour

## Core Features

### Snapshot Management
CodeLapse provides three types of snapshots to match your workflow:

- **Quick Snapshot** (`Ctrl+Alt+S`): Fastest option for capturing your current state with just a description
- **Detailed Snapshot**: Includes tags, notes, task references, and favorite marking for better organization
- **Selective Snapshot**: Choose specific files to include, perfect for focused changes

**Key Benefits:**
- Differential storage saves disk space by only storing changes
- Respects `.gitignore` and `.snapshotignore` for clean snapshots
- Automatic exclusion of binary files and common build directories

### Navigation & Restoration
Move through your development history with ease:

- **Keyboard Navigation**: `Ctrl+Alt+B` (Back) and `Ctrl+Alt+N` (Next)
- **Visual Timeline**: Browse snapshots in the Snapshot Explorer with time-based grouping
- **Quick Restore**: Preview changes before restoring with conflict detection
- **Safe Restoration**: Option to snapshot current state before restoring

### File Comparison & Recovery
Compare and recover individual files or entire snapshots:

- **Diff View**: Compare any file version with your current workspace
- **Single File Restore**: Recover just the files you need
- **Change Indicators**: Visual gutter indicators show modifications since last snapshot
- **Conflict Resolution**: Smart handling of unsaved changes during restoration

### Automatic Snapshots
Set up automated safety nets for your development workflow:

- **Time-Based**: Automatic snapshots at regular intervals
- **Rule-Based**: Pattern-matching rules for specific file types or directories
- **Git Integration**: Automatic snapshots before Git operations (pull, merge, rebase)

### Semantic Search
> ⚠️ **EXPERIMENTAL FEATURE** - See [security warnings](#semantic-search) below

Find code across all snapshots using natural language queries:
- Natural language search (e.g., "find login function with JWT")
- Cross-snapshot code discovery
- Relevance scoring and filtering
- Direct navigation to found code

## Common Tasks

### Taking Your First Snapshot

**Scenario**: You've just implemented a new feature and want to save your progress.

1. **Quick Method**: Press `Ctrl+Alt+S` (or `Cmd+Alt+S` on Mac)
2. **Choose Snapshot Type**: Select "Quick Snapshot" for fastest capture
3. **Add Description**: Enter something meaningful like "Implemented user authentication"
4. **Confirm**: Press Enter to save

**Result**: Your snapshot appears in the Snapshot Explorer, and the status bar updates to show the new snapshot count.

**Pro Tip**: Use descriptive names that will help you find this snapshot later, like "Before refactoring user service" or "Working login with validation".

### Finding and Restoring Code

**Scenario**: You need to find and restore code from yesterday's work session.

**Method 1: Browse by Time**
1. Open Snapshot Explorer (history icon in Activity Bar)
2. Expand "Yesterday" group in "My Snapshots"
3. Look for snapshots with relevant descriptions
4. Right-click desired snapshot → "Restore"

**Method 2: Filter by Content**
1. Click the file filter icon (`$(file)`) in Snapshot Explorer
2. Enter file pattern (e.g., `src/auth/*.ts`)
3. Browse filtered results
4. Right-click desired snapshot → "Restore"

**Method 3: Use Semantic Search** (if enabled)
1. Press `Ctrl+Alt+Shift+F`
2. Enter natural language query: "authentication code with JWT tokens"
3. Review results with relevance scores
4. Click "Jump to Snapshot" on desired result

### Managing Snapshot History

**Scenario**: Your snapshot history is getting cluttered and you want to organize it.

**Organize with Tags and Favorites**:
1. Right-click important snapshots → "Toggle Favorite Status"
2. Right-click snapshots → "Edit Tags" → Add tags like "feature", "bugfix", "experiment"
3. Use tag filter (`$(tag)`) to view snapshots by category

**Clean Up Old Snapshots**:
1. Right-click unwanted snapshots → "Delete"
2. Adjust `maxSnapshots` setting to automatically limit history size
3. Use date filters to focus on recent work

**Bulk Operations**:
- Filter by date range, then delete multiple old snapshots
- Use favorites filter to protect important snapshots from cleanup

### Setting Up Automation

**Scenario**: You want CodeLapse to automatically protect your work without manual intervention.

**Time-Based Automation**:
1. Open Settings view in Snapshot Explorer
2. Click "Auto Snapshot Interval (min)"
3. Set to `30` for snapshots every 30 minutes
4. Snapshots appear in "Auto Snapshots" view

**Rule-Based Automation**:
1. Run "Snapshots: Manage Auto-Snapshot Rules"
2. Select "Add New Rule"
3. Enter pattern: `src/**/*.ts` (for TypeScript files)
4. Set interval: `15` minutes
5. Save rule

**Git Integration**:
1. Open Settings view in Snapshot Explorer
2. Click "Auto Snapshot Before Git Operations"
3. Select "Yes" to enable
4. Automatic snapshots before pull/merge/rebase operations

**Example Rules for Different Projects**:
- **Web Development**: `src/**/*.{js,ts,jsx,tsx}` every 20 minutes
- **Configuration Files**: `config/**/*.{json,yaml,yml}` every 10 minutes
- **Documentation**: `docs/**/*.md` every 30 minutes

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

> ⚠️ **EXPERIMENTAL FEATURE - CRITICAL SECURITY WARNING**: 
> - **Data Privacy Risk**: Your code content is transmitted to external AI services (Pinecone, Gemini)
> - **API Key Security**: Third-party services require API keys with potential access implications
> - **Network Exposure**: Code is processed by external providers over the internet
> - **Compliance Issues**: May violate organizational security policies and data protection regulations
> - **Cost Impact**: API usage may result in unexpected charges on your accounts
> - **Functionality Changes**: Experimental features may change, break, or be removed without notice
> - **NOT RECOMMENDED** for proprietary, sensitive, or confidential codebases
> - **Use at your own risk** and ensure compliance with your organization's security policies

CodeLapse offers experimental semantic search capabilities to find code across all your snapshots using natural language queries:

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

##### API Key Management and Security for Semantic Search

> ⚠️ **CRITICAL SECURITY WARNING**: API key management is part of the experimental semantic search feature with significant security implications:
> - **Third-party Access**: API keys grant external services access to process your code
> - **Data Transmission**: Your code content is sent to external AI providers
> - **Cost Implications**: API usage may result in unexpected charges
> - **Compliance Risks**: May violate organizational security policies
> - **Use with extreme caution** and only with non-sensitive codebases

**Required API Keys:**
Semantic search requires two API keys from external services:

- **Pinecone API Key**: Used for vector database storage and retrieval
  - Service: Pinecone (vector database provider)
  - Purpose: Stores code embeddings for search functionality
  - Data exposure: Code chunks are stored as vectors in Pinecone's cloud service

- **Gemini API Key**: Used for semantic code analysis and embeddings
  - Service: Google Gemini AI
  - Purpose: Generates semantic embeddings from your code
  - Data exposure: Code content is processed by Google's AI service

**🛡️ Security Best Practices:**

1. **API Key Security:**
   - Use dedicated API keys with minimal permissions
   - Regularly rotate API keys
   - Monitor API usage and costs
   - Never share API keys or commit them to version control

2. **Data Privacy:**
   - Only use with non-proprietary, non-sensitive code
   - Review API provider terms of service and privacy policies
   - Understand data retention policies of external services
   - Consider geographic data residency requirements

3. **Access Control:**
   - Limit API key permissions to minimum required functionality
   - Use separate API keys for different projects/environments
   - Implement API usage monitoring and alerts

4. **Compliance Considerations:**
   - Verify compliance with organizational security policies
   - Check data protection regulations (GDPR, CCPA, etc.)
   - Obtain necessary approvals before using with work-related code
   - Document API usage for audit purposes

**Managing API Keys:**

You can manage API keys directly from the Settings view in the Snapshot Explorer:

1. Navigate to the Snapshot Explorer in the Activity Bar
2. Expand the "Settings" view
3. Expand the "API Keys" section
4. Click on either "Pinecone API Key" or "Gemini API Key" to update it
5. Enter your API key in the secure input dialog that appears
6. The key will be securely stored using VS Code's SecretStorage and masked in the UI

**Security Features:**
- API keys are encrypted using VS Code's built-in SecretStorage
- Keys are never displayed in plain text in the UI
- Keys are not logged or stored in configuration files
- Secure transmission to external services via HTTPS

**Setup Instructions with Security Considerations:**

1. **Obtain API Keys Securely:**
   - Create dedicated accounts for CodeLapse usage
   - Use strong, unique passwords for API provider accounts
   - Enable two-factor authentication where available
   - Generate API keys with minimal required permissions

2. **Configure Keys Safely:**
   - Use the Settings view interface (never edit configuration files directly)
   - Verify the key is masked after entry
   - Test with non-sensitive code first
   - Monitor initial API usage for unexpected behavior

3. **Indexing Process:**
   - Before using semantic search, index your snapshots using "Snapshots: Index All Snapshots for Search"
   - This process analyzes your code and creates searchable embeddings
   - Monitor the indexing process for any errors or unexpected API usage
   - Verify that only intended snapshots are being indexed

**🚫 How to Disable Semantic Search:**

If you decide the security risks are too high, you can disable semantic search:

1. **Via Settings View:**
   - Navigate to Snapshot Explorer → Settings → Semantic Search
   - Click "Enable Semantic Search" and select "No"

2. **Via VS Code Settings:**
   - Open Settings (`Ctrl+,`)
   - Search for "semantic search"
   - Set `vscode-snapshots.semanticSearch.enabled` to `false`

3. **Remove API Keys:**
   - Use the Settings view to clear stored API keys
   - This prevents any accidental usage of the feature

**Emergency Procedures:**

If you suspect API key compromise:
1. Immediately disable semantic search in CodeLapse settings
2. Revoke the compromised API keys in the respective service dashboards
3. Generate new API keys with different permissions
4. Review API usage logs for unauthorized activity
5. Update any other applications using the same keys


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

## Troubleshooting Guide

### Common Issues

#### Snapshots Not Being Created
**Symptoms**: Pressing `Ctrl+Alt+S` doesn't create snapshots, or snapshots appear empty

**Solutions**:
1. **Check File Permissions**: Ensure VS Code has write access to your workspace directory
2. **Verify Workspace**: CodeLapse requires an open workspace folder (not just individual files)
3. **Check Ignore Files**: Review `.gitignore` and `.snapshotignore` - they might be excluding all your files
4. **Run Diagnostics**: Use `Ctrl+Alt+D` to check extension status and view detailed logs
5. **Check Output Panel**: Open Output panel and select "CodeLapse" to see error messages

**Example**: If working in a restricted directory, try opening a different workspace folder with proper permissions.

#### Snapshots Not Being Restored
**Symptoms**: Right-click "Restore" doesn't change files, or restoration fails silently

**Solutions**:
1. **Check Unsaved Changes**: Save or discard unsaved changes before restoring
2. **Verify File Locks**: Close any files that might be locked by other applications
3. **Check Workspace State**: Ensure you're in the same workspace where snapshots were created
4. **Review Restore Preview**: Pay attention to the preview dialog - it shows what will change
5. **Try Single File Restore**: Test with individual files first to isolate the issue

**Example**: If restoring fails, try "Take Snapshot & Restore" option to preserve current changes.

#### Filtering and Search Issues
**Symptoms**: Filters don't show expected results, or search returns no matches

**Solutions**:
1. **Clear All Filters**: Use the clear filters button (`$(clear-all)`) to reset view
2. **Check Filter Combinations**: Multiple filters work together - ensure they're not too restrictive
3. **Verify Tag Spelling**: Tags are case-sensitive - check exact spelling
4. **Review Date Ranges**: Ensure selected date range includes your snapshots
5. **Check File Patterns**: Use correct glob syntax (e.g., `src/**/*.js` not `src/*.js` for subdirectories)

**Example**: If searching for "feature" tag, ensure it's not filtered as "Feature" (different case).

### Performance Problems

#### Slow Snapshot Creation
**Symptoms**: Taking snapshots takes a long time or causes VS Code to freeze

**Solutions**:
1. **Reduce Snapshot Size**: Use selective snapshots for large projects
2. **Update Ignore Files**: Add large directories to `.snapshotignore`:
   ```
   node_modules/
   dist/
   build/
   .git/
   *.log
   ```
3. **Limit Max Snapshots**: Reduce `maxSnapshots` setting to 20-30 for better performance
4. **Check Disk Space**: Ensure adequate free space in workspace directory
5. **Monitor File Count**: Projects with >10,000 files may need selective snapshots

**Example Configuration**:
```json
{
  "vscode-snapshots.maxSnapshots": 25,
  "vscode-snapshots.showOnlyChangedFiles": true
}
```

#### High Memory Usage
**Symptoms**: VS Code becomes slow or unresponsive when using CodeLapse

**Solutions**:
1. **Reduce Snapshot History**: Lower `maxSnapshots` setting
2. **Use Selective Snapshots**: Only snapshot files you're actively working on
3. **Clear Old Snapshots**: Manually delete old snapshots you no longer need
4. **Restart VS Code**: Restart periodically to clear memory
5. **Check Extension Conflicts**: Disable other extensions temporarily to identify conflicts

### Configuration Issues

#### Settings Not Saving
**Symptoms**: Changes made in Settings view don't persist, or settings revert

**Solutions**:
1. **Check Workspace Settings**: Verify settings are saved in `.vscode/settings.json`
2. **File Permissions**: Ensure VS Code can write to workspace settings file
3. **Settings Sync**: If using VS Code Settings Sync, check for conflicts
4. **Manual Configuration**: Edit settings directly in VS Code Settings (`Ctrl+,`)
5. **Restart Extension**: Disable and re-enable CodeLapse extension

**Example Settings File**:
```json
{
  "vscode-snapshots.autoSnapshotInterval": 30,
  "vscode-snapshots.maxSnapshots": 50,
  "vscode-snapshots.autoSnapshot.rules": [
    {
      "pattern": "src/**/*.ts",
      "intervalMinutes": 15
    }
  ]
}
```

#### Auto-Snapshot Rules Not Working
**Symptoms**: Rule-based auto-snapshots aren't triggering as expected

**Solutions**:
1. **Verify Pattern Syntax**: Use correct glob patterns:
   - `src/**/*.js` - All JS files in src and subdirectories
   - `*.json` - JSON files in root only
   - `**/*.{ts,js}` - TypeScript and JavaScript files everywhere
2. **Check Intervals**: Ensure enough time has passed since last auto-snapshot
3. **Enable Verbose Logging**: Turn on detailed logging to see rule processing
4. **Test Patterns**: Use VS Code's file search to verify your patterns match expected files
5. **Save Files**: Rules trigger on file save - ensure you're saving files

**Debugging Rules**:
1. Open Output panel → "CodeLapse"
2. Enable verbose logging in Settings view
3. Save a file that should match your rule
4. Check logs for rule processing messages

### Getting Help

#### Self-Help Resources
1. **Run Diagnostics**: `Ctrl+Alt+D` provides comprehensive system information
2. **Check Extension Logs**: "Snapshots: Show Extension Logs" for detailed troubleshooting
3. **Review Documentation**: Check [Git Companion Guide](GIT_COMPANION.md) for integration help
4. **Use Getting Started**: "Snapshots: Getting Started" command for guided tour

#### Reporting Issues
When reporting bugs, include:
1. **Diagnostic Output**: Results from `Ctrl+Alt+D`
2. **Extension Logs**: Output from "Show Extension Logs"
3. **Steps to Reproduce**: Exact steps that cause the issue
4. **Environment Info**: VS Code version, operating system, workspace type
5. **Settings**: Relevant CodeLapse settings from your configuration

#### Community Support
- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share tips
- **Documentation**: Check for updates and new features

**Emergency Recovery**:
If CodeLapse causes VS Code instability:
1. Disable the extension immediately
2. Restart VS Code
3. Check `.snapshots/` directory for corruption
4. Re-enable extension after identifying the issue

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

## Configuration Reference

### Essential Settings

**Storage and Performance**:
- `vscode-snapshots.snapshotLocation`: Where snapshots are stored (default: `.snapshots`)
- `vscode-snapshots.maxSnapshots`: Maximum snapshots to keep (default: 50)
- `vscode-snapshots.showOnlyChangedFiles`: Show only modified files in snapshot view (default: true)

**Automation Settings**:
- `vscode-snapshots.autoSnapshotInterval`: Minutes between auto-snapshots (0 = disabled)
- `vscode-snapshots.autoSnapshot.rules`: Array of pattern-based rules for automatic snapshots
- `vscode-snapshots.git.autoSnapshotBeforeOperation`: Auto-snapshot before Git operations

**User Experience**:
- `vscode-snapshots.ux.confirmRestoreOperations`: Require confirmation before restoring
- `vscode-snapshots.ux.useAnimations`: Enable smooth transitions and animations
- `vscode-snapshots.ux.showKeyboardShortcutHints`: Display helpful keyboard shortcuts

### Example Configuration

**Basic Setup for Web Development**:
```json
{
  "vscode-snapshots.maxSnapshots": 30,
  "vscode-snapshots.autoSnapshotInterval": 20,
  "vscode-snapshots.autoSnapshot.rules": [
    {
      "pattern": "src/**/*.{js,ts,jsx,tsx}",
      "intervalMinutes": 15
    },
    {
      "pattern": "*.{json,md}",
      "intervalMinutes": 30
    }
  ],
  "vscode-snapshots.git.autoSnapshotBeforeOperation": true
}
```

**Performance-Optimized Setup**:
```json
{
  "vscode-snapshots.maxSnapshots": 20,
  "vscode-snapshots.showOnlyChangedFiles": true,
  "vscode-snapshots.autoSnapshotInterval": 0,
  "vscode-snapshots.verboseLogging": false
}
```

### Advanced Configuration

**Custom Ignore Patterns** (`.snapshotignore`):
```
# Build outputs
dist/
build/
out/

# Dependencies
node_modules/
vendor/

# Logs and temporary files
*.log
.tmp/
.cache/

# IDE files
.vscode/
.idea/

# Large media files
*.mp4
*.mov
*.zip
```

**Rule-Based Auto-Snapshot Examples**:
```json
{
  "vscode-snapshots.autoSnapshot.rules": [
    {
      "pattern": "src/components/**/*.{jsx,tsx}",
      "intervalMinutes": 10,
      "description": "React components"
    },
    {
      "pattern": "config/**/*.{json,yaml,yml}",
      "intervalMinutes": 5,
      "description": "Configuration files"
    },
    {
      "pattern": "docs/**/*.md",
      "intervalMinutes": 30,
      "description": "Documentation"
    }
  ]
}
```

## Quick Reference

### Keyboard Shortcuts

| Action | Windows/Linux | Mac | Description |
|--------|---------------|-----|-------------|
| Take Snapshot | `Ctrl+Alt+S` | `Cmd+Alt+S` | Create a new snapshot |
| Previous Snapshot | `Ctrl+Alt+B` | `Cmd+Alt+B` | Navigate to previous snapshot |
| Next Snapshot | `Ctrl+Alt+N` | `Cmd+Alt+N` | Navigate to next snapshot |
| View Snapshots | `Ctrl+Alt+V` | `Cmd+Alt+V` | Open snapshot selection dialog |
| Run Diagnostics | `Ctrl+Alt+D` | `Cmd+Alt+D` | Check extension status |
| Semantic Search | `Ctrl+Alt+Shift+F` | `Cmd+Alt+Shift+F` | Search code with natural language |

### Common Commands

**From Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`):
- `Snapshots: Take Snapshot` - Create new snapshot
- `Snapshots: View Snapshots` - Browse and restore snapshots
- `Snapshots: Getting Started` - Launch guided tour
- `Snapshots: Manage Auto-Snapshot Rules` - Configure automation
- `Snapshots: Show Extension Logs` - View detailed logs
- `Snapshots: Index All Snapshots for Search` - Prepare semantic search

### Snapshot Types Quick Guide

| Type | When to Use | What's Included | Setup Time |
|------|-------------|-----------------|------------|
| **Quick** | Frequent checkpoints | All files + description | 10 seconds |
| **Detailed** | Important milestones | All files + tags/notes/favorites | 30 seconds |
| **Selective** | Focused changes | Chosen files + full metadata | 1-2 minutes |

### Filter Quick Reference

| Filter | Icon | Purpose | Example |
|--------|------|---------|---------|
| Date | `$(calendar)` | Time-based filtering | "Last 7 Days" |
| Tags | `$(tag)` | Category filtering | "feature", "bugfix" |
| Favorites | `$(star)` | Important snapshots | Starred snapshots only |
| File Path | `$(file)` | Content filtering | `src/**/*.ts` |

### Troubleshooting Quick Fixes

| Problem | Quick Fix | Command |
|---------|-----------|---------|
| Snapshots not creating | Check permissions & run diagnostics | `Ctrl+Alt+D` |
| Can't find snapshots | Clear all filters | Click `$(clear-all)` |
| Performance issues | Reduce max snapshots | Settings → Max Snapshots → 20 |
| Rules not working | Enable verbose logging | Settings → Enable Verbose Logging |
| Extension not responding | Restart extension | Disable/Enable in Extensions view |

### File Patterns for Rules

| Pattern | Matches | Use Case |
|---------|---------|----------|
| `src/**/*.js` | All JS files in src/ and subdirectories | JavaScript projects |
| `*.{json,yaml,yml}` | Config files in root | Configuration management |
| `**/*.{ts,tsx}` | All TypeScript files | TypeScript projects |
| `docs/**/*.md` | All Markdown in docs/ | Documentation |
| `test/**/*` | All test files | Test automation |

### Status Bar Indicators

| Display | Meaning |
|---------|---------|
| `$(history) 5m ago \| 15 Snapshots` | Last snapshot 5 minutes ago, 15 total |
| `$(history) 2m ago \| 3/15 Snapshots` | Currently viewing snapshot 3 of 15 |
| `$(filter) My Snapshots: 2 filters` | 2 active filters on My Snapshots view |

### Emergency Procedures

**If CodeLapse Causes Issues**:
1. Disable extension: Extensions view → CodeLapse → Disable
2. Restart VS Code
3. Check `.snapshots/` directory for corruption
4. Re-enable extension after resolving issue

**If Snapshots Are Corrupted**:
1. Backup `.snapshots/` directory
2. Run diagnostics: `Ctrl+Alt+D`
3. Check extension logs for errors
4. Report issue with diagnostic output

## Future Updates

Check the [Roadmap](ROADMAP.md) for planned features like enhanced comparison, visual timeline, search, and more.
