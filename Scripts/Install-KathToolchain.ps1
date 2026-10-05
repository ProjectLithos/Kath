[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptRoot
$ToolchainRoot = Join-Path $Root '.toolchain'
$Downloads = Join-Path $ToolchainRoot 'Downloads'
$ManifestPath = Join-Path $Root 'JSON\Toolchain-Versions.json'

function Write-Info([string]$Message) { Write-Host "[INFO] $Message" }
function Write-Ok([string]$Message) { Write-Host "[ OK ] $Message" }
function Write-Fail([string]$Message) { Write-Host "[FAIL] $Message" }
function Write-Warn([string]$Message) { Write-Host "[WARN] $Message" }

function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Download-File([string]$Uri, [string]$Destination) {
    Ensure-Directory (Split-Path -Parent $Destination)
    if (Test-Path -LiteralPath $Destination) {
        return
    }
    $temporary = "$Destination.download"
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    Write-Info "Downloading $Uri"
    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $temporary
            Move-Item -LiteralPath $temporary -Destination $Destination -Force
            return
        } catch {
            $lastError = $_
            Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
            if ($attempt -lt 3) { Start-Sleep -Seconds (2 * $attempt) }
        }
    }
    throw "Download failed after three attempts: $Uri`n$lastError"
}

function Assert-AuthenticodePublisher([string]$Path, [string]$PublisherFragment) {
    $signature = Get-AuthenticodeSignature -FilePath $Path
    if ($signature.Status -ne 'Valid') {
        throw "Authenticode verification failed for $Path. Status: $($signature.Status)"
    }
    if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notlike "*$PublisherFragment*") {
        throw "Unexpected publisher for $Path. Expected a signer containing '$PublisherFragment'."
    }
}

function Ensure-Node($Config) {
    $nodeRoot = Join-Path $ToolchainRoot 'Node'
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    $npmCmd = Join-Path $nodeRoot 'npm.cmd'
    $required = [string]$Config.node.version

    if ((Test-Path $nodeExe) -and (Test-Path $npmCmd)) {
        $actual = (& $nodeExe --version).Trim().TrimStart('v')
        if ($actual -eq $required) {
            Write-Ok "Node.js $required already installed in the Kath toolchain."
            return @{ Node = $nodeExe; Npm = $npmCmd }
        }
        Write-Info "Replacing Kath Node.js $actual with pinned version $required."
        Remove-Item -LiteralPath $nodeRoot -Recurse -Force
    }

    $archiveName = "node-v$required-win-x64.zip"
    $archivePath = Join-Path $Downloads $archiveName
    $checksumsPath = Join-Path $Downloads "node-v$required-SHASUMS256.txt"
    Download-File ([string]$Config.node.windowsX64Archive) $archivePath
    Download-File ([string]$Config.node.sha256Manifest) $checksumsPath

    $expectedLine = Get-Content -LiteralPath $checksumsPath | Where-Object { $_ -match "\s+$([regex]::Escape($archiveName))$" } | Select-Object -First 1
    if (-not $expectedLine) { throw "Could not find $archiveName in the official Node.js SHA256 manifest." }
    $expectedHash = ($expectedLine -split '\s+')[0].ToUpperInvariant()
    $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToUpperInvariant()
    if ($expectedHash -ne $actualHash) { throw "SHA256 verification failed for $archiveName." }

    $extractRoot = Join-Path $ToolchainRoot '_node_extract'
    Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    Ensure-Directory $extractRoot
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $expanded = Join-Path $extractRoot "node-v$required-win-x64"
    if (-not (Test-Path (Join-Path $expanded 'node.exe'))) { throw 'Node.js archive did not contain the expected layout.' }
    Move-Item -LiteralPath $expanded -Destination $nodeRoot
    Remove-Item -LiteralPath $extractRoot -Recurse -Force

    $actual = (& $nodeExe --version).Trim().TrimStart('v')
    if ($actual -ne $required) { throw "Node.js verification failed. Expected $required; found $actual." }
    Write-Ok "Installed pinned Node.js $required."
    return @{ Node = $nodeExe; Npm = $npmCmd }
}

