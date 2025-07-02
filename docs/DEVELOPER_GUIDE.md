# CodeLapse - Developer Guide

This document provides technical details, architecture information, and contribution guidelines for the CodeLapse VS Code extension. It's intended for developers who want to understand, modify, or extend the extension.

## Architecture Overview

CodeLapse follows a modular architecture with several key components designed for separation of concerns (core logic vs. UI vs. storage) and asynchronous operation:


### Key Components

1.  **Extension Entrypoint** (`extension.ts`)

    - Handles extension activation/deactivation.
    - Attempts to activate and retrieve the built-in Git extension API.
    - Initializes core components (`SnapshotManager`, `SnapshotStorage`, `ChangeNotifier`, UI elements, `EditorDecorator`, etc.).
    - Initializes the `CredentialsManager` with the extension context to enable secure storage of sensitive data like API keys.
    - Coordinates the registration of commands by calling `registerCommands`, passing dependencies including the Git API.
    - Sets up Git command interception for auto-snapshots (if configured).
    - Initializes semantic search services if enabled.
    - Manages global disposables and initial welcome experience.

2.  **Command Registration & UI Flow** (`commands.ts`)

    - Centralized location for registering all VS Code commands exposed by the extension.
    - Orchestrates UI interactions associated with commands (Quick Picks, Input Boxes, Progress Notifications, Confirmation Dialogs, Conflict Resolution).
    - Calls appropriate methods on `SnapshotManager` or other services to execute actions (e.g., `takeSnapshot`, `applySnapshotRestore`).
    - Handles Git API interactions for commands like "Create Git Commit from Snapshot".
    - Manages editor state preservation/restoration during navigation.

3.  **Snapshot Manager** (`snapshotManager.ts`)

    - Core component responsible for snapshot state and logic (no direct UI interaction or file I/O).
    - Accepts the Git API instance in its constructor.
    - Manages the _in-memory_ list of snapshot metadata (`Snapshot[]`).
    - Handles snapshot creation logic (ID/timestamp generation, calling `SnapshotStorage` for file filtering/reading/saving, fetching Git info).
    - Handles snapshot restoration logic (`applySnapshotRestore`), delegating file operations to `SnapshotStorage`.
    - Provides methods for navigation (`navigateToPreviousSnapshot`, `navigateToNextSnapshot`).
    - Provides methods for calculating changes (`calculateRestoreChanges`).
    - Provides snapshot data retrieval (`getSnapshots`, `getSnapshotById`). Delegates file content retrieval to `SnapshotStorage`.
    - Handles snapshot deletion logic (delegating file deletion to `SnapshotStorage`).
    - Enforces snapshot limits (delegating file deletion to `SnapshotStorage`).
    - Handles snapshot context updates (delegating saving to `SnapshotStorage`).
    - Emits events (`onDidChangeSnapshots`) when snapshots change.

4.  **Snapshot Storage** (`snapshotStorage.ts`)

    - **Handles all direct asynchronous file system interactions** (using `fs.promises`).
    - Manages reading/writing/deleting snapshot data (`snapshot.json`) and index files (`index.json`).
    - Manages the physical storage structure in the `.snapshots` directory (configurable).
    - Provides methods for reading workspace files (`readFileContent`) and writing them during restore (`writeFileContent`), handling directory creation.
    - Implements the core logic for retrieving snapshot file content (`getSnapshotFileContent`), recursively applying diffs by calling itself.
    - Implements content caching (`contentCache`) for `getSnapshotFileContent`.
    - Detects binary files (by extension and content sampling) and handles them appropriately.
    - Provides snapshot recovery mechanisms (`recoverSnapshotsFromFileSystem`) if the index is missing/corrupt.

5.  **Snapshot Tree View** (`ui/treeView.ts`)

    - Implements the `TreeDataProvider` interface for the sidebar views ("My Snapshots", "Auto Snapshots").
    - Displays the list of snapshots (filtered by type: MANUAL or AUTO) and changed files within them.
    - Handles user interactions within the tree view (e.g., context menu actions, click actions).
    - Manages its _own_ filter state (by date, tags, favorites, file patterns) per view instance.
    - Groups snapshots by time periods (Today, Yesterday, This Week, etc.).
    - Determines display labels, icons, tooltips, and context values for tree items.

6.  **Snapshot Quick Pick** (`ui/quickPick.ts`)

    - Renders the quick pick UI (`vscode.window.showQuickPick`) for selecting snapshots via the "View Snapshots" command.
    - Handles the selection process and triggers the `jumpToSnapshot` command internally upon selection.
    - Displays enhanced metadata including change summaries and Git information.

7.  **Status Bar Controller** (`statusBarController.ts`)

    - Manages the main status bar indicator (left side).
    - Updates UI based on current snapshot state (last snapshot time, current index/total).
    - Handles status bar click interactions (e.g., running view snapshots command).
    - Shows time elapsed since last snapshot and position information.

8.  **Gitignore Parser** (`gitignoreParser.ts`)

    - Handles file exclusion logic based on `.gitignore` and `.snapshotignore` (latter takes precedence).
    - Parses ignore files and converts patterns to glob format.
    - Generates `exclude` and negated glob patterns suitable for `vscode.workspace.findFiles`.

9.  **Change Notifier** (`changeNotifier.ts`)

    - Monitors file saves and snapshot creation times.
    - Prompts the user (via timed notification) to take a snapshot if significant changes have occurred since the last one.
    - Handles **Rule-based Auto-Snapshots**:
      - Periodically checks configured rules (`vscode-snapshots.autoSnapshot.rules`).
      - Triggers time-based auto-snapshots for matching patterns if the interval has passed.
      - Triggers save-based auto-snapshots for matching patterns if the interval has passed.
      - Manages its own state and timers for rules and notifications.

