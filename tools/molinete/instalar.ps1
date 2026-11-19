# Instala el agente del molinete para el usuario actual: lo copia a
# %LOCALAPPDATA%\PiqueMolinete, deja un acceso en Inicio (arranca solo al iniciar
# sesion) y lo levanta. No necesita permisos de administrador.
#
#   powershell -ExecutionPolicy Bypass -File instalar.ps1
#   powershell -ExecutionPolicy Bypass -File instalar.ps1 -Desinstalar

param([switch]$Desinstalar)

$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'PiqueMolinete'
$startup = [Environment]::GetFolderPath('Startup')
$shortcut = Join-Path $startup 'Pique Molinete.lnk'

function Stop-Agent {
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -like '*pique-molinete.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

if ($Desinstalar) {
  Stop-Agent
  if (Test-Path $shortcut) { Remove-Item $shortcut -Force }
  Write-Output "Agente detenido y quitado del inicio. La carpeta $dest queda (tiene tu config y el registro)."
  exit 0
}

Stop-Agent
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'pique-molinete.ps1') $dest
Copy-Item -Force (Join-Path $PSScriptRoot 'config.example.json') $dest
$config = Join-Path $dest 'config.json'
if (-not (Test-Path $config)) {
  Copy-Item (Join-Path $PSScriptRoot 'config.example.json') $config
  Write-Output "Se creo $config (rele en modo simulate: no abre nada hasta que lo configures)."
} else {
  Write-Output "Se mantuvo tu config: $config"
}

$script = Join-Path $dest 'pique-molinete.ps1'
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$psArgs = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($shortcut)
$lnk.TargetPath = $psExe
$lnk.Arguments = $psArgs
$lnk.WorkingDirectory = $dest
$lnk.WindowStyle = 7
$lnk.Description = 'Pique - agente del molinete'
$lnk.Save()

Start-Process -FilePath $psExe -ArgumentList $psArgs -WorkingDirectory $dest -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $port = (Get-Content -Raw -Encoding UTF8 $config | ConvertFrom-Json).port
  if (-not $port) { $port = 7788 }
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 3
  Write-Output "Agente funcionando (rele: $($health.relay)). En el kiosco, poner: http://127.0.0.1:$port"
} catch {
  Write-Output "El agente no respondio. Mira el registro en $dest\molinete.log"
}
