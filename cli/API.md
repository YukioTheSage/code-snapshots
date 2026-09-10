# CodeLapse CLI API Reference

Complete reference for all CodeLapse CLI commands, options, and usage patterns.

**Binary**: `codelapse` (alias: `cl`)

---

## Global Options

These options apply to all commands:

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format (AI-friendly) | `false` |
| `--silent` | Silent mode - no user prompts or status messages | `false` |
| `--verbose` | Verbose output for debugging | `false` |
| `--timeout <ms>` | Connection timeout in milliseconds | `5000` |

> **There is no global `--mode`.** An earlier version of this table documented
> one (`auto` / `standalone` / `ipc`), but it cannot exist under that name:
> Commander resolves an option to the first command in the chain declaring it,
> so a program-level `--mode` would *shadow* the `-m, --mode` that
> `search query` and `search-enhanced query` declare to select a search
> strategy. Measured: with the global present, `search query foo --mode hybrid`
> left the handler with the default `semantic`, silently discarding the user's
> choice.
>
> The client therefore always runs in `auto` mode (standalone first, IPC
> fallback) and there is currently no way to force one. If a selector is wanted,
> it must use a non-colliding name such as `--client-mode`.

---

## Commands

### `status`

Check CodeLapse status and current mode.

```bash
codelapse status
```

---

### `snapshot` (alias: `snap`)

Snapshot management commands.

#### `snapshot create [description]` (alias: `new`)

Create a new snapshot.

```bash
codelapse snapshot create "Before refactoring"
codelapse snapshot create -t "auth,bugfix" -f
codelapse snapshot create --files "src/a.ts,src/b.ts"
```

| Option | Description |
|--------|-------------|
| `-t, --tags <tags>` | Comma-separated tags |
| `-n, --notes <notes>` | Snapshot notes |
| `-r, --task-ref <ref>` | Task reference |
| `-f, --favorite` | Mark as favorite |
| `-s, --selective` | Selective snapshot (choose files) |
| `--files <files>` | Comma-separated file paths for selective snapshot |

#### `snapshot list` (alias: `ls`)

List all snapshots.

```bash
codelapse snapshot list
codelapse snapshot list -f --since "2d"
codelapse snapshot list -t "auth" -l 10
```

| Option | Description |
|--------|-------------|
| `-t, --tags <tags>` | Filter by tags (comma-separated) |
| `-f, --favorites` | Show only favorites |
| `-l, --limit <number>` | Limit number of results |
| `--since <date>` | Show snapshots since date (ISO string or relative like `1h`, `2d`) |

#### `snapshot show <id>`

Show snapshot details.

```bash
codelapse snapshot show snapshot-123456
codelapse snapshot show snapshot-123456 --files
codelapse snapshot show snapshot-123456 --content src/index.ts
```

| Option | Description |
|--------|-------------|
| `--files` | Show file changes |
| `--content <file>` | Show content of specific file |

#### `snapshot restore <id>`

Restore a snapshot.

```bash
codelapse snapshot restore snapshot-123456
codelapse snapshot restore snapshot-123456 --backup -y
codelapse snapshot restore snapshot-123456 --files "src/a.ts,src/b.ts"
```

| Option | Description |
|--------|-------------|
| `--backup` | Create backup snapshot before restore |
| `--files <files>` | Restore only specific files (comma-separated) |
| `-y, --yes` | Skip confirmation |

#### `snapshot delete <id>` (alias: `rm`)

Delete a snapshot.

