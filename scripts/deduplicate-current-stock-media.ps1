$ErrorActionPreference = 'Stop'
$mediaRoot = [IO.Path]::GetFullPath('C:\Users\rosup\AppData\Roaming\@gold-work\desktop\workspace\projects\project_mu8iia3v_qhpe9y9\Documentary').TrimEnd('\') + '\'
$rootItem = Get-Item -LiteralPath $mediaRoot
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Expected the current ordinary project directory on C:' }
$entries = @(Get-ChildItem -LiteralPath $mediaRoot -Recurse -Force)
if ($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Unexpected link inside project media' }
$files = @($entries | Where-Object { -not $_.PSIsContainer -and $_.Name -match '^[a-f0-9]{64}\.(mp4|webm|mov|mkv)$' -and $_.Length -gt 10MB })
$groups = $files | Group-Object { $_.Name + ':' + $_.Length } | Where-Object Count -gt 1
$replaced = 0
$before = (Get-PSDrive C).Free
foreach ($group in $groups) {
  $canonicalByHash = @{}
  foreach ($file in $group.Group) {
    $target = [IO.Path]::GetFullPath($file.FullName)
    if (-not $target.StartsWith($mediaRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Media target escaped project' }
    $digest = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if (-not $canonicalByHash.ContainsKey($digest)) { $canonicalByHash[$digest] = $target; continue }
    $canonical = [IO.Path]::GetFullPath($canonicalByHash[$digest])
    if (-not $canonical.StartsWith($mediaRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Canonical target escaped project' }
    $temporary = $target + '.dedup-' + [guid]::NewGuid().ToString('N')
    $backup = $temporary + '.old'
    # Only immutable content-addressed app media. Source and duplicate were hashed.
    # ReplaceFile preserves the exact public filename atomically for the running player.
    try {
      New-Item -ItemType HardLink -Path $temporary -Target $canonical | Out-Null
      $current = Get-Item -LiteralPath $target
      if ($current.Length -ne $file.Length -or $current.LastWriteTimeUtc -ne $file.LastWriteTimeUtc) { throw 'Media changed; no replacement' }
      [IO.File]::Replace($temporary, $target, $backup, $true)
      if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $digest) {
        [IO.File]::Replace($backup, $target, $null, $true)
        throw 'Verification failed; restored original'
      }
      # The old duplicate is recoverable from the identical canonical file;
      # all project filenames continue to exist and no database entry is changed.
      Remove-Item -LiteralPath $backup -Force
      $replaced++
    } catch {
      Write-Output ('Preserved busy/changed media: ' + $file.Name)
      if (Test-Path -LiteralPath $backup) { throw 'An original backup was retained; inspect before further cleanup' }
    } finally {
      if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
  }
  [pscustomobject]@{Group=$group.Name;Replaced=$replaced;FreeC_GiB=[math]::Round((Get-PSDrive C).Free/1GB,2)} | ConvertTo-Json -Compress
}
[pscustomobject]@{Replaced=$replaced;FreeC_GiB=[math]::Round((Get-PSDrive C).Free/1GB,2);NetFreedGiB=[math]::Round(((Get-PSDrive C).Free-$before)/1GB,2)} | ConvertTo-Json -Compress