function Ensure-Python($Config) {
    $pythonRoot = Join-Path $ToolchainRoot 'Python'
    $pythonExe = Join-Path $pythonRoot 'python.exe'
    $required = [string]$Config.python.version

    if (Test-Path $pythonExe) {
        $actual = (& $pythonExe -c 'import platform; print(platform.python_version())').Trim()
        if ($actual -eq $required) {
            Write-Ok "Python $required already installed in the Kath toolchain."
            return $pythonExe
        }
        Write-Info "Replacing Kath Python $actual with pinned version $required."
    }

    # Do not use the registered CPython EXE installer for a private toolchain.
    # Windows can treat a second install of the same version as maintenance of
    # an existing registered installation, return exit code 0, and never place
    # python.exe in Kath\.toolchain\Python.  The official Python NuGet package
    # is application-local and specifically intended for build/CI scenarios.
    if (Test-Path -LiteralPath $pythonRoot) {
        Remove-Item -LiteralPath $pythonRoot -Recurse -Force
    }

    $nugetConfig = $Config.python.nuget
    $nugetVersion = [string]$nugetConfig.version
    $nugetExe = Join-Path $Downloads "nuget-$nugetVersion.exe"
    Download-File ([string]$nugetConfig.windowsX86CommandLine) $nugetExe

    $expectedNugetHash = ([string]$nugetConfig.sha256).ToUpperInvariant()
    $actualNugetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $nugetExe).Hash.ToUpperInvariant()
    if ($actualNugetHash -ne $expectedNugetHash) {
        Remove-Item -LiteralPath $nugetExe -Force -ErrorAction SilentlyContinue
        throw "NuGet CLI SHA256 verification failed. Expected $expectedNugetHash; found $actualNugetHash."
    }
    Assert-AuthenticodePublisher $nugetExe 'Microsoft Corporation'

    $stagingRoot = Join-Path $ToolchainRoot ('_python_staging_' + [guid]::NewGuid().ToString('N'))
    Ensure-Directory $stagingRoot
    try {
        Write-Info "Provisioning private Python $required from the official NuGet build package."
        $packageId = [string]$Config.python.packageId
        $source = [string]$Config.python.source
        $arguments = @(
            'install', $packageId,
            '-Version', $required,
            '-ExcludeVersion',
            '-OutputDirectory', $stagingRoot,
            '-Source', $source,
            '-NonInteractive',
            '-DirectDownload',
            '-NoCache',
            '-Verbosity', 'normal'
        )
        & $nugetExe @arguments
        if ($LASTEXITCODE -ne 0) {
            throw "NuGet failed while provisioning Python $required (exit code $LASTEXITCODE)."
        }

        $packageRoot = Join-Path $stagingRoot $packageId
        $toolsRoot = Join-Path $packageRoot 'tools'
        $stagedPython = Join-Path $toolsRoot 'python.exe'
        if (-not (Test-Path -LiteralPath $stagedPython -PathType Leaf)) {
            throw "Python NuGet package did not contain the expected tools\\python.exe: $stagedPython"
        }

        $stagedVersion = (& $stagedPython -c 'import platform; print(platform.python_version())').Trim()
        if ($stagedVersion -ne $required) {
            throw "Python package verification failed. Expected $required; found $stagedVersion."
        }

        # Move only the package's tools payload into the stable private path.
        Move-Item -LiteralPath $toolsRoot -Destination $pythonRoot
    }
    finally {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
        throw "Python provisioning completed but python.exe was not found at $pythonExe."
    }
    $actual = (& $pythonExe -c 'import platform; print(platform.python_version())').Trim()
    if ($actual -ne $required) { throw "Python verification failed. Expected $required; found $actual." }
    Write-Ok "Installed private Python $required from the official NuGet build package."
    return $pythonExe
}

function Get-VsWherePath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    return ($candidates | Select-Object -First 1)
}

function Test-VsComponent([string]$InstallationPath, [string]$ComponentId) {
    $vswhere = Get-VsWherePath
    if (-not $vswhere) { return $false }
    $matches = & $vswhere -products * -requires $ComponentId -property installationPath 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $matches) { return $false }
    $target = [IO.Path]::GetFullPath($InstallationPath).TrimEnd('\')
    foreach ($match in @($matches)) {
        if (-not $match) { continue }
        try {
            if ([IO.Path]::GetFullPath(([string]$match).Trim()).TrimEnd('\') -ieq $target) { return $true }
        } catch { }
    }
    return $false
}

function Find-MsvcInstallation {
    $vswhere = Get-VsWherePath
    if ($vswhere) {
        $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
        if ($LASTEXITCODE -eq 0 -and $path) {
            return ($path | Select-Object -First 1).Trim()
        }
    }

    $roots = @(
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    foreach ($root in $roots) {
        $cl = Get-ChildItem -LiteralPath $root -Filter cl.exe -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\VC\\Tools\\MSVC\\.+\\bin\\Hostx64\\x64\\cl\.exe$' } |
            Select-Object -First 1
        if ($cl) {
            $match = [regex]::Match($cl.FullName, '^(.*?Microsoft Visual Studio\\[^\\]+\\[^\\]+)\\VC\\Tools\\MSVC\\')
            if ($match.Success) { return $match.Groups[1].Value }
            return (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $cl.FullName))))
        }
    }
    return $null
}