10. **Snapshot Content Provider** (`snapshotContentProvider.ts`)

    - Implements `TextDocumentContentProvider`.
    - Provides content for custom `snapshot-diff:` URIs used in diff views.
    - Enables VS Code's diff view to show snapshot file content by resolving content via `SnapshotStorage.getSnapshotFileContent`.

11. **Editor Decorator** (`editorDecorator.ts`)

    - Adds visual indicators (colored bars) in the editor gutter for lines changed since the _last_ snapshot.
    - Uses different theme colors to indicate added vs. modified lines.
    - Updates dynamically (debounced) as changes are made to files.
    - Listens for snapshot changes to update decorations.

12. **Snapshot Context Input** (`ui/snapshotContextInput.ts`)

    - Handles the multi-step input process (`showQuickPick`, `showInputBox`) for collecting enhanced snapshot context when taking a snapshot.
    - Provides UI flow for Quick, Detailed, and Selective snapshot creation.
    - Collects metadata like description, tags, notes, task references, and favorite status.
    - Manages file selection UI (multi-select Quick Pick) for Selective Snapshots.

13. **Filter Status Bar** (`ui/filterStatusBar.ts`)

    - Manages the status bar indicator showing active filters (right side).
    - Displays count of active filters and filter descriptions for a specific Tree View instance.
    - Provides quick access (click action) to the `clearAllFilters` command.
    - Updates dynamically when the associated TreeDataProvider's filters change.

14. **Auto Snapshot Rules UI** (`ui/autoSnapshotRulesUI.ts`)

    - Provides command-driven UI (`showQuickPick`, `showInputBox`) for managing file-specific auto-snapshot rules stored in configuration.
    - Allows adding, editing, viewing, and deleting rules.
    - Validates rule inputs (patterns and intervals).
    - Handles saving rules to VS Code configuration (`workspace.getConfiguration().update`).

15. **Configuration** (`config.ts`)

    - Provides helper functions to access extension settings from `vscode.workspace.getConfiguration`.

16. **Utilities** (`snapshotDiff.ts`, `utils/pathMatching.ts`, `logger.ts`)

    - `snapshotDiff`: Uses the `diff` library to create and apply patches.
    - `pathMatching`: Helper function using `minimatch` for flexible path/pattern comparison.
    - `logger`: Centralized logging utility with verbosity levels controlled by configuration.

17. **Security** (`services/credentialsManager.ts`)

    - **CredentialsManager**: Manages secure storage of sensitive information like API keys using VS Code's SecretStorage API.
    - Provides methods to securely store and retrieve API keys for external services (e.g., Pinecone, Gemini).
    - Handles prompting users for credentials when needed.
    - Ensures sensitive data is never stored in plaintext or version control.
    - Methods include:
      - `getPineconeApiKey()`: Retrieves the stored Pinecone API key.
      - `setFPineconeApiKey(apiKey)`: Securely stores the Pinecone API key.
      - `getGeminiApiKey()`: Retrieves the stored Gemini API key.
      - `setGeminiApiKey(apiKey)`: Securely stores the Gemini API key.
      - `hasCredentials()`: Checks if all required credentials are set.
      - `promptForCredentials()`: Interactive method to collect and store credentials from the user.

18. **Semantic Search Services**

    > ⚠️ **EXPERIMENTAL FEATURE**: Semantic search services are currently experimental features. Use them at your own risk. The functionality may change or have limitations in future releases.

    - **Credentials Manager** (`services/credentialsManager.ts`): Securely stores and retrieves API keys using VS Code's SecretStorage.
    - **Code Chunker** (`services/codeChunker.ts`): Intelligently splits code files into semantic chunks based on language structure.
    - **Vector Database Service** (`services/vectorDatabaseService.ts`): Manages interactions with Pinecone for vector storage and retrieval.
    - **Embedding Service** (`services/embeddingService.ts`): Handles the creation of embeddings using Gemini API.
    - **Semantic Search Service** (`services/semanticSearchService.ts`): Orchestrates the search process, from query to results.
    - **Semantic Search Webview** (`ui/semanticSearchWebview.ts`): Provides a rich interface for semantic search and results visualization.

## Data Storage

### Snapshot Format

Snapshots are stored in the `.snapshots` directory (configurable via `vscode-snapshots.snapshotLocation`) with the following structure:

```
.snapshots/
  ├── index.json              # Master index of all snapshots (IDs, timestamps, descriptions, currentIndex)
  ├── snapshot-1617289464-abc/
  │   └── snapshot.json       # Full metadata and file data for this snapshot
  ├── snapshot-1617289500-def/
  │   └── snapshot.json
  └── ...
```


The `index.json` file contains a summary for quick loading:

```json
{
  "snapshots": [
    // Array of basic info for each snapshot
    {
      "id": "snapshot-1617289464-abc",
      "timestamp": 1617289464000,
      "description": "Initial setup"
    }
    // ... more snapshot summaries
  ],
  "currentIndex": 1 // Index in the 'snapshots' array of the currently restored snapshot (-1 if none)
}
```

Each individual `snapshot.json` file contains the full snapshot details:

