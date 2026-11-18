# Pique - agente del molinete
#
# Corre en la PC del kiosco. El kiosco de Pique (/admin/kiosco), cuando alguien puede
# pasar, le pide a este agente que abra el molinete: el agente cierra un rele USB
# conectado a la entrada "abrir" del controlador del molinete durante unos milisegundos.
#
# Solo escucha en 127.0.0.1 y solo acepta pedidos de los origenes configurados.
# Windows PowerShell 5.1, sin nada para instalar.
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File pique-molinete.ps1            (queda escuchando)
#   powershell -ExecutionPolicy Bypass -File pique-molinete.ps1 -Test      (abre una vez y sale)
#   powershell -ExecutionPolicy Bypass -File pique-molinete.ps1 -ListPorts (puertos COM)

param(
  [string]$Config = (Join-Path $PSScriptRoot 'config.json'),
  [switch]$Test,
  [switch]$ListPorts
)

$ErrorActionPreference = 'Stop'
$Version = '1.0.0'

if ($ListPorts) {
  $names = [System.IO.Ports.SerialPort]::GetPortNames()
  if ($names.Count -eq 0) { Write-Output 'No hay puertos COM. Conecta el rele USB y fijate que tenga el driver (CH340).' }
  else { $names | Sort-Object | ForEach-Object { Write-Output $_ } }
  exit 0
}

# ---------- Configuracion ----------

$defaults = @{
  port           = 7788
  pulseMs        = 600
  allowedOrigins = @('https://pique.ar', 'https://www.pique.ar')
  logFile        = (Join-Path $PSScriptRoot 'molinete.log')
  relay          = @{
    type     = 'simulate'      # simulate | serial | command
    comPort  = 'COM3'
    baudRate = 9600
    openHex  = 'A0 01 01 A2'   # LCUS-1 (CH340): canal 1 encendido
    closeHex = 'A0 01 00 A1'   # LCUS-1 (CH340): canal 1 apagado
    openCommand  = ''          # type=command: linea a ejecutar para cerrar el rele
    closeCommand = ''          # type=command: linea a ejecutar para soltarlo
  }
}

function Merge-Config($base, $over) {
  $out = @{}
  foreach ($k in $base.Keys) { $out[$k] = $base[$k] }
  if ($null -eq $over) { return $out }
  foreach ($p in $over.PSObject.Properties) {
    if ($base.ContainsKey($p.Name) -and $base[$p.Name] -is [hashtable] -and $p.Value -is [psobject]) {
      $out[$p.Name] = Merge-Config $base[$p.Name] $p.Value
    } else {
      $out[$p.Name] = $p.Value
    }
  }
  return $out
}

$fileCfg = $null
if (Test-Path $Config) {
  $fileCfg = Get-Content -Raw -Encoding UTF8 $Config | ConvertFrom-Json
}
$cfg = Merge-Config $defaults $fileCfg
$relayCfg = $cfg.relay
$origins = @($cfg.allowedOrigins | ForEach-Object { ([string]$_).TrimEnd('/').ToLowerInvariant() })

function Write-Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Output $line
  try {
    if ((Test-Path $cfg.logFile) -and ((Get-Item $cfg.logFile).Length -gt 2MB)) {
      Move-Item -Force $cfg.logFile ($cfg.logFile + '.1')
    }
    Add-Content -Path $cfg.logFile -Value $line -Encoding UTF8
  } catch { }
}

# ---------- Rele ----------

$script:serial = $null
$script:lastOpen = $null
$script:lastError = $null

function ConvertTo-Bytes([string]$hex) {
  $clean = ($hex -replace '[^0-9A-Fa-f]', '')
  if ($clean.Length -eq 0 -or ($clean.Length % 2) -ne 0) { throw "Hex invalido: $hex" }
  $bytes = New-Object byte[] ($clean.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($clean.Substring($i * 2, 2), 16) }
  return ,$bytes
}

