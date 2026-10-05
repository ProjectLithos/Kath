[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourceRoot,
    [Parameter(Mandatory=$true)][string]$Version
)

$ErrorActionPreference='Stop'
$SourceRoot=[IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$RepositoryUrl='https://github.com/ProjectLithos/Kath.git'
$RepositoryName='Kath'

function Fail([string]$m){ Write-Host "[FAIL] $m"; exit 1 }
# Windows PowerShell turns native stderr into ErrorRecord objects. Expected
# nonzero probe results (missing origin/identity/HEAD) must reach our exit checks.
# Keep this preference local and capture diagnostics for real command failures.
function Invoke-GitResult([string[]]$a){
    $ErrorActionPreference='Continue'
    $PSNativeCommandUseErrorActionPreference=$false
    $lines=@(& $script:GitExe -C $SourceRoot @a 2>&1)
    $code=$LASTEXITCODE
    return [pscustomobject]@{ ExitCode=$code; Lines=@($lines | ForEach-Object { [string]$_ }) }
}
function Git([string[]]$a){
    $result=Invoke-GitResult -a $a
    foreach($line in $result.Lines){ Write-Host $line }
    if($result.ExitCode -ne 0){ Fail "Git failed for ${RepositoryName}: git $($a -join ' ') (exit $($result.ExitCode))" }
}

$GitExe=$null
$cmd=Get-Command git.exe -ErrorAction SilentlyContinue
if($cmd){$GitExe=$cmd.Source}
if(-not $GitExe){
    foreach($candidate in @(
        "$env:ProgramFiles\Git\cmd\git.exe",
        "$env:ProgramFiles\Git\bin\git.exe",
        "${env:ProgramFiles(x86)}\Git\cmd\git.exe"
    )){ if($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)){ $GitExe=$candidate; break } }
}
if(-not $GitExe){ Fail "Git is required to publish the successful source build to $RepositoryUrl." }

Write-Host "[INFO] Publishing $RepositoryName $Version to $RepositoryUrl"
if(-not (Test-Path -LiteralPath (Join-Path $SourceRoot '.git') -PathType Container)){
    Git -a @('init')
    Git -a @('branch','-M','main')
}

$probe=Invoke-GitResult -a @('remote','get-url','origin')
if($probe.ExitCode -eq 2){
    Git -a @('remote','add','origin',$RepositoryUrl)
    Write-Host "[ OK ] Configured origin for $RepositoryName."
} elseif($probe.ExitCode -eq 0){
    $origin=($probe.Lines -join "`n").Trim()
    if($origin -ne $RepositoryUrl){ Git -a @('remote','set-url','origin',$RepositoryUrl) }
} else {
    foreach($line in $probe.Lines){ Write-Host $line }
    Fail "Could not inspect origin for $RepositoryName (exit $($probe.ExitCode))."
}

# Use the user's Git identity when configured.  Only create a repository-local
# fallback identity when Git has no usable identity at all.
foreach($setting in @(
    @{ Key='user.name'; Fallback='ProjectLithos' },
    @{ Key='user.email'; Fallback='ProjectLithos@users.noreply.github.com' }
)){
    $probe=Invoke-GitResult -a @('config','--get',$setting.Key)
    if($probe.ExitCode -eq 1 -or ($probe.ExitCode -eq 0 -and [string]::IsNullOrWhiteSpace(($probe.Lines -join '')))){
        Git -a @('config',$setting.Key,$setting.Fallback)
    } elseif($probe.ExitCode -ne 0){
        foreach($line in $probe.Lines){ Write-Host $line }
        Fail "Could not inspect Git identity for $RepositoryName (exit $($probe.ExitCode))."
    }
}

Git -a @('add','-A')
$probe=Invoke-GitResult -a @('diff','--cached','--quiet')
if($probe.ExitCode -notin @(0,1)){ Fail "Could not inspect staged changes for $RepositoryName (exit $($probe.ExitCode))." }
$hasChanges=($probe.ExitCode -eq 1)
$probe=Invoke-GitResult -a @('rev-parse','--verify','--quiet','HEAD')
if($probe.ExitCode -notin @(0,1)){ Fail "Could not inspect HEAD for $RepositoryName (exit $($probe.ExitCode))." }
$hasHead=($probe.ExitCode -eq 0)
if($hasChanges -or -not $hasHead){
    Git -a @('commit','-m',"Kath&Inu $Version successful build")
} else {
    Write-Host "[INFO] $RepositoryName has no source changes to commit."
}

# Never force-push.  If someone has changed the remote independently, stop and
# report it rather than destroying that history.
$push=Invoke-GitResult -a @('push','-u','origin','HEAD:main')
foreach($line in $push.Lines){ Write-Host $line }
if($push.ExitCode -ne 0){
    Fail "The build succeeded, but $RepositoryName could not be pushed to $RepositoryUrl. Check GitHub authentication or remote history."
}
Write-Host "[ OK ] $RepositoryName $Version published to GitHub."
