[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$versionPath = Join-Path $root 'VERSION'
if (-not (Test-Path -LiteralPath $versionPath)) {
    Write-Host '[FAIL] VERSION is missing; Kath cannot determine the release version.'
    exit 1
}

$version = [string](Get-Content -LiteralPath $versionPath -TotalCount 1)
$version = $version.Trim()
if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Host '[FAIL] VERSION line 1 is empty.'
    exit 1
}
if ($version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "[FAIL] VERSION line 1 is not a valid Kath semantic version: $version"
    exit 1
}

$parent = Split-Path -Parent $OutputPath
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
}
[System.IO.File]::WriteAllText($OutputPath, $version, [System.Text.Encoding]::ASCII)
exit 0
