# codelapse-core

Shared core functionality for CodeLapse CLI and VS Code extension.

## Overview

This package contains all the core snapshot management logic that's shared between the CLI and VS Code extension. It has no VS Code dependencies and can be used standalone.

## Installation

```bash
npm install codelapse-core
```

For local development:
```bash
npm install file:../shared
```

## Features

- **Snapshot Management**: Create, restore, delete, compare snapshots
- **Configuration**: Unified config system with multiple sources
- **Git Integration**: Read-only Git operations
- **Diff Operations**: Efficient diff-based storage
- **Gitignore Support**: Respects `.gitignore` and `.snapshotignore`

## Quick Start

```typescript
import { SnapshotManager, ConfigManager } from 'codelapse-core';

// Initialize managers
const workspaceRoot = '/path/to/workspace';
const config = new ConfigManager(workspaceRoot);
const manager = new SnapshotManager(workspaceRoot);

// Take a snapshot
const snapshot = await manager.takeSnapshot({
  description: 'My snapshot',
  tags: ['feature', 'backup'],
});

// List snapshots
const snapshots = manager.getSnapshots();

// Filter snapshots
const favorites = manager.getSnapshots({ favorite: true });
const tagged = manager.getSnapshots({ tag: 'feature' });

// Restore a snapshot
await manager.restoreSnapshot(snapshot.id, {
  backup: true, // Create backup before restore
});

// Compare snapshots
const comparison = await manager.compareSnapshots(id1, id2);
console.log('Modified files:', comparison.modifiedFiles);

// Delete a snapshot
await manager.deleteSnapshot(snapshot.id);
```

## API Reference

### SnapshotManager

Main class for snapshot operations.

```typescript
class SnapshotManager {
  constructor(workspaceRoot: string);

  // Snapshot operations
  takeSnapshot(options: SnapshotOptions): Promise<Snapshot>;
  getSnapshots(filter?: SnapshotFilter): Snapshot[];
  getSnapshot(snapshotId: string): Promise<Snapshot | null>;
  restoreSnapshot(snapshotId: string, options?: RestoreOptions): Promise<void>;
  deleteSnapshot(snapshotId: string): Promise<void>;
  compareSnapshots(id1: string, id2: string): Promise<SnapshotComparison>;

  // Metadata operations
  updateSnapshotMetadata(snapshotId: string, updates: Partial<Snapshot>): Promise<void>;

  // File operations
  getSnapshotFileContent(snapshotId: string, filePath: string): Promise<string | null>;

  // Utility
  getStorageStats(): Promise<StorageStats>;
  reload(): Promise<void>;
}
```

### ConfigManager

Manages configuration with fallback chain.

```typescript
class ConfigManager {
  constructor(workspaceRoot: string);

  // Get/Set config
  getConfig(): CodelapseConfig;
  get<K extends keyof CodelapseConfig>(key: K): CodelapseConfig[K];
  set<K extends keyof CodelapseConfig>(key: K, value: CodelapseConfig[K]): Promise<void>;
  getNested(keyPath: string): any;
  setNested(keyPath: string, value: any): Promise<void>;

  // Import/Export
  exportConfig(): string;
  importConfig(json: string): Promise<void>;

  // Utility
  validate(): { valid: boolean; errors: string[] };
  reset(): Promise<void>;
  clearCache(): void;
}
```

### GitIntegration

Read-only Git operations.

```typescript
class GitIntegration {
  constructor(workspaceRoot: string);

  isGitRepository(): boolean;
  getGitInfo(): GitInfo | null;
  getCurrentBranch(): string | undefined;
  getCurrentCommit(): string | undefined;
  hasUncommittedChanges(): boolean;
  getRemoteUrl(): string | undefined;
  getChangedFiles(): string[];
  getCommitHistory(limit?: number): Array<CommitInfo>;
}
```

### GitignoreParser

Parse and apply gitignore rules.

```typescript
class GitignoreParser {
  constructor(workspaceRoot: string, snapshotLocation?: string);

  shouldIgnore(filePath: string): boolean;
  getExcludeGlobPattern(): string;
  getNegatedGlobs(): string[];
  getPatterns(): string[];
}
```

### Diff Utilities

```typescript
// Create a diff between two strings
function createDiff(fileName: string, oldContent: string, newContent: string): string;

// Apply a diff patch
function applyDiff(baseContent: string, patchStr: string, fileName: string): string | null;

// Generate diff summary
function generateDiffSummary(oldContent: string, newContent: string): {
  additions: number;
  deletions: number;
  changes: number;
};

// Format diff for terminal
function formatDiffForTerminal(diffString: string): string;
```