```bash
codelapse snapshot delete snapshot-123456
codelapse snapshot delete snapshot-123456 -y
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation |

#### `snapshot compare <id1> <id2>` (alias: `diff`)

Compare two snapshots.

```bash
codelapse snapshot compare snapshot-123 snapshot-456
codelapse snapshot compare snapshot-123 snapshot-456 --files
```

| Option | Description |
|--------|-------------|
| `--files` | Show file-level changes only |

#### `snapshot navigate <direction>` (alias: `nav`)

Navigate to previous/next snapshot.

```bash
codelapse snapshot navigate previous
codelapse snapshot navigate next
codelapse snapshot navigate first
codelapse snapshot navigate last
```

**Directions**: `previous`, `next`, `first`, `last`

---

### `search`

Semantic search commands.

#### `search query <query>` (alias: `q`)

Search snapshots with natural language.

```bash
codelapse search query "authentication logic"
codelapse search query "error handling" -m hybrid -l 10
codelapse search query "database queries" --languages "ts,js" --quality-min 0.8
```

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <number>` | `20` | Limit results |
| `-t, --threshold <number>` | `0.65` | Score threshold (0-1) |
| `--snapshots <ids>` | | Search specific snapshots (comma-separated) |
| `--languages <langs>` | | Filter by languages (comma-separated) |
| `-m, --mode <mode>` | `semantic` | Search mode: `semantic`, `syntactic`, `behavioral`, `hybrid` |
| `--no-explanations` | | Disable result explanations |
| `--no-relationships` | | Disable relationship information |
| `--no-quality` | | Disable quality metrics |
| `-c, --context <lines>` | `5` | Context radius in lines |
| `-r, --ranking <strategy>` | `relevance` | Ranking: `relevance`, `quality`, `recency`, `usage` |
| `--complexity-min <number>` | | Minimum complexity score |
| `--complexity-max <number>` | | Maximum complexity score |
| `--quality-min <number>` | | Minimum quality threshold |
| `--semantic-types <types>` | | Filter by semantic types (comma-separated) |
| `--patterns <patterns>` | | Filter by design patterns (comma-separated) |
| `--exclude-smells <smells>` | | Exclude code smells (comma-separated) |
| `--domains <domains>` | | Filter by business domains (comma-separated) |
| `--max-per-file <number>` | | Maximum results per file |
| `--no-diversify` | | Disable result diversification |

#### `search behavioral <description>` (alias: `b`)

Search for code based on behavioral description.

```bash
codelapse search behavioral "validates user input before saving"
codelapse search behavioral "retries failed HTTP requests" --languages "ts"
```

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <number>` | `20` | Limit results |
| `-t, --threshold <number>` | `0.6` | Score threshold (0-1) |
| `--snapshots <ids>` | | Search specific snapshots (comma-separated) |
| `--languages <langs>` | | Filter by languages (comma-separated) |
| `--no-relationships` | | Disable relationship information |
| `-c, --context <lines>` | `5` | Context radius in lines |
| `--complexity-min <number>` | | Minimum complexity score |
| `--complexity-max <number>` | | Maximum complexity score |
| `--quality-min <number>` | | Minimum quality threshold |
| `--semantic-types <types>` | | Filter by semantic types (comma-separated) |
| `--patterns <patterns>` | | Filter by design patterns (comma-separated) |
| `--exclude-smells <smells>` | | Exclude code smells (comma-separated) |
| `--domains <domains>` | | Filter by business domains (comma-separated) |

#### `search pattern <pattern-type>` (alias: `p`)

Search for specific design patterns or code structures.

```bash
codelapse search pattern "singleton"
codelapse search pattern "observer" --languages "ts" -l 10
```

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <number>` | `15` | Limit results |
| `-t, --threshold <number>` | `0.7` | Score threshold (0-1) |
| `--snapshots <ids>` | | Search specific snapshots (comma-separated) |
| `--languages <langs>` | | Filter by languages (comma-separated) |
| `-c, --context <lines>` | `8` | Context radius in lines |
| `--complexity-min <number>` | | Minimum complexity score |
| `--complexity-max <number>` | | Maximum complexity score |
| `--quality-min <number>` | | Minimum quality threshold |
| `--semantic-types <types>` | | Filter by semantic types (comma-separated) |
| `--exclude-smells <smells>` | | Exclude code smells (comma-separated) |
| `--domains <domains>` | | Filter by business domains (comma-separated) |

#### `search batch <queries-file>`

Execute multiple search queries from a JSON file.

```bash
codelapse search batch queries.json
codelapse search batch queries.json --concurrency 5
```

| Option | Default | Description |
|--------|---------|-------------|
| `--no-parallel` | | Disable parallel processing |
| `--concurrency <number>` | `3` | Maximum concurrent queries |

#### `search index`

Index snapshots for semantic search.

```bash
codelapse search index
codelapse search index --all
```

| Option | Description |
|--------|-------------|
| `--all` | Index all snapshots |

---

### `search-enhanced` (alias: `se`)

Enhanced semantic search commands optimized for AI agents. Provides the same subcommands as `search` (`query`, `behavioral`, `pattern`, `batch`) with identical options.

```bash
codelapse se query "authentication logic" --json
codelapse se behavioral "handles retries" --json
codelapse se pattern "factory" --json
```