```json
{
  "id": "snapshot-1617289500-def",
  "timestamp": 1617289500000,
  "description": "Added login feature",
  "gitBranch": "feature/login", // Optional Git info
  "gitCommitHash": "a1b2c3d4", // Optional Git info
  "tags": ["feature", "login"], // Optional context
  "notes": "Implemented basic email/password login.", // Optional context
  "taskReference": "JIRA-123", // Optional context
  "isFavorite": true, // Optional context
  "isSelective": false, // Indicates if only specific files were included
  "selectedFiles": [], // List of relative paths if isSelective is true
  "files": {
    // File data
    "src/index.js": {
      // Full content for the first time or if base couldn't be resolved
      "content": "console.log('Hello!');"
    },
    "src/utils.js": {
      // Diff patch if changed from base
      "diff": "@@ -1,1 +1,1 @@\n-console.log('Old');\n+console.log('New!');",
      // Reference to the previous snapshot where this file existed
      "baseSnapshotId": "snapshot-1617289464-abc"
    },
    "src/unchanged.js": {
      // No diff or content means it's unchanged from base
      "baseSnapshotId": "snapshot-1617289464-abc"
    },
    "src/deleted.js": {
      // Marker indicating the file was deleted in this snapshot
      "deleted": true
    },
    "images/logo.png": {
      // Marker indicating a binary file (no content/diff stored)
      "isBinary": true,
      "baseSnapshotId": "snapshot-1617289464-abc" // Still tracks existence relative to base
    }
  }
}
```

### Storage Optimization & Caching

The extension uses several techniques to manage storage and performance:

- **Differential Storage**: Only changes (diffs) are stored after the first version of a file, reducing disk usage.
- **Base Snapshot Reference**: Each file change points to the previous snapshot (`baseSnapshotId`) containing the file, allowing reconstruction.
- **Binary File Exclusion**: Files identified as binary (by extension or content analysis) are tracked for existence but their content isn't stored.
- **Ignore File Handling**: `.gitignore` and `.snapshotignore` prevent unnecessary files from being included.
- **Asynchronous I/O**: All file system operations use `fs.promises` to avoid blocking the extension host.
- **Content Caching**: `SnapshotStorage` maintains an in-memory cache (`contentCache`) for resolved file content (`getSnapshotFileContent`). This avoids repeatedly applying diffs for the same file version, significantly speeding up operations like diff views and restores. The cache has a maximum size and uses a simple eviction strategy.

## Core Algorithms

### Snapshot Creation Algorithm (`SnapshotManager.takeSnapshot`)

1.  Generate unique ID and timestamp.
2.  Collect context options (description, tags, notes, etc.) from arguments.
3.  Fetch current Git branch/commit info (if API available and enabled).
4.  Create initial `Snapshot` object.
5.  Instantiate `GitignoreParser`.
6.  **Delegate File Discovery:** Call `vscode.workspace.findFiles` using exclude/negated globs from `GitignoreParser` to get a list of candidate `vscode.Uri`s.
7.  Apply selective filtering if `isSelective` is true, based on `selectedFiles`.
8.  Perform secondary binary content check on suspicious files using `SnapshotStorage.checkSuspiciousFilesForBinaryContent`.
9.  Build a `Set` of relative paths for files existing in the filtered workspace (`currentWorkspaceFiles`).
10. Identify the `baseSnapshot` (if any). Get its file list (`previousSnapshotFiles`).
11. **Iterate through filtered `finalFiles`:**
    - Get relative path.
    - Check if binary using `SnapshotStorage.isBinaryFile`. If yes, record `{ isBinary: true, baseSnapshotId }` and continue.
    - **Delegate Read:** Call `SnapshotStorage.readFileContent` for the current file content. If null, skip.
    - If `baseSnapshot` has this file:
      - **Delegate Base Content Retrieval:** Call `SnapshotStorage.getSnapshotFileContent` for `baseContent`.
      - If `baseContent` exists and differs from current content, calculate `diff` using `createDiff` utility and store `{ diff, baseSnapshotId }`.
      - If `baseContent` exists and is identical, store `{ baseSnapshotId }`.
      - If `baseContent` is null (error), store full `{ content }` as fallback.
    - Else (new file), store full `{ content }`.
12. **Detect Deletions:** Iterate through `previousSnapshotFiles`. If a file is not in `currentWorkspaceFiles`, mark it in the new snapshot as `{ deleted: true }`.
13. **Delegate Save:** Call `SnapshotStorage.saveSnapshotData` to write `snapshot.json`.
14. Add snapshot to in-memory list (`this.snapshots`) and update `currentSnapshotIndex`.
15. **Delegate Index Save:** Call `SnapshotStorage.saveSnapshotIndex`.
16. Enforce snapshot limit (calling `SnapshotStorage.deleteSnapshotData` if needed).
17. Emit `onDidChangeSnapshots` event.
18. Return the created `Snapshot` object.


### Snapshot Restoration Algorithm (`commands.ts` / `SnapshotManager.applySnapshotRestore`)

1.  **Trigger:** User selects "Restore" from Tree View context menu or Quick Pick. Command handler (`jumpToSnapshot`) in `commands.ts` is invoked.
2.  **Calculate Changes:** Command handler calls `SnapshotManager.calculateRestoreChanges` to get a list of added/modified/deleted files relative to the current workspace.
3.  **Show Preview UI:** Command handler displays the changes in a Quick Pick for user review. Files with unsaved changes are marked.
4.  **Confirmation:** User selects "Restore Snapshot" or "Cancel" from the preview.
5.  **Conflict Check:** If confirmed, command handler checks for unsaved changes (`isDirty`) in the affected files.
6.  **Conflict Resolution UI:** If conflicts exist, command handler shows a modal warning with options: "Restore (Overwrite Unsaved)", "Take Snapshot & Restore", "Cancel".
7.  **Preserve Editor State:** Command handler calls `preserveEditorViewStates`.
8.  **Execute Core Restore:** If proceeding, command handler calls `SnapshotManager.applySnapshotRestore(snapshotId)`.
9.  **`applySnapshotRestore` Logic:**
    - Finds the target `snapshot`.
    - Gets current workspace files (using ignore logic).
    - Creates `expectedSnapshotFiles` map from the target snapshot.
    - **Handle Deletions:** Iterates through `currentWorkspaceFilesRelative`. If a file is not in `expectedSnapshotFiles` or marked `deleted` (and is not binary), calls `SnapshotStorage.deleteWorkspaceFile`.
    - **Handle Restorations/Additions:** Iterates through `expectedSnapshotFiles`. If not `deleted` and not `isBinary`:
      - **Delegate Content Retrieval:** Calls `SnapshotStorage.getSnapshotFileContent` (which handles diff resolution and caching).
      - If content is retrieved successfully, calls `SnapshotStorage.writeFileContent`.
    - Waits for all async file operations (`Promise.all`).
    - Updates `currentSnapshotIndex` and calls `SnapshotStorage.saveSnapshotIndex`.
    - Emits `onDidChangeSnapshots`.
    - Returns `true` on success.
