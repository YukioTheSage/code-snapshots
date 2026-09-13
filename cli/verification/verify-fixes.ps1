# Black-box verification of the CLI bug-fix wave (see CLI_TEST_REPORT.md).
# Run from the repository root:  pwsh -File cli-test-sandbox/verify-fixes.ps1

$ErrorActionPreference = 'Continue'
$sandbox = $PSScriptRoot
$cli = Join-Path (Split-Path $PSScriptRoot -Parent) 'cli\dist\cli.js'
Set-Location $sandbox

$script:passed = 0
$script:failed = 0

function Check($name, $condition, $detail) {
  if ($condition) {
    $script:passed++
    Write-Host "PASS  $name" -ForegroundColor Green
  } else {
    $script:failed++
    Write-Host "FAIL  $name  -- $detail" -ForegroundColor Red
  }
}

function RunCli([string[]]$arguments) {
  $output = & node $cli @arguments 2>&1 | Out-String
  return @{ Output = $output.Trim(); Code = $LASTEXITCODE }
}

function LastJson($text) {
  $line = ($text -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
  if (-not $line) { return $null }
  try { return $line | ConvertFrom-Json } catch { return $null }
}

Write-Host "`n=== BUG-1: standalone mode in a nested directory ===" -ForegroundColor Cyan
$nested = Join-Path $sandbox 'fresh\nested\deeper'
New-Item -ItemType Directory -Force $nested | Out-Null
Push-Location $nested
$r = RunCli @('status', '--json')
$json = LastJson $r.Output
Check 'nested status succeeds' ($r.Code -eq 0) "exit=$($r.Code) out=$($r.Output)"
Check 'nested status reports standalone' ($json.mode -eq 'standalone') "mode=$($json.mode)"
Pop-Location

Write-Host "`n=== BUG-2: deleting a nonexistent snapshot ===" -ForegroundColor Cyan
$r = RunCli @('snapshot', 'delete', '999')
Check 'delete 999 exits 1' ($r.Code -eq 1) "exit=$($r.Code)"
Check 'delete 999 says not found' ($r.Output -match 'not found') "out=$($r.Output)"

Write-Host "`n=== BUG-3: snapshot show --files / --content ===" -ForegroundColor Cyan
$list = LastJson (RunCli @('snapshot', 'list', '--json')).Output
$id = $list.snapshots[0].id
$r = RunCli @('snapshot', 'show', $id, '--files')
$json = LastJson $r.Output
Check 'show --files succeeds' ($json.success -eq $true) "out=$($r.Output)"
Check 'show --files returns changes' ($null -ne $json.changes) "changes missing"
$r = RunCli @('snapshot', 'show', $id, '--content', 'sample.ts')
$json = LastJson $r.Output
Check 'show --content succeeds' ($json.success -eq $true) "out=$($r.Output)"

Write-Host "`n=== BUG-4: filter date validation ===" -ForegroundColor Cyan
foreach ($bad in @('week', 'neverland')) {
  $r = RunCli @('filter', 'date', $bad)
  Check "filter date '$bad' exits 1" ($r.Code -eq 1) "exit=$($r.Code)"
  Check "filter date '$bad' is not a fatal crash" ($r.Output -notmatch 'Fatal error') "out=$($r.Output)"
  Check "filter date '$bad' explains the accepted forms" ($r.Output -match 'Invalid date|use a relative range') "out=$($r.Output)"
}
$r = RunCli @('filter', 'date', 'today')
Check "filter date 'today' is accepted (reaches the API layer)" ($r.Output -match 'not supported in standalone mode') "out=$($r.Output)"

Write-Host "`n=== BUG-5: api failure exit code ===" -ForegroundColor Cyan
$r = RunCli @('api', 'makeCoffee')
Check 'api unknown method exits 1' ($r.Code -eq 1) "exit=$($r.Code)"
Check 'api unknown method reports failure' ($r.Output -match '"success":false') "out=$($r.Output)"
$r = RunCli @('api', 'getStatus')
Check 'api served method exits 0' ($r.Code -eq 0) "exit=$($r.Code)"

Write-Host "`n=== BUG-6: snapshot list filters ===" -ForegroundColor Cyan
$all = LastJson (RunCli @('snapshot', 'list', '--json')).Output
$tagged = LastJson (RunCli @('snapshot', 'list', '--tags', 'alpha', '--json')).Output
$limited = LastJson (RunCli @('snapshot', 'list', '--limit', '1', '--json')).Output
$favs = LastJson (RunCli @('snapshot', 'list', '--favorites', '--json')).Output
Check 'tags filter narrows the list' ($tagged.total -lt $all.total -and $tagged.total -ge 1) "all=$($all.total) tagged=$($tagged.total)"
Check 'limit is honoured' ($limited.total -eq 1) "total=$($limited.total)"
Check 'favorites filter returns only favorites' ($favs.total -eq 0) "total=$($favs.total)"

Write-Host "`n=== BUG-8: batch file shapes ===" -ForegroundColor Cyan
'{ "commands": [ { "method": "getStatus" }, { "method": "getSnapshots" } ] }' | Set-Content batch-wrapper.json -Encoding utf8
'[ { "method": "getStatus" } ]' | Set-Content batch-array.json -Encoding utf8
$r = RunCli @('batch', 'batch-wrapper.json')
$json = LastJson $r.Output
Check 'wrapper shape accepted' ($json.success -eq $true -and $json.total -eq 2) "out=$($r.Output)"
$r = RunCli @('batch', 'batch-array.json')
$json = LastJson $r.Output
Check 'array shape still accepted' ($json.success -eq $true) "out=$($r.Output)"

Write-Host "`n=== BUG-9: git reporting (git is unrunnable in this sandbox) ===" -ForegroundColor Cyan
$r = RunCli @('git', 'info')
Check 'git info does not print undefined' ($r.Output -notmatch 'undefined') "out=$($r.Output)"
Check 'git info either succeeds or says git is unavailable' (($r.Code -eq 0) -or ($r.Output -match 'git is not available')) "exit=$($r.Code) out=$($r.Output)"

Write-Host "`n=== BUG-10: CLI byproducts are not captured ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Force .vscode | Out-Null
'{ "snapshotLocation": ".snapshots" }' | Set-Content .vscode/codelapse.json -Encoding utf8
'leftover' | Set-Content 'sample.ts.backup-2026-01-01T00-00-00-000Z' -Encoding utf8
RunCli @('snapshot', 'create', 'byproduct check', '--silent') | Out-Null
$newest = LastJson (RunCli @('snapshot', 'list', '--json')).Output
$newId = $newest.snapshots[-1].id
$files = RunCli @('files', 'list', $newId, '--json')
$filesJson = LastJson $files.Output
# An excluded file may still be listed as `deleted` (the previous snapshot had
# it and this one does not). What must never happen is it being captured again
# as added/modified/unchanged.
$captured = @($filesJson.files | Where-Object { $_.status -ne 'deleted' })
$pollutingConfig = @($captured | Where-Object { $_.path -match 'codelapse\.json' })
$pollutingBackup = @($captured | Where-Object { $_.path -match '\.backup-' })
Check 'snapshot does not capture .vscode/codelapse.json' ($pollutingConfig.Count -eq 0) "captured=$($pollutingConfig.path -join ',')"
Check 'snapshot does not capture *.backup-* files' ($pollutingBackup.Count -eq 0) "captured=$($pollutingBackup.path -join ',')"

Write-Host "`n=== Task 11: files export destinations ===" -ForegroundColor Cyan
$inside = Join-Path $sandbox 'abs-export.ts'
$r = RunCli @('files', 'export', $id, 'sample.ts', $inside)
Check 'absolute path inside the workspace works' ($r.Code -eq 0) "exit=$($r.Code) out=$($r.Output)"
$r = RunCli @('files', 'export', $id, 'sample.ts', 'C:\Windows\evil.ts')
Check 'absolute path outside the workspace is refused' ($r.Code -eq 1 -and $r.Output -match 'outside the workspace root') "exit=$($r.Code) out=$($r.Output)"

Write-Host "`n=== LOW-1: short snapshot ids ===" -ForegroundColor Cyan
$short = $id -replace '^snapshot-', '' -replace '-.*$', ''
$r = RunCli @('snapshot', 'show', $short, '--json')
$json = LastJson $r.Output
Check "short id '$short' resolves" ($json.success -eq $true -and $json.snapshot.id -eq $id) "out=$($r.Output)"
$r = RunCli @('snapshot', 'show', 'snapshot', '--json')
Check 'ambiguous prefix is refused' ($r.Output -match 'Ambiguous') "out=$($r.Output)"

Write-Host "`n=== LOW-6: current-snapshot pointer ===" -ForegroundColor Cyan
RunCli @('snapshot', 'navigate', 'previous') | Out-Null
$status = LastJson (RunCli @('status', '--json')).Output
Check 'status reports the navigated snapshot' (-not [string]::IsNullOrEmpty($status.currentSnapshot)) "currentSnapshot=$($status.currentSnapshot)"

Write-Host "`n=== BUG-11: status banner ===" -ForegroundColor Cyan
$r = RunCli @('status')
Check 'banner names standalone mode' ($r.Output -match 'Connected \(standalone mode\)') "out=$($r.Output)"

Write-Host "`n---------------------------------------------"
Write-Host "passed: $script:passed   failed: $script:failed"
if ($script:failed -gt 0) { exit 1 }
