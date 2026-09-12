# CodeLapse CLI Help

CodeLapse CLI is a comprehensive command-line interface for managing code snapshots. It can run independently in **Standalone Mode** or connect to the CodeLapse VSCode extension for enhanced features.

## Quick Start

```bash
# Check connection to VSCode extension
codelapse status

# Create a snapshot
codelapse snapshot create "My first snapshot"

# List all snapshots
codelapse snapshot list

# Search snapshots
codelapse search query "authentication function"

# Get help for any command
codelapse <command> --help
```

## Global Options

- `--json` - Output in JSON format (AI-friendly)
- `--silent` - Silent mode - no user prompts or status messages. It suppresses
  *all* non-JSON stdout, including listings, so pair it with `--json` in
  automation: a silent `snapshot list` prints nothing at all.
- `--verbose` - Verbose output for debugging, including which mode was selected
- `--timeout <ms>` - Connection timeout in milliseconds (default: 5000)

> **Exit status mirrors the payload.** The process exits 0 when the JSON
> payload's top-level `success` is `true` and 1 when it is `false`, for every
> command including `api` and `batch`.

> There is **no** global `--mode`. Mode selection is automatic: standalone
> first, then IPC if the extension is running. The flag cannot be added under
> that name because it would shadow the `-m, --mode` that `search query` and
> `search-enhanced query` use for search strategy; a future selector would need
> a non-colliding name such as `--client-mode`.

## Command Groups

> **Which groups need the extension running.** Commands are served by the
> CodeLapse extension over IPC. With no extension running the CLI falls back to
> **standalone mode**, which implements snapshot operations (create, list with
> `--tags`/`--favorites`/`--limit`/`--since`, show, restore, delete, compare,
> navigate), config, file-level operations, `workspace info`, and the `git`
> operations that need only a repository — against `.snapshots/` directly.
> It does *not* implement `workspace state` / `workspace files`, the
> `analyze`, `chunk`, `search index`, `rules`, `filter` and `diagnostics` API
> methods, or the git operations that compare against commits. Those fail with
> an explicit "not supported in standalone mode" error rather than returning
> anything invented. Start VS Code with the extension active to use them.
>
> `git info`, `git branches` and the git write operations need a runnable
> `git` executable; when it cannot be run the command fails with
> "git is not available" and exits 1 instead of printing empty fields.
>
> Snapshot ids may be abbreviated to any unique prefix or fragment, so
> `snapshot show 1789120661991` works for
> `snapshot-1789120661991-fe3a3996`. An ambiguous abbreviation is refused with
> the list of candidates.

### Connection & Status
- `codelapse status` - Check connection to CodeLapse extension

### Snapshot Management
- `codelapse snapshot create [description]` - Create a new snapshot
- `codelapse snapshot list` - List all snapshots
- `codelapse snapshot show <id>` - Show snapshot details
- `codelapse snapshot restore <id>` - Restore a snapshot
- `codelapse snapshot delete <id>` - Delete a snapshot
- `codelapse snapshot compare <id1> <id2>` - Compare two snapshots
- `codelapse snapshot navigate <direction>` - Navigate to previous/next snapshot

