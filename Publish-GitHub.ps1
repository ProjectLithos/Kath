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
function Quote-NativeArgument([string]$value){
    if($null -eq $value){ return '""' }
    if($value.Length -gt 0 -and $value -notmatch '[\s"]'){ return $value }
    $escaped=[regex]::Replace($value,'(\\*)"','$1$1\"')
    $escaped=[regex]::Replace($escaped,'(\\+)$','$1$1')
    return '"' + $escaped + '"'
}
function Invoke-GitResult([string[]]$a, [int]$TimeoutSeconds=30){
    $psi=New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName=$script:GitExe
    $psi.WorkingDirectory=$SourceRoot
    $psi.UseShellExecute=$false
    $psi.CreateNoWindow=$true
    $psi.RedirectStandardOutput=$true
    $psi.RedirectStandardError=$true
    $psi.Arguments=( @('-C',$SourceRoot) + $a | ForEach-Object { Quote-NativeArgument ([string]$_) } ) -join ' '
    $psi.EnvironmentVariables['GIT_TERMINAL_PROMPT']='0'
    $psi.EnvironmentVariables['GCM_INTERACTIVE']='Never'
    $process=New-Object System.Diagnostics.Process
    $process.StartInfo=$psi
    try {
        if(-not $process.Start()){
            return [pscustomobject]@{ ExitCode=-1; Lines=@('Could not start git.'); TimedOut=$false }
        }
        $stdoutTask=$process.StandardOutput.ReadToEndAsync()
        $stderrTask=$process.StandardError.ReadToEndAsync()
        if(-not $process.WaitForExit($TimeoutSeconds * 1000)){
            try { $process.Kill() } catch {}
            try { $process.WaitForExit() } catch {}
            $stdout=''; $stderr=''
            try { $stdout=$stdoutTask.GetAwaiter().GetResult() } catch {}
            try { $stderr=$stderrTask.GetAwaiter().GetResult() } catch {}
            $lines=@(($stdout + "`n" + $stderr) -split "`r?`n" | Where-Object { $_ -ne '' })
            $lines += "Git timed out after $TimeoutSeconds second(s)."
            return [pscustomobject]@{ ExitCode=124; Lines=$lines; TimedOut=$true }
        }
        $process.WaitForExit()
        $stdout=$stdoutTask.GetAwaiter().GetResult()
        $stderr=$stderrTask.GetAwaiter().GetResult()
        $lines=@(($stdout + "`n" + $stderr) -split "`r?`n" | Where-Object { $_ -ne '' })
        return [pscustomobject]@{ ExitCode=[int]$process.ExitCode; Lines=$lines; TimedOut=$false }
    } finally { $process.Dispose() }
}
function Git([string[]]$a, [int]$TimeoutSeconds=30){
    $result=Invoke-GitResult -a $a -TimeoutSeconds $TimeoutSeconds
    foreach($line in $result.Lines){ Write-Host $line }
    if($result.ExitCode -ne 0){
        if($result.TimedOut){ Fail "Git timed out for ${RepositoryName}: git $($a -join ' ')" }
        Fail "Git failed for ${RepositoryName}: git $($a -join ' ') (exit $($result.ExitCode))"
    }
}
function Remove-IgnoredTrackedFiles {
    $probe=Invoke-GitResult -a @('ls-files','-ci','--exclude-standard')
    if($probe.ExitCode -ne 0){
        foreach($line in $probe.Lines){ Write-Host $line }
        Fail "Could not inspect ignored tracked files for $RepositoryName (exit $($probe.ExitCode))."
    }
    $paths=@($probe.Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if($paths.Count -eq 0){ return }
    Write-Host "[INFO] Removing $($paths.Count) generated/ignored file(s) from the $RepositoryName Git index."
    for($i=0; $i -lt $paths.Count; $i+=50){
        $last=[Math]::Min($i+49,$paths.Count-1)
        $chunk=@($paths[$i..$last])
        Git -a (@('rm','--cached','--ignore-unmatch','--') + $chunk)
    }
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

Remove-IgnoredTrackedFiles
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
$push=Invoke-GitResult -a @('push','-u','origin','HEAD:main') -TimeoutSeconds 90
foreach($line in $push.Lines){ Write-Host $line }
if($push.ExitCode -ne 0){
    Fail "The build succeeded, but $RepositoryName could not be pushed to $RepositoryUrl. Git is non-interactive and limited to 90 seconds; check GitHub authentication, connectivity, or remote history."
}
Write-Host "[ OK ] $RepositoryName $Version published to GitHub."