10. **Restore Editor State:** Command handler calls `restoreEditorViewStates`.
11. **Show Progress/Completion UI:** Command handler manages `vscode.window.withProgress` and shows final success/error messages.


### File Content Resolution (`SnapshotStorage.getSnapshotFileContent`)

1.  Check cache using `snapshotId::relativePath` key. If hit, return cached value.
2.  Find the requested `snapshot` object in the `allSnapshots` list.
3.  Get the `fileData` for the `relativePath`. Return `null` if file/snapshot not found or `fileData.deleted` is true.
4.  If `fileData.content` exists (string), cache and return it.
5.  If `fileData.baseSnapshotId` exists:
    - Recursively call `getSnapshotFileContent` for the `baseSnapshotId`.
    - If base content is null (error in recursion), return `null`.
    - If `fileData.diff` exists, apply it to the base content using `applyDiff` utility. Cache and return the result (or `null` if patching fails).
    - If `fileData.diff` does _not_ exist, the file is unchanged from base. Cache and return the base content.
6.  If none of the above conditions match (e.g., `content` is explicitly `null` with no `baseSnapshotId`), cache and return `null`.
7.  Update cache before returning. Implement cache eviction if size limit exceeded.


### File Exclusion Logic (`GitignoreParser`, `SnapshotManager.takeSnapshot`)

1.  `GitignoreParser` reads `.snapshotignore` (priority) or `.gitignore`.
2.  Adds default patterns (`.snapshots/`, `node_modules/`, `.git/`, `venv/`, `.venv/`).
3.  Separates patterns into positive (`patterns`) and negated (`negatedPatterns`).
4.  `getExcludeGlobPattern()` converts positive patterns into a single `{...}` glob string for `findFiles`'s `exclude` parameter. Handles basic gitignore syntax nuances (leading/trailing `/`, no `/`).
5.  `getNegatedGlobs()` converts negated patterns into an array of glob strings.
6.  `SnapshotManager.takeSnapshot`:
    - Calls `getExcludeGlobPattern()` for the `exclude` argument in the first `vscode.workspace.findFiles('**/*', excludePattern)`.
    - Calls `getNegatedGlobs()`. For each negated glob, calls `vscode.workspace.findFiles(negatedGlob, null)` to find files that should be re-included.
    - Merges the results, ensuring uniqueness, to get the final list of files to snapshot.

## Error Handling

The extension implements several error handling strategies:

1.  **User Feedback**:

    - Shows clear error/warning/info messages via `vscode.window.showXMessage`.
    - Uses modal dialogs (`showWarningMessage` with `{ modal: true }`) for critical confirmations (delete, restore overwrite).
    - Provides guidance on how to resolve common issues.
    - Logs detailed information to the Output panel via the `logger` module.

