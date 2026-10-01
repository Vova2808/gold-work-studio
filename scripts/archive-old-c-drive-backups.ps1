$ErrorActionPreference = 'Stop'
$sourceRoot = 'C:\Users\rosup\AppData\Roaming\@gold-work\desktop\workspace'
$archiveRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSScriptRoot) 'workspace-data\cleanup-backups-2026-09-19'))
if ([IO.Path]::GetPathRoot($archiveRoot) -ne 'D:\') { throw 'The recovery archive must stay on D:' }
$projectIndex = 'C:\Users\rosup\AppData\Roaming\@gold-work\desktop\projects.json'
$relativeSources = @(
  'projects\project_mu1sc77k_kyoo4o9.before-d-drive-2026-09-15T13-10-36-291Z',
  'Materials.before-d-drive-2026-09-15T13-10-36-291Z'
)
$before = (Get-PSDrive C).Free
foreach ($relativeSource in $relativeSources) {
  $source = [IO.Path]::GetFullPath((Join-Path $sourceRoot $relativeSource))
  $destination = [IO.Path]::GetFullPath((Join-Path $archiveRoot $relativeSource))
  if (-not $source.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($archiveRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside the approved backup directories' }
  $item = Get-Item -LiteralPath $source -Force
  if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Source must be an ordinary backup directory' }
  if (Test-Path -LiteralPath $destination) { throw "Archive already exists: $destination" }
  if ((Get-Content -LiteralPath $projectIndex -Raw).Contains($item.Name)) { throw 'A project references this backup; leave it intact' }
  $entries = @(Get-ChildItem -LiteralPath $source -Force -Recurse)
  if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Unexpected link inside backup' }
  $files = @($entries | Where-Object { -not $_.PSIsContainer })
  $bytes = ($files | Measure-Object Length -Sum).Sum
  if ((Get-PSDrive D).Free -lt $bytes + 2GB) { throw 'Insufficient archive space on D:' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Recurse
  $verified = 0
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($source.Length + 1)
    $copy = Join-Path $destination $relative
    if ((Get-Item -LiteralPath $copy).Length -ne $file.Length -or (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash) { throw "Copy mismatch: $relative" }
    $verified++
  }
  if ((Get-Content -LiteralPath $projectIndex -Raw).Contains($item.Name)) { throw 'Project acquired a backup reference; preserve both copies' }
  foreach ($file in $files) {
    $current = Get-Item -LiteralPath $file.FullName
    if ($current.Length -ne $file.Length -or $current.LastWriteTimeUtc -ne $file.LastWriteTimeUtc) { throw 'Source changed during archival; preserve both copies' }
  }
  # Exact absolute source is validated above; no junctions or active project files.
  Remove-Item -LiteralPath $source -Recurse -Force
  [PSCustomObject]@{ ArchivedFrom=$source; RecoverableAt=$destination; VerifiedFiles=$verified; LogicalGiB=[math]::Round($bytes / 1GB, 2); FreeC_GiB=[math]::Round((Get-PSDrive C).Free / 1GB, 2) } | ConvertTo-Json -Compress
}
[PSCustomObject]@{ FreedGiB=[math]::Round(((Get-PSDrive C).Free - $before) / 1GB, 2); FreeC_GiB=[math]::Round((Get-PSDrive C).Free / 1GB, 2) } | ConvertTo-Json -Compress
