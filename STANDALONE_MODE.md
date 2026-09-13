# CodeLapse Standalone Mode

## Overview

CodeLapse CLI now supports **standalone mode**, allowing it to run independently without the VS Code extension. The CLI automatically detects whether the extension is available and chooses the appropriate mode.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CodeLapse CLI                       │
│                                                       │
│  ┌────────────────────────────────────────────┐    │
│  │         Unified Client (Auto)              │    │
│  └────────────────────────────────────────────┘    │
│           │                         │               │
│           ▼                         ▼               │
│  ┌──────────────────┐    ┌──────────────────┐     │
│  │ Standalone Mode  │    │    IPC Mode      │     │
│  │  (Direct File    │    │  (Extension      │     │
│  │   Access)        │    │   API)           │     │
│  └──────────────────┘    └──────────────────┘     │
│           │                         │               │
└───────────┼─────────────────────────┼───────────────┘
            │                         │
            ▼                         ▼
   ┌─────────────────┐       ┌──────────────┐
   │ codelapse-core │       │  VS Code     │
   │  Shared Package │       │  Extension   │
   └─────────────────┘       └──────────────┘
            │                         │
            ▼                         ▼
   ┌─────────────────────────────────────┐
   │      .snapshots/ Directory          │
   │  (Snapshot Storage on Disk)         │
   └─────────────────────────────────────┘
```

## Mode Selection

The CLI automatically chooses the best mode:

1. **Standalone Mode** (Default):
   - Direct file system access to `.snapshots/`
   - Works without VS Code extension
   - Supports basic snapshot operations
   - Uses shared configuration (`.vscode/codelapse.json`)

2. **IPC Mode** (Fallback):
   - Requires VS Code extension running
   - Full feature support including semantic search
   - Uses extension's APIs
   - Required for AI-powered features

3. **Mode Selection Is Automatic**:
   ```bash
   # No flag exists; the CLI tries standalone, then falls back to IPC.
   codelapse snapshot take
   codelapse search "authentication"
   ```

   > The `--mode standalone` / `--mode ipc` examples that used to appear here
   > never worked — no such flag is registered. It also cannot be added under
   > that name, because a program-level option shadows the same-named
   > subcommand option and `search query` declares `-m, --mode` for search
   > strategy. A future selector would need a non-colliding name such as
   > `--client-mode`.

## Shared Components (codelapse-core)

The shared package provides core functionality used by both CLI and extension:

### Types
- `Snapshot` - Core snapshot data structure
- `SnapshotOptions` - Snapshot creation options
- `RestoreOptions` - Restore operation options
- `SnapshotFilter` - Filtering criteria
- `CodelapseConfig` - Configuration structure

### Storage
- `SnapshotStorage` - Low-level snapshot file operations
- `SnapshotManager` - High-level snapshot management

### Configuration
- `ConfigManager` - Unified configuration system
  - Reads from `.vscode/codelapse.json`
  - Falls back to environment variables
  - Supports defaults

### Utilities
- `GitignoreParser` - Respects .gitignore rules
- `diffUtils` - Diff generation and application
- `GitIntegration` - Git operations (read and write)

## Configuration Sharing

Both CLI and extension share configuration through `.vscode/codelapse.json`:

```json
{
  "snapshotLocation": ".snapshots",
  "maxSnapshots": 50,
  "git": {
    "addCommitInfo": true
  },
  "semanticSearch": {
    "enabled": true,
    "provider": "gemini",
    "apiKey": "env:GEMINI_API_KEY"
  }
}
```

> `git.autoSnapshotBeforeOperation` was removed: it was accepted by the schema
> and settable, but nothing read it. A configuration file that still carries the
> key keeps loading, and `codelapse config set git.autoSnapshotBeforeOperation <value>`
> now fails with "Invalid configuration key path".

**Fallback chain**:
1. `.vscode/codelapse.json` (shared file)
2. Environment variables
3. Default values

## Standalone Mode Features

### ✅ Supported Operations

**Snapshot Management**:
- `codelapse snapshot take` - Create snapshots
- `codelapse snapshot list` - List all snapshots
- `codelapse snapshot show <id>` - Show snapshot details
- `codelapse snapshot restore <id>` - Restore snapshot
- `codelapse snapshot delete <id>` - Delete snapshot
- `codelapse snapshot compare <id1> <id2>` - Compare snapshots

**File Operations**:
- `codelapse files list <id>` - List files in snapshot
- `codelapse files show <id> <path>` - Show file content
- `codelapse files compare <id1> <id2> <path>` - Compare file versions
- `codelapse files history <path>` - Show file history

**Filtering & Metadata**:
- `codelapse filter favorite` - Show favorite snapshots
- `codelapse filter tag <tag>` - Filter by tag
- `codelapse snapshot edit <id>` - Edit metadata

**Configuration**:
- `codelapse config get <key>` - Get config value
- `codelapse config set <key> <value>` - Set config value
- `codelapse config export` - Export configuration
- `codelapse config import <file>` - Import configuration

**Git Integration**:
- Git branch/commit info in snapshots
- Compare snapshots with Git commits
- Repository information
- Create commits from snapshots
- Create, switch, list, and delete branches

### ⚠️ Extension-Only Features

These features require IPC mode (VS Code extension):

- **Semantic Search**: AI-powered code search
- **Enhanced Analysis**: Code quality metrics, chunk analysis
- **Live Features**: Auto-snapshots, file watchers
- **UI Components**: Tree views, webviews

## Usage Examples

### Basic Snapshot Operations (Standalone)

```bash
# Take a snapshot
codelapse snapshot take -d "Before refactoring"