2.  **Snapshot Consistency**:

    - `SnapshotStorage.loadSnapshotIndexAndMetadata` handles missing/corrupt `index.json` by attempting recovery from `snapshot.json` files (`recoverSnapshotsFromFileSystem`).
    - Validates snapshot IDs and `currentIndex` after loading/recovery.
    - File operations are atomic where possible (though full atomicity isn't guaranteed across multiple files).

3.  **Conflict Resolution**:

    - `commands.ts` checks for unsaved changes (`document.isDirty`) before snapshot restoration.
    - Prompts user with options ("Overwrite", "Take Snapshot & Restore", "Cancel") if conflicts are detected.
    - Confirms destructive operations (like snapshot deletion) using modal dialogs.

4.  **Asynchronous Operations**: Uses `try...catch` blocks extensively around `await` calls for file I/O and other potentially failing async operations. Logs errors gracefully without crashing the extension where possible.

## Performance Considerations

1.  **File Handling**:

    - **Async I/O**: All file system operations use `fs.promises`, preventing UI blocking.
    - **Optimized Filtering**: `vscode.workspace.findFiles` with glob patterns is used for efficient file discovery, leveraging VS Code's native capabilities. Manual iteration is minimized.
    - **Binary File Handling**: Binary files are detected early (extension, content sampling) and their content is not read/stored, saving I/O and memory.
    - **Differential Storage**: Reduces the amount of data written to disk for subsequent snapshots.

2.  **Memory Usage**:

    - **On-Demand Loading**: Full snapshot data (`snapshot.json`) is loaded only when needed (e.g., when expanding a node in the tree or resolving content). The initial load uses only the lightweight `index.json`.
    - **Content Caching**: `SnapshotStorage.getSnapshotFileContent` caches resolved content, avoiding redundant diff application and significantly improving performance for repeated access (e.g., multiple diff views).
    - **Stream Processing (Potential Future)**: For very large files, stream-based diffing/reading could be considered, though current approach handles typical code files well.

3.  **UI Responsiveness**:
    - **Async Operations**: Ensures UI remains responsive during snapshot creation, restoration, and loading.
    - **Progress Notifications**: `vscode.window.withProgress` provides feedback during long operations (take, restore).
    - *    *Debouncing**: UI updates like editor decorations (`EditorDecorator.triggerUpdateDecorations`) are debounced to prevent excessive updates during rapid typing.
    - **Event-Driven Updates**: Components listen for `onDidChangeSnapshots` or `onDidChangeTreeData` events instead of polling.

## Extension Points & Future Enhancements

The code is designed to be extensible in these key areas:

1.  **Storage Backends**:

    - The `SnapshotStorage` class encapsulates file system logic. It could be adapted or replaced to support alternative backends (e.g., cloud storage, databases) by conforming to a similar interface.

2.  **UI Components**:

    - The Tree View (`ui/treeView.ts`) could be enhanced with different grouping or visualization methods.
    - A dedicated timeline view could be added.
    - The Semantic Search Webview could be enhanced with additional filtering and visualization options.

3.  **Snapshot Operations**:

    - Adding snapshot merging capabilities.
    - Branch-like features (though intended to remain simpler than Git).

4.  **Integration Points**:
    - Deeper Git integration (e.g., comparing snapshots directly with Git commits).
    - Integration with task management extensions based on `taskReference`.
5.  **Semantic Search**:
    - Alternative embedding models beyond Gemini.
    - Support for additional vector databases beyond Pinecone.
    - Enhanced code understanding with more sophisticated chunking strategies.
    - AI-powered query expansion and code explanation.

## Contributing to CodeLapse

Thank you for your interest in contributing!

### Development Environment Setup

1.  **Prerequisites**:

    - Node.js (Check `engines` in `package.json` for recommended version)
    - npm or yarn
    - VS Code

2.  **Clone and Install**:

    ```bash
    git clone https://github.com/yourusername/vscode-snapshots.git # Replace with actual repo URL
    cd vscode-snapshots
    npm install # or yarn install
    code .
    ```

3.  **Development Workflow**:
    - Open the project in VS Code.
    - Press `F5` to launch the Extension Development Host with the extension loaded.
    - Make changes to the code (`src` directory). TypeScript files will be compiled automatically (`npm run watch` or VS Code's build task).
    - Reload the development instance (`Developer: Reload Window` command) to test changes.

### Project Structure

```
vscode-snapshots/
├── .snapshots/           # Snapshot storage (when testing locally)
├── .vscode/              # VS Code settings for development (launch.json, tasks.json)
├── docs/                 # Documentation files (USER_GUIDE.md, DEVELOPER_GUIDE.md, etc.)
├── images/               # Icons and screenshots
├── node_modules/         # Dependencies (generated)
├── out/                  # Compiled JavaScript (generated by tsc)
├── src/                  # TypeScript source code
│   ├── types/            # TypeScript type definitions (git.d.ts, intl.d.ts)
│   ├── ui/               # User interface components (treeView, quickPick, etc.)
│   ├── utils/            # Utility functions (pathMatching, animationHelpers, etc.)
│   ├── changeNotifier.ts # Logic for suggesting snapshots & rule-based auto-snapshots
│   ├── commands.ts       # Command registration and UI flow orchestration
│   ├── config.ts         # Configuration access helpers
│   ├── editorDecorator.ts# Gutter decorations for changes
│   ├── extension.ts      # Extension entry point (activation, initialization)
│   ├── gitignoreParser.ts# Handles file exclusion logic
│   ├── logger.ts         # Logging utility
│   ├── snapshotContentProvider.ts # Content provider for diff views (snapshot-diff: URIs)
│   ├── snapshotDiff.ts   # Diff creation/application utilities (uses 'diff' library)
│   ├── snapshotManager.ts# Core snapshot logic (in-memory state, delegates I/O)
│   ├── snapshotStorage.ts# Handles all file system I/O for snapshots (async)
│   └── statusBarController.ts# Main status bar indicator management
├── .gitignore
├── package.json          # Extension manifest, dependencies, commands, views
├── tsconfig.json         # TypeScript compiler options
└── README.md
```

### Key Files and Their Purposes (Updated)

- **extension.ts**: Entry point; initializes components (`SnapshotManager`, `SnapshotStorage`, UI, etc.), registers command handlers via `registerCommands`. Handles Git API acquisition and setup.
- **commands.ts**: Registers all commands, handles UI flows (prompts, progress, confirmation, conflict resolution), calls `SnapshotManager` for core logic execution.
- **snapshotManager.ts**: Core snapshot logic (in-memory state, create/restore/delete logic _without_ direct UI or FS I/O). Delegates persistence to `SnapshotStorage`.
- **snapshotStorage.ts**: **Crucial**: Handles _all_ asynchronous file system I/O (reading/writing/deleting snapshot data, index, workspace files). Implements diff application and content caching.
- **changeNotifier.ts**: Manages timed notifications and rule-based auto-snapshots (time & save triggered).
- **editorDecorator.ts**: Provides visual gutter indicators for lines changed since the last snapshot.
- **ui/treeView.ts**: Implements the sidebar tree views ("My Snapshots", "Auto Snapshots") including filtering and grouping logic for each view instance.
- **ui/quickPick.ts**: Implements the quick pick list for selecting snapshots ("View Snapshots" command).
- **ui/snapshotContextInput.ts**: Handles multi-step input collection for enhanced snapshot context (description, tags, notes, selective files).
- **ui/autoSnapshotRulesUI.ts**: Provides command-driven UI for managing file-specific auto-snapshot rules in settings.
- **ui/filterStatusBar.ts**: Displays active filter information for each Tree View instance in the status bar.
- **snapshotContentProvider.ts**: Provides content for `snapshot-diff:` URIs used in diff views.
- **statusBarController.ts**: Manages the main status bar indicator.
- **gitignoreParser.ts**: Handles file inclusion/exclusion based on ignore patterns, generating globs for `findFiles`.
- **utils/pathMatching.ts**: Utility for flexible path/pattern matching.
- **snapshotDiff.ts**: Wraps the `diff` library for creating/applying patches.
- **package.json**: Defines extension metadata, commands, views (including the two tree views), activation events, and configuration options.

### Coding Guidelines

#### TypeScript Style Guide

- Use strict TypeScript (`strict: true` in tsconfig.json).
- Use interfaces for complex types (`Snapshot`, `SnapshotIndex`, etc.).
- Use `async`/`await` for all asynchronous operations (especially file I/O in `SnapshotStorage`).
- Document public methods and interfaces with JSDoc comments.
- Use strong typing; avoid `any` where possible. Use specific types from `vscode` API.

#### Code Organization

- Adhere to separation of concerns:
  - `SnapshotManager`: In-memory state and core logic orchestration.
  - `SnapshotStorage`: All file system interaction (async).
  - `commands.ts`: UI flow logic for commands.
  - `ui/`: Self-contained UI components.
- Keep files focused on a single responsibility.
- Extract reusable utilities to `utils/`.
- Use dependency injection (passing instances like `SnapshotManager`, `SnapshotStorage` in constructors).

#### Naming Conventions

- **Files**: `camelCase.ts`.
- **Classes**: `PascalCase`.
- **Interfaces**: `PascalCase`.
- **Methods/Functions**: `camelCase`.
- **Constants**: `UPPER_SNAKE_CASE` for true constants, `camelCase` for configuration values.
- **Private Members**: Prefix with `_` (e.g., `_onDidChangeSnapshots`).

### Extension API Usage

The extension primarily leverages these VS Code API components:

- **Workspace API**: `vscode.workspace.workspaceFolders`, `getConfiguration`, `onDidChangeConfiguration`, `findFiles`, `asRelativePath`, `fs` (via `fs.promises` for async I/O), `applyEdit`.
- **Window API**: `showInformationMessage`, `showWarningMessage`, `showErrorMessage`, `showQuickPick`, `showInputBox`, `createStatusBarItem`, `createOutputChannel`, `withProgress`, `activeTextEditor`, `visibleTextEditors`, `onDidChangeActiveTextEditor`, `createTextEditorDecorationType`.
- **Commands API**: `registerCommand`, `executeCommand`, `getCommands`.
- **TreeView API**: `registerTreeDataProvider`, `createTreeView`, `TreeDataProvider`, `TreeItem`, `ThemeIcon`, `ThemeColor`.
- **StatusBar API**: `createStatusBarItem`, `StatusBarItem`, `StatusBarAlignment`.
- **Extensions API**: `getExtension`, `activate` (for Git extension).
- **Uri API**: `vscode.Uri.parse`, `joinPath`, `file`.
- **TextDocumentContentProvider API**: `registerTextDocumentContentProvider`.
- **Event API**: `vscode.EventEmitter`, `vscode.Event`.

Key extension points used (`package.json`):

- `contributes.commands`: For registering all user-facing and internal commands.
- `contributes.views`: Defines the "Snapshot Explorer" container and the two tree views (`manualSnapshotHistoryView`, `autoSnapshotHistoryView`).
- `contributes.viewsContainers`: Defines the "Snapshot Explorer" activity bar icon and container.
- `contributes.menus`: Defines context menus for tree items (`view/item/context`) and view title actions (`view/title`).
- `contributes.keybindings`: Defines default keyboard shortcuts.
- `contributes.configuration`: Defines user-configurable settings.

### Testing

_(Assumed Testing Strategy - Requires implementation)_

#### Running Tests

```bash
npm test # Or yarn test
```

#### Writing Tests

- Add unit tests for utility functions (`snapshotDiff`, `pathMatching`) and potentially logic within `SnapshotManager` or `GitignoreParser` using mocking frameworks (like `jest` or `mocha` with `sinon`).
- Add integration tests using `vscode-test` to simulate VS Code environment and test command flows, UI interactions, and component integrations.
- Tests should be located in a `src/test` or `test` directory.
- Mock external dependencies (filesystem via `memfs` or similar, VS Code API using testing utilities).
- Cover core scenarios: snapshot creation (full, diff, selective), restoration (add, modify, delete), filtering, navigation, context editing, rule execution.

#### Test Coverage

- Aim for high test coverage, especially for core logic (`SnapshotManager`, `SnapshotStorage`, `snapshotDiff`) and command handlers (`commands.ts`).
- Focus on testing edge cases (empty files, binary files, ignore patterns, snapshot limits, recovery).

### Pull Request Process

1.  **Fork & Branch**: Create a fork and a descriptive branch (`feature/add-x`, `fix/resolve-y`).
2.  **Implement**: Make changes, adhering to coding guidelines.
3.  **Test**: Add/update unit and integration tests. Run `npm test`.
4.  **Document**: Update `README.md`, `DEVELOPER_GUIDE.md`, `USER_GUIDE.md`, and JSDoc as needed.
5.  **Lint**: Run linter (`npm run lint` - if configured).
6.  **Submit PR**: Ensure tests pass. Provide a clear description, link related issues. Follow PR template if available.
7.  **Review & Iterate**: Address feedback, rebase/merge main if necessary.
8.  **Merge**: Maintainers merge upon approval.

### Commit Guidelines

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Example:

```
feat(storage): implement content caching for getSnapshotFileContent

Adds an in-memory cache to SnapshotStorage to avoid redundant diff
application when retrieving file content multiple times for the same
snapshot version. Uses a Map with a simple size limit and eviction.

Improves performance significantly for diff views and restores.

Fixes #42
```

**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
**Scopes**: `manager`, `storage`, `ui`, `commands`, `config`, `git`, `rules`, `test`, etc.

### Feature Requests and Bug Reports

Use GitHub Issues for reporting bugs or suggesting features. Provide detailed information:

- For bugs: Steps to reproduce, expected vs. actual behavior, VS Code version, extension version, relevant logs (from Output panel), screenshots/GIFs if applicable.
- For features: Clear description, motivation/use cases, potential implementation ideas, mockups if possible.

### Documentation

Update relevant documentation (`README.md`, `DEVELOPER_GUIDE.md`, `USER_GUIDE.md`, JSDoc) when making changes. Use clear Markdown and include examples/diagrams where helpful. Ensure documentation reflects the latest architecture and features.

## Key Implementation Details (Updated)

### Asynchronous Operations

All potentially long-running operations, especially file I/O, MUST be asynchronous using `async`/`await` and `fs.promises`. This is critical for UI responsiveness. `SnapshotStorage` is the primary location for async I/O.

```typescript
// Example in SnapshotStorage
public async readFileContent(absolutePath: string): Promise<string | null> {
  try {
    // ... checks ...
    const content = await fsPromises.readFile(absolutePath, "utf8");
    // ... more checks ...
    return content;
  } catch (error) {
    log(`Warning: Error reading file content ${absolutePath}: ${error}`);
    return null;
  }
}
```

### State Management

- **Snapshot List**: The primary list of `Snapshot` objects is held in `SnapshotManager.snapshots`.
- **Current Index**: `SnapshotManager.currentSnapshotIndex` tracks the currently restored snapshot.
- **Filter State**: Each `SnapshotTreeDataProvider` instance holds its own filter state (date, tags, etc.).
- **UI State**: Managed within individual UI components (`commands.ts` orchestrates multi-step inputs).

### Event System

`vscode.EventEmitter` is used for communication between components:

- `SnapshotManager.onDidChangeSnapshots`: Fires when the list of snapshots changes (add, delete, restore). UI components (Tree View, Status Bar) listen to this.
- `SnapshotTreeDataProvider._onDidChangeTreeData`: Fires when the tree view needs to be refreshed (due to snapshot changes or filter changes).
- `SnapshotContentProvider._onDidChange`: Can be used to signal changes to virtual document content (though less critical with nonce usage).

```typescript
// In SnapshotManager
this._onDidChangeSnapshots.fire();

// In extension.ts or UI component constructor
snapshotManager.onDidChangeSnapshots(() => {
  manualSnapshotTreeDataProvider.refresh();
  autoSnapshotTreeDataProvider.refresh();
  // Potentially update other UI elements like status bar
});
```

## Appendix: API Reference (Updated)

### SnapshotManager

```typescript
/** Core manager for snapshot logic (in-memory state). Delegates I/O to SnapshotStorage. */
class SnapshotManager {
  /** Event that fires when snapshots change (add, delete, restore, context update). */
  public readonly onDidChangeSnapshots: vscode.Event<void>;

  constructor(gitApi: GitAPI | null);

  /** Gets the current workspace root path (delegated from storage). */
  public getWorkspaceRoot(): string | null;

  /** Take a new snapshot. Collects files, calculates diffs, delegates saving to storage. */
  public async takeSnapshot(description: string, contextOptions?: {...}): Promise<Snapshot>;

  /** Finds a snapshot by its ID from the in-memory list. */
  public getSnapshotById(snapshotId: string): Snapshot | undefined;

  /** Calculates changes required to restore a snapshot relative to the current workspace. */
  public async calculateRestoreChanges(snapshot: Snapshot, workspaceRoot: string): Promise<ChangeObject[]>;

  /** Applies file changes to restore a snapshot (core file ops via storage, no UI). */
  public async applySnapshotRestore(snapshotId: string): Promise<boolean>;

  /** Navigate to previous snapshot (uses applySnapshotRestore). */
  public async navigateToPreviousSnapshot(): Promise<boolean>;

  /** Navigate to next snapshot (uses applySnapshotRestore). */
  public async navigateToNextSnapshot(): Promise<boolean>;

  /** Get all available snapshots (from in-memory list). */
  public getSnapshots(): Snapshot[];

  /** Get the index of the currently restored snapshot. */
  public getCurrentSnapshotIndex(): number;

  /** Delete a snapshot (updates in-memory list, delegates file deletion to storage). */
  public async deleteSnapshot(snapshotId: string): Promise<boolean>;

  /** Public wrapper to get file content (delegates to storage, uses cache). */
  public async getSnapshotFileContentPublic(snapshotId: string, relativePath: string): Promise<string | null>;

  /** Gets a summary of changes (added, modified, deleted) within a snapshot relative to its base. */
  public getSnapshotChangeSummary(snapshotId: string): { added: number; modified: number; deleted: number };

  /** Restores a single file from a snapshot to the workspace (delegates to storage). */
  public async restoreSingleFile(snapshotId: string, relativePath: string): Promise<void>;

  /** Updates context fields of an existing snapshot (delegates saving to storage). */
  public async updateSnapshotContext(snapshotId: string, contextUpdate: {...}): Promise<boolean>;
}
```

### SnapshotStorage

```typescript
/** Handles all asynchronous file system interactions for snapshots. */
class SnapshotStorage {
  constructor();

  /** Gets the current workspace root path. */
  public getWorkspaceRoot(): string;

  /** Gets the absolute path to the snapshot storage directory. */
  public getSnapshotDirectory(): string;

  /** Loads snapshot index and metadata, attempts recovery if index is missing/corrupt. */
  public async loadSnapshotIndexAndMetadata(): Promise<{
    snapshots: Snapshot[];
    currentIndex: number;
  } | null>;

  /** Saves the snapshot index file (list of snapshot summaries). */
  public async saveSnapshotIndex(
    snapshots: Snapshot[],
    currentIndex: number,
  ): Promise<void>;

  /** Saves the full snapshot data (snapshot.json). */
  public async saveSnapshotData(snapshot: Snapshot): Promise<void>;

  /** Deletes a snapshot's directory and associated data. */
  public async deleteSnapshotData(snapshotId: string): Promise<void>;

  /** Reads workspace file content (async, handles binary exclusion). */
  public async readFileContent(absolutePath: string): Promise<string | null>;

  /** Checks if a file is likely binary based on extension/patterns. */
  public isBinaryFile(filePath: string): boolean;

  /** Performs async content check for potentially binary files. */
  public async checkSuspiciousFilesForBinaryContent(
    filePaths: string[],
  ): Promise<Set<string>>;

  /** Writes content to a workspace file (async, creates dirs). */
  public async writeFileContent(
    absolutePath: string,
    content: string,
  ): Promise<void>;

  /** Deletes a workspace file (async, ignores ENOENT). */
  public async deleteWorkspaceFile(absolutePath: string): Promise<void>;

  /** Retrieves snapshot file content, resolving diffs recursively and using cache. */
  public async getSnapshotFileContent(
    snapshotId: string,
    relativePath: string,
    allSnapshots: Snapshot[],
  ): Promise<string | null>;
}
```

### SnapshotTreeDataProvider

```typescript
/** Tree data provider for snapshot sidebar views (Manual/Auto). */
class SnapshotTreeDataProvider
  implements vscode.TreeDataProvider<SnapshotTreeItem>
{
  readonly onDidChangeTreeData: vscode.Event<
    SnapshotTreeItem | undefined | null | void
  >;

  constructor(snapshotManager: SnapshotManager, snapshotType: SnapshotType);

  /** Triggers a refresh of the tree view. */
  refresh(): void;

  /** Updates the filter state for this specific tree view instance. */
  setFilter(options: {
    startDate?;
    endDate?;
    tags?;
    favoritesOnly?;
    filePattern?;
  }): void;

  // Filter getter methods (getFilterStartDate, getFilterTags, etc.)

  /** Calculates the number of active filters applied to this view. */
  public getActiveFilterCount(): number;

  /** Generates a human-readable description of the active filters for this view instance. */
  public getActiveFiltersDescription(): string;

  /** Returns the tree item representation for the given element. */
  getTreeItem(element: SnapshotTreeItem): vscode.TreeItem;

  /** Returns the children (groups, snapshots, or files) for the given element or root. */
  getChildren(element?: SnapshotTreeItem): Thenable<SnapshotTreeItem[]>;
}
```

_(Other class APIs like `SnapshotQuickPick`, `StatusBarController`, `GitignoreParser`, `SnapshotContentProvider`, etc., follow standard patterns based on their described responsibilities.)_

## Filtering Architecture (Updated)

The snapshot filtering system allows users to narrow down the displayed snapshots in the **My Snapshots** and **Auto Snapshots** views independently.

### Components

1.  **`SnapshotTreeDataProvider`**: Each instance (one for Manual, one for Auto view) maintains its own independent filter state (`filterStartDate`, `filterTags`, etc.). The filtering logic is applied within its `getChildren` method when retrieving root elements.
2.  **`commands.ts` (Filter Commands)**: Commands like `filterByDate`, `filterByTags`, etc., are registered. They typically:
    - Use `getTargetProviders` helper to ask the user whether to apply the filter to the "Active View Only" or "Both Views".
    - Prompt the user for filter criteria (e.g., select tags, enter pattern).
    - Call the `setFilter` method on the target `SnapshotTreeDataProvider` instance(s).
3.  **`FilterStatusBar`**: An instance is created for each `SnapshotTreeDataProvider`. It listens for `onDidChangeTreeData` on its provider and updates a dedicated status bar item (right side) to show the active filter count and description for that specific view. Clicking it triggers the `clearAllFilters` command.
4.  **`package.json` (Menus)**: Filter commands are contributed to the `view/title` menu context, making them appear as icons in the title bar of each snapshot tree view.

### Workflow

1.  User clicks a filter icon (e.g., `$(tag)`) in the title bar of either the "My Snapshots" or "Auto Snapshots" view.
2.  The corresponding filter command (e.g., `vscode-snapshots.filterByTags`) is executed.
3.  The command handler asks the user where to apply the filter ("Active" or "Both").
4.  The command handler prompts for filter details (e.g., shows tag selection Quick Pick).
5.  Upon user confirmation, the command handler calls `setFilter` on the appropriate `SnapshotTreeDataProvider` instance(s).
6.  `setFilter` updates the internal filter state of the provider(s).
7.  `setFilter` calls `refresh()`, which fires the `_onDidChangeTreeData` event.
8.  VS Code calls the `getChildren` method of the affected provider(s).
9.  `getChildren` fetches all snapshots, applies the _instance's_ current filter state, groups the results, and returns the filtered/grouped `SnapshotTreeItem`s.
10. The `FilterStatusBar` associated with the affected provider(s) also receives the `onDidChangeTreeData` event and updates its display based on the provider's new filter state.

This design ensures that each view (Manual/Auto) can have independent filters, while providing a unified command interface and clear status indication.
