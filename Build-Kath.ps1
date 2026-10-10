[CmdletBinding()]
param([switch]$ForceRebuild)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$KathRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')
$VersionPath = Join-Path $KathRoot 'VERSION'
if (-not (Test-Path -LiteralPath $VersionPath -PathType Leaf)) {
    throw "[FAIL] Kath VERSION is missing."
}
$KathVersion = (Get-Content -LiteralPath $VersionPath -TotalCount 1).Trim()

function Info([string]$m) { Write-Host "[INFO] $m" }
function Ok([string]$m) { Write-Host "[ OK ] $m" }
function Fail([string]$m) { throw "[FAIL] $m" }

function Quote-ProcessArgument([string]$value) {
    if ($null -eq $value) { return '""' }
    if ($value -notmatch '[\s"]') { return $value }

    # Windows CreateProcess quoting rules:
    # wrap in quotes, double backslashes that precede a quote or the final quote.
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    $slashes = 0
    foreach ($ch in $value.ToCharArray()) {
        if ($ch -eq '\') {
            $slashes++
            continue
        }
        if ($ch -eq '"') {
            [void]$sb.Append(('\' * ($slashes * 2 + 1)))
            [void]$sb.Append('"')
            $slashes = 0
            continue
        }
        if ($slashes -gt 0) {
            [void]$sb.Append(('\' * $slashes))
            $slashes = 0
        }
        [void]$sb.Append($ch)
    }
    if ($slashes -gt 0) {
        [void]$sb.Append(('\' * ($slashes * 2)))
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Invoke-External([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.WorkingDirectory = $WorkingDirectory
    $psi.UseShellExecute = $false
    $psi.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join ' ')

    $p = New-Object System.Diagnostics.Process
    $p.StartInfo = $psi
    [void]$p.Start()
    $p.WaitForExit()
    $exitCode = [int]$p.ExitCode
    $p.Dispose()
    return $exitCode
}

Write-Host ''
Write-Host '============================================================'
Write-Host "Kath Build $KathVersion"
Write-Host '============================================================'
Info "Root: $KathRoot"
Write-Host ''

$bootstrap = Join-Path $KathRoot 'Scripts\Install-KathToolchain.ps1'
if (-not (Test-Path -LiteralPath $bootstrap -PathType Leaf)) { Fail "Missing Kath toolchain bootstrap: $bootstrap" }

& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $bootstrap
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$node = Join-Path $KathRoot '.toolchain\Node\node.exe'
$npm = Join-Path $KathRoot '.toolchain\Node\npm.cmd'
$python = Join-Path $KathRoot '.toolchain\Python\python.exe'
$npmPrefix = Join-Path $KathRoot '.toolchain\NpmWorkspace'

foreach ($required in @($node, $npm, $python)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { Fail "Required Kath tool is missing: $required" }
}

$env:PATH = "$(Split-Path -Parent $node);$(Split-Path -Parent $python);$env:PATH"
$env:npm_config_python = $python
$env:PYTHON = $python
$env:NODE_ENV = 'development'
$env:npm_config_omit = ''
$env:NPM_CONFIG_OMIT = ''
$env:KATH_ROOT = $KathRoot
$env:INU_SDK_ROOT = [IO.Path]::GetFullPath((Join-Path $KathRoot '..\Inu\SDK'))

New-Item -ItemType Directory -Path $npmPrefix -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $KathRoot 'JSON\package.json') -Destination (Join-Path $npmPrefix 'package.json') -Force
$lock = Join-Path $KathRoot 'JSON\package-lock.json'
if (Test-Path -LiteralPath $lock -PathType Leaf) {
    Copy-Item -LiteralPath $lock -Destination (Join-Path $npmPrefix 'package-lock.json') -Force
}

foreach ($name in @('applications','packages','CJS')) {
    $link = Join-Path $npmPrefix $name
    $target = Join-Path $KathRoot $name
    if (Test-Path -LiteralPath $link) {
        cmd.exe /D /S /C "rmdir `"$link`"" 2>$null | Out-Null
    }
    cmd.exe /D /S /C "mklink /J `"$link`" `"$target`"" | Out-Null
    if (-not (Test-Path -LiteralPath $link -PathType Container)) { Fail "Could not stage $name workspace." }
}

$rootNodeModules = Join-Path $KathRoot 'node_modules'
if (Test-Path -LiteralPath $rootNodeModules) {
    cmd.exe /D /S /C "rmdir `"$rootNodeModules`"" 2>$null | Out-Null
}
$workspaceNodeModules = Join-Path $npmPrefix 'node_modules'
New-Item -ItemType Directory -Path $workspaceNodeModules -Force | Out-Null
cmd.exe /D /S /C "mklink /J `"$rootNodeModules`" `"$workspaceNodeModules`"" | Out-Null
if (-not (Test-Path -LiteralPath $rootNodeModules -PathType Container)) { Fail 'Could not create node_modules workspace junction.' }

Info 'Checking Kath build stage caches...'
$cacheRunner = Join-Path $KathRoot 'CJS\stage-cache.cjs'
if (-not (Test-Path -LiteralPath $cacheRunner -PathType Leaf)) { Fail "Kath cache runner is missing: $cacheRunner. Restore the current FullSource ZIP." }
$cacheArguments = @($cacheRunner, $KathRoot)
if ($ForceRebuild) { $cacheArguments += '--force' }
$rc = Invoke-External $node $cacheArguments $npmPrefix
if ($rc -ne 0) { Fail "Kath stage build failed with exit code $rc." }

$frontend = Join-Path $KathRoot 'packages\kath\lib\browser\inu-frontend-module.js'
$backend = Join-Path $KathRoot 'packages\kath\lib\node\inu-backend-module.js'
$electron = Join-Path $KathRoot 'applications\electron\lib\backend\electron-main.js'
foreach ($required in @($frontend,$backend,$electron)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { Fail "Kath build output is missing: $required" }
}

# Cache the launcher independently from Theia/Electron outputs.
$Configuration = 'Release'
$stageHelper = Join-Path $KathRoot '..\Inu\SDK\scripts\StageCache.ps1'
. $stageHelper
$dotnet = Join-Path $KathRoot '..\Inu\.toolchain\DotNet\dotnet.exe'
$launcherProject = Join-Path $KathRoot 'src\Kath.Launcher\Kath.Launcher.csproj'
$launcherOut = Join-Path $KathRoot 'Artifacts\Launcher'
$launcherExe = Join-Path $KathRoot 'Bin\Kath.exe'
$launcherArguments = @('publish',$launcherProject,'-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-p:DebugType=None','-p:DebugSymbols=false',("-p:Version={0}" -f $KathVersion),("-p:AssemblyVersion={0}.0" -f $KathVersion),("-p:FileVersion={0}.0" -f $KathVersion),'-o',$launcherOut)
$launcherInputs = @($stageHelper,$dotnet,(Join-Path $KathRoot 'Build-Kath.ps1')) + @(Get-InuProjectStageInputs -ProjectFile $launcherProject) + @((Get-InuStageFiles -Paths @((Join-Path (Split-Path -Parent $dotnet) 'sdk'),(Join-Path (Split-Path -Parent $dotnet) 'host'),(Join-Path (Split-Path -Parent $dotnet) 'shared')) -Outputs).FullName)
Invoke-InuCachedAction -Stage 'Kath launcher' -CacheDirectory (Join-Path $KathRoot 'Artifacts\StageCache') -Inputs $launcherInputs -Outputs @($launcherExe,$launcherOut) -KeyArguments $launcherArguments -Force:$ForceRebuild -Action {
    $rc = Invoke-External $dotnet $launcherArguments $KathRoot
    if ($rc -ne 0) { Fail "Kath launcher publish failed with exit code $rc." }
    New-Item -ItemType Directory -Path (Split-Path -Parent $launcherExe) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $launcherOut 'Kath.exe') -Destination $launcherExe -Force
}
$launcherVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($launcherExe).FileVersion
if ($launcherVersion -ne ($KathVersion + '.0')) { Fail "Kath launcher version mismatch: $launcherVersion" }

Ok "Kath $KathVersion build completed."
exit 0