---

### `files`

File-level snapshot operations.

#### `files list <snapshot-id>` (alias: `ls`)

List files in a snapshot.

```bash
codelapse files list snapshot-123
codelapse files list snapshot-123 --changed-only --sort-by size
```

| Option | Default | Description |
|--------|---------|-------------|
| `--changed-only` | | Show only changed files |
| `--content` | | Include file content preview |
| `--pattern <pattern>` | | Filter files by pattern |
| `--sort-by <field>` | `path` | Sort by: `path`, `size`, `modified` |
| `--sort-order <order>` | `asc` | Sort order: `asc`, `desc` |

#### `files show <snapshot-id> <file-path>`

Show file content from a snapshot.

```bash
codelapse files show snapshot-123 src/index.ts
codelapse files show snapshot-123 src/auth.ts --no-syntax
```

| Option | Description |
|--------|-------------|
| `--no-content` | Skip file content |
| `--no-metadata` | Skip file metadata |
| `--no-syntax` | Skip syntax highlighting |
| `--no-line-numbers` | Skip line numbers |
| `--context <lines>` | Context lines around changes |

#### `files compare <id1> <id2> <file-path>` (alias: `diff`)

Compare a file between two snapshots.

```bash
codelapse files compare snapshot-123 snapshot-456 src/index.ts
codelapse files compare snapshot-123 snapshot-456 src/index.ts --side-by-side
```

| Option | Default | Description |
|--------|---------|-------------|
| `--context <lines>` | `3` | Context lines for diff |
| `--ignore-whitespace` | | Ignore whitespace changes |
| `--side-by-side` | | Side-by-side diff format |

#### `files restore <snapshot-id> <file-path>`

Restore a single file from a snapshot.

```bash
codelapse files restore snapshot-123 src/index.ts
codelapse files restore snapshot-123 src/index.ts --to src/index.backup.ts
```

| Option | Description |
|--------|-------------|
| `--to <path>` | Restore to a different path |
| `--no-backup` | Skip creating backup |
| `--force` | Force restore without confirmation |

#### `files history <file-path>`

Show file history across snapshots.