function Add-VsComponent([string]$InstallationPath, [string]$ComponentId) {
    $setupCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\setup.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
    $setup = $setupCandidates | Select-Object -First 1
    if (-not $setup) {
        throw "Visual Studio Installer setup.exe was not found; cannot add required component $ComponentId."
    }

    Write-Info "Adding Visual Studio component: $ComponentId"
    Write-Info "Target Visual Studio installation: $InstallationPath"
    Write-Info 'Windows may display an elevation prompt because Visual Studio components are machine-level software.'
    # Start-Process joins an ArgumentList array into a command line.  On Windows
    # PowerShell 5.1 that can lose the argument boundary for values containing
    # spaces (for example C:\Program Files\...).  Build one command-line string
    # and quote value arguments explicitly so Visual Studio receives the complete
    # installation path.
    $quotedInstallationPath = '"' + $InstallationPath.Replace('"', '\\"') + '"'
    $quotedComponentId = '"' + $ComponentId.Replace('"', '\\"') + '"'
    $argumentLine = "modify --installPath $quotedInstallationPath --add $quotedComponentId --passive --norestart"

    Write-Info "Visual Studio Installer arguments: $argumentLine"
    if ($InstallationPath -match '\s' -and $argumentLine -notmatch '--installPath\s+"') {
        throw 'Internal error: Visual Studio install path contains spaces but was not quoted.'
    }

    $process = Start-Process -FilePath $setup -ArgumentList $argumentLine -Verb RunAs -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) {
        throw "Visual Studio Installer failed while adding $ComponentId (exit code $($process.ExitCode))."
    }
}

function Ensure-Msvc($Config) {
    $existing = Find-MsvcInstallation
    if (-not $existing) {
        $bootstrapper = Join-Path $Downloads 'vs_BuildTools.exe'
        Download-File ([string]$Config.visualStudio.bootstrapper) $bootstrapper
        Assert-AuthenticodePublisher $bootstrapper 'Microsoft Corporation'

        Write-Info 'Microsoft C++ build tools are missing. Installing the Visual C++ Build Tools workload.'
        Write-Info 'Windows may display an elevation prompt because Microsoft Build Tools are machine-level software.'
        $arguments = @(
            '--quiet', '--wait', '--norestart', '--nocache',
            '--add', [string]$Config.visualStudio.requiredWorkload,
            '--add', [string]$Config.visualStudio.requiredComponent,
            '--includeRecommended'
        )
        $process = Start-Process -FilePath $bootstrapper -ArgumentList $arguments -Verb RunAs -Wait -PassThru
        if ($process.ExitCode -notin @(0, 3010)) {
            throw "Visual Studio Build Tools installer failed with exit code $($process.ExitCode)."
        }
        $existing = Find-MsvcInstallation
        if (-not $existing) {
            throw 'Visual Studio Build Tools installation completed, but the x64 MSVC compiler could not be verified.'
        }
    }

    Write-Ok "Microsoft C++ build tools found: $existing"

    # Spectre-mitigated VC runtimes are useful when available, but Kath does not
    # require them to build or run.  Treat installation/verification as best-effort
    # so a Visual Studio servicing problem cannot block the private Kath toolchain.
    $spectre = [string]$Config.visualStudio.optionalSpectreComponent
    if ($spectre -and -not (Test-VsComponent $existing $spectre)) {
        Write-Info 'Optional MSVC x64 Spectre-mitigated libraries are missing.'
        try {
            Add-VsComponent $existing $spectre
        } catch {
            Write-Warn "Could not install optional Visual Studio component '$spectre': $($_.Exception.Message)"
        }

        if (Test-VsComponent $existing $spectre) {
            Write-Ok 'Installed optional MSVC x64 Spectre-mitigated libraries.'
        } else {
            Write-Warn "Optional Visual Studio component '$spectre' could not be verified."
            Write-Warn 'Kath will continue because Spectre-mitigated VC runtimes are not required to build or run Kath.'
        }
    } elseif ($spectre) {
        Write-Ok 'Optional MSVC x64 Spectre-mitigated libraries are installed.'
    }

    return $existing
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Kath toolchain bootstrap currently supports Windows only.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Kath requires 64-bit Windows.' }
    if (-not (Test-Path -LiteralPath $ManifestPath)) { throw "Missing toolchain manifest: $ManifestPath" }

    Ensure-Directory $ToolchainRoot
    Ensure-Directory $Downloads
    $config = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

    $node = Ensure-Node $config
    $python = Ensure-Python $config
    $vs = Ensure-Msvc $config

    Write-Ok 'Kath toolchain is ready.'
    Write-Info "Node.js: $($node.Node)"
    Write-Info "npm: $($node.Npm)"
    Write-Info "Python: $python"
    Write-Info "MSVC: $vs"
    exit 0
} catch {
    Write-Fail $_.Exception.Message
    exit 1
}
