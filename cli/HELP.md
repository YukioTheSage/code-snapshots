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
- `--silent` - Silent mode - no user prompts or status messages
- `--verbose` - Verbose output for debugging
- `--timeout <ms>` - Connection timeout in milliseconds (default: 5000)
- `--mode <mode>` - Force mode: `auto` (default), `standalone`, or `ipc`

## Command Groups

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
- `codelapse search index` - Index snapshots for search
- `codelapse analyze chunk <chunk-id>` - Analyze a specific code chunk
- `codelapse analyze file <file-path>` - Analyze a complete file
- `codelapse analyze quality <target>` - Analyze code quality metrics

### Git Integration
- `codelapse git commit <snapshot-id>` - Create Git commit from snapshot
- `codelapse git auto-snapshot <operation>` - Auto-snapshot before Git operations
- `codelapse git info` - Get Git repository information
- `codelapse git compare <snapshot-id> <commit-hash>` - Compare with Git commit

### Auto-Snapshot Rules
- `codelapse rules list` - List auto-snapshot rules
- `codelapse rules add <pattern> <interval>` - Add auto-snapshot rule
- `codelapse rules update <rule-id>` - Update auto-snapshot rule
- `codelapse rules remove <rule-id>` - Remove auto-snapshot rule
- `codelapse rules toggle <rule-id>` - Toggle rule enabled/disabled
- `codelapse rules test <pattern>` - Test rule pattern

### Filtering & Favorites
- `codelapse filter favorites` - Show favorite snapshots
- `codelapse filter tags <tags>` - Filter by tags
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

### Workspace Information
- `codelapse workspace info` - Show workspace information
- `codelapse workspace state` - Show current workspace state
- `codelapse workspace files` - List workspace files

### Utilities
- `codelapse utility validate <id>` - Validate a snapshot
- `codelapse utility export <id>` - Export a snapshot

### Advanced Features
- `codelapse batch <file>` - Execute batch commands from JSON file
- `codelapse watch` - Watch for snapshot changes (real-time events)
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
codelapse git auto-snapshot "pull" --description "Before pulling latest changes"

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

# Filter by tags
codelapse filter tags "auth,feature"

# Filter by date (last 2 days)
codelapse filter date "2d"

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

## JSON Output Format

All commands support `--json` flag for structured output suitable for automation and AI tools:

```bash
codelapse snapshot list --json
codelapse search query "authentication" --json
codelapse filter favorites --json
```

## Real-time Events

Watch for real-time changes:

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