```bash
codelapse files history src/index.ts
codelapse files history src/auth.ts --since "7d" -l 20
```

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --limit <number>` | `50` | Limit results |
| `--since <time>` | | Show history since time |
| `--content` | | Include content changes |
| `--sort-order <order>` | `desc` | Sort order: `asc`, `desc` |

#### `files export <snapshot-id> <file-path> <output-path>`

Export a file from a snapshot.

```bash
codelapse files export snapshot-123 src/index.ts ./exported-index.ts
codelapse files export snapshot-123 src/index.ts ./data.json --format json --metadata
```

| Option | Default | Description |
|--------|---------|-------------|
| `--format <format>` | `original` | Export format: `original`, `json` |
| `--metadata` | | Include metadata in export |

---

### `filter` (alias: `f`)

Filter and manage snapshots.

#### `filter favorites` (alias: `fav`)

Show favorite snapshots.

```bash
codelapse filter favorites
codelapse filter favorites -l 10
```

| Option | Description |
|--------|-------------|
| `-l, --limit <number>` | Limit results |
| `--offset <number>` | Offset for pagination |

#### `filter tags <tags>`

Filter snapshots by tags.

```bash
codelapse filter tags "auth,security"
```

| Option | Description |
|--------|-------------|
| `-l, --limit <number>` | Limit results |
| `--offset <number>` | Offset for pagination |

#### `filter date <range>`

Filter snapshots by date.

```bash
codelapse filter date "2d"
codelapse filter date "2025-01-01..2025-12-31"
```

| Option | Description |
|--------|-------------|
| `-l, --limit <number>` | Limit results |
| `--offset <number>` | Offset for pagination |

#### `filter file <file-path>`

Filter snapshots by file path.

```bash
codelapse filter file src/auth.ts
```

| Option | Description |
|--------|-------------|
| `-l, --limit <number>` | Limit results |
| `--offset <number>` | Offset for pagination |

#### `filter favorite <snapshot-id>`

Toggle favorite status of a snapshot.

```bash
codelapse filter favorite snapshot-123
```

#### `filter edit-tags <snapshot-id> <tags>`

Edit snapshot tags.

```bash
codelapse filter edit-tags snapshot-123 "auth,refactor,v2"
```

#### `filter edit-notes <snapshot-id> <notes>`

Edit snapshot notes.

```bash
codelapse filter edit-notes snapshot-123 "Refactored auth module"
```

#### `filter edit-task <snapshot-id> <task-ref>`

Edit snapshot task reference.

```bash
codelapse filter edit-task snapshot-123 "JIRA-456"
```

---

### `config` (alias: `cfg`)

Configuration management commands.

#### `config get [key]`

Get configuration value(s). Omit key to show all configuration.

```bash
codelapse config get
codelapse config get snapshotLocation
```

#### `config set <key> <value>`

Set a configuration value.

```bash
codelapse config set maxSnapshots 100
codelapse config set snapshotLocation ".my-snapshots"
```

#### `config reset [key]`

Reset configuration to defaults. Omit key to reset all.

```bash
codelapse config reset
codelapse config reset maxSnapshots
```

#### `config list`

List available configuration keys.

```bash
codelapse config list
```

#### `config validate`

Validate current configuration.

```bash
codelapse config validate
```

#### `config export <file-path>`

Export configuration to file.

```bash
codelapse config export ./my-config.json
codelapse config export ./my-config.yaml --format yaml
```

| Option | Default | Description |
|--------|---------|-------------|
| `--format <format>` | `json` | Export format: `json`, `yaml` |

#### `config import <file-path>`

Import configuration from file.

```bash
codelapse config import ./my-config.json
codelapse config import ./my-config.json --merge
```

| Option | Description |
|--------|-------------|
| `--merge` | Merge with existing config instead of replacing |

---

### `git` (alias: `g`)

Git integration commands.

#### `git commit <snapshot-id>`

Create a Git commit from a snapshot.

```bash
codelapse git commit snapshot-123 -m "feat: add auth module"
codelapse git commit snapshot-123 --branch feature/auth --push
```

| Option | Description |
|--------|-------------|
| `-m, --message <message>` | Commit message |
| `--include-untracked` | Include untracked files |
| `--branch <name>` | Create new branch |
| `--push` | Push after commit |

#### `git auto-commit <operation>`

Create an auto-snapshot before a Git operation. **Requires a running extension** —
`autoSnapshotBeforeGitOperation` is not implemented in standalone mode, where this
command exits 1 with `Method autoSnapshotBeforeGitOperation not supported in
standalone mode`.

```bash
codelapse git auto-commit merge
codelapse git auto-commit rebase -d "Before rebase onto main"
```

| Option | Description |
|--------|-------------|
| `-d, --description <desc>` | Snapshot description |
| `-u, --include-untracked` | Include untracked files |

#### `git info`

Get Git repository information.

```bash
codelapse git info
```

#### `git compare <snapshot-id> <commit-hash>`

Compare a snapshot with a Git commit.

```bash
codelapse git compare snapshot-123 abc1234
codelapse git compare snapshot-123 abc1234 --files
```

| Option | Description |
|--------|-------------|
| `--files` | Show file-level changes |

#### `git branches`

List available Git branches.

```bash
codelapse git branches
```

#### `git branch <name>`

Create a new Git branch.

```bash
codelapse git branch feature/auth
codelapse git branch feature/auth -c    # checkout after creation
```

| Option | Description |
|--------|-------------|
| `-c, --checkout` | Switch to new branch after creation |

#### `git checkout <name>`

Switch to an existing Git branch.

```bash
codelapse git checkout feature/auth
```

#### `git delete-branch <name>`

Delete a Git branch.

```bash
codelapse git delete-branch feature/auth
codelapse git delete-branch feature/auth -f    # force delete
```

| Option | Description |
|--------|-------------|
| `-f, --force` | Force delete |

---

### `analyze` (alias: `an`)

Code analysis commands for AI agents.

#### `analyze chunk <chunk-id>`

Analyze a specific code chunk.

```bash
codelapse analyze chunk chunk-abc -s snapshot-123
codelapse analyze chunk chunk-abc -s snapshot-123 -t quick
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --snapshot <id>` | *required* | Snapshot ID |
| `-t, --type <type>` | `full` | Analysis type: `full`, `quick`, `quality` |
| `--no-relationships` | | Disable relationship analysis |
| `--no-quality` | | Disable quality metrics |
| `--no-context` | | Disable context information |

#### `analyze file <file-path>`

Analyze a complete file.

```bash
codelapse analyze file src/auth.ts -s snapshot-123
codelapse analyze file src/auth.ts -s snapshot-123 -t quality
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --snapshot <id>` | *required* | Snapshot ID |
| `-t, --type <type>` | `full` | Analysis type: `full`, `quick`, `quality` |
| `--no-chunks` | | Disable chunk information |
| `--no-metrics` | | Disable file metrics |
| `--no-suggestions` | | Disable improvement suggestions |

#### `analyze quality <target>`

Analyze code quality metrics.

```bash
codelapse analyze quality src/auth.ts -s snapshot-123
codelapse analyze quality src/ -s snapshot-123 -m readability,complexity
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --snapshot <id>` | *required* | Snapshot ID |
| `-m, --metrics <metrics>` | | Specific metrics: `readability`, `maintainability`, `complexity`, `documentation` |
| `--no-recommendations` | | Disable recommendations |
| `--no-trends` | | Disable trend analysis |
| `--threshold <number>` | `0.7` | Quality threshold (0-1) |

#### `analyze relationships <chunk-id>`

Analyze chunk relationships and dependencies.

```bash
codelapse analyze relationships chunk-abc
codelapse analyze relationships chunk-abc -d 5 --types "calls,imports"
```

| Option | Default | Description |
|--------|---------|-------------|
| `--no-transitive` | | Disable transitive relationships |
| `-d, --depth <number>` | `3` | Maximum relationship depth |
| `--types <types>` | | Relationship types: `calls`, `imports`, `extends`, `implements` |
| `--no-strength` | | Disable relationship strength calculation |

#### `analyze batch <input-file>`

Execute multiple analysis operations from a JSON file.

```bash
codelapse analyze batch analysis-tasks.json
codelapse analyze batch analysis-tasks.json --concurrency 10
```

| Option | Default | Description |
|--------|---------|-------------|
| `--no-parallel` | | Disable parallel processing |
| `--concurrency <number>` | `5` | Maximum concurrent operations |

---

### `chunk` (alias: `ch`)

Enhanced code chunking commands.

#### `chunk file <file-path>`

Chunk a specific file with enhanced strategies.

```bash
codelapse chunk file src/auth.ts -s snapshot-123
codelapse chunk file src/auth.ts -s snapshot-123 --strategy hierarchical
```

| Option | Default | Description |
|--------|---------|-------------|
| `-s, --snapshot <id>` | *required* | Snapshot ID |
| `--strategy <strategy>` | `semantic` | Strategy: `semantic`, `hierarchical`, `context-aware` |
| `--max-size <number>` | `1000` | Maximum chunk size in lines |
| `--min-size <number>` | `50` | Minimum chunk size in lines |
| `--overlap <number>` | `0` | Overlap between chunks in lines |
| `--no-preserve-structure` | | Disable structure preservation |
| `--no-context` | | Disable context inclusion |

#### `chunk snapshot <snapshot-id>`

Chunk all files in a snapshot.

```bash
codelapse chunk snapshot snapshot-123
codelapse chunk snapshot snapshot-123 --patterns "*.ts,*.js" --exclude-tests
```

| Option | Default | Description |
|--------|---------|-------------|
| `--strategy <strategy>` | `semantic` | Strategy: `semantic`, `hierarchical`, `context-aware` |
| `--patterns <patterns>` | | File patterns to include (comma-separated) |
| `--max-size <number>` | `1000` | Maximum chunk size in lines |
| `--min-size <number>` | `50` | Minimum chunk size in lines |
| `--overlap <number>` | `0` | Overlap between chunks in lines |
| `--no-preserve-structure` | | Disable structure preservation |
| `--no-context` | | Disable context inclusion |
| `--no-exclude-binary` | | Include binary files |
| `--exclude-tests` | | Exclude test files |

#### `chunk list <snapshot-id>`

List chunks in a snapshot with filtering.

```bash
codelapse chunk list snapshot-123
codelapse chunk list snapshot-123 --types "function,class" --quality-min 0.8
```

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --file <file-path>` | | Filter by specific file |
| `--types <types>` | | Filter by semantic types (comma-separated) |
| `--quality-min <number>` | | Minimum quality threshold |
| `--complexity-min <number>` | | Minimum complexity score |
| `--complexity-max <number>` | | Maximum complexity score |
| `--patterns <patterns>` | | Filter by design patterns (comma-separated) |
| `--exclude-smells <smells>` | | Exclude code smells (comma-separated) |
| `-p, --page <number>` | `1` | Page number |
| `-l, --limit <number>` | `50` | Results per page |
| `--sort <field>` | `startLine` | Sort by: `startLine`, `endLine`, `quality`, `complexity` |
| `--order <order>` | `asc` | Sort order: `asc`, `desc` |

