$ErrorActionPreference = 'Stop'
$backupRoot = Split-Path -Parent $PSScriptRoot
Start-Transcript -Path (Join-Path $backupRoot 'scheduled-task.log') -Append
try {
    & (Join-Path $PSScriptRoot 'backup-to-windows.ps1') -SkipIfBackedUpToday
    Stop-Transcript
    exit 0
} catch {
    Write-Output $_.Exception.Message
    Stop-Transcript
    exit 1
}