## Types

### Snapshot

```typescript
interface Snapshot {
  id: string;
  timestamp: number;
  description: string;
  gitBranch?: string;
  gitCommitHash?: string;
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  isSelective?: boolean;
  selectedFiles?: string[];
  files: {
    [relativePath: string]: {
      content?: string | null;
      diff?: string;
      baseSnapshotId?: string;
      deleted?: boolean;
      isBinary?: boolean;
    };
  };
}
```

### SnapshotOptions

```typescript
interface SnapshotOptions {
  description?: string;
  tags?: string[];
  notes?: string;
  taskReference?: string;
  isFavorite?: boolean;
  isSelective?: boolean;
  selectedFiles?: string[];
}
```

### SnapshotFilter

```typescript
interface SnapshotFilter {
  tag?: string;
  favorite?: boolean;
  startDate?: number;
  endDate?: number;
  search?: string;
  filePath?: string;
}
```

### CodelapseConfig

```typescript
interface AutoSnapshotRule {
  pattern: string;
  intervalMinutes: number;
  enabled?: boolean;
}

interface AutoSnapshotConfig {
  rules: AutoSnapshotRule[];
}

interface CodelapseConfig {
  snapshotLocation: string;
  maxSnapshots: number;
  /**
   * Maximum bytes the snapshot store may occupy. 0 disables the limit, which is
   * the default, so turning it on can never surprise an existing store.
   */
  maxSnapshotStoreBytes: number;
  autoSnapshot: AutoSnapshotConfig;
  git: {
    addCommitInfo: boolean;
  };
  semanticSearch?: {
    enabled: boolean;
    provider?: string;
    apiKey?: string;
    chunkSize?: number;
    autoIndex?: boolean;
  };
}
```

> An earlier version declared `git.autoSnapshotBeforeOperation`, defaulted it,
> validated it and made it settable; nothing ever read it, so it was removed
> rather than given a standalone-only meaning. A configuration file that still
> carries the key keeps loading — unknown keys are ignored.

## Configuration

The package reads configuration from multiple sources:

1. **File**: `.vscode/codelapse.json` in workspace root
2. **Environment Variables**: `CODELAPSE_*` variables
3. **Defaults**: Built-in default values

### Configuration File Example

```json
{
  "snapshotLocation": ".snapshots",
  "maxSnapshots": 50,
  "maxSnapshotStoreBytes": 0,
  "autoSnapshot": {
    "rules": []
  },
  "git": {
    "addCommitInfo": true
  }
}
```

### Environment Variables

```bash
export CODELAPSE_SNAPSHOT_LOCATION=".my-snapshots"
export CODELAPSE_MAX_SNAPSHOTS=100
export GEMINI_API_KEY="your-api-key"
```

## Storage

Snapshots are stored in the `.snapshots/` directory (configurable):

```
.snapshots/
├── index.json                    # Snapshot index
├── snapshot-123-abc.json        # Snapshot metadata + files
├── snapshot-456-def.json        # Another snapshot
└── ...
```

### Index Format

```json
{
  "snapshots": [
    {
      "id": "snapshot-123-abc",
      "timestamp": 1234567890,
      "description": "My snapshot"
    }
  ],
  "currentIndex": 0
}
```

### Snapshot Format

Each snapshot file contains:
- Metadata (id, timestamp, description, tags, etc.)
- File data (content or diff from base snapshot)
- Git information (branch, commit)

## Performance

- **Diff-based storage**: Only stores changes between snapshots
- **Content caching**: LRU cache for file content retrieval
- **Gitignore support**: Efficiently filters files
- **Binary detection**: Skips binary files

## Error Handling

All async operations may throw errors. Wrap in try-catch:

```typescript
try {
  const snapshot = await manager.takeSnapshot({ description: 'Test' });
} catch (error) {
  console.error('Failed to take snapshot:', error);
}
```

## Development

### Build

```bash
npm run build
```

### Watch Mode

```bash
npm run watch
```

### Clean

```bash
npm run clean
```

## Dependencies

- `minimatch` - Glob pattern matching
- `diff` - Diff generation and application

## License

MIT

## Related Packages

- **codelapse-cli**: Command-line interface
- **vscode-snapshots**: VS Code extension

## Support

For issues and questions:
- GitHub Issues: https://github.com/YukioTheSage/code-snapshots/issues
- Documentation: https://github.com/YukioTheSage/code-snapshots
