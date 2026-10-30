param(
    [string]$ServerIp = '200.141.23.247',
    [string]$IdentityFile = (Join-Path $env:USERPROFILE '.ssh\id_ed25519'),
    [string]$Destination = (Join-Path $env:USERPROFILE 'Backups\Pique'),
    [int]$RetentionDays = 90,
    [switch]$SkipIfBackedUpToday
)

$ErrorActionPreference = 'Stop'
if ($ServerIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'Invalid server IPv4 address.' }
if ($RetentionDays -lt 1) { throw 'RetentionDays must be positive.' }
if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) { throw 'SSH identity file is missing.' }
$null = New-Item -ItemType Directory -Force -Path $Destination
if ($SkipIfBackedUpToday) {
    $latestBackup = Get-ChildItem -LiteralPath $Destination -Filter 'backup_*.sql.gz' -File |
        Where-Object { $_.LastWriteTime -ge (Get-Date).Date } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestBackup) {
        $pairedSecrets = $latestBackup.FullName -replace '\.sql\.gz$', '.secrets.tar.gz'
        if (Test-Path -LiteralPath $pairedSecrets -PathType Leaf) {
            Write-Output 'Backup already downloaded today.'
            exit 0
        }
    }
}
$logFile = Join-Path $Destination 'backup.log'
$sshArgs = @('-i', $IdentityFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'StrictHostKeyChecking=yes')
$remoteHost = "root@$ServerIp"

try {
    $remoteOutput = @(& ssh @sshArgs $remoteHost 'cd /opt/pique && bash scripts/backup-production.sh 14')
    if ($LASTEXITCODE -ne 0) { throw 'Remote database backup failed.' }
    $remoteBackup = ($remoteOutput | Select-Object -Last 1).Trim()
    if ($remoteBackup -notmatch '^/var/backups/pique/backup_\d{8}_\d{6}\.sql\.gz$') {
        throw 'Unexpected remote backup path.'
    }
    $remoteSecrets = $remoteBackup -replace '\.sql\.gz$', '.secrets.tar.gz'
    & ssh @sshArgs $remoteHost "umask 077; tar -czf '$remoteSecrets' -C /opt/pique .env apps/backend/.env secrets/barrio-parque.env"
    if ($LASTEXITCODE -ne 0) { throw 'Recovery environment backup failed.' }

    foreach ($remoteFile in @($remoteBackup, $remoteSecrets)) {
        $localFile = Join-Path $Destination ([System.IO.Path]::GetFileName($remoteFile))
        $tempFile = "$localFile.partial"
        & scp @sshArgs "${remoteHost}:$remoteFile" $tempFile
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $remoteFile" }
        $inputFile = [System.IO.File]::OpenRead($tempFile)
        try {
            $gzip = [System.IO.Compression.GZipStream]::new($inputFile, [System.IO.Compression.CompressionMode]::Decompress)
            try { $gzip.CopyTo([System.IO.Stream]::Null) } finally { $gzip.Dispose() }
        } finally { $inputFile.Dispose() }
        Move-Item -LiteralPath $tempFile -Destination $localFile -Force
    }

    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    Get-ChildItem -LiteralPath $Destination -File |
        Where-Object { $_.Name -match '^backup_\d{8}_\d{6}\.(sql\.gz|secrets\.tar\.gz)$' -and $_.LastWriteTime -lt $cutoff } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    $message = "$(Get-Date -Format o) OK $([System.IO.Path]::GetFileName($remoteBackup))"
    Add-Content -LiteralPath $logFile -Value $message
    Write-Output $message
} catch {
    Add-Content -LiteralPath $logFile -Value "$(Get-Date -Format o) ERROR $($_.Exception.Message)"
    throw
}
