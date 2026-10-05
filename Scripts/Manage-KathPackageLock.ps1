[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$PackageLockPath = Join-Path $rootPath 'JSON\package-lock.json'
$versionPath = Join-Path $rootPath 'VERSION'

if (-not (Test-Path -LiteralPath $PackageLockPath)) { exit 0 }
if (-not (Test-Path -LiteralPath $versionPath)) {
    Write-Host '[FAIL] VERSION is missing while validating package-lock.json.'
    exit 2
}
$ExpectedVersion = (Get-Content -LiteralPath $versionPath -TotalCount 1).Trim()

try {
    $lock = Get-Content -LiteralPath $PackageLockPath -Raw | ConvertFrom-Json
    $actualVersion = [string]$lock.version
    if ($actualVersion -and $actualVersion -ne $ExpectedVersion) {
        Write-Host "[INFO] Removing stale package-lock.json from Kath $actualVersion"
        Remove-Item -LiteralPath $PackageLockPath -Force
    }
}
catch {
    Write-Host '[INFO] Removing unreadable package-lock.json so npm can regenerate it.'
    Remove-Item -LiteralPath $PackageLockPath -Force
}
exit 0
