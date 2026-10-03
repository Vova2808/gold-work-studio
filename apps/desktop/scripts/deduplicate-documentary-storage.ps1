$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath('C:\Users\rosup\AppData\Roaming\@gold-work\desktop\workspace\projects\project_mu1sc77k_kyoo4o9\Documentary').TrimEnd('\') + '\'
$libraryRoot = [IO.Path]::GetFullPath('C:\Users\rosup\AppData\Roaming\@gold-work\desktop\workspace\Materials\Files').TrimEnd('\') + '\'
$backupRoot = [IO.Path]::GetFullPath('D:\Софт Gold Work Sudio\apps\desktop\captures\documentary-dedup-backup').TrimEnd('\') + '\'
$records = @()
$files = Get-ChildItem -LiteralPath $projectRoot -File -Recurse -Filter '*.webm' | Where-Object { $_.Length -gt 100MB -and $_.Name -match '^[a-f0-9]{64}\.webm$' }
foreach ($file in $files) {
  $source = [IO.Path]::GetFullPath($file.FullName)
  $canonical = [IO.Path]::GetFullPath((Join-Path $libraryRoot $file.Name))
  $backup = [IO.Path]::GetFullPath((Join-Path $backupRoot $source.Substring($projectRoot.Length)))
  if (-not $source.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $canonical.StartsWith($libraryRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $backup.StartsWith($backupRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped its approved task directory' }
  if (-not (Test-Path -LiteralPath $canonical) -or (Test-Path -LiteralPath $backup)) { continue }
  $expected = [IO.Path]::GetFileNameWithoutExtension($source)
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expected -or (Get-FileHash -LiteralPath $canonical -Algorithm SHA256).Hash -ne $expected) { throw 'Originals do not match their checksum; nothing moved' }
  New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
  # Preserve the duplicate on D: and keep the scene's exact original path via an NTFS link.
  Move-Item -LiteralPath $source -Destination $backup
  try { New-Item -ItemType HardLink -Path $source -Target $canonical | Out-Null }
  catch { Copy-Item -LiteralPath $backup -Destination $source; throw }
  $records += [pscustomobject]@{ original=$source; canonical=$canonical; backup=$backup; sha256=$expected; bytes=$file.Length }
  $records | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $backupRoot 'manifest.json') -Encoding UTF8
}
[pscustomobject]@{ preservedDuplicates=$records.Count; retainedBackupGB=[Math]::Round(($records|Measure-Object bytes -Sum).Sum/1GB,2); freeCGB=[Math]::Round((Get-PSDrive C).Free/1GB,2) } | ConvertTo-Json -Compress