#### `chunk metadata <chunk-id>`

Get detailed metadata for a chunk.

```bash
codelapse chunk metadata chunk-abc
codelapse chunk metadata chunk-abc --context-radius 10
```

| Option | Default | Description |
|--------|---------|-------------|
| `--no-relationships` | | Disable relationship information |
| `--no-quality` | | Disable quality metrics |
| `--no-context` | | Disable context information |
| `--context-radius <number>` | `5` | Context radius in lines |

#### `chunk context <chunk-id>`

Get contextual information for a chunk.

```bash
codelapse chunk context chunk-abc
codelapse chunk context chunk-abc -r 10 --no-business
```

| Option | Default | Description |
|--------|---------|-------------|
| `-r, --radius <number>` | `5` | Context radius in lines |
| `--no-file-context` | | Disable file context |
| `--no-architectural` | | Disable architectural context |
| `--no-business` | | Disable business context |

#### `chunk dependencies <chunk-id>`

Get chunk dependencies and relationships.

```bash
codelapse chunk dependencies chunk-abc
codelapse chunk dependencies chunk-abc -d 5 --types "imports,calls"
```

| Option | Default | Description |
|--------|---------|-------------|
| `--no-transitive` | | Disable transitive dependencies |
| `-d, --depth <number>` | `3` | Maximum dependency depth |
| `--types <types>` | | Dependency types: `imports`, `calls`, `extends`, `implements` |
| `--no-strength` | | Disable relationship strength calculation |

