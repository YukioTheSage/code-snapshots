# CodeLapse CLI API Reference

Complete API reference for the CodeLapse CLI, designed for developers, automation systems, and AI agents.

## Table of Contents

- [Overview](#overview)
- [Global Options](#global-options)
- [Connection & Status](#connection--status)
- [Snapshot Management API](#snapshot-management-api)
- [Semantic Search API](#semantic-search-api)
- [Workspace API](#workspace-api)
- [Utility API](#utility-api)
- [Batch Operations API](#batch-operations-api)
- [Event Streaming API](#event-streaming-api)
- [Direct API Access](#direct-api-access)
- [Error Codes Reference](#error-codes-reference)
- [Integration Examples](#integration-examples)
- [SDK-Style Usage](#sdk-style-usage)

## Overview

The CodeLapse CLI provides a comprehensive API for interacting with the CodeLapse VSCode extension. All commands support JSON output for machine-readable responses, making it ideal for automation, CI/CD pipelines, and AI agent integration.

### Base Command Structure

```bash
codelapse [global-options] <command> [command-options] [arguments]
```

### Response Format

All API responses follow a consistent JSON structure:

```typescript
interface APIResponse<T = any> {
  success: boolean;
  error?: string;
  errorCode?: string;
  [key: string]: T;
}
```

## Global Options

Available for all commands:

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format (required for automation) | false |
| `--silent` | Suppress user prompts and status messages | false |
| `--verbose` | Enable verbose output for debugging | false |
| `--timeout <ms>` | Connection timeout in milliseconds | 5000 |

### Example Usage

```bash
# AI-friendly command execution
codelapse snapshot list --json --silent

# Debug mode with extended timeout
codelapse status --verbose --timeout 10000
```

## Connection & Status

### `codelapse status`

Check connection to the CodeLapse VSCode extension.

**Parameters:** None

**Response Schema:**
```typescript
interface StatusResponse {
  success: true;
  connected: boolean;
  workspace: string | null;
  totalSnapshots: number;
  currentSnapshot: string | null;
}
```

**Example:**
```bash
codelapse status --json --silent
```

**Response:**
```json
{
  "success": true,
  "connected": true,
  "workspace": "/path/to/project",
  "totalSnapshots": 42,
  "currentSnapshot": "snapshot-abc123"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Failed to connect to CodeLapse extension: Connection refused",
  "errorCode": "CONNECTION_REFUSED"
}
```

## Snapshot Management API

### `codelapse snapshot create [description]`

Create a new snapshot of the current workspace state.

**Parameters:**
- `description` (optional): Snapshot description
- `-t, --tags <tags>`: Comma-separated tags
- `-n, --notes <notes>`: Additional notes
- `-r, --task-ref <ref>`: Task reference (e.g., Jira ticket)
- `-f, --favorite`: Mark as favorite
- `-s, --selective`: Create selective snapshot
- `--files <files>`: Comma-separated file paths for selective snapshot

**Response Schema:**
```typescript
interface CreateSnapshotResponse {
  success: true;
  snapshot: {
    id: string;
    description: string;
    timestamp: string;
    gitBranch: string;
    gitCommitHash: string;
    tags: string[];
    notes?: string;
    taskReference?: string;
    isFavorite: boolean;
    isSelective: boolean;
    selectedFiles: string[];
  };
  message: string;
}
```

**Examples:**

Basic snapshot:
```bash
codelapse snapshot create "Feature implementation" --json --silent
```

Tagged snapshot with task reference:
```bash
codelapse snapshot create "User auth system" \
  --tags "feature,auth,backend" \
  --task-ref "JIRA-123" \
  --favorite \
  --json --silent
```

Selective snapshot:
```bash
codelapse snapshot create "Config changes" \
  --selective \
  --files "config/app.json,src/config.ts" \
  --json --silent
```

**Response:**
```json
{
  "success": true,
  "snapshot": {
    "id": "snapshot-abc123",
    "description": "Feature implementation",
    "timestamp": "2023-10-27T10:00:00Z",
    "gitBranch": "feature/auth",
    "gitCommitHash": "a1b2c3d4",
    "tags": ["feature", "auth", "backend"],
    "notes": null,
    "taskReference": "JIRA-123",
    "isFavorite": true,
    "isSelective": false,
    "selectedFiles": []
  },
  "message": "Snapshot \"Feature implementation\" created successfully"
}
```

### `codelapse snapshot list`

List snapshots with optional filtering.

**Parameters:**
- `-t, --tags <tags>`: Filter by comma-separated tags
- `-f, --favorites`: Show only favorites
- `-l, --limit <number>`: Limit number of results
- `--since <date>`: Show snapshots since date (ISO string or relative like "1h", "2d")

**Response Schema:**
```typescript
interface ListSnapshotsResponse {
  success: true;
  snapshots: SnapshotSummary[];
  total: number;
}
```

**Examples:**

List all snapshots:
```bash
codelapse snapshot list --json --silent
```

Filter by tags and limit:
```bash
codelapse snapshot list --tags "feature,auth" --limit 10 --json --silent
```

Recent snapshots:
```bash
codelapse snapshot list --since "24h" --json --silent
```

**Response:**
```json
{
  "success": true,
  "snapshots": [
    {
      "id": "snapshot-abc123",
      "description": "Feature implementation",
      "timestamp": "2023-10-27T10:00:00Z",
      "tags": ["feature", "auth"]
    }
  ],
  "total": 1
}
```

### `codelapse snapshot show <id>`

Show detailed information for a specific snapshot.

**Parameters:**
- `id` (required): Snapshot ID
- `--files`: Include file changes in response
- `--content <file>`: Include content of specific file

**Response Schema:**
```typescript
interface ShowSnapshotResponse {
  success: true;
  snapshot: SnapshotDetails;
  changes?: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  fileContent?: {
    filePath: string;
    content: string;
  };
}
```

**Examples:**

Basic snapshot details:
```bash
codelapse snapshot show snapshot-abc123 --json --silent
```

With file changes:
```bash
codelapse snapshot show snapshot-abc123 --files --json --silent
```

With specific file content:
```bash
codelapse snapshot show snapshot-abc123 --content "src/auth.ts" --json --silent
```

### `codelapse snapshot restore <id>`

Restore a snapshot, overwriting current workspace state.

**Parameters:**
- `id` (required): Snapshot ID to restore
- `--backup`: Create backup snapshot before restore
- `--files <files>`: Restore only specific files
- `-y, --yes`: Skip confirmation prompt

**Response Schema:**
```typescript
interface RestoreSnapshotResponse {
  success: true;
  result: {
    restoredSnapshotId: string;
    backupSnapshotId?: string;
  };
  message: string;
}
```

**Examples:**

Safe restore with backup:
```bash
codelapse snapshot restore snapshot-abc123 --backup --json --silent
```

Partial restore:
```bash
codelapse snapshot restore snapshot-abc123 --files "src/,config/" --json --silent
```

### `codelapse snapshot delete <id>`

Delete a snapshot permanently.

**Parameters:**
- `id` (required): Snapshot ID to delete
- `-y, --yes`: Skip confirmation prompt

**Response Schema:**
```typescript
interface DeleteSnapshotResponse {
  success: true;
  result: {
    deletedSnapshotId: string;
  };
  message: string;
}
```

**Example:**
```bash
codelapse snapshot delete snapshot-abc123 --yes --json --silent
```

### `codelapse snapshot compare <id1> <id2>`

Compare two snapshots to see differences.

**Parameters:**
- `id1` (required): First snapshot ID
- `id2` (required): Second snapshot ID
- `--files`: Show only file-level changes

**Response Schema:**
```typescript
interface CompareSnapshotsResponse {
  success: true;
  comparison: {
    addedFiles: string[];
    removedFiles: string[];
    modifiedFiles: string[];
    identicalFiles: string[];
  };
  summary: {
    addedFiles: number;
    removedFiles: number;
    modifiedFiles: number;
    identicalFiles: number;
  };
}
```

**Example:**
```bash
codelapse snapshot compare snapshot-abc123 snapshot-def456 --json --silent
```

### `codelapse snapshot navigate <direction>`

Navigate to previous or next snapshot in chronological order.

**Parameters:**
- `direction` (required): "previous" or "next"

**Response Schema:**
```typescript
interface NavigateSnapshotResponse {
  success: true;
  navigation: {
    fromSnapshotId: string;
    toSnapshotId: string;
    direction: string;
  };
  message: string;
}
```

**Examples:**
```bash
codelapse snapshot navigate next --json --silent
codelapse snapshot navigate previous --json --silent
```

## Semantic Search API

> ⚠️ **EXPERIMENTAL FEATURE - SECURITY WARNING**: Semantic search transmits code to external AI services. Use with caution on sensitive codebases.

### `codelapse search query <query>`

Search snapshots using natural language queries.

**Parameters:**
- `query` (required): Natural language search query
- `-l, --limit <number>`: Maximum results (default: 20)
- `-t, --threshold <number>`: Score threshold 0-1 (default: 0.65)
- `--snapshots <ids>`: Search specific snapshots (comma-separated)
- `--languages <langs>`: Filter by programming languages

**Response Schema:**
```typescript
interface SearchResponse {
  success: true;
  query: string;
  results: Array<{
    snapshotId: string;
    score: number;
    matches: Array<{
      filePath: string;
      line: number;
      content: string;
    }>;
  }>;
  total: number;
  options: SearchOptions;
}
```

**Examples:**

Basic search:
```bash
codelapse search query "authentication code" --json --silent
```

Filtered search:
```bash
codelapse search query "database connection" \
  --limit 5 \
  --threshold 0.8 \
  --languages "typescript,javascript" \
  --json --silent
```

**Response:**
```json
{
  "success": true,
  "query": "authentication code",
  "results": [
    {
      "snapshotId": "snapshot-abc123",
      "score": 0.85,
      "matches": [
        {
          "filePath": "src/auth.ts",
          "line": 42,
          "content": "function authenticate(user: string, password: string) {"
        }
      ]
    }
  ],
  "total": 1
}
```

### `codelapse search index`

Build or update the semantic search index.

**Parameters:**
- `--all`: Index all snapshots

**Response Schema:**
```typescript
interface IndexResponse {
  success: true;
  indexing: {
    indexedSnapshots: string[];
    status: string;
  };
  message: string;
}
```

**Example:**
```bash
codelapse search index --all --json --silent
```

## Workspace API

### `codelapse workspace info`

Get workspace information and metadata.

**Response Schema:**
```typescript
interface WorkspaceInfoResponse {
  success: true;
  workspace: {
    rootPath: string;
    name: string;
    openFiles: string[];
    changedFiles: string[];
    activeFile: string | null;
  };
}
```

**Example:**
```bash
codelapse workspace info --json --silent
```

### `codelapse workspace state`

Get current workspace state (open/changed files).

**Response Schema:**
```typescript
interface WorkspaceStateResponse {
  success: true;
  state: {
    openFiles: string[];
    changedFiles: string[];
    activeFile: string | null;
  };
}
```

**Example:**
```bash
codelapse workspace state --json --silent
```

### `codelapse workspace files`

List workspace files with optional filtering.

**Parameters:**
- `--changed`: Show only changed files

**Response Schema:**
```typescript
interface WorkspaceFilesResponse {
  success: true;
  files: {
    openFiles: string[];
    changedFiles: string[];
    activeFile: string | null;
  };
}
```

**Examples:**
```bash
codelapse workspace files --json --silent
codelapse workspace files --changed --json --silent
```

## Utility API

### `codelapse utility validate <id>`

Validate snapshot integrity and consistency.

**Parameters:**
- `id` (required): Snapshot ID to validate

**Response Schema:**
```typescript
interface ValidateResponse {
  success: true;
  validation: {
    isValid: boolean;
    checkedFiles: number;
    issues: string[];
  };
  message: string;
}
```

**Example:**
```bash
codelapse utility validate snapshot-abc123 --json --silent
```

### `codelapse utility export <id>`

Export snapshot to external format.

**Parameters:**
- `id` (required): Snapshot ID to export
- `-f, --format <format>`: Export format ("json" or "zip")
- `-o, --output <path>`: Output file path

**Response Schema:**
```typescript
interface ExportResponse {
  success: true;
  export: {
    exportPath: string;
    format: string;
  };
  message: string;
}
```

**Examples:**
```bash
codelapse utility export snapshot-abc123 --format zip --output ./backup.zip --json --silent
codelapse utility export snapshot-abc123 --format json --output ./snapshot.json --json --silent
```

## Batch Operations API

Execute multiple commands from a JSON file for complex automation workflows.

### `codelapse batch <file>`

**Parameters:**
- `file` (required): Path to JSON file containing batch commands

**Batch File Format:**
```json
[
  {
    "method": "takeSnapshot",
    "data": {
      "description": "Batch operation backup",
      "tags": ["batch", "backup"]
    }
  },
  {
    "method": "getSnapshots",
    "data": {
      "limit": 5,
      "tags": ["recent"]
    }
  }
]
```

**Response Schema:**
```typescript
interface BatchResponse {
  success: true;
  results: Array<{
    success: boolean;
    command: any;
    result?: any;
    error?: string;
  }>;
}
```

**Example:**
```bash
# Create batch-commands.json
cat > batch-commands.json << 'EOF'
[
  { "method": "takeSnapshot", "data": { "description": "Pre-operation backup" } },
  { "method": "getSnapshots", "data": { "limit": 10 } }
]
EOF

# Execute batch
codelapse batch batch-commands.json --json --silent
```

## Event Streaming API

Monitor real-time events from the CodeLapse extension.

### `codelapse watch`

**Parameters:**
- `--events <events>`: Event types to watch (comma-separated)

**Available Event Types:**
- `snapshots`: Snapshot creation, deletion, restoration
- `workspace`: Workspace file changes
- `changes`: General workspace changes

**Response Format:**
Each event is output as a separate JSON line:
```typescript
interface EventMessage {
  type: "event";
  event: {
    type: string;
    data: any;
    timestamp: string;
  };
}
```

**Example:**
```bash
codelapse watch --events "snapshots,workspace" --json | while read -r event; do
  echo "Processing: $event"
  # Add your event handling logic here
done
```

**Sample Event Output:**
```json
{"type": "event", "event": {"type": "snapshot_created", "data": {"id": "snapshot-abc123", "description": "New feature"}, "timestamp": "2023-10-27T10:00:00Z"}}
{"type": "event", "event": {"type": "workspace_changed", "data": {"changedFiles": ["src/main.ts"]}, "timestamp": "2023-10-27T10:01:00Z"}}
```

## Direct API Access

Low-level API access for maximum flexibility.

### `codelapse api <method>`

**Parameters:**
- `method` (required): API method name
- `-d, --data <json>`: JSON data to send

**Available API Methods:**
- `takeSnapshot`
- `getSnapshots`
- `getSnapshot`
- `restoreSnapshot`
- `deleteSnapshot`
- `compareSnapshots`
- `navigateSnapshot`
- `searchSnapshots`
- `indexSnapshots`
- `getWorkspaceInfo`
- `getCurrentState`
- `validateSnapshot`
- `exportSnapshot`

**Example:**
```bash
codelapse api takeSnapshot --data '{"description": "Direct API call", "tags": ["api"]}' --json --silent
```

## Error Codes Reference

### Connection Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| `CONNECTION_REFUSED` | Extension not running | Start VSCode with CodeLapse extension |
| `CONNECTION_TIMEOUT` | Connection timeout | Increase timeout or check connectivity |
| `NO_WORKSPACE` | No workspace open | Open a folder in VSCode |

### Snapshot Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| `SNAPSHOT_NOT_FOUND` | Snapshot ID doesn't exist | Verify ID with `snapshot list` |
| `NO_CHANGES_TO_SNAPSHOT` | No changes to capture | Make file changes or use selective snapshot |
| `SNAPSHOT_RESTORE_FAILED` | Restore operation failed | Check file permissions and workspace state |

### Search Errors (Experimental)

| Error Code | Description | Solution |
|------------|-------------|----------|
| `API_KEY_MISSING` | Search API key not configured | Configure API key or disable search |
| `INDEX_NOT_FOUND` | Search index not built | Run `search index --all` |
| `SEARCH_SERVICE_ERROR` | External search service error | Check API key and network connectivity |

### Workspace Errors

| Error Code | Description | Solution |
|------------|-------------|----------|
| `FILE_ACCESS_DENIED` | Permission denied | Check file permissions |
| `WORKSPACE_NOT_READY` | Workspace not initialized | Wait for workspace to load |

## Integration Examples

### Node.js Integration

```javascript
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

class CodeLapseAPI {
  async createSnapshot(description, options = {}) {
    const tags = options.tags ? `--tags "${options.tags.join(',')}"` : '';
    const favorite = options.favorite ? '--favorite' : '';
    
    const cmd = `codelapse snapshot create "${description}" ${tags} ${favorite} --json --silent`;
    
    try {
      const { stdout } = await execAsync(cmd);
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Snapshot creation failed: ${error.message}`);
    }
  }

  async listSnapshots(filter = {}) {
    let cmd = 'codelapse snapshot list --json --silent';
    
    if (filter.tags) cmd += ` --tags "${filter.tags.join(',')}"`;
    if (filter.limit) cmd += ` --limit ${filter.limit}`;
    if (filter.since) cmd += ` --since "${filter.since}"`;
    
    const { stdout } = await execAsync(cmd);
    return JSON.parse(stdout);
  }

  async restoreSnapshot(id, createBackup = true) {
    const backup = createBackup ? '--backup' : '';
    const cmd = `codelapse snapshot restore ${id} ${backup} --json --silent`;
    
    const { stdout } = await execAsync(cmd);
    return JSON.parse(stdout);
  }
}

// Usage example
async function example() {
  const api = new CodeLapseAPI();
  
  // Create a snapshot
  const snapshot = await api.createSnapshot('Feature complete', {
    tags: ['feature', 'complete'],
    favorite: true
  });
  
  console.log('Created snapshot:', snapshot.snapshot.id);
  
  // List recent snapshots
  const snapshots = await api.listSnapshots({ limit: 5 });
  console.log('Recent snapshots:', snapshots.snapshots.length);
}
```

### Python Integration

```python
import json
import subprocess
from typing import Dict, List, Optional, Any

class CodeLapseAPI:
    def __init__(self, timeout: int = 5000):
        self.timeout = timeout
    
    def _execute_command(self, cmd: List[str]) -> Dict[str, Any]:
        """Execute CLI command and return parsed JSON response."""
        try:
            result = subprocess.run(
                cmd + ['--json', '--silent'],
                capture_output=True,
                text=True,
                timeout=self.timeout / 1000
            )
            
            if result.returncode != 0:
                raise Exception(f"Command failed: {result.stderr}")
            
            return json.loads(result.stdout)
        except subprocess.TimeoutExpired:
            raise Exception("Command timeout")
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON response: {e}")
    
    def create_snapshot(self, description: str, tags: Optional[List[str]] = None, 
                       favorite: bool = False) -> Dict[str, Any]:
        """Create a new snapshot."""
        cmd = ['codelapse', 'snapshot', 'create', description]
        
        if tags:
            cmd.extend(['--tags', ','.join(tags)])
        if favorite:
            cmd.append('--favorite')
        
        return self._execute_command(cmd)
    
    def list_snapshots(self, tags: Optional[List[str]] = None, 
                      limit: Optional[int] = None) -> Dict[str, Any]:
        """List snapshots with optional filtering."""
        cmd = ['codelapse', 'snapshot', 'list']
        
        if tags:
            cmd.extend(['--tags', ','.join(tags)])
        if limit:
            cmd.extend(['--limit', str(limit)])
        
        return self._execute_command(cmd)
    
    def restore_snapshot(self, snapshot_id: str, create_backup: bool = True) -> Dict[str, Any]:
        """Restore a snapshot with optional backup."""
        cmd = ['codelapse', 'snapshot', 'restore', snapshot_id]
        
        if create_backup:
            cmd.append('--backup')
        
        return self._execute_command(cmd)
    
    def search_snapshots(self, query: str, limit: int = 20) -> Dict[str, Any]:
        """Search snapshots using natural language."""
        cmd = ['codelapse', 'search', 'query', query, '--limit', str(limit)]
        return self._execute_command(cmd)

# Usage example
def main():
    api = CodeLapseAPI()
    
    try:
        # Create a snapshot
        result = api.create_snapshot(
            "Python integration test",
            tags=["test", "python"],
            favorite=True
        )
        
        if result['success']:
            print(f"Created snapshot: {result['snapshot']['id']}")
        else:
            print(f"Failed to create snapshot: {result['error']}")
        
        # List recent snapshots
        snapshots = api.list_snapshots(limit=5)
        print(f"Found {snapshots['total']} snapshots")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
```

### Bash/Shell Integration

```bash
#!/bin/bash

# CodeLapse CLI wrapper functions for shell scripts

# Global configuration
CODELAPSE_TIMEOUT=10000
CODELAPSE_OPTS="--json --silent --timeout $CODELAPSE_TIMEOUT"

# Error handling
set -euo pipefail

# Utility functions
log_info() {
    echo "[INFO] $1" >&2
}

log_error() {
    echo "[ERROR] $1" >&2
}

check_success() {
    local response="$1"
    if ! echo "$response" | jq -e '.success' > /dev/null; then
        local error=$(echo "$response" | jq -r '.error // "Unknown error"')
        log_error "$error"
        return 1
    fi
    return 0
}

# API wrapper functions
codelapse_create_snapshot() {
    local description="$1"
    local tags="${2:-}"
    local favorite="${3:-false}"
    
    local cmd="codelapse snapshot create \"$description\" $CODELAPSE_OPTS"
    
    if [[ -n "$tags" ]]; then
        cmd="$cmd --tags \"$tags\""
    fi
    
    if [[ "$favorite" == "true" ]]; then
        cmd="$cmd --favorite"
    fi
    
    local result=$(eval "$cmd")
    
    if check_success "$result"; then
        echo "$result" | jq -r '.snapshot.id'
        return 0
    else
        return 1
    fi
}

codelapse_list_snapshots() {
    local tags="${1:-}"
    local limit="${2:-}"
    
    local cmd="codelapse snapshot list $CODELAPSE_OPTS"
    
    if [[ -n "$tags" ]]; then
        cmd="$cmd --tags \"$tags\""
    fi
    
    if [[ -n "$limit" ]]; then
        cmd="$cmd --limit $limit"
    fi
    
    local result=$(eval "$cmd")
    
    if check_success "$result"; then
        echo "$result"
        return 0
    else
        return 1
    fi
}

codelapse_restore_snapshot() {
    local snapshot_id="$1"
    local create_backup="${2:-true}"
    
    local cmd="codelapse snapshot restore \"$snapshot_id\" $CODELAPSE_OPTS"
    
    if [[ "$create_backup" == "true" ]]; then
        cmd="$cmd --backup"
    fi
    
    local result=$(eval "$cmd")
    
    if check_success "$result"; then
        echo "$result" | jq -r '.result.backupSnapshotId // "no-backup"'
        return 0
    else
        return 1
    fi
}

# Example usage functions
example_safe_operation() {
    log_info "Starting safe operation with backup"
    
    # Create backup
    local backup_id
    if backup_id=$(codelapse_create_snapshot "Pre-operation backup" "backup,auto" "false"); then
        log_info "Created backup: $backup_id"
    else
        log_error "Failed to create backup"
        return 1
    fi
    
    # Perform your operations here
    log_info "Performing operations..."
    
    # If operations fail, restore backup
    if ! perform_operations; then
        log_error "Operations failed, restoring backup"
        if codelapse_restore_snapshot "$backup_id" "false"; then
            log_info "Backup restored successfully"
        else
            log_error "Failed to restore backup!"
        fi
        return 1
    fi
    
    # Create success snapshot
    if codelapse_create_snapshot "Operation completed successfully" "complete,auto" "true"; then
        log_info "Operation completed and documented"
    fi
}

perform_operations() {
    # Your actual operations here
    # Return 0 for success, 1 for failure
    return 0
}

# CI/CD integration example
ci_snapshot_workflow() {
    local branch=$(git branch --show-current)
    local commit=$(git rev-parse --short HEAD)
    
    # Pre-test snapshot
    local pre_test_id
    if pre_test_id=$(codelapse_create_snapshot "CI: Pre-test $commit" "ci,pre-test,$branch" "false"); then
        log_info "Created pre-test snapshot: $pre_test_id"
    fi
    
    # Run tests
    if npm test; then
        codelapse_create_snapshot "CI: Tests passed $commit" "ci,success,$branch" "true"
        log_info "Tests passed, success snapshot created"
    else
        codelapse_create_snapshot "CI: Tests failed $commit" "ci,failure,$branch" "false"
        log_error "Tests failed, failure snapshot created"
        return 1
    fi
}

# Main execution
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-}" in
        "safe-op")
            example_safe_operation
            ;;
        "ci")
            ci_snapshot_workflow
            ;;
        *)
            echo "Usage: $0 {safe-op|ci}"
            exit 1
            ;;
    esac
fi
```

## SDK-Style Usage

### TypeScript SDK Interface

```typescript
interface CodeLapseSDK {
  // Connection
  connect(options?: { timeout?: number }): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): Promise<ConnectionStatus>;
  
  // Snapshots
  createSnapshot(options: CreateSnapshotOptions): Promise<Snapshot>;
  listSnapshots(filter?: SnapshotFilter): Promise<Snapshot[]>;
  getSnapshot(id: string): Promise<SnapshotDetails>;
  restoreSnapshot(id: string, options?: RestoreOptions): Promise<RestoreResult>;
  deleteSnapshot(id: string): Promise<void>;
  compareSnapshots(id1: string, id2: string): Promise<ComparisonResult>;
  
  // Search (Experimental)
  searchSnapshots(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  indexSnapshots(snapshotIds?: string[]): Promise<IndexResult>;
  
  // Workspace
  getWorkspaceInfo(): Promise<WorkspaceInfo>;
  getCurrentState(): Promise<WorkspaceState>;
  
  // Utilities
  validateSnapshot(id: string): Promise<ValidationResult>;
  exportSnapshot(id: string, format: 'json' | 'zip', outputPath?: string): Promise<ExportResult>;
  
  // Events
  watchEvents(eventTypes: string[], callback: (event: EventData) => void): Promise<void>;
  
  // Batch operations
  executeBatch(commands: BatchCommand[]): Promise<BatchResult>;
}
```

This comprehensive API reference provides complete documentation for all CodeLapse CLI functionality, making it easy for developers, automation systems, and AI agents to integrate with CodeLapse programmatically.