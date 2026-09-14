<#
.SYNOPSIS
  Fetch GitHub Dependabot alerts and Code scanning alerts for a repository and
  emit raw JSON, CSV, and a Markdown report.

.DESCRIPTION
  Uses the GitHub REST API through the `gh` CLI (must already be authenticated).
  Endpoints:
    GET /repos/{owner}/{repo}/dependabot/alerts
    GET /repos/{owner}/{repo}/code-scanning/alerts

  Both endpoints require authentication. For a classic PAT the `repo` scope is
  sufficient for a repository you can administer; fine-grained tokens need
  "Dependabot alerts: read" and "Code scanning alerts: read".

.EXAMPLE
  pwsh -File security-reports/fetch-github-alerts.ps1
  pwsh -File security-reports/fetch-github-alerts.ps1 -Repo YukioTheSage/code-snapshots -State open
#>
[CmdletBinding()]
param(
  [string]$Repo = 'YukioTheSage/code-snapshots',
  [ValidateSet('open', 'dismissed', 'fixed', 'auto_dismissed', 'all')]
  [string]$State = 'open',
  [string]$OutDir = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-GhPaginated {
  param([string]$Path)
  # --paginate + `@json` gives JSONL across every page, which sidesteps gh's
  # concatenated-array output and keeps parsing simple.
  $lines = gh api "$Path" --paginate --jq '.[] | @json' 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh api failed for ${Path}:`n$lines" }
  if (-not $lines) { return @() }
  return @($lines | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
}

function ConvertTo-MdCell {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return '' }
  return ($Text -replace '\|', '\|' -replace '\r?\n', ' ').Trim()
}

$sevRank = @{ critical = 0; high = 1; medium = 2; low = 3 }
function Sort-BySeverity {
  # -Selector must be a scriptblock returning the raw severity string; the
  # property lives at a nested path, so the caller resolves it.
  param($Items, [scriptblock]$Selector)
  @($Items) | Sort-Object @{ Expression = { $s = [string](& $Selector $_); if ($sevRank.ContainsKey($s)) { $sevRank[$s] } else { 9 } }; Ascending = $true },
                        @{ Expression = { $_.number }; Ascending = $true }
}

Write-Host "Fetching Dependabot alerts  ($Repo, state=$State)..."
$depPath = "repos/$Repo/dependabot/alerts?per_page=100"
if ($State -ne 'all') { $depPath += "&state=$State" }
$dep = Get-GhPaginated -Path $depPath

Write-Host "Fetching Code scanning alerts ($Repo, state=$State)..."
$csPath = "repos/$Repo/code-scanning/alerts?per_page=100"
if ($State -ne 'all') { $csPath += "&state=$State" }
$cs = @()
try { $cs = Get-GhPaginated -Path $csPath }
catch { Write-Warning "Code scanning alerts unavailable (not enabled, or missing permission). $_" }

$dep = Sort-BySeverity -Items $dep -Selector { $_.security_advisory.severity }
$cs = Sort-BySeverity -Items $cs -Selector { $_.rule.security_severity_level }

# ---------------------------------------------------------------- raw archives
$dep | ConvertTo-Json -Depth 30 | Set-Content "$OutDir/dependabot-$State.json" -Encoding utf8
$cs | ConvertTo-Json -Depth 30 | Set-Content "$OutDir/code-scanning-$State.json" -Encoding utf8

# ------------------------------------------------------------------------ CSVs
$dep | ForEach-Object {
  [PSCustomObject]@{
    number    = $_.number
    severity  = $_.security_advisory.severity
    package   = $_.dependency.package.name
    ecosystem = $_.dependency.package.ecosystem
    manifest  = $_.dependency.manifest_path
    scope     = $_.dependency.scope
    relation  = $_.dependency.relationship
    range     = $_.security_vulnerability.vulnerable_version_range
    fix       = $_.security_vulnerability.first_patched_version.identifier
    ghsa      = $_.security_advisory.ghsa_id
    cve       = $_.security_advisory.cve_id
    summary   = $_.security_advisory.summary
    url       = $_.html_url
  }
} | Export-Csv "$OutDir/dependabot-$State.csv" -NoTypeInformation -Encoding utf8

$cs | ForEach-Object {
  [PSCustomObject]@{
    number   = $_.number
    severity = $_.rule.security_severity_level
    rule     = $_.rule.id
    tool     = $_.tool.name
    path     = $_.most_recent_instance.location.path
    line     = $_.most_recent_instance.location.start_line
    message  = $_.most_recent_instance.message.text
    ref      = $_.most_recent_instance.ref
    url      = $_.html_url
  }
} | Export-Csv "$OutDir/code-scanning-$State.csv" -NoTypeInformation -Encoding utf8

# ---------------------------------------------------------------------- report
$sb = [System.Text.StringBuilder]::new()
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm') + ' UTC'

$depCounts = @($dep | Group-Object { $_.security_advisory.severity })
$csCounts = @($cs | Group-Object { $_.rule.security_severity_level })
# NB: do not write `@(... ).Count` here — the array wrapper would shadow the
# GroupInfo object's own .Count and always report 1 per matching group.
function CountOf {
  param($Groups, [string]$Name)
  $hit = @($Groups | Where-Object { $_.Name -eq $Name })
  if ($hit.Count -eq 0) { return 0 }
  return $hit[0].Count
}

[void]$sb.AppendLine("# GitHub Security Alerts — ``$Repo``")
[void]$sb.AppendLine()
[void]$sb.AppendLine("Fetched **$now** via the GitHub REST API (state filter: ``$State``).")
[void]$sb.AppendLine()
[void]$sb.AppendLine('| Surface | Total | Critical | High | Medium | Low |')
[void]$sb.AppendLine('| --- | ---: | ---: | ---: | ---: | ---: |')
[void]$sb.AppendLine("| Dependabot alerts | $($dep.Count) | $(CountOf $depCounts 'critical') | $(CountOf $depCounts 'high') | $(CountOf $depCounts 'medium') | $(CountOf $depCounts 'low') |")
[void]$sb.AppendLine("| Code scanning alerts | $($cs.Count) | — | $(CountOf $csCounts 'high') | $(CountOf $csCounts 'medium') | $(CountOf $csCounts 'low') |")
[void]$sb.AppendLine()

# --- Part 1: code scanning
[void]$sb.AppendLine('## 1. Code scanning alerts')
[void]$sb.AppendLine()
if ($cs.Count -eq 0) {
  [void]$sb.AppendLine('_No alerts._')
} else {
  [void]$sb.AppendLine('| # | Severity | Rule | Location | Finding |')
  [void]$sb.AppendLine('| ---: | --- | --- | --- | --- |')
  foreach ($a in $cs) {
    $loc = "$($a.most_recent_instance.location.path):$($a.most_recent_instance.location.start_line)"
    [void]$sb.AppendLine("| [$($a.number)]($($a.html_url)) | $($a.rule.security_severity_level) | ``$($a.rule.id)`` | ``$loc`` | $(ConvertTo-MdCell $a.most_recent_instance.message.text) |")
  }
}
[void]$sb.AppendLine()

# --- Part 2: dependabot
[void]$sb.AppendLine('## 2. Dependabot alerts')
[void]$sb.AppendLine()
$direct = @($dep | Where-Object { $_.dependency.relationship -eq 'direct' })
[void]$sb.AppendLine("### Direct dependencies (actionable) — $($direct.Count) of $($dep.Count)")
[void]$sb.AppendLine()
if ($direct.Count -eq 0) {
  [void]$sb.AppendLine('_None; every open alert is on a transitive dependency._')
} else {
  [void]$sb.AppendLine('| # | Severity | Package | Manifest | Vulnerable | Fixed in |')
  [void]$sb.AppendLine('| ---: | --- | --- | --- | --- | --- |')
  foreach ($a in (Sort-BySeverity -Items $direct -Selector { $_.security_advisory.severity })) {
    [void]$sb.AppendLine("| [$($a.number)]($($a.html_url)) | $($a.security_advisory.severity) | ``$($a.dependency.package.name)`` | ``$($a.dependency.manifest_path)`` | ``$($a.security_vulnerability.vulnerable_version_range)`` | ``$($a.security_vulnerability.first_patched_version.identifier)`` |")
  }
}
[void]$sb.AppendLine()

[void]$sb.AppendLine('### By manifest')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| Manifest | Alerts |')
[void]$sb.AppendLine('| --- | ---: |')
foreach ($g in ($dep | Group-Object { $_.dependency.manifest_path } | Sort-Object Count -Descending)) {
  [void]$sb.AppendLine("| ``$($g.Name)`` | $($g.Count) |")
}
[void]$sb.AppendLine()

[void]$sb.AppendLine('### Top affected packages')
[void]$sb.AppendLine()
[void]$sb.AppendLine('| Package | Alerts |')
[void]$sb.AppendLine('| --- | ---: |')
foreach ($g in ($dep | Group-Object { $_.dependency.package.name } | Sort-Object Count -Descending | Select-Object -First 15)) {
  [void]$sb.AppendLine("| ``$($g.Name)`` | $($g.Count) |")
}
[void]$sb.AppendLine()

[void]$sb.AppendLine("### Appendix — all $($dep.Count) open alerts")
[void]$sb.AppendLine()
[void]$sb.AppendLine('| # | Sev | Package | Manifest | Relation | Fixed in | Advisory |')
[void]$sb.AppendLine('| ---: | --- | --- | --- | --- | --- | --- |')
foreach ($a in $dep) {
  $adv = ConvertTo-MdCell $a.security_advisory.summary
  [void]$sb.AppendLine("| [$($a.number)]($($a.html_url)) | $($a.security_advisory.severity) | ``$($a.dependency.package.name)`` | ``$($a.dependency.manifest_path)`` | $($a.dependency.relationship) | ``$($a.security_vulnerability.first_patched_version.identifier)`` | $adv |")
}
[void]$sb.AppendLine()

[void]$sb.AppendLine('## Notes')
[void]$sb.AppendLine()
[void]$sb.AppendLine('Generated by `security-reports/fetch-github-alerts.ps1`. Re-run with:')
[void]$sb.AppendLine()
[void]$sb.AppendLine('```powershell')
[void]$sb.AppendLine("pwsh -File security-reports/fetch-github-alerts.ps1 -Repo $Repo -State open")
[void]$sb.AppendLine('```')
[void]$sb.AppendLine()
[void]$sb.AppendLine('Pass `-State auto_dismissed`, `-State fixed`, or `-State all` for the other buckets.')
[void]$sb.AppendLine('Dependabot endpoints require admin/security access to the repository; code')
[void]$sb.AppendLine('scanning returns 404 when the feature is not enabled on the repository.')
[void]$sb.AppendLine()

$sb.ToString() | Set-Content "$OutDir/SECURITY_ALERTS_REPORT.md" -Encoding utf8

Write-Host ''
Write-Host "Wrote to $OutDir :"
Write-Host "  dependabot-$State.json / .csv      ($($dep.Count) alerts)"
Write-Host "  code-scanning-$State.json / .csv   ($($cs.Count) alerts)"
Write-Host "  SECURITY_ALERTS_REPORT.md"