# List snapshots
codelapse snapshot list

# Restore a snapshot
codelapse snapshot restore snapshot-123456

# Compare snapshots
codelapse snapshot compare snapshot-123 snapshot-456

# Show file from snapshot
codelapse files show snapshot-123 src/index.ts
```

### Configuration Management (Standalone)

```bash
# Get configuration
codelapse config get snapshotLocation

# Set configuration
codelapse config set maxSnapshots 100

# Export configuration
codelapse config export > my-config.json

# Import configuration
codelapse config import my-config.json
```

### Advanced Features (Requires Extension)

```bash
# Semantic search (IPC mode)
codelapse search "authentication logic"

# Enhanced analysis (IPC mode)
codelapse analyze file src/auth.ts

# These automatically use IPC mode
```

## Configuration File Format

### .vscode/codelapse.json

```json
{
  "snapshotLocation": ".snapshots",
  "maxSnapshots": 50,
  "git": {
    "addCommitInfo": true
  },
  "semanticSearch": {
    "enabled": true,
    "provider": "gemini",
    "chunkSize": 200,
    "autoIndex": false
  }
}
```

### Environment Variables

```bash
# Snapshot location
export CODELAPSE_SNAPSHOT_LOCATION=".my-snapshots"

# Max snapshots
export CODELAPSE_MAX_SNAPSHOTS=100

# API keys for semantic search
export GEMINI_API_KEY="your-api-key"
export PINECONE_API_KEY="your-api-key"
```

## Migration from IPC-Only Mode

No migration needed! The CLI automatically:
1. Tries standalone mode first
2. Falls back to IPC if needed
3. Works with existing `.snapshots/` directory
4. Respects existing VS Code settings

## Development

### Building the Shared Package

```bash
cd shared
npm install
npm run build
```

### Building the CLI

```bash
cd cli
npm install
npm run build
```

### Testing Standalone Mode

```bash
# Standalone mode is selected automatically when a snapshot store is present.
# Run from a workspace containing .snapshots/ (there is no --mode flag).
codelapse snapshot take

# Check which mode is active
codelapse status
```

## Troubleshooting

### "Failed to initialize standalone handler"

**Cause**: Not in a valid workspace

**Solution**: Make sure you're in a directory with project indicators:
- `.git` directory
- `package.json` file
- `.snapshots` directory
- `tsconfig.json` file

### "Client not initialized"

**Cause**: Both standalone and IPC modes failed

**Solutions**:
1. Check you're in a valid workspace
2. For IPC mode, ensure VS Code extension is running
3. There is no flag to force a mode (`--mode` is not a real option). To force
   standalone, run from a directory containing a `.snapshots/` store; to force
   IPC, run where no store exists and ensure the extension is active.

### Configuration Not Shared

**Cause**: Configuration file not in `.vscode/` directory

**Solution**: Create `.vscode/codelapse.json` in workspace root

## Performance Considerations

**Standalone Mode**:
- ✅ Faster for basic operations (no IPC overhead)
- ✅ Works offline
- ✅ Lower memory usage
- ❌ No AI features
- ❌ No real-time updates

**IPC Mode**:
- ✅ Full feature set
- ✅ AI-powered search and analysis
- ✅ Real-time synchronization
- ❌ Requires extension running
- ❌ Slightly slower for basic ops

## Future Enhancements

Planned improvements for standalone mode:

1. **Local Embeddings**: Semantic search without external APIs
2. **Compression**: Reduce snapshot storage size
4. **Encryption**: Secure sensitive snapshots
5. **Cloud Sync**: Sync snapshots across machines
6. **Watch Mode**: Auto-snapshot on file changes

## API Reference

See [API.md](./cli/API.md) for complete CLI command reference.

## Contributing

Contributions welcome! Key areas:

1. **Shared Package**: Add utilities to `shared/src/`
2. **CLI Commands**: Add commands that work standalone
3. **Documentation**: Improve this guide
4. **Tests**: Add test coverage

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.