---

### `rules` (alias: `r`)

Auto-snapshot rules management.

#### `rules list` (alias: `ls`)

List auto-snapshot rules.

```bash
codelapse rules list
```

#### `rules add <pattern> <interval>`

Add an auto-snapshot rule (interval in minutes).

```bash
codelapse rules add "src/**/*.ts" 30
codelapse rules add "*.config.js" 60 -d "Config file watcher" --tags "config"
```

| Option | Description |
|--------|-------------|
| `-d, --description <desc>` | Rule description |
| `--tags <tags>` | Comma-separated tags |
| `--disabled` | Create rule in disabled state |

#### `rules update <rule-id>`

Update an auto-snapshot rule.

```bash
codelapse rules update rule-123 --interval 15
codelapse rules update rule-123 --pattern "src/**/*.tsx" --enabled
```

| Option | Description |
|--------|-------------|
| `--pattern <pattern>` | New pattern |
| `--interval <minutes>` | New interval |
| `--description <desc>` | New description |
| `--tags <tags>` | New tags (comma-separated) |
| `--enabled` | Enable rule |
| `--disabled` | Disable rule |

#### `rules remove <rule-id>` (alias: `rm`)

Remove an auto-snapshot rule.

```bash
codelapse rules remove rule-123
```

#### `rules toggle <rule-id>`

Toggle auto-snapshot rule enabled/disabled.

```bash
codelapse rules toggle rule-123
```

#### `rules test <pattern>`

Test an auto-snapshot rule pattern against files.

```bash
codelapse rules test "src/**/*.ts"
codelapse rules test "*.config.*" --path ./config
```

| Option | Default | Description |
|--------|---------|-------------|
| `--path <path>` | current directory | Test path |

---

### `workspace` (alias: `ws`)

Workspace information commands.

#### `workspace info`

Show workspace information.

```bash
codelapse workspace info
```

#### `workspace state`

Show current workspace state.

```bash
codelapse workspace state
```

#### `workspace files`

List workspace files.

```bash
codelapse workspace files
codelapse workspace files --changed
```

| Option | Description |
|--------|-------------|
| `--changed` | Show only changed files |

---

### `utility` (alias: `util`)

Utility commands.

#### `utility validate <id>`

Validate a snapshot.

```bash
codelapse utility validate snapshot-123
```

#### `utility export <id>`

Export a snapshot.

```bash
codelapse utility export snapshot-123
codelapse utility export snapshot-123 -f zip -o ./backup.zip
```

