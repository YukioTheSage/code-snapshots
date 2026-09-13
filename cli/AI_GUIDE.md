# CodeLapse CLI Instructions for AI Agents

You drive `codelapse-cli` to snapshot a workspace before and after code changes:
snapshot first, change second, snapshot again when the work is finished, and
restore the backup rather than improvising when something fails. Every command
answers with the same JSON envelope and the same exit status, so the same two
checks - the exit code and the payload's `success` - carry you through every step
below. Run the CLI from the workspace you are editing; it locates the workspace
itself. The bash examples need `jq`; the PowerShell examples do not.

> Verified against codelapse-cli 2.0.0 (Node >= 18.15.0). Command surface: [HELP.md](HELP.md). Per-command payloads: [API.md](API.md). Mode matrix: [API.md#mode-availability](API.md#mode-availability).

> ⚠️ **CRITICAL SECURITY WARNING - SEMANTIC SEARCH**:
>
> - **NEVER** use semantic search commands (`codelapse search`) with sensitive, proprietary, or confidential code
> - **Data Exposure Risk**: Semantic search transmits code content to external AI services (Pinecone, Gemini)
> - **API Key Security**: Third-party services require API keys with potential access implications
> - **Privacy Violation**: Code is processed by external providers over the internet
> - **Compliance Issues**: May violate organizational security policies and data protection regulations
> - **Cost Impact**: API usage may result in unexpected charges on user accounts
> - **Experimental Status**: Features may change, break, or be removed without notice
> - **ALWAYS** verify with users before enabling or using semantic search features
> - **RECOMMEND** disabling semantic search for any sensitive work environments

## The contract

- **Output flags.** `--json` prints one JSON object on stdout, and it is the only
  JSON there - but it is not always the _first_ line. In standalone mode, a
  workspace whose snapshot store does not exist yet gets a plain-text notice on
  stdout (`Snapshot index file not found. Starting with empty state.`) ahead of
  the payload, so select the JSON line instead of assuming line 1. The notice
  stops once a snapshot-writing command has created the store; `status` does not
  create it, so running `status` first is not a workaround. `--silent`
  suppresses banners, spinners **and the JSON envelope** for every command
  routed through the shared result printer (`snapshot list`, `snapshot create`,
  `config get`, ...). The exceptions are the commands that write their JSON
  directly - `status`, `snapshot show` (success path) and `api` - which print it
  anyway. **Use `--json` alone.**
- **Exit status.** The process exits 0 when the payload's top-level `success` is
  `true` and 1 when it is `false` - for every command, including `api` and
  `batch`. Branch on the exit code first and parse stdout second.
- **Envelope.** Success is `{"success": true, ...}`; failure is
  `{"success": false, "error": "<message>"}`. `snapshot create` returns
  `snapshot.id` (with `description`, `tags`, `notes`, `isFavorite`); and
  `snapshot list` returns `snapshots[]` and `total`.
- **Fan-out results cannot be judged by `success` alone.** A `batchSearch` or
  `batchAnalyze` payload (through `api`, or as one entry of a batch file) reports
  `success: false` only when **every** item failed; a partial failure keeps
  `success: true` and reports the count in `failedQueries` / `failedOperations`.
  An empty batch also reports `success: true`. **After any fan-out call, read
  those two fields.** The top-level `batch <file>` result is different: it
  carries `total` and `failed` and reports `success: false` as soon as one entry
  failed; a batch that never ran (missing or malformed file, refused method)
  reports `success: false` with an `error` and no counts at all.
- **`api` exits 0 whenever the call resolved.** Its envelope is
  `{"success": true, "result": <payload>}`: a `result.success` of `false` - or
  a `result` of `null` for an unknown id - still exits 0. Read `result`, not the
  outer envelope.
- **No global `--mode`.** Mode is automatic: standalone (`.snapshots/` read
  directly) first, IPC when the extension is running. `-m, --mode` belongs to
  `search query` and `search-enhanced query` and selects the search strategy.
- **Prompts.** `--silent` does not answer a prompt. Only the flag a command's own
  `--help` documents can skip one: `snapshot delete` skips its confirmation with
  `-y, --yes` (there `--force` means "delete even when a later snapshot cannot be
  rebuilt from it"), and `files restore` uses `-f, --force`. Not every command has
  such a flag, so never assume `--silent` or `--force` answers one.
- **Snapshot ids.** Any unambiguous prefix or fragment resolves to a full id, so
  `snapshot show 1789120661991` works for `snapshot-1789120661991-fe3a3996`; an
  ambiguous abbreviation is refused with the list of candidates. Discover ids
  with `snapshot list --json` and never invent one.
- **Modes.** Commands that standalone mode does not implement need the
  extension. They fail with `success: false` and an error that begins
  `Method <name> is not available in standalone mode`; the process exits 1. They
  never return invented data.

| Feature                                                            | Standalone | Extension |
| ------------------------------------------------------------------ | ---------- | --------- |
| Snapshot CRUD (`snapshot create/list/show/restore/delete/compare`) | Yes        | Yes       |
| File operations (`files ...`)                                      | Yes        | Yes       |
| Filtering and metadata (`filter ...`)                              | Yes        | Yes       |
| Configuration (`config ...`)                                       | Yes        | Yes       |
| Git integration (`git ...`)                                        | Yes        | Yes       |
| `workspace info`                                                   | Yes        | Yes       |
| Auto-snapshot rules (`rules ...`)                                  | Yes        | Yes       |
| Diagnostics (`diagnostics ...`)                                    | Yes        | Yes       |
| Workspace state (`workspace state`, `workspace files`)             | No         | Yes       |
| Utility (`utility validate`, `utility export`)                     | No         | Yes       |
| Semantic search (`search`, `search-enhanced`)                      | No         | Yes       |
| Analysis (`analyze ...`)                                           | No         | Yes       |
| Chunking (`chunk ...`)                                             | No         | Yes       |
| Live events (`watch`)                                              | No         | Yes       |

## Hard rules

1. Use `--json` on every command whose output you need to read. Add `--silent`
   only when you truly need no output at all.
2. Check the exit code first, then the payload's `success`, then - for a fan-out
   call - `failedQueries` / `failedOperations`.
3. **NEVER** make changes without creating a backup snapshot first.
4. **ALWAYS** parse the JSON output; never assume success from silence.
5. **NEVER** proceed if a command exits 1 or returns `success: false`.
6. **ALWAYS** restore the backup if an operation fails, then re-check the result.
7. **NEVER** run batch operations without validating each item's result.
8. **ALWAYS** create a recovery snapshot at each critical checkpoint.
9. **NEVER** ignore an error message or a warning.
10. **ALWAYS** document what you changed in the closing snapshot's description,
    `--notes` or `--tags`.
11. **NEVER** treat `success: true` from a fan-out call as proof that every item
    worked.

## The canonical loop

Replace the two placeholder steps with your own edit and verification commands.

```bash
# 1. Check that the CLI can reach the workspace.
codelapse status --json || exit 1

# 2. Read the workspace before you touch it.
codelapse workspace info --json || exit 1

# 3. Create the backup and capture its id. --json prints one JSON object, but a
#    plain-text storage notice can precede it on a first run, so keep only the
#    line that parses as JSON (jq's fromjson? ignores the other lines).
backup_id=$(codelapse snapshot create "Backup before refactor" --tags backup --json \
  | jq -Rr 'fromjson? | objects | .snapshot.id // empty' | tail -n 1)
[ -n "$backup_id" ] || exit 1

# 4. Make the changes (your edits here).

# 5. Verify the changes (your tests here).

# 6. Record what you finished.
codelapse snapshot create "Completed: refactor" --tags complete --favorite --json
```

```powershell
# 1. Check that the CLI can reach the workspace.
codelapse status --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'CodeLapse is not reachable' }

# 2. Read the workspace before you touch it.
codelapse workspace info --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'workspace info failed' }

# 3. Create the backup and capture its id. A plain-text storage notice can
#    precede the JSON on a first run, so keep the line that starts with '{'.
$backup = codelapse snapshot create 'Backup before refactor' --tags backup --json |
  Where-Object { $_ -match '^\{' } | ConvertFrom-Json
if (-not $backup.success) { throw "Backup failed: $($backup.error)" }
$backupId = $backup.snapshot.id

# 4. Make the changes (your edits here).

# 5. Verify the changes (your tests here).

# 6. Record what you finished.
codelapse snapshot create 'Completed: refactor' --tags complete --favorite --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Completion snapshot failed' }
```

## Command reference

Add `--json` to every command you read; the flags are the ones this build's
`--help` documents. `codelapse --help` and `codelapse <group> --help` are the
live source of truth when this table and the installed binary disagree.

| Command                                                                                                                                      | What you get                                | Mode                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| `codelapse status`                                                                                                                           | `connected`, `mode`, `workspace`            | standalone             |
| `codelapse snapshot create <description> [-t, --tags a,b] [-n, --notes t] [-r, --task-ref t] [-f, --favorite] [-s, --selective --files a,b]` | `snapshot.id`                               | standalone             |
| `codelapse snapshot list [-t, --tags a,b] [-f, --favorites] [-l, --limit n] [--since <date>]`                                                | `snapshots[]`, `total`                      | standalone             |
| `codelapse snapshot show <id> [--files] [--content <path>]`                                                                                  | one snapshot, or file content               | standalone             |
| `codelapse snapshot restore <id> [--backup] [--files a,b] [-y, --yes]`                                                                       | restore result                              | standalone             |
| `codelapse snapshot compare <id1> <id2> [--files]`                                                                                           | `comparison`, `summary`                     | standalone             |
| `codelapse snapshot delete <id> [-y, --yes] [--force]`                                                                                       | deletion result                             | standalone             |
| `codelapse workspace info`                                                                                                                   | `workspace.root`, `config` (standalone)     | standalone             |
| `codelapse workspace state`                                                                                                                  | current workspace state                     | extension              |
| `codelapse git commit <snapshot-id> [-m, --message <msg>]`                                                                                   | a git commit from the snapshot              | standalone, clean tree |
| `codelapse git compare <snapshot-id> <commit-hash> [-f, --files]`                                                                            | snapshot vs commit diff                     | standalone             |
| `codelapse config get [key]` / `codelapse config set <key> <value>`                                                                          | `config`, `key` (get); `key`, `value` (set) | standalone             |
| `codelapse batch <file>`                                                                                                                     | `total`, `failed`, `results[]`              | standalone methods     |
| `codelapse api <method> [-d, --data <json>]`                                                                                                 | `result` (any allowlisted method)           | depends on the method  |
| `codelapse filter favorites [-l, --limit n] [--offset n]`                                                                                    | `snapshots[]`, `totalCount`                 | standalone             |
| `codelapse diagnostics run [--no-system] [--no-snapshots] [--no-git] [--no-config]`                                                          | `diagnostics[]`, `summary`                  | standalone             |

## Error recovery

The exit status is the first signal; these are the messages that come with it.

| Exit 1 says                                                                  | Cause                                                                             | Do this                                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `Method <name> is not available in standalone mode ...`                      | the command needs the extension and none answered                                 | start VS Code with CodeLapse active, or drop the command (see the mode table)                    |
| `Could not find CodeLapse extension connection. Make sure VSCode is running` | no extension running, or no workspace open in VS Code                             | run `codelapse status --json`; ask the user to open the workspace, then retry once               |
| `Snapshot <id> not found`                                                    | wrong or deleted id                                                               | run `snapshot list --json`; use a full id or an unambiguous prefix you actually saw              |
| restore failed (`not found`, or a disk or permission error)                  | the backup cannot be applied                                                      | **stop**; change nothing further; list the snapshots; tell the user; never hand-repair the tree  |
| `snapshot create` fails with a filesystem error                              | no space or no write permission for `.snapshots/`                                 | stop before changing anything; report the error text and the workspace path to the user          |
| `codelapse batch` exits 1 with `"failed": N` (N > 0)                         | at least one entry failed; the rest still ran                                     | read `results[]` for which entry failed and why; fix or restore, then decide whether to continue |
| `codelapse batch` exits 1 with an `error` and no `failed` count              | the batch never ran: missing or malformed file, or a method the allowlist refused | fix the file or the entry; nothing ran, so there is nothing to undo                              |
| exit 0 but `failedQueries` / `failedOperations` > 0                          | a partial fan-out failure, which does not flip `success`                          | read `result.success` and the counts; treat the failed items as unfinished work                  |
| `error: unknown option '--mode'`                                             | you invented a flag                                                               | run `codelapse <command> --help`; there is no global `--mode`                                    |

## Recipes

### 1. Single-file modification

```bash
#!/usr/bin/env bash
# Back up one file, change it, verify, then document - or restore and stop.
set -euo pipefail
target='src/auth.ts'
# Replace this stub with your real verification command (exit 0 on success).
verify_changes() { return 0; }

codelapse status --json > /dev/null

backup_id=$(codelapse snapshot create "Backup before modifying $target" --tags backup,file-mod --json \
  | jq -Rr 'fromjson? | objects | .snapshot.id // empty' | tail -n 1)
[ -n "$backup_id" ] || { echo 'no snapshot id returned' >&2; exit 1; }

# ... edit $target here ...
if ! verify_changes; then
  codelapse snapshot restore "$backup_id" --backup --json > /dev/null
  echo "verification failed; restored $backup_id" >&2
  exit 1
fi

codelapse snapshot create "Completed: modified $target" --tags complete,file-mod --favorite --json > /dev/null
```

```powershell
# Back up one file, change it, verify, then document - or restore and stop.
$ErrorActionPreference = 'Stop'
$target = 'src/auth.ts'
# Replace this stub with your real verification command (exit 0 on success).
function Test-Changes { $true }

codelapse status --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'CodeLapse is not reachable' }

$backup = codelapse snapshot create "Backup before modifying $target" --tags backup,file-mod --json |
  Where-Object { $_ -match '^\{' } | ConvertFrom-Json
if (-not $backup.success) { throw "Backup failed: $($backup.error)" }
$backupId = $backup.snapshot.id

# ... edit $target here ...
if (-not (Test-Changes)) {
  codelapse snapshot restore $backupId --backup --json | Out-Null
  throw "Verification failed; restored $backupId"
}

codelapse snapshot create "Completed: modified $target" --tags complete,file-mod --favorite --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Completion snapshot failed' }
```

### 2. Multi-file refactoring with a checkpoint per file

Plain word lists and arrays only - no namerefs - so macOS bash 3.2 and newer
both run this.

```bash
#!/usr/bin/env bash
# Checkpoint every file before touching it; restore the whole tree on failure.
set -uo pipefail
files='src/auth.ts src/api.ts src/service.ts'
# Replace this stub with your real verification command (exit 0 on success).
verify_changes() { return 0; }

backup_id=$(codelapse snapshot create "Backup before multi-file refactor" --tags backup,refactor --json \
  | jq -Rr 'fromjson? | objects | .snapshot.id // empty' | tail -n 1)
[ -n "$backup_id" ] || exit 1

for file in $files; do
  codelapse snapshot create "Checkpoint: before $file" --tags checkpoint --json > /dev/null || exit 1
  # ... edit "$file" here ...
  if ! verify_changes "$file"; then
    codelapse snapshot restore "$backup_id" --backup --json > /dev/null
    echo "failed on $file; restored $backup_id" >&2
    exit 1
  fi
done

codelapse snapshot create "Completed: multi-file refactor" --tags complete,refactor --favorite --json > /dev/null
```

```powershell
# Checkpoint every file before touching it; restore the whole tree on failure.
$ErrorActionPreference = 'Stop'
$files = @('src/auth.ts', 'src/api.ts', 'src/service.ts')
# Replace this stub with your real verification command (exit 0 on success).
function Test-Changes { param($File) $true }

$backup = codelapse snapshot create 'Backup before multi-file refactor' --tags backup,refactor --json |
  Where-Object { $_ -match '^\{' } | ConvertFrom-Json
if (-not $backup.success) { throw "Backup failed: $($backup.error)" }
$backupId = $backup.snapshot.id

foreach ($file in $files) {
  codelapse snapshot create "Checkpoint: before $file" --tags checkpoint --json | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Checkpoint for $file failed" }
  # ... edit $file here ...
  if (-not (Test-Changes $file)) {
    codelapse snapshot restore $backupId --backup --json | Out-Null
    throw "Verification failed on $file; restored $backupId"
  }
}

codelapse snapshot create 'Completed: multi-file refactor' --tags complete,refactor --favorite --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Completion snapshot failed' }
```

### 3. Batch work with a failure threshold

Both accepted batch file shapes are a bare `[...]` array or a `{"commands":
[...]}` wrapper; every entry is validated against the API allowlist before
anything runs, and a failed entry does not stop the rest of the batch.

```bash
#!/usr/bin/env bash
# Abort and restore when more than three batch entries fail.
set -uo pipefail
max_failures=3

cat > commands.json <<'JSON'
[
  { "method": "takeSnapshot", "data": { "description": "Batch: step 1" } },
  { "method": "takeSnapshot", "data": { "description": "Batch: step 2" } }
]
JSON

backup_id=$(codelapse snapshot create "BATCH: backup before batch" --tags backup,batch --json \
  | jq -Rr 'fromjson? | objects | .snapshot.id // empty' | tail -n 1)
[ -n "$backup_id" ] || exit 1

result=$(codelapse batch commands.json --json)
batch_status=$?
failed=$(printf '%s' "$result" | jq -Rr 'fromjson? | objects | .failed // empty' | tail -n 1)
total=$(printf '%s' "$result" | jq -Rr 'fromjson? | objects | .total // empty' | tail -n 1)

if [ "$batch_status" -ne 0 ] && [ -z "$failed" ]; then
  # Exit 1 without a `failed` count means nothing ran: the file is missing or
  # malformed, or an entry was refused by the API allowlist.
  reason=$(printf '%s' "$result" | jq -Rr 'fromjson? | objects | .error // "no error reported"' | tail -n 1)
  echo "batch did not run: $reason" >&2
  codelapse snapshot create "FAILED: batch did not run" --tags failed,batch --json > /dev/null
  exit 1
fi

failed=${failed:-0}
total=${total:-0}
echo "batch: $failed of $total entries failed"
if [ "$failed" -gt "$max_failures" ]; then
  codelapse snapshot restore "$backup_id" --backup --json > /dev/null
  echo "too many failures; restored $backup_id" >&2
  exit 1
fi

codelapse snapshot create "Completed: batch" --tags complete,batch --favorite --json > /dev/null
```

```powershell
# Abort and restore when more than three batch entries fail.
$ErrorActionPreference = 'Stop'
$maxFailures = 3

# [IO.File]::WriteAllText avoids the UTF-8 BOM that Windows PowerShell 5.1
# adds with -Encoding utf8; the CLI's JSON.parse rejects a BOM.
$commands = @'
[
  { "method": "takeSnapshot", "data": { "description": "Batch: step 1" } },
  { "method": "takeSnapshot", "data": { "description": "Batch: step 2" } }
]
'@
[IO.File]::WriteAllText((Join-Path $PWD 'commands.json'), $commands)

$backup = codelapse snapshot create 'BATCH: backup before batch' --tags backup,batch --json |
  Where-Object { $_ -match '^\{' } | ConvertFrom-Json
if (-not $backup.success) { throw "Backup failed: $($backup.error)" }
$backupId = $backup.snapshot.id

$result = codelapse batch commands.json --json | Where-Object { $_ -match '^\{' } | ConvertFrom-Json
$batchStatus = $LASTEXITCODE

if ($batchStatus -ne 0 -and $null -eq $result.failed) {
  # Exit 1 without a `failed` count means nothing ran: the file is missing or
  # malformed, or an entry was refused by the API allowlist.
  codelapse snapshot create 'FAILED: batch did not run' --tags failed,batch --json | Out-Null
  throw "Batch did not run (exit $batchStatus): $($result.error)"
}

Write-Output "batch: $($result.failed) of $($result.total) entries failed"
if ($result.failed -gt $maxFailures) {
  codelapse snapshot restore $backupId --backup --json | Out-Null
  throw "$($result.failed) of $($result.total) batch entries failed; restored $backupId"
}

codelapse snapshot create 'Completed: batch' --tags complete,batch --favorite --json | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Completion snapshot failed' }
```

A `batchSearch` or `batchAnalyze` entry counts as one batch item, so it keeps
`success: true` when only some of its own queries or operations failed - read
`failedQueries` / `failedOperations` in that entry's `result` before counting it
as done.

## Never do this

- Never combine `--json` with `--silent` and then parse stdout: for most
  commands `--silent` suppresses the payload, so a parser that depends on it
  breaks.
- Never branch on `success` alone for a fan-out payload (`batchSearch` /
  `batchAnalyze`, including one inside a batch file's `results[]`): it keeps
  `success: true` through a partial failure.
- Never run `search` or `search-enhanced` on sensitive code (see the warning at
  the top).
- Never assume a global `--mode`; mode is automatic.
- Never parse the human-readable output; use `--json` and select the JSON line.
- Never reuse a snapshot id you did not observe in `snapshot list --json`.
- Never continue past a failed backup: restore, then stop and report.

## Quick reference

| Task        | Command                                                              |
| ----------- | -------------------------------------------------------------------- |
| Start       | `codelapse status --json`                                            |
| Backup      | `codelapse snapshot create "Backup before X" --tags backup --json`   |
| Restore     | `codelapse snapshot restore <id> --backup --json`                    |
| Finish      | `codelapse snapshot create "Completed: X" --favorite --json`         |
| Checkpoint  | `codelapse snapshot create "Checkpoint: X" --tags checkpoint --json` |
| Find ids    | `codelapse snapshot list --json`                                     |
| Batch       | `codelapse batch commands.json --json`                               |
| Exit status | 0 when the payload's `success` is `true`; 1 when it is `false`       |
| Discover    | `codelapse --help`, `codelapse <group> --help`                       |

Remember: When in doubt, create a snapshot. Better to have too many backups than lose user's work.