function Get-Serial {
  if ($script:serial -and $script:serial.IsOpen) { return $script:serial }
  $sp = New-Object System.IO.Ports.SerialPort ([string]$relayCfg.comPort), ([int]$relayCfg.baudRate), ([System.IO.Ports.Parity]::None), 8, ([System.IO.Ports.StopBits]::One)
  $sp.WriteTimeout = 1000
  $sp.Open()
  $script:serial = $sp
  return $sp
}

function Send-Serial([string]$hex) {
  $bytes = ConvertTo-Bytes $hex
  try {
    (Get-Serial).Write($bytes, 0, $bytes.Length)
  } catch {
    # Se desenchufo o lo tomo otro programa: reintenta una vez abriendo de nuevo.
    try { if ($script:serial) { $script:serial.Close() } } catch { }
    $script:serial = $null
    (Get-Serial).Write($bytes, 0, $bytes.Length)
  }
}

function Invoke-Line([string]$line) {
  if ([string]::IsNullOrWhiteSpace($line)) { return }
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $line -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { throw "El comando termino con codigo $($p.ExitCode): $line" }
}

# Cierra el rele (el molinete libera un paso). Se suelta con Release-Relay despues de pulseMs.
function Close-Relay {
  $type = [string]$relayCfg.type
  switch ($type) {
    'simulate' { }
    'serial' { Send-Serial ([string]$relayCfg.openHex) }
    'command' { Invoke-Line ([string]$relayCfg.openCommand) }
    default { throw "Tipo de rele desconocido: $type" }
  }
  $script:lastOpen = Get-Date
}

function Release-Relay {
  Start-Sleep -Milliseconds ([int]$cfg.pulseMs)
  switch ([string]$relayCfg.type) {
    'serial' { Send-Serial ([string]$relayCfg.closeHex) }
    'command' { Invoke-Line ([string]$relayCfg.closeCommand) }
  }
}

if ($Test) {
  Write-Log "Prueba: abriendo una vez (rele $($relayCfg.type))"
  Close-Relay
  Release-Relay
  Write-Log 'Prueba: listo'
  exit 0
}

# ---------- HTTP minimo sobre TCP (sin permisos de administrador) ----------

$reasons = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 500 = 'Internal Server Error' }

function Send-Response($stream, [int]$status, [hashtable]$headers, [string]$body) {
  $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$body)
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append("HTTP/1.1 $status $($reasons[$status])`r`n")
  foreach ($k in $headers.Keys) { [void]$sb.Append("${k}: $($headers[$k])`r`n") }
  if ($body) { [void]$sb.Append("Content-Type: application/json; charset=utf-8`r`n") }
  [void]$sb.Append("Content-Length: $($bodyBytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n")
  $head = [System.Text.Encoding]::ASCII.GetBytes($sb.ToString())
  $stream.Write($head, 0, $head.Length)
  if ($bodyBytes.Length -gt 0) { $stream.Write($bodyBytes, 0, $bodyBytes.Length) }
  $stream.Flush()
}

function Read-Request($stream) {
  $buffer = New-Object byte[] 16384
  $total = 0
  $text = ''
  while ($total -lt $buffer.Length) {
    $n = $stream.Read($buffer, $total, $buffer.Length - $total)
    if ($n -le 0) { break }
    $total += $n
    $text = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $total)
    if ($text.Contains("`r`n`r`n")) { break }
  }
  $headEnd = $text.IndexOf("`r`n`r`n")
  if ($headEnd -lt 0) { return $null }
  $lines = $text.Substring(0, $headEnd) -split "`r`n"
  $first = $lines[0] -split ' '
  if ($first.Count -lt 2) { return $null }
  $headers = @{}
  for ($i = 1; $i -lt $lines.Count; $i++) {
    $idx = $lines[$i].IndexOf(':')
    if ($idx -gt 0) { $headers[$lines[$i].Substring(0, $idx).Trim().ToLowerInvariant()] = $lines[$i].Substring($idx + 1).Trim() }
  }
  $path = ($first[1] -split '\?')[0]
  return @{ method = $first[0].ToUpperInvariant(); path = $path; headers = $headers }
}