| Option | Default | Description |
|--------|---------|-------------|
| `-f, --format <format>` | `json` | Export format: `json`, `zip` |
| `-o, --output <path>` | | Output path |

---

### `diagnostics` (alias: `diag`)

Diagnostics and logging commands.

#### `diagnostics run`

Run comprehensive diagnostics.

```bash
codelapse diagnostics run
codelapse diagnostics run -v --no-git
```

| Option | Description |
|--------|-------------|
| `--no-system` | Skip system information |
| `--no-snapshots` | Skip snapshot checks |
| `--no-git` | Skip Git checks |
| `--no-config` | Skip configuration checks |
| `-v, --verbose` | Verbose output |

#### `diagnostics system`

Show system information.

```bash
codelapse diagnostics system
```

#### `diagnostics logs`

Show extension logs.

```bash
codelapse diagnostics logs
codelapse diagnostics logs -l 50 --level error --since "1h"
codelapse diagnostics logs -f
```

| Option | Default | Description |
|--------|---------|-------------|
| `-l, --lines <number>` | `100` | Number of log lines |
| `--level <level>` | | Log level filter: `error`, `warn`, `info`, `debug` |
| `--since <time>` | | Show logs since time (e.g., `1h`, `2d`) |
| `-f, --follow` | | Follow log output in real-time |

#### `diagnostics clear-logs`

Clear extension logs.

```bash
codelapse diagnostics clear-logs
codelapse diagnostics clear-logs --older-than "7d" --level debug
```

| Option | Description |
|--------|-------------|
| `--older-than <time>` | Clear logs older than time |
| `--level <level>` | Clear only specific log level |

#### `diagnostics health`

Run health check.

```bash
codelapse diagnostics health
```

| Option | Description |
|--------|-------------|
| `--no-performance` | Skip performance checks |
| `--no-connectivity` | Skip connectivity checks |
| `--no-storage` | Skip storage checks |

#### `diagnostics performance`

Show performance metrics.

```bash
codelapse diagnostics performance
codelapse diagnostics performance --time-range 1d
```

| Option | Default | Description |
|--------|---------|-------------|
| `--no-history` | | Skip performance history |
| `--time-range <range>` | `1h` | Time range: `1h`, `6h`, `1d` |

---

### `batch <file>`

Execute batch commands from a JSON file (AI-friendly).

```bash
codelapse batch commands.json
```

### `watch`

Watch for snapshot changes (real-time event streaming).

```bash
codelapse watch
codelapse watch --events "changes,snapshots"
```

| Option | Description |
|--------|-------------|
| `--events <events>` | Event types: `changes`, `snapshots`, `workspace` (comma-separated) |

### `api <method>`

Direct API call (AI-friendly).

```bash
codelapse api getSnapshots
codelapse api createSnapshot -d '{"description": "test"}'
```

| Option | Description |
|--------|-------------|
| `-d, --data <json>` | JSON data to send |

---

## Mode Availability

Verified by running each family with `--json` in standalone mode (no extension
running) and reading the resulting envelope.

| Feature | Standalone | IPC (Extension) |
|---------|-----------|-----------------|
| Snapshot CRUD | Yes | Yes |
| File operations | Yes | Yes |
| Filtering & metadata (`filter …`) | **No** | Yes |
| Configuration | Yes | Yes |
| Git integration | **Partly** — `commit`, `info` work; `auto-commit` and `compare` require IPC | Yes |
| Workspace info (`workspace info`) | Yes | Yes |
| Workspace state (`workspace state`/`files`) | No | Yes |
| Utility tasks (`export`, `validate`) | No | Yes |
| Diagnostics | No | Yes |
| Rules management | No | Yes |
| Semantic search | No | Yes |
| Enhanced analysis | No | Yes |
| Chunking | No | Yes |
| Live features (`watch`) | No | Yes |
| UI components | No | Yes |

*Note: Commands that are not supported in Standalone mode require the CodeLapse VS Code Extension to be running and connected. They fail with `{"success": false, "error": "Method <name> not supported in standalone mode"}` and exit 1 — they do not return invented data.*

---

## JSON Output

All commands support `--json` for machine-readable output:

```bash
codelapse --json snapshot list
codelapse --json search query "auth"
codelapse --json config get
```

JSON output follows a consistent envelope format for easy parsing by AI agents and scripts.
