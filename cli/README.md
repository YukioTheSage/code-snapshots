# CodeLapse CLI

[![GitHub Repository](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/YukioTheSage/code-snapshots)
[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-green?logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
[![Issues](https://img.shields.io/github/issues/YukioTheSage/code-snapshots)](https://github.com/YukioTheSage/code-snapshots/issues)
[![License](https://img.shields.io/github/license/YukioTheSage/code-snapshots)](https://github.com/YukioTheSage/code-snapshots/blob/main/LICENSE)

A comprehensive command-line interface for CodeLapse snapshots - bringing
snapshot-driven development to your terminal for automation, AI integration
and advanced workflows. Snapshot CRUD, file operations, `filter`, `rules`,
`diagnostics` (except `diagnostics logs --follow`), config, the `git`
family and `workspace info` run **standalone**, with no VS Code; semantic
search, `analyze`, `chunk`, `watch`, `workspace state` / `workspace files`
and `utility` need the extension running, and the extension UI has no CLI
surface in either mode.
The full matrix is in [API.md](API.md#mode-availability).

> ⚠️ **EXPERIMENTAL FEATURE - SECURITY WARNING**: Semantic search is currently experimental with significant security and privacy risks:
> - **Data Privacy**: Your code content is transmitted to external AI services (Pinecone, Gemini)
> - **API Key Security**: Requires third-party API keys that may expose sensitive information
> - **Network Exposure**: Code is processed by external services over the internet
> - **Functionality Changes**: Features may change or be removed without notice
> - **Cost Implications**: API usage may incur charges on your accounts
> - **NOT RECOMMENDED** for proprietary, sensitive, or confidential codebases
> - **Use at your own risk** and ensure compliance with your organization's security policies

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [User Guides](#user-guides)
  - [For Developers](#for-developers)
  - [AI agents](#ai-agents)
  - [For DevOps/Automation](#for-devopsautomation)
- [AI Agent Guide](AI_GUIDE.md)
- [AI-Friendly Features](#ai-friendly-features)
- [Command Reference](#command-reference)
- [Integration Examples](#integration-examples)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [Support & Community](#support--community)

## Prerequisites

### Required Components

- **Node.js**: Version 18.15.0 or higher (CI runs Node 20)
- **Optional**: VS Code & CodeLapse Extension (required only for IPC mode and AI features)

### Modes of Operation

The CLI supports two modes of operation:

1. **Standalone Mode** (Default):
   - Works independently without VS Code
   - Manages snapshots directly on disk
   - Supports core snapshot operations (create, list, restore, etc.)
   - Ideal for CI/CD, servers, and headless environments

2. **IPC Mode**:
   - Requires VS Code extension running
   - Connects to the extension via local server
   - Enables AI features (Semantic Search) and real-time UI updates

### Step-by-Step Setup

#### 1. Install CLI Tool
```bash
# Global installation (recommended)
npm install -g codelapse-cli

# Or use npx for one-time usage
npx codelapse-cli --help
```

#### 2. (Optional) Install VS Code Extension
For AI features and visual management:
1. Open VS Code
2. Search for "CodeLapse" in Extensions
3. Install the extension by YukioTheSage

### Verification Steps

#### 1. Check CLI Installation
```bash
# Verify CLI is installed
codelapse --version
```

#### 2. Verify Standalone Mode
```bash
# Go to any project folder
cd my-project

# Initialize/Check status
codelapse status
# Output: ✓ Connected (standalone mode)
```

#### 3. Verify IPC Mode (Optional)
```bash
# Open VS Code with the project
code .

# Check status (CLI will auto-detect extension)
codelapse status
# Output: ✓ Connected to CodeLapse extension
```

### Troubleshooting Setup

If verification fails:

1. **CLI not found**: Verify Node.js is installed and npm global packages are in your PATH
2. **IPC Connection failed**: Make sure VS Code is running if you specifically need IPC features
3. **Standalone issues**: Ensure you are in a valid project directory (has package.json or .git)

## Installation

> ⚠️ **NOTE**: The CLI can run in **Standalone Mode** without VS Code. However, for AI features and visual management, the VS Code extension is required.

### Install the CLI

```bash
# Global installation (recommended)
npm install -g codelapse-cli

# Or use npx for one-time usage
npx codelapse-cli --help
```

### Verify Installation

After installing the CLI, verify it can see your workspace. No VS Code is
needed for this - the CLI runs standalone by default:

```bash
# Check CLI version
codelapse --version

# Check the workspace and which mode was selected
codelapse status --json

# Expected output (`mode` is `standalone` when no extension answered). A
# brand-new workspace writes the store-absent notice to stderr - it never
# joins stdout:
# Snapshot index file not found. Starting with empty state.
# {
#   "success": true,
#   "connected": true,
#   "mode": "standalone",
#   "workspace": "/path/to/your/project",
#   "totalSnapshots": 0,
#   "currentSnapshot": null
# }
```

If the check fails, refer to the [Prerequisites](#prerequisites) section above
for setup instructions and troubleshooting steps. Which commands do need the
extension is set out in [API.md](API.md#mode-availability).

> 💡 **Tip**: The CLI works great on its own! Use it in CI/CD pipelines, on servers, or for quick terminal operations. Connect to VS Code when you need visual tools.

## Quick Start

### Basic Workflow
1. **Check the workspace:**
   ```bash
   codelapse status --json
   ```

2. **Create a snapshot:**
   ```bash
   codelapse snapshot create "My changes" --tags "feature,wip" --json
   ```

3. **List snapshots:**
   ```bash
   codelapse snapshot list --json
   ```

4. **Search snapshots:** ⚠️ **(Experimental - use at your own risk)**
   ```bash
   # needs the CodeLapse extension running
   codelapse search query "authentication code" --json
   ```

## User Guides

### For Developers

#### Interactive Development Workflow
Perfect for manual development and debugging:

```bash
# Create a snapshot before starting work
codelapse snapshot create "Before implementing user auth" --tags "checkpoint"

# Work on your code...

# Create another snapshot after major changes
codelapse snapshot create "User auth implementation complete" --tags "feature,auth" --favorite

# Compare your changes
codelapse snapshot compare snapshot-123 snapshot-124

# Navigate between snapshots
codelapse snapshot navigate next
codelapse snapshot navigate previous
```

#### Code Review and Collaboration
```bash
# Export snapshot for sharing (needs the CodeLapse extension running)
codelapse utility export snapshot-123 --format zip --output ./auth-feature.zip

# Validate snapshot integrity (needs the CodeLapse extension running)
codelapse utility validate snapshot-123

# Show detailed snapshot information
codelapse snapshot show snapshot-123 --files --content src/auth.ts
```

### AI agents

`codelapse` is built to be driven by an agent, and the contract is short:

1. `--json` and **not** `--silent`. What the flag suppresses, and which
   commands print anyway, are stated once in
   [HELP.md's Global Options](HELP.md#global-options) instead of being repeated
   here.
2. Branch on the exit code: 0 when the payload's `success` is `true`, 1 when it
   is `false` - for every command, `api` and `batch` included.
3. After a fan-out call, check `failedQueries` / `failedOperations` (and a
   batch's `failed` count): `success: true` alone is not proof that every item
   worked.
4. Back up before changes: create a snapshot first, and restore it instead of
   improvising when a step fails.

**Full guide: [AI_GUIDE.md](AI_GUIDE.md)**

### For DevOps/Automation

#### CI/CD Integration
Perfect for automated testing and deployment pipelines:

```bash
# Pre-deployment snapshot
codelapse snapshot create "Pre-deployment: $(git rev-parse --short HEAD)" --tags "deployment,$(git branch --show-current)" --silent

# Validate the workspace the CLI sees
codelapse workspace info --json

# Create release snapshot
codelapse snapshot create "Release v$(cat package.json | jq -r .version)" --tags "release,production" --favorite --silent
```

#### Automated Testing Workflows
```bash
# Create test checkpoint
codelapse snapshot create "Before test run" --tags "test,checkpoint" --silent

# Run tests and capture results
if npm test; then
  codelapse snapshot create "Tests passed: $(date)" --tags "test,success" --silent
else
  codelapse snapshot create "Tests failed: $(date)" --tags "test,failure" --silent
  # Optionally restore to last known good state
  codelapse snapshot restore last-good-snapshot --backup --silent
fi
```

#### Environment Management
```bash
# Capture environment state
codelapse snapshot create "Environment: $(NODE_ENV)" --tags "environment,$(NODE_ENV)" --silent

# Switch between environment configurations
codelapse snapshot restore dev-config-snapshot --files "config/" --silent
```

## AI-Friendly Features

### JSON Output Mode
All commands support the `--json` flag for structured, machine-readable output.

Verified against the built `dist/cli.js` for `status`, `snapshot list`,
`snapshot show`, `git info`, `git compare`, `config list/get/validate/export`,
`workspace info/state/files`, `rules list`, `filter favorites/tags/file/date`,
`diagnostics system/health/performance`, `files list/history/export`,
`utility validate`, `analyze chunk/file/quality`, `search query`,
`search index` and `api`: every one wrote a single JSON object to stdout and
exit code 0 or 1 agreeing with its own `success` field. Human-readable progress,
warnings and storage notices go to **stderr**, so stdout carries the payload and
nothing else: the store-absent notice (`Snapshot index file not found. Starting
with empty state.`) that standalone mode writes until a snapshot-writing command
creates the store is on stderr too. Parse the payload directly.

```bash
# Success response
{
  "success": true,
  "snapshot": { "id": "snapshot-123", "description": "My changes" },
  "message": "Snapshot created successfully"
}

# Error response
{
  "success": false,
  "error": "Failed to connect to CodeLapse extension: Connection timeout"
}
```

### Silent Mode
Use `--json`; add `--silent` only when you want no output at all. `--silent`
suppresses banners, spinners and progress messages *and the JSON envelope with
them*, so a command routed through the shared result printer prints no payload
when both flags are set - the exit code is then the whole result. The
store-absent notice described under [JSON Output Mode](#json-output-mode) goes
to stderr, so it does not appear on the payload stream either. `--silent` is
**not** a way to skip a confirmation prompt: only the flag a command's own
`--help` documents as skipping it does that, and not every command has one. The
full contract is in [HELP.md's Global Options](HELP.md#global-options).

```bash
# No payload is printed; branch on the exit code
codelapse snapshot create "Auto snapshot" --silent

# The payload is printed, for a script that reads it
codelapse snapshot create "Auto snapshot" --json
```

### Batch Operations
Execute multiple commands from a single JSON file for complex, automated workflows.

```bash
# batch-commands.json
[
  { "method": "takeSnapshot", "data": { "description": "Before refactor" } },
  { "method": "getSnapshots", "data": { "limit": 10 } }
]

codelapse batch batch-commands.json
```

A `{ "commands": [ ... ] }` wrapper around the same array is accepted too.
Entries are validated against the API allowlist before anything runs, and a
failing command is reported per entry without stopping the batch.

### Real-time Event Streaming
Use `codelapse watch` to monitor for snapshot and workspace changes in real-time, enabling reactive AI workflows.

```bash
# needs the CodeLapse extension running
codelapse watch --events snapshots,workspace --json
# Outputs: {"type": "event", "event": {"type": "snapshot_created", "data": {...}}}
```

### Direct API Access
The `codelapse api` command provides a direct, low-level interface to the CodeLapse extension API for maximum flexibility.

```bash
codelapse api takeSnapshot --data '''{"description": "Test", "tags": ["auto"]}'''
```

> **Agent guidance lives in one place.** The operating contract is in
> [AI agents](#ai-agents); the full rules, loop and recipes are in
> [AI_GUIDE.md](AI_GUIDE.md). They are not repeated here.

## Command Reference

> **Which families need the extension.** Semantic search (`search`,
> `search-enhanced`), analysis (`analyze`), chunking (`chunk`), live events
> (`watch`), `workspace state` / `workspace files` and `utility` are served
> over IPC only - they need VS Code running with CodeLapse enabled and fail
> standalone. Everything else below also runs without it; the full matrix is
> in [API.md's mode availability](API.md#mode-availability).

### Global Options
- `--json`: Output in JSON format.
- `--silent`: Output suppression - no spinners, banners or progress messages,
  and no JSON envelope either. It does not skip a confirmation prompt. The
  contract, including the commands that print anyway, is in
  [HELP.md's Global Options](HELP.md#global-options).
- `--verbose`: Enable verbose output for debugging.
- `--timeout <ms>`: Connection timeout in milliseconds (default: 5000).

> **There is no `--mode` flag.** The client always runs in `auto`: it uses the
> standalone snapshot store when one is available and falls back to IPC when it
> is not, so what answers decides the mode, not a flag. `status --json` reports
> which one served the run in its `mode` field (`"standalone"` or `"ipc"`). The
> flag cannot be exposed as `--mode` because a program-level option shadows the
> same-named subcommand option, and `search query` / `search-enhanced query`
> declare `-m, --mode` for search strategy; adding it silently reset that to its
> default. Any future selector needs a non-colliding name such as
> `--client-mode`.

### Connection & Status

#### `codelapse status`
Report the active mode, the workspace and the snapshot count. No VS Code
is required: standalone mode answers with `"mode": "standalone"`.

**Returns**
```json
{
  "success": true,
  "connected": true,
  "mode": "standalone",
  "workspace": "/path/to/project",
  "totalSnapshots": 42,
  "currentSnapshot": "snap-1"
}
```

### Snapshot Management (`codelapse snapshot`)

#### `create [description]`
Create a new snapshot.
- `-t, --tags <tags>`: Comma-separated tags.
- `-n, --notes <notes>`: Snapshot notes.
- `-r, --task-ref <ref>`: Task reference (e.g., Jira ticket).
- `-f, --favorite`: Mark as a favorite.
- `-s, --selective`: Create a snapshot of only specific files.
- `--files <files>`: Comma-separated file paths for a selective snapshot.

**Returns**
```json
{
  "success": true,
  "snapshot": {
    "id": "snapshot-123",
    "description": "My changes",
    "timestamp": "2023-10-27T10:00:00Z",
    "gitBranch": "main",
    "gitCommitHash": "a1b2c3d",
    "tags": ["feature", "wip"],
    "notes": "Implemented the new login flow.",
    "taskReference": "JIRA-123",
    "isFavorite": true,
    "isSelective": false,
    "selectedFiles": []
  },
  "message": "Snapshot 'My changes' created successfully"
}
```

#### `list`
List all snapshots with filtering.
- `-t, --tags <tags>`: Filter by tags.
- `-f, --favorites`: Show only favorites.
- `-l, --limit <number>`: Limit number of results.
- `--since <date>`: Show snapshots since a date (ISO string or relative like "1h", "2d").

**Returns**
```json
{
  "success": true,
  "snapshots": [
    {
      "id": "snapshot-123",
      "description": "My changes",
      "timestamp": "2023-10-27T10:00:00Z",
      "tags": ["feature", "wip"]
    }
  ],
  "total": 1
}
```

#### `show <id>`
Show detailed information for a single snapshot.
- `--files`: Show file changes within the snapshot.
- `--content <file>`: Show the content of a specific file from the snapshot.

**Returns**
```json
{
  "success": true,
  "snapshot": {
    "id": "snapshot-123",
    "description": "My changes",
    "timestamp": "2023-10-27T10:00:00Z",
    "gitBranch": "main",
    "gitCommitHash": "a1b2c3d",
    "tags": ["feature", "wip"],
    "notes": "Implemented the new login flow.",
    "taskReference": "JIRA-123",
    "isFavorite": true,
    "isSelective": false,
    "selectedFiles": []
  },
  "changes": {
    "added": ["src/new-file.ts"],
    "modified": ["src/existing-file.ts"],
    "deleted": []
  },
  "fileContent": {
    "filePath": "src/new-file.ts",
    "content": "console.log('hello world');"
  }
}
```

#### `restore <id>`
Restore a snapshot, overwriting local files.
- `--backup`: Create a new snapshot of the current state before restoring.
- `--files <files>`: Restore only specific files from the snapshot.
- `-y, --yes`: Accept discarding unsaved editor changes over IPC; a restore that would overwrite them is refused without it.

**Returns**
```json
{
  "success": true,
  "result": {
    "restoredSnapshotId": "snapshot-123",
    "backupSnapshotId": "snapshot-124"
  },
  "message": "Snapshot snapshot-123 restored successfully"
}
```

#### `delete <id>`
Delete a snapshot.
- `-y, --yes`: Skip the confirmation prompt.

**Returns**
```json
{
  "success": true,
  "result": {
    "deletedSnapshotId": "snapshot-123"
  },
  "message": "Snapshot snapshot-123 deleted successfully"
}
```

#### `compare <id1> <id2>`
Compare two snapshots to see the differences.
- `--files`: Show only file-level changes (added, removed, modified).

**Returns**
```json
{
  "success": true,
  "comparison": {
    "addedFiles": ["src/new-feature.ts"],
    "removedFiles": [],
    "modifiedFiles": ["src/main.ts"],
    "identicalFiles": ["package.json"]
  },
  "summary": {
    "addedFiles": 1,
    "removedFiles": 0,
    "modifiedFiles": 1,
    "identicalFiles": 1
  }
}
```

#### `navigate <direction>`
Navigate to the `previous` or `next` snapshot.

**Returns**
```json
{
  "success": true,
  "navigation": {
    "fromSnapshotId": "snapshot-123",
    "toSnapshotId": "snapshot-124",
    "direction": "next"
  },
  "message": "Navigated to next snapshot"
}
```

### Semantic Search (`codelapse search`) ⚠️ **(Experimental - Security Risks)**

> ⚠️ **CRITICAL SECURITY WARNING**: 
> - **Data Exposure**: Your code content is sent to external AI services (Pinecone, Gemini)
> - **API Key Risks**: Third-party services require API keys with potential security implications
> - **Privacy Concerns**: Code is processed by external providers over the internet
> - **Compliance Issues**: May violate organizational security policies
> - **Cost Impact**: API usage may result in unexpected charges
> - **Functionality Instability**: Experimental features may change or break without notice
> - **AVOID** using with proprietary, sensitive, or confidential code

#### `query <query>` ⚠️ **(Experimental - Use with Extreme Caution)**
Search snapshots using natural language (enhanced with AI-optimized features).
- `-l, --limit <number>`: Limit results (default: 20).
- `-t, --threshold <number>`: Score threshold 0-1 (default: 0.65).
- `--snapshots <ids>`: Comma-separated list of snapshot IDs to search within.
- `--languages <langs>`: Filter by languages (e.g., "typescript,python").
- `-m, --mode <mode>`: Search mode: semantic, syntactic, behavioral, hybrid.
- `--no-explanations`: Disable result explanations.
- `--no-relationships`: Disable relationship information.
- `--no-quality`: Disable quality metrics.
- `-c, --context <lines>`: Context radius in lines (default: 5).
- `-r, --ranking <strategy>`: Ranking strategy: relevance, quality, recency, usage.
- `--complexity-min <number>`, `--complexity-max <number>`: Complexity score range.
- `--quality-min <number>`: Minimum quality threshold.
- `--semantic-types <types>`, `--patterns <patterns>`, `--exclude-smells <smells>`, `--domains <domains>`: Advanced filtering by types, patterns, smells, and domains.
- `--max-per-file <number>`: Maximum results per file.
- `--no-diversify`: Disable result diversification.

**Returns**
```json
{
  "success": true,
  "query": "authentication code",
  "results": [
    {
      "snapshotId": "snapshot-123",
      "score": 0.85,
      "matches": [
        {
          "filePath": "src/auth.ts",
          "line": 42,
          "content": "function authenticate(user, pass) { ... }"
        }
      ]
    }
  ],
  "total": 1
}
```

#### `behavioral <description>`
Search for code based on behavioral description.
- Supports filtering options similar to `query` including `-l`, `-t`, `--snapshots`, `--languages`, `-c`, and quality/complexity filters.

#### `pattern <pattern-type>`
Search for specific design patterns or code structures.
- Supports filtering options similar to `query`.

#### `batch <queries-file>`
Execute multiple search queries from a JSON file.
- `--no-parallel`: Disable parallel processing.
- `--concurrency <number>`: Maximum concurrent queries (default: 3).

#### `index` ⚠️ **(Experimental)**
Manage the semantic search index.
- `--all`: Index all snapshots.

**Returns**
```json
{
  "success": true,
  "indexing": {
    "indexedSnapshots": ["snapshot-123", "snapshot-124"],
    "status": "completed"
  },
  "message": "Snapshots indexed successfully"
}
```

### Workspace (`codelapse workspace`)

#### `info`
Show workspace information (root path, etc.).

**Returns**
```json
{
  "success": true,
  "workspace": {
    "rootPath": "/path/to/project",
    "name": "my-project",
    "openFiles": ["src/main.ts"],
    "changedFiles": ["src/main.ts"],
    "activeFile": "src/main.ts"
  }
}
```

#### `state`
Show the current workspace state (open files, changed files).

**Returns**
```json
{
  "success": true,
  "state": {
    "openFiles": ["src/main.ts"],
    "changedFiles": ["src/main.ts"],
    "activeFile": "src/main.ts"
  }
}
```

#### `files`
List workspace files.
- `--changed`: Show only changed files.

**Returns**
```json
{
  "success": true,
  "files": {
    "openFiles": ["src/main.ts"],
    "changedFiles": ["src/main.ts"],
    "activeFile": "src/main.ts"
  }
}
```

### Utilities (`codelapse utility`)

#### `validate <id>`
Validate the integrity of a snapshot.

**Returns**
```json
{
  "success": true,
  "validation": {
    "isValid": true,
    "checkedFiles": 10,
    "issues": []
  },
  "message": "Snapshot is valid"
}
```

#### `export <id>`
Export a snapshot to a file.
- `-f, --format <format>`: Export format (`json` or `zip`).
- `-o, --output <path>`: Output file path.

**Returns**
```json
{
  "success": true,
  "export": {
    "exportPath": "/path/to/export.zip",
    "format": "zip"
  },
  "message": "Snapshot exported to /path/to/export.zip"
}
```

### Enhanced Search (`codelapse search-enhanced`)

Enhanced semantic search commands specifically designed for AI agents, providing advanced filtering, context, and quality metrics.

#### `query <query>`
Enhanced semantic search with AI-optimized features.
- `-l, --limit <number>`: Limit results (default: 20).
- `-t, --threshold <number>`: Score threshold 0-1 (default: 0.65).
- `--snapshots <ids>`: Search specific snapshots.
- `-m, --mode <mode>`: Search mode: semantic, syntactic, behavioral, hybrid.
- `-c, --context <lines>`: Context radius in lines (default: 5).
- `-r, --ranking <strategy>`: Ranking strategy: relevance, quality, recency, usage.

#### `behavioral <description>`
Search for code based on behavioral description.

#### `pattern <pattern-type>`
Search for specific design patterns or code structures.

#### `batch <queries-file>`
Execute multiple search queries from a JSON file.

---

### Code Analysis (`codelapse analyze`)

Code analysis commands for AI agents to evaluate code quality, structure, and metrics.

#### `chunk <chunk-id>`
Analyze a specific code chunk.
- `-s, --snapshot <id>`: Snapshot ID (required).
- `-t, --type <type>`: Analysis type: full, quick, quality (default: full).

#### `file <file-path>`
Analyze a complete file.
- `-s, --snapshot <id>`: Snapshot ID (required).

#### `quality <target>`
Analyze code quality metrics.
- `-s, --snapshot <id>`: Snapshot ID (required).
- `-m, --metrics <metrics>`: Specific metrics: readability, maintainability, complexity, documentation.

#### `relationships <chunk-id>`
Analyze chunk relationships and dependencies.
- `-d, --depth <number>`: Maximum relationship depth (default: 3).

#### `batch <input-file>`
Execute multiple analysis operations from a JSON file.

---

### Code Chunking (`codelapse chunk`)

Enhanced code chunking commands for context extraction and management.

#### `file <file-path>`
Chunk a specific file with enhanced strategies.
- `-s, --snapshot <id>`: Snapshot ID (required).
- `--strategy <strategy>`: Chunking strategy: semantic, hierarchical, context-aware.

#### `snapshot <snapshot-id>`
Chunk all files in a snapshot.

#### `list <snapshot-id>`
List chunks in a snapshot with filtering and pagination.

#### `metadata <chunk-id>`
Get detailed metadata for a chunk.

#### `context <chunk-id>`
Get contextual information for a chunk.

#### `dependencies <chunk-id>`
Get chunk dependencies and relationships.

---

### Git Integration (`codelapse git`)

#### `commit <snapshot-id>`
Create a Git commit from a snapshot.
- `-m, --message <message>`: Commit message (auto-generated if omitted).
- `-b, --branch <name>`: Create a new branch for the commit.
- `-u, --include-untracked`: Include untracked files.
- `-p, --push`: Push commit to remote.

**Returns**
```json
{
  "success": true,
  "commit": {
    "hash": "a1b2c3d",
    "message": "My commit message",
    "branch": "main"
  },
  "message": "Git commit created successfully"
}
```

#### `auto-commit <operation>`
Create an auto-snapshot before a Git operation. Works in both modes. Standalone
takes the snapshot itself — no `git` binary is needed, because the operation is a
label for the snapshot description — and returns the same payload the extension
returns: `{ snapshot: { id, description } }`, tagged `['auto', 'git']`.
- `-d, --description <desc>`: Snapshot description.
- `-u, --include-untracked`: Recorded in the snapshot notes only; it does not
  change which files are captured (the snapshot takes untracked files either
  way).

**Returns**
```json
{
  "success": true,
  "snapshot": {
    "id": "snapshot-123",
    "description": "Pre-operation backup"
  }
}
```

#### `info`
Get current Git repository information.

**Returns**
```json
{
  "success": true,
  "info": {
    "branch": "main",
    "commit": "a1b2c3d",
    "isDirty": false
  }
}
```

#### `branches`
List available Git branches.

**Returns**
```json
{
  "success": true,
  "branches": ["main", "feature/auth", "develop"],
  "currentBranch": "main"
}
```

#### `branch <name>`
Create a new Git branch.
- `-c, --checkout`: Switch to branch after creating.

**Returns**
```json
{
  "success": true,
  "message": "Branch 'feature/auth' created successfully"
}
```

#### `checkout <name>`
Switch to an existing Git branch.

**Returns**
```json
{
  "success": true,
  "message": "Switched to branch 'feature/auth'"
}
```

#### `delete-branch <name>`
Delete a Git branch.
- `-f, --force`: Force delete branch.

**Returns**
```json
{
  "success": true,
  "message": "Branch 'feature/auth' deleted successfully"
}
```

#### `compare <snapshot-id> <commit-hash>`
Compare a snapshot with a Git commit.
- `-f, --files`: Show file-level changes only.

**Returns**
```json
{
  "success": true,
  "comparison": {
    "addedFiles": ["src/new-feature.ts"],
    "removedFiles": [],
    "modifiedFiles": ["src/main.ts"]
  }
}
```

## Error Handling

### Standard Error Response Format

When a command fails, it returns a standardized JSON error object:

```json
{
  "success": false,
  "error": "A detailed error message explaining what went wrong.",
  "errorCode": "CONNECTION_TIMEOUT",
  "details": {
    "command": "snapshot create",
    "timestamp": "2023-10-27T10:00:00Z",
    "context": {}
  }
}
```

### Common Error Scenarios

#### Connection Errors

**Error**: Extension not running or not connected
```json
{
  "success": false,
  "error": "Failed to connect to CodeLapse extension: Connection refused",
  "errorCode": "CONNECTION_REFUSED"
}
```

**Solution**: Ensure VSCode is running with CodeLapse extension enabled.

**Error**: Connection timeout
```json
{
  "success": false,
  "error": "Failed to connect to CodeLapse extension: Connection timeout",
  "errorCode": "CONNECTION_TIMEOUT"
}
```

**Solution**: Increase timeout with `--timeout 10000` or check network connectivity.

#### Snapshot Errors

**Error**: Snapshot not found
```json
{
  "success": false,
  "error": "Snapshot with ID 'snapshot-123' not found",
  "errorCode": "SNAPSHOT_NOT_FOUND"
}
```

**Solution**: Verify snapshot ID with `codelapse snapshot list`.

**Error**: Snapshot creation failed
```json
{
  "success": false,
  "error": "Failed to create snapshot: Workspace has no changes",
  "errorCode": "NO_CHANGES_TO_SNAPSHOT"
}
```

**Solution**: Make changes to files or use `--force` flag if available.

#### Workspace Errors

**Error**: No workspace open
```json
{
  "success": false,
  "error": "No workspace is currently open in VSCode",
  "errorCode": "NO_WORKSPACE"
}
```

**Solution**: Open a folder or workspace in VSCode.

**Error**: File access denied
```json
{
  "success": false,
  "error": "Permission denied accessing file: /path/to/file.ts",
  "errorCode": "FILE_ACCESS_DENIED"
}
```

**Solution**: Check file permissions or run with appropriate privileges.

#### Semantic Search Errors ⚠️ **(Experimental)**

**Error**: API key not configured
```json
{
  "success": false,
  "error": "Semantic search requires API key configuration",
  "errorCode": "API_KEY_MISSING"
}
```

**Solution**: Configure API key in VSCode settings or disable semantic search.

**Error**: Search index not available
```json
{
  "success": false,
  "error": "Search index not found. Run 'codelapse search index' first",
  "errorCode": "INDEX_NOT_FOUND"
}
```

**Solution**: Build search index with `codelapse search index`.

### Error Handling Best Practices

#### For Developers
```bash
# Always check command success
if ! codelapse snapshot create "My changes" --silent; then
  echo "Snapshot creation failed"
  exit 1
fi

# Parse JSON responses properly
RESULT=$(codelapse snapshot list --json | tail -n 1)
if echo "$RESULT" | jq -e '.success' > /dev/null; then
  echo "Command succeeded"
else
  ERROR=$(echo "$RESULT" | jq -r '.error')
  echo "Command failed: $ERROR"
fi
```

> **For agent scripts.** The backup-and-restore error handler and the fan-out
> result checks are documented in [AI agents](#ai-agents) and
> [AI_GUIDE.md](AI_GUIDE.md).

#### For CI/CD Systems
```bash
# Fail-safe CI integration
set -euo pipefail

# Create backup before operations. Capture first: the selector must not sit
# between the command and the abort that depends on its status.
BACKUP_JSON=$(codelapse snapshot create "CI: Pre-operation backup" \
  --tags "ci,backup" --json)
BACKUP_ID=$(printf '%s\n' "$BACKUP_JSON" | tail -n 1 | jq -r '.snapshot.id')

# Execute operations with error handling
if ! npm test; then
  echo "Tests failed, creating failure snapshot"
  codelapse snapshot create "CI: Test failure $(date)" \
    --tags "ci,failure" --silent
  
  echo "Restoring backup state"
  codelapse snapshot restore "$BACKUP_ID" --backup --silent
  
  exit 1
fi
```

## Troubleshooting

### Connection Issues

#### Problem: "Failed to connect to CodeLapse extension"
**Symptoms**: Commands fail with connection errors like "Connection refused", "Connection timeout", or "Extension not found"

**Root Cause**: The method you called is one that standalone mode does not
implement - the CLI itself does not need the extension. Snapshot CRUD, file
operations, `filter`, `rules`, `diagnostics` (except `logs --follow`),
config, the `git` family and `workspace info` all run without it; only the
commands marked *Extension* in
[API.md's mode matrix](API.md#mode-availability) need VS Code running. Those
fail with `Method <name> is not available in standalone mode and no CodeLapse
extension answered over IPC (<connection error>)` rather than returning
invented data. `diagnostics logs --follow` is the one exception to that
message - it needs the extension to stream and fails with "Streaming logs
requires the CodeLapse extension over IPC; standalone mode has no log source."
instead.

**Solutions**:

**Step 1: Install the VS Code Extension (only for the commands in the matrix)**
If you haven't installed the extension yet:
1. **Direct Installation**: [Install CodeLapse Extension](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
2. **Via VS Code**:
   - Open VS Code
   - Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
   - Search for "CodeLapse" or "vscode-snapshots"
   - Click "Install" on the extension by YukioTheSage
3. **Via Command Line**:
   ```bash
   code --install-extension YukioTheSage.vscode-snapshots
   ```

**Step 2: Verify Extension Installation**
```bash
# Check if extension is installed
code --list-extensions | grep YukioTheSage.vscode-snapshots

# Should output: YukioTheSage.vscode-snapshots
```

**Step 3: Ensure Extension is Running**
1. Open VS Code with a project folder (File → Open Folder)
2. Check Extensions panel (Ctrl+Shift+X) - CodeLapse should be enabled
3. Look for CodeLapse in the status bar or activity bar
4. If extension appears disabled, click "Enable"

**Step 4: Test Connection**
```bash
# Basic status check - the "mode" field says how the command was served
codelapse status --json

# Expected successful response:
# {"success": true, "connected": true, "mode": "standalone", "workspace": "/path/to/project"}
```

`"mode": "standalone"` means the CLI is working. Only the IPC-only commands are
unavailable without the extension, so a connection error from one of them is
expected rather than a sign that the install is broken.

**Step 5: Advanced Troubleshooting**
If connection still fails:
1. **Restart VS Code completely** (close all windows, reopen)
2. **Check extension status** in VS Code Extensions panel
3. **Try with increased timeout**: `codelapse status --timeout 15000`
4. **Verify workspace is open** in VS Code (not just empty window)
5. **Check for extension conflicts** - disable other extensions temporarily

**For Users New to CodeLapse**:
> ⚠️ **Important**: The CLI does not need VS Code. Standalone mode manages the
> snapshots in the workspace's `.snapshots/` store directly, which is what makes
> CI/CD and headless use possible. Only the commands marked *Extension* in
> [API.md's mode matrix](API.md#mode-availability) need VS Code running with
> CodeLapse enabled - if you get a connection error, check that matrix first.

**Diagnostic Commands**:
```bash
# Check basic connectivity with verbose output
codelapse status --verbose

# Test with extended timeout
codelapse status --timeout 15000 --json

# Check workspace information
codelapse workspace info --json

# Check if VS Code is running (Windows)
tasklist | findstr "Code.exe"

# Check if VS Code is running (macOS/Linux)
ps aux | grep "Visual Studio Code"
```

#### Problem: "Connection timeout"
**Symptoms**: Commands hang or timeout after 5 seconds
**Solutions**:
1. Increase timeout globally: `codelapse --timeout 10000 status`
2. Check system resources (CPU/Memory usage)
3. Close unnecessary VSCode extensions
4. Restart VSCode completely

### Snapshot Issues

#### Problem: "Snapshot not found"
**Symptoms**: Commands referencing snapshot IDs fail
**Solutions**:
```bash
# List all available snapshots
codelapse snapshot list --json

# Search for snapshots by description
codelapse snapshot list --json | tail -n 1 | jq '.snapshots[] | select(.description | contains("search-term"))'

# Check if snapshot was deleted
codelapse snapshot list --json | tail -n 1 | jq '.total'
```

#### Problem: "No changes to snapshot"
**Symptoms**: Snapshot creation fails with no changes detected
**Solutions**:
1. Make actual file changes in the workspace
2. Check if files are saved in VSCode
3. Verify workspace has files (not empty folder)
4. Use selective snapshots for specific files:
   ```bash
   codelapse snapshot create "Selective changes" --files "src/main.ts,package.json" --json
   ```

#### Problem: "Snapshot restore failed"
**Symptoms**: Restore operations don't apply changes
**Solutions**:
```bash
# Create backup before restore
codelapse snapshot restore snapshot-123 --backup --json

# Restore specific files only
codelapse snapshot restore snapshot-123 --files "src/" --json

# Validate snapshot before restore (needs the CodeLapse extension running)
codelapse utility validate snapshot-123 --json
```

### Workspace Issues

#### Problem: "No workspace is currently open"
**Symptoms**: Workspace commands fail
**Solutions**:
1. Open a folder in VSCode (File → Open Folder)
2. Ensure the folder contains files
3. Check VSCode workspace status
4. Verify correct VSCode window is active

**Diagnostic Commands**:
```bash
# Check workspace status
codelapse workspace info --json

# List workspace files (needs the CodeLapse extension running)
codelapse workspace files --json

# Check current state (needs the CodeLapse extension running)
codelapse workspace state --json
```

#### Problem: "Permission denied accessing file"
**Symptoms**: File operations fail with permission errors
**Solutions**:
1. Check file permissions: `ls -la filename`
2. Ensure files aren't locked by other processes
3. Run with appropriate user permissions
4. Check if files are in use by VSCode or other editors

### Semantic Search Issues ⚠️ **(Experimental)**

#### Problem: "API key not configured"
**Symptoms**: Search commands fail with API key errors
**Solutions**:
1. Configure API key in VSCode settings
2. Disable semantic search if not needed
3. Check API key validity and permissions
4. Verify network connectivity to API service

#### Problem: "Search index not found"
**Symptoms**: Search queries return no results or index errors
**Solutions**:
```bash
# Build search index (needs the CodeLapse extension running)
codelapse search index --json

# Rebuild index for specific snapshots (needs the CodeLapse extension running)
codelapse search index --snapshots "snapshot-123,snapshot-124" --json
```

### Performance Issues

#### Problem: Commands are slow or hang
**Symptoms**: Operations take longer than expected
**Solutions**:
1. Check system resources (CPU, Memory, Disk)
2. Close unnecessary applications
3. Reduce snapshot size with selective snapshots
4. Clean up old snapshots:
   ```bash
   # List old snapshots
   codelapse snapshot list --since "30d" --json
   
   # Delete old snapshots (be careful!)
   codelapse snapshot delete old-snapshot-id --yes --json
   ```

#### Problem: Large workspace performance
**Symptoms**: Operations slow with many files
**Solutions**:
```bash
# Use selective snapshots
codelapse snapshot create "Important changes" --files "src/,tests/" --json

# Filter file listings (needs the CodeLapse extension running)
codelapse workspace files --changed --json

# Limit snapshot listings
codelapse snapshot list --limit 10 --json
```

### JSON Parsing Issues

#### Problem: "Invalid JSON response"
**Symptoms**: JSON parsing fails in scripts
**Solutions**:
```bash
# Use --json; add --silent only when you want no output at all
codelapse snapshot list --json

# Validate JSON before parsing
RESULT=$(codelapse status --json | tail -n 1)
if echo "$RESULT" | jq empty 2>/dev/null; then
  echo "Valid JSON"
else
  echo "Invalid JSON: $RESULT"
fi

# Keep the command's own payload, failed or not. stdout carries JSON alone, so
# there is nothing to filter out
RESULT=$(codelapse status --json 2>/dev/null)
```

### Common Integration Issues

#### Problem: CI/CD pipeline failures
**Symptoms**: Automated workflows fail inconsistently
**Solutions**:
```bash
# Add retry logic
for i in {1..3}; do
  if codelapse snapshot create "CI attempt $i" --silent; then
    break
  fi
  sleep 2
done

# Use longer timeouts in CI
codelapse status --timeout 30000 --json

# Validate environment
codelapse status --verbose --json
```

#### Problem: Batch operations fail partially
**Symptoms**: Some commands in batch succeed, others fail
**Solutions**:
```bash
# Process batch results individually
codelapse batch operations.json --json | tail -n 1 | jq -r '.results[] | select(.success == false)'

# Add error handling to batch files
cat > safe-batch.json << EOF
[
  { "method": "takeSnapshot", "data": { "description": "Safe backup" } },
  { "method": "getSnapshots", "data": { "limit": 1 } }
]
EOF
```

### Getting Help

#### Enable Verbose Logging
```bash
# Enable detailed logging for any command
codelapse --verbose snapshot create "Debug test" --json

# Check connection with full details
codelapse --verbose status
```

#### Collect Diagnostic Information
```bash
# System information
codelapse --version
node --version
npm --version

# Extension status
codelapse status --verbose --json

# Workspace information
codelapse workspace info --json

# Recent snapshots
codelapse snapshot list --limit 5 --json
```

#### Report Issues
When reporting issues, include:
1. CodeLapse CLI version (`codelapse --version`)
2. Node.js version (`node --version`)
3. Operating system and version
4. Full command that failed
5. Complete error message
6. Output from `codelapse status --verbose`

**Issue Template**:
```
**Environment:**
- CodeLapse CLI: [version]
- Node.js: [version]
- OS: [operating system]
- VSCode: [version]

**Command:**
```bash
[exact command that failed]
```

**Error:**
```
[complete error message]
```

**Diagnostic Info:**
```bash
codelapse status --verbose
[output]
```
```

## API Reference

All API methods are reachable through the `codelapse api` command. Standalone
mode serves the ones it implements and the extension serves the rest - see the
[mode availability matrix](API.md#mode-availability).

### Core API Methods
- `takeSnapshot(options)`
- `getSnapshots(filter?)`
- `getSnapshot(id)`
- `restoreSnapshot(id, options?)`
- `deleteSnapshot(id)`
- `compareSnapshots(id1, id2)`
- `navigateSnapshot(direction)`
- `searchSnapshots(query, options?)`
- `indexSnapshots(snapshotIds?)`
- `getWorkspaceInfo()`
- `getCurrentState()`
- `validateSnapshot(id)`
- `exportSnapshot(id, format)`

### Event Types
- `snapshot_created`
- `snapshot_deleted`
- `snapshot_restored`
- `workspace_changed`
- `search_indexed`

## Integration Examples

### GitHub Actions CI/CD

Create `.github/workflows/codelapse-integration.yml`:

```yaml
name: CodeLapse Integration
on: [push, pull_request]

jobs:
  snapshot-workflow:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      # Install CodeLapse CLI
      - name: Install CodeLapse CLI
        run: npm install -g codelapse-cli
      
      # Create pre-test snapshot
      - name: Create pre-test snapshot
        run: |
          codelapse snapshot create "CI: Pre-test $(git rev-parse --short HEAD)" \
            --tags "ci,pre-test,$(git branch --show-current)" \
            --task-ref "${{ github.event.number }}" \
            --silent
      
      # Run tests
      - name: Run tests
        id: tests
        run: npm test
        continue-on-error: true
      
      # Create post-test snapshot
      - name: Create test result snapshot
        run: |
          if [ "${{ steps.tests.outcome }}" == "success" ]; then
            codelapse snapshot create "CI: Tests passed $(date)" \
              --tags "ci,test-success" --favorite --silent
          else
            codelapse snapshot create "CI: Tests failed $(date)" \
              --tags "ci,test-failure" --silent
          fi
      
      # Export snapshots for artifacts
      - name: Export snapshots
        if: failure()
        run: |
          SNAPSHOTS_JSON=$(codelapse snapshot list --tags "ci" --json)
          printf '%s\n' "$SNAPSHOTS_JSON" | tail -n 1 > snapshots.json
          # needs the CodeLapse extension running
          codelapse utility export $(jq -r '.snapshots[0].id' snapshots.json) \
            --format zip --output failure-snapshot.zip
      
      - name: Upload failure artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: failure-snapshots
          path: failure-snapshot.zip
```

### Jenkins Pipeline

```groovy
pipeline {
    agent any
    
    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g codelapse-cli'
                sh 'codelapse status --silent'
            }
        }
        
        stage('Pre-deployment Snapshot') {
            steps {
                script {
                    def snapshotResult = sh(
                        script: """
                            SNAPSHOT_JSON=\$(codelapse snapshot create "Jenkins: Pre-deploy ${env.BUILD_NUMBER}" \
                                --tags "jenkins,pre-deploy,${env.BRANCH_NAME}" \
                                --task-ref "${env.BUILD_NUMBER}" \
                                --json)
                            printf '%s\\n' "\$SNAPSHOT_JSON" | tail -n 1
                        """,
                        returnStdout: true
                    ).trim()
                    
                    def snapshot = readJSON text: snapshotResult
                    env.PRE_DEPLOY_SNAPSHOT = snapshot.snapshot.id
                }
            }
        }
        
        stage('Deploy') {
            steps {
                // Your deployment steps here
                sh 'npm run deploy'
            }
            post {
                success {
                    sh """
                        codelapse snapshot create "Jenkins: Deploy success ${env.BUILD_NUMBER}" \
                            --tags "jenkins,deploy-success" --favorite --silent
                    """
                }
                failure {
                    sh """
                        codelapse snapshot create "Jenkins: Deploy failed ${env.BUILD_NUMBER}" \
                            --tags "jenkins,deploy-failure" --silent
                        codelapse snapshot restore ${env.PRE_DEPLOY_SNAPSHOT} --backup --silent
                    """
                }
            }
        }
    }
}
```

### Docker Integration

```dockerfile
# Dockerfile for CodeLapse-enabled development
FROM node:20-alpine

# Install CodeLapse CLI
RUN npm install -g codelapse-cli

# Create development script
COPY <<EOF /usr/local/bin/dev-with-snapshots.sh
#!/bin/sh
set -e

echo "Creating development snapshot..."
codelapse snapshot create "Docker: Development start \$(date)" \
  --tags "docker,dev-start" --silent

# Run development command
"\$@"

echo "Creating completion snapshot..."
codelapse snapshot create "Docker: Development complete \$(date)" \
  --tags "docker,dev-complete" --silent
EOF

RUN chmod +x /usr/local/bin/dev-with-snapshots.sh

ENTRYPOINT ["/usr/local/bin/dev-with-snapshots.sh"]
CMD ["npm", "run", "dev"]
```

### Automated Testing with Snapshot Rollback

```bash
#!/bin/bash
# test-with-rollback.sh

set -e

# Configuration
TEST_SUITE_NAME="$1"
ROLLBACK_ON_FAILURE="${2:-true}"

# Create pre-test snapshot
echo "Creating pre-test snapshot..."
PRE_TEST_JSON=$(codelapse snapshot create "Test: Before $TEST_SUITE_NAME" \
  --tags "test,pre-test,$TEST_SUITE_NAME" --json)
PRE_TEST_SNAPSHOT=$(printf '%s\n' "$PRE_TEST_JSON" | tail -n 1 | jq -r '.snapshot.id')

echo "Pre-test snapshot created: $PRE_TEST_SNAPSHOT"

# Run tests
echo "Running test suite: $TEST_SUITE_NAME"
if npm run test:$TEST_SUITE_NAME; then
  echo "Tests passed!"
  codelapse snapshot create "Test: $TEST_SUITE_NAME passed" \
    --tags "test,success,$TEST_SUITE_NAME" --favorite --silent
  exit 0
else
  echo "Tests failed!"
  
  # Create failure snapshot
  FAILURE_JSON=$(codelapse snapshot create "Test: $TEST_SUITE_NAME failed" \
    --tags "test,failure,$TEST_SUITE_NAME" --json)
  FAILURE_SNAPSHOT=$(printf '%s\n' "$FAILURE_JSON" | tail -n 1 | jq -r '.snapshot.id')
  
  echo "Failure snapshot created: $FAILURE_SNAPSHOT"
  
  # Rollback if requested
  if [ "$ROLLBACK_ON_FAILURE" = "true" ]; then
    echo "Rolling back to pre-test state..."
    codelapse snapshot restore "$PRE_TEST_SNAPSHOT" --backup --silent
    echo "Rollback completed"
  fi
  
  exit 1
fi
```

### Monitoring and Alerting

```bash
#!/bin/bash
# snapshot-monitor.sh

# Monitor CodeLapse events and send alerts
# needs the CodeLapse extension running
codelapse watch --events snapshots,workspace --json | while read -r event; do
  EVENT_TYPE=$(echo "$event" | jq -r '.event.type')
  
  case "$EVENT_TYPE" in
    "snapshot_created")
      SNAPSHOT_ID=$(echo "$event" | jq -r '.event.data.id')
      DESCRIPTION=$(echo "$event" | jq -r '.event.data.description')
      
      # Send notification to Slack/Discord/etc.
      curl -X POST "$WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"text\":\"📸 New snapshot created: $DESCRIPTION ($SNAPSHOT_ID)\"}"
      ;;
      
    "workspace_changed")
      FILES_CHANGED=$(echo "$event" | jq -r '.event.data.changedFiles | length')
      
      if [ "$FILES_CHANGED" -gt 10 ]; then
        curl -X POST "$WEBHOOK_URL" \
          -H 'Content-Type: application/json' \
          -d "{\"text\":\"⚠️ Large workspace change detected: $FILES_CHANGED files modified\"}"
      fi
      ;;
  esac
done
```

## Contributing

We welcome contributions to CodeLapse! Here's how you can get involved:

### 🐛 Report Issues

Found a bug or have a feature request? [Open an issue](https://github.com/YukioTheSage/code-snapshots/issues/new) on GitHub.

**When reporting issues, please include:**
- CodeLapse CLI version (`codelapse --version`)
- Node.js version (`node --version`)
- Operating system and version
- VS Code version
- Complete error message and stack trace
- Steps to reproduce the issue
- Expected vs actual behavior

**For better support, run this diagnostic command:**
```bash
codelapse status --verbose --json
```

### 🔧 Contribute Code

Ready to contribute code? Here's how to get started:

#### 1. Fork and Clone
1. **Fork the repository**: [YukioTheSage/code-snapshots](https://github.com/YukioTheSage/code-snapshots)
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/code-snapshots.git
   cd code-snapshots
   ```

#### 2. Set Up Development Environment
1. **Read the setup guide**: [Developer Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/DEVELOPER_GUIDE.md)
2. **Install dependencies**:
   ```bash
   npm install
   cd cli && npm install
   ```
3. **Build the project**:
   ```bash
   npm run build
   ```

#### 3. Development Workflow
1. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. **Make your changes** following the coding standards
3. **Test your changes**:
   ```bash
   npm test
   cd cli && npm test
   ```
4. **Commit with clear messages**:
   ```bash
   git commit -m "feat: add new snapshot filtering feature"
   ```

#### 4. Submit Your Contribution
1. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
2. **Create a Pull Request** on GitHub
3. **Follow the PR template** and provide detailed description
4. **Respond to code review feedback**

**Before submitting:**
- [ ] Code follows the project's style guidelines
- [ ] Tests pass locally (`npm test`)
- [ ] Documentation is updated if needed
- [ ] Commit messages follow conventional commit format
- [ ] PR description clearly explains the changes

### 📚 Improve Documentation

Help us make CodeLapse more accessible by improving documentation:

#### Areas where you can help:
- **README improvements**: Clarify installation steps, add examples
- **Code examples**: Add real-world usage scenarios
- **User guides**: Expand the [User Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/USER_GUIDE.md)
- **API documentation**: Improve the [API Reference](https://github.com/YukioTheSage/code-snapshots/blob/main/cli/API.md)
- **Troubleshooting**: Add solutions for common issues
- **Integration guides**: Document CI/CD and automation setups

#### How to contribute documentation:
1. **Fork the repository** and create a documentation branch
2. **Edit markdown files** in the `docs/` directory or update README files
3. **Test documentation locally** to ensure formatting is correct
4. **Submit a Pull Request** with clear description of improvements

**Documentation standards:**
- Use clear, concise language
- Include code examples where helpful
- Follow existing formatting conventions
- Test all code examples to ensure they work
- Update table of contents if adding new sections

### 🌟 Show Support

Even if you're not ready to contribute code, you can still help the project:

#### Ways to show support:
- **⭐ Star the repository** on [GitHub](https://github.com/YukioTheSage/code-snapshots) to show appreciation
- **📝 Leave a review** on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)
- **🐦 Share with the community** on social media, blogs, or developer forums
- **💬 Join discussions** on [GitHub Discussions](https://github.com/YukioTheSage/code-snapshots/discussions)
- **📖 Write blog posts** or tutorials about using CodeLapse
- **🎥 Create video content** demonstrating CodeLapse features
- **🗣️ Present at meetups** or conferences about snapshot-driven development

#### Community guidelines:
- Be respectful and inclusive in all interactions
- Help other users in discussions and issues
- Share constructive feedback and suggestions
- Follow the [Code of Conduct](https://github.com/YukioTheSage/code-snapshots/blob/main/CODE_OF_CONDUCT.md)

### 📋 Contributing Guidelines

For detailed contribution guidelines, please read:
- **[Contributing Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/CONTRIBUTING.md)**: Comprehensive contribution guidelines
- **[Developer Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/DEVELOPER_GUIDE.md)**: Development setup and workflow
- **[Code of Conduct](https://github.com/YukioTheSage/code-snapshots/blob/main/CODE_OF_CONDUCT.md)**: Community standards

### 🤝 Get Help Contributing

Need help getting started? We're here to help:
- **💬 Ask questions** in [GitHub Discussions](https://github.com/YukioTheSage/code-snapshots/discussions)
- **🐛 Report contribution issues** on [GitHub Issues](https://github.com/YukioTheSage/code-snapshots/issues)
- **📧 Contact maintainers** through GitHub for guidance

**First-time contributors welcome!** Look for issues labeled `good first issue` or `help wanted` to get started.

## Support & Community

### 🆘 Getting Help

Need assistance with CodeLapse? Here are the best ways to get support:

#### Documentation Resources
- **📖 [User Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/USER_GUIDE.md)**: Complete user documentation and tutorials
- **🔧 [API Reference](https://github.com/YukioTheSage/code-snapshots/blob/main/cli/API.md)**: Detailed API documentation for developers
- **🚀 [Developer Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/DEVELOPER_GUIDE.md)**: Development setup and contribution guidelines
- **❓ [Troubleshooting Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/TROUBLESHOOTING.md)**: Common issues and solutions

#### Community Support
- **🐛 [GitHub Issues](https://github.com/YukioTheSage/code-snapshots/issues)**: Report bugs, request features, or get technical help
- **💬 [GitHub Discussions](https://github.com/YukioTheSage/code-snapshots/discussions)**: Ask questions, share ideas, and connect with the community
- **📋 [GitHub Repository](https://github.com/YukioTheSage/code-snapshots)**: Browse source code, releases, and project updates

### 🔗 Links

#### Repository & Source Code
- **🏠 [Main Repository](https://github.com/YukioTheSage/code-snapshots)**: Primary GitHub repository with source code
- **📊 [Issues](https://github.com/YukioTheSage/code-snapshots/issues)**: Bug reports and feature requests
- **🔄 [Pull Requests](https://github.com/YukioTheSage/code-snapshots/pulls)**: Code contributions and reviews
- **📈 [Releases](https://github.com/YukioTheSage/code-snapshots/releases)**: Version history and release notes

#### VS Code Extension
- **🔌 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots)**: Install the CodeLapse extension
- **⭐ [Extension Reviews](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots&ssr=false#review-details)**: Read and leave reviews
- **📊 [Extension Statistics](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots&ssr=false#version-history)**: Download stats and version history

#### Documentation
- **📚 [Documentation Hub](https://github.com/YukioTheSage/code-snapshots/tree/main/docs)**: All project documentation
- **📖 [User Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/USER_GUIDE.md)**: Getting started and usage instructions
- **🔧 [API Reference](https://github.com/YukioTheSage/code-snapshots/blob/main/cli/API.md)**: Complete API documentation
- **🚀 [Developer Guide](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/DEVELOPER_GUIDE.md)**: Development and contribution guide
- **📄 [Changelog](https://github.com/YukioTheSage/code-snapshots/blob/main/CHANGELOG.md)**: Release history for the VS Code extension, `codelapse-core` and this CLI

#### Package Distribution
- **📦 [npm Package](https://www.npmjs.com/package/codelapse-cli)**: CLI tool on npm registry
- **📊 [npm Statistics](https://www.npmjs.com/package/codelapse-cli)**: Download stats and version history
- **🔍 [Package Dependencies](https://www.npmjs.com/package/codelapse-cli?activeTab=dependencies)**: View package dependencies

---

**Ready to get started?** Install the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=YukioTheSage.vscode-snapshots) and [CLI tool](https://www.npmjs.com/package/codelapse-cli) to begin your snapshot-driven development journey!
