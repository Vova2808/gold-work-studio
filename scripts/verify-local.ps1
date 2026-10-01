[CmdletBinding()]
param(
    [switch]$Full,
    [switch]$List
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$checks = @()
if ($Full) {
    # Build first: core tests and workspace package consumers load dist.
    $checks += @{ Command = 'pnpm'; Arguments = @('build') }
    $checks += @{ Command = 'pnpm'; Arguments = @('typecheck') }
    $checks += @{ Command = 'pnpm'; Arguments = @('test') }
    $checks += @{ Command = 'pnpm'; Arguments = @('--filter', '@gold-work/desktop', 'exec', 'tsx', 'scripts/pipeline-smoke.ts') }
} else {
    # Shared/core declarations must reflect source for consumer typechecks.
    $checks += @{ Command = 'pnpm'; Arguments = @('--filter', '@gold-work/shared', '--filter', '@gold-work/core', 'build') }
    $checks += @{ Command = 'pnpm'; Arguments = @('typecheck') }
}
$checks += @{ Command = 'git'; Arguments = @('diff', '--check') }

Push-Location -LiteralPath $projectRoot
try {
    foreach ($check in $checks) {
        $commandName = $check.Command
        $commandArguments = $check.Arguments
        Write-Output ('> ' + $commandName + ' ' + ($commandArguments -join ' '))
        if ($List) { continue }
        & $commandName @commandArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Local verification failed: $commandName (exit $LASTEXITCODE)"
        }
    }
    if (-not $List) {
        Write-Output 'Local checks passed. Live-provider and portable acceptance are separate.'
    }
} finally {
    Pop-Location
}