### Search & Analysis
- `codelapse search query <query>` - Semantic search across snapshots
- `codelapse search behavioral <description>` - Search by behavioral description
- `codelapse search pattern <pattern-type>` - Search for design patterns
- `codelapse search index --all` - Index snapshots for search. **`--all` is required**: the extension can index every snapshot but not individual ones, so the unflagged form fails with "Individual snapshot indexing not supported".
- `codelapse analyze chunk <chunk-id>` - Analyze a specific code chunk ⚠️ **placeholder data** (see below)
- `codelapse analyze file <file-path>` - Analyze a complete file (derived from the snapshot's real content)
- `codelapse analyze quality <target>` - Analyze code quality metrics ⚠️ **placeholder data**

### Git Integration
- `codelapse git commit <snapshot-id>` - Create Git commit from snapshot
- `codelapse git auto-commit <operation>` - Auto-snapshot before Git operations (requires the extension; not available in standalone mode)
- `codelapse git info` - Get Git repository information
- `codelapse git compare <snapshot-id> <commit-hash>` - Compare with Git commit (requires the extension; not available in standalone mode)

### Auto-Snapshot Rules
- `codelapse rules list` - List auto-snapshot rules
- `codelapse rules add <pattern> <interval>` - Add auto-snapshot rule
- `codelapse rules update <rule-id>` - Update auto-snapshot rule
- `codelapse rules remove <rule-id>` - Remove auto-snapshot rule
- `codelapse rules toggle <rule-id>` - Toggle rule enabled/disabled
- `codelapse rules test <pattern>` - Test rule pattern

### Filtering & Favorites
- `codelapse filter favorites` - Show favorite snapshots
- `codelapse filter tags <tags>` - Filter by all listed tags
- `codelapse filter date <range>` - Filter by date range
- `codelapse filter file <file-path>` - Filter by file path
- `codelapse filter favorite <snapshot-id>` - Toggle favorite status
- `codelapse filter edit-tags <snapshot-id> <tags>` - Edit snapshot tags
- `codelapse filter edit-notes <snapshot-id> <notes>` - Edit snapshot notes

### Configuration
- `codelapse config get [key]` - Get configuration value(s)
- `codelapse config set <key> <value>` - Set configuration value
- `codelapse config reset [key]` - Reset configuration to defaults
- `codelapse config list` - List available configuration keys
- `codelapse config validate` - Validate current configuration
- `codelapse config export <file>` - Export configuration
- `codelapse config import <file>` - Import configuration

### Diagnostics & Logging
- `codelapse diagnostics run` - Run comprehensive diagnostics
- `codelapse diagnostics system` - Show system information
- `codelapse diagnostics logs` - Show extension logs
- `codelapse diagnostics health` - Run health check
- `codelapse diagnostics performance` - Show performance metrics

### File Operations
- `codelapse files list <snapshot-id>` - List files in snapshot
- `codelapse files show <snapshot-id> <file-path>` - Show file content
- `codelapse files compare <id1> <id2> <file-path>` - Compare file between snapshots
- `codelapse files restore <snapshot-id> <file-path>` - Restore file from snapshot
- `codelapse files history <file-path>` - Show file history across snapshots
- `codelapse files export <snapshot-id> <file-path> <output>` - Export file

### Code Chunking
- `codelapse chunk file <file-path>` - Chunk a file with the enhanced strategies (real data)
- `codelapse chunk snapshot <snapshot-id>` - Chunk every file in a snapshot (real data)
- `codelapse chunk list <snapshot-id>` - List chunks in a snapshot ⚠️ **placeholder data**
- `codelapse chunk metadata <chunk-id>` - Chunk metadata ⚠️ **placeholder data**
- `codelapse chunk context <chunk-id>` - Chunk context ⚠️ **placeholder data**
- `codelapse chunk dependencies <chunk-id>` - Chunk dependencies ⚠️ **placeholder data**

### Workspace Information
- `codelapse workspace info` - Show workspace information
- `codelapse workspace state` - Show current workspace state
- `codelapse workspace files` - List workspace files

### Utilities
- `codelapse utility validate <id>` - Validate a snapshot
- `codelapse utility export <id>` - Export a snapshot

### Advanced Features
- `codelapse batch <file>` - Execute batch commands from JSON file
- `codelapse watch` - Watch for snapshot changes (real-time events). **Requires a
  running extension**: events are pushed over IPC, and in standalone mode there
  is no event source, so the command returns immediately without printing
  anything.
- `codelapse api <method>` - Direct API call (AI-friendly)

## Examples

### Basic Workflow
```bash
# Check status
codelapse status

# Create a snapshot with tags
codelapse snapshot create "Implement user auth" --tags "auth,feature" --favorite

# List recent snapshots
codelapse snapshot list --limit 10

# Search for authentication code
codelapse search query "user authentication" --limit 5

# Show snapshot details
codelapse snapshot show abc123
```

### Advanced Search
```bash
# Semantic search with filtering
codelapse search query "error handling" --languages "typescript,javascript" --threshold 0.7

# Search for design patterns
codelapse search pattern "factory pattern" --context 10

# Behavioral search
codelapse search behavioral "validates user input and returns error messages"
```

### Git Integration
```bash
# Create auto-snapshot before git pull
codelapse git auto-commit "pull" --description "Before pulling latest changes"

# Create git commit from snapshot
codelapse git commit abc123 --message "Add user authentication" --push

# Compare snapshot with git commit
codelapse git compare abc123 HEAD --files
```

### File Operations
```bash
# List changed files in snapshot
codelapse files list abc123 --changed-only

# Show file content with line numbers
codelapse files show abc123 src/auth.ts

# Compare file between snapshots
codelapse files compare abc123 def456 src/auth.ts --context 5

# Restore file from snapshot
codelapse files restore abc123 src/auth.ts --backup
```

### Configuration Management
```bash
# Show all configuration
codelapse config get

# Set maximum snapshots
codelapse config set maxSnapshots 100

# Enable verbose logging
codelapse config set verboseLogging true

# Export configuration
codelapse config export my-config.json
```

### Auto-Snapshot Rules
```bash
# Add rule for TypeScript files
codelapse rules add "**/*.ts" 30 --description "Auto-snapshot TS files every 30 minutes"

# Add rule with tags
codelapse rules add "src/**/*.js" 60 --tags "javascript,src"

# Test a pattern
codelapse rules test "**/*.{ts,js}" --path ./src
```

### Filtering & Management
```bash
# Show favorite snapshots
codelapse filter favorites --limit 20

# Filter by tags (all listed tags must match)
codelapse filter tags "auth,feature"

# Filter by date (last 2 days)
codelapse filter date "2d"

# Also accepted: 1h, 1w, 3m, 1y, the keyword "today",
# ISO dates ("2025-01-31") and ranges ("2025-01-01..2025-12-31").
# Anything else fails with a message listing the accepted forms.

# Mark snapshot as favorite
codelapse filter favorite abc123

# Edit snapshot tags
codelapse filter edit-tags abc123 "auth,login,security"
```

### Diagnostics
```bash
# Run full diagnostics
codelapse diagnostics run --verbose

# Show system information
codelapse diagnostics system

# Follow logs in real-time
codelapse diagnostics logs --follow

# Check health
codelapse diagnostics health

# Show performance metrics
codelapse diagnostics performance --time-range 6h
```

### Batch Operations
```bash
# Create batch file (commands.json)
echo '[
  {"method": "takeSnapshot", "data": {"description": "Batch snapshot 1"}},
  {"method": "takeSnapshot", "data": {"description": "Batch snapshot 2"}}
]' > commands.json

# Execute batch commands
codelapse batch commands.json
```

Both file shapes are accepted: the bare top-level array above, and a
`{"commands": [ ... ]}` wrapper around the same array. Anything else is
refused with an error naming both.

Each entry is validated against the API allowlist before anything runs, and
`success` in the result reflects whether every command succeeded. A command
that fails does not stop the rest of the batch.

## JSON Output Format

All commands support `--json` flag for structured output suitable for automation and AI tools:

```bash
codelapse snapshot list --json
codelapse search query "authentication" --json
codelapse filter favorites --json
```

Progress and warnings are written to stderr, so stdout stays parseable. The
process exit code is 0 when the JSON payload's `success` is `true` and 1 when it
is `false` (verified for 30 command/argument combinations).

## Placeholder data

These commands return a well-formed response whose **values are not derived from
your repository** — hardcoded numbers, `chunk-1`, `example.ts`, `'Factory'`,
`'User authentication service'`. Do not use them for decisions:

- `codelapse analyze chunk`
- `codelapse analyze quality`
- `codelapse chunk list` / `metadata` / `context` / `dependencies`

`codelapse analyze file`, `codelapse chunk file` and `codelapse chunk snapshot`
are **not** in this list: they read real snapshot content and score real chunks.
See [Known Issues](https://github.com/YukioTheSage/code-snapshots/blob/main/docs/KNOWN_ISSUES.md).

## Real-time Events

Watch for real-time changes. Requires a running extension (IPC mode):

```bash
# Watch all events
codelapse watch

# Watch specific event types
codelapse watch --events "changes,snapshots"
```

## Troubleshooting

1. **Connection Issues**: For IPC mode, ensure VSCode is running. For Standalone mode, check file permissions.
2. **No Workspace**: Ensure you are in a valid project directory (Standalone) or have a workspace open (IPC).
3. **Extension Not Found**: Install extension if you need AI features (IPC mode).
4. **Timeout Errors**: Increase timeout with `--timeout 10000`
5. **Permission Issues**: Check file system permissions for snapshot location

## Support

- Use `codelapse <command> --help` for command-specific help
- Run `codelapse diagnostics run` to identify issues
- Check logs with `codelapse diagnostics logs`
- Report issues at: https://github.com/YukioTheSage/code-snapshots/issues