function Get-Json($obj) { return ($obj | ConvertTo-Json -Compress) }

function Get-Health {
  $last = $null
  if ($script:lastOpen) { $last = $script:lastOpen.ToString('s') }
  return @{ ok = $true; agent = 'pique-molinete'; version = $Version; relay = [string]$relayCfg.type; lastOpenAt = $last; lastError = $script:lastError }
}

function Invoke-Request($req, $stream) {
  $origin = [string]$req.headers['origin']
  $cors = @{}
  $originOk = $true
  if ($origin) {
    $originOk = $origins -contains $origin.TrimEnd('/').ToLowerInvariant()
    if ($originOk) {
      $cors['Access-Control-Allow-Origin'] = $origin
      $cors['Vary'] = 'Origin'
    }
  }

  if ($req.method -eq 'OPTIONS') {
    if (-not $originOk) { Send-Response $stream 403 @{} ''; return 'preflight rechazado' }
    $cors['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $cors['Access-Control-Allow-Headers'] = 'Content-Type'
    $cors['Access-Control-Max-Age'] = '600'
    # Chrome: pedido de una pagina publica a la red local (Private Network Access).
    if ($req.headers['access-control-request-private-network']) { $cors['Access-Control-Allow-Private-Network'] = 'true' }
    Send-Response $stream 204 $cors ''
    return $null
  }

  if (-not $originOk) {
    # Se deja leer el motivo (no abre nada) para que el kiosco muestre que falta autorizar la pagina.
    $msg = "El agente no tiene autorizada esta pagina ($origin). Agregala en allowedOrigins de config.json."
    Send-Response $stream 403 @{ 'Access-Control-Allow-Origin' = $origin; 'Vary' = 'Origin' } (Get-Json @{ ok = $false; error = $msg })
    return "rechazado: origen $origin"
  }

  if ($req.path -eq '/health' -and $req.method -eq 'GET') {
    Send-Response $stream 200 $cors (Get-Json (Get-Health))
    return $null
  }

  if ($req.path -eq '/open') {
    if ($req.method -ne 'POST') { Send-Response $stream 405 $cors ''; return $null }
    try {
      Close-Relay
    } catch {
      $script:lastError = $_.Exception.Message
      Send-Response $stream 500 $cors (Get-Json @{ ok = $false; error = $script:lastError })
      return "error al abrir: $($script:lastError)"
    }
    # Contesta apenas libera el paso; el rele se suelta despues.
    Send-Response $stream 200 $cors (Get-Json @{ ok = $true })
    try {
      Release-Relay
      $script:lastError = $null
    } catch {
      $script:lastError = "No se pudo soltar el rele: $($_.Exception.Message)"
      return $script:lastError
    }
    return 'abierto'
  }

  Send-Response $stream 404 $cors ''
  return $null
}

$listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), ([int]$cfg.port)
try {
  $listener.Start()
} catch {
  Write-Log "No se pudo usar el puerto $($cfg.port). Ya hay otro agente corriendo? $($_.Exception.Message)"
  exit 1
}
Write-Log "Agente del molinete $Version escuchando en http://127.0.0.1:$($cfg.port) (rele: $($relayCfg.type), origenes: $($origins -join ', '))"

try {
  while ($true) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 40; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 2000
      $client.SendTimeout = 2000
      $stream = $client.GetStream()
      $req = Read-Request $stream
      if ($null -eq $req) {
        Send-Response $stream 400 @{} ''
      } else {
        $note = Invoke-Request $req $stream
        if ($note) { Write-Log "$($req.method) $($req.path) $($req.headers['origin']) -> $note" }
      }
    } catch {
      Write-Log "Error atendiendo pedido: $($_.Exception.Message)"
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
  if ($script:serial) { try { $script:serial.Close() } catch { } }
}
