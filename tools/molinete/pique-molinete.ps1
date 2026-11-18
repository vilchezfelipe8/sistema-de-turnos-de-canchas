# Pique - agente del molinete
#
# Corre en la PC del kiosco. El kiosco de Pique (/admin/kiosco), cuando alguien puede
# pasar, le pide a este agente que abra el molinete: el agente cierra un rele USB
# conectado a la entrada "abrir" del controlador del molinete durante unos milisegundos.
#
# Si hay lector de huellas (ZKTeco, ZKFinger SDK), el agente lee el dedo, lo compara con
# las huellas que le pasa el kiosco y le avisa quien es. Las huellas no salen de esta PC
# salvo al registrarlas (el kiosco las guarda en Pique).
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
$Version = '1.1.0'

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
  fingerprint    = @{
    type      = 'none'         # none | simulate | zkfinger
    dll       = 'libzkfp.dll'  # ZKFinger SDK (lo instala el SDK en System32)
    minScore  = 0              # 0 = lo que decida el SDK
    cooldownMs = 1500          # ignora el mismo dedo apoyado durante este tiempo
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

# ---------- Lector de huellas ----------

$fpCfg = $cfg.fingerprint
$script:fp = @{
  type = [string]$fpCfg.type; ready = $false; error = $null
  device = [IntPtr]::Zero; db = [IntPtr]::Zero; width = 0; height = 0
  ids = @(); templates = @{}; count = 0; syncedAt = $null
  seq = 0; events = New-Object System.Collections.ArrayList
  lastCaptureAt = [DateTime]::MinValue; lastPoll = [DateTime]::MinValue
  pending = $null   # captura simulada esperando ser procesada
}
$script:enroll = @{ active = $false; step = 0; needed = 3; captures = New-Object System.Collections.ArrayList; template = $null; error = $null; startedAt = $null }

function Initialize-Fingerprint {
  if ($script:fp.type -eq 'none') { return }
  if ($script:fp.type -eq 'simulate') { $script:fp.ready = $true; return }
  if ($script:fp.type -ne 'zkfinger') { $script:fp.error = "Tipo de lector desconocido: $($script:fp.type)"; return }
  try {
    $dll = ([string]$fpCfg.dll).Replace('\', '\\')
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ZKFP {
  [DllImport("$dll")] public static extern int ZKFPM_Init();
  [DllImport("$dll")] public static extern int ZKFPM_GetDeviceCount();
  [DllImport("$dll")] public static extern IntPtr ZKFPM_OpenDevice(int index);
  [DllImport("$dll")] public static extern int ZKFPM_CloseDevice(IntPtr handle);
  [DllImport("$dll")] public static extern int ZKFPM_GetParameters(IntPtr handle, int code, byte[] value, ref int size);
  [DllImport("$dll")] public static extern int ZKFPM_AcquireFingerprint(IntPtr handle, byte[] image, int imageSize, byte[] template, ref int templateSize);
  [DllImport("$dll")] public static extern IntPtr ZKFPM_DBInit();
  [DllImport("$dll")] public static extern int ZKFPM_DBClear(IntPtr db);
  [DllImport("$dll")] public static extern int ZKFPM_DBAdd(IntPtr db, int fid, byte[] template, int size);
  [DllImport("$dll")] public static extern int ZKFPM_DBIdentify(IntPtr db, byte[] template, int size, ref int fid, ref int score);
  [DllImport("$dll")] public static extern int ZKFPM_DBMatch(IntPtr db, byte[] t1, int s1, byte[] t2, int s2);
  [DllImport("$dll")] public static extern int ZKFPM_DBMerge(IntPtr db, byte[] t1, byte[] t2, byte[] t3, byte[] merged, ref int size);
}
"@
    $r = [ZKFP]::ZKFPM_Init()
    if ($r -ne 0) { throw "No se pudo iniciar el SDK de huellas (codigo $r). Esta instalado el ZKFinger SDK?" }
    if ([ZKFP]::ZKFPM_GetDeviceCount() -lt 1) { throw 'No se encontro el lector de huellas. Esta conectado?' }
    $script:fp.device = [ZKFP]::ZKFPM_OpenDevice(0)
    if ($script:fp.device -eq [IntPtr]::Zero) { throw 'No se pudo abrir el lector de huellas.' }
    $buf = New-Object byte[] 4
    $size = 4
    [void][ZKFP]::ZKFPM_GetParameters($script:fp.device, 1, $buf, [ref]$size)
    $script:fp.width = [BitConverter]::ToInt32($buf, 0)
    $size = 4
    [void][ZKFP]::ZKFPM_GetParameters($script:fp.device, 2, $buf, [ref]$size)
    $script:fp.height = [BitConverter]::ToInt32($buf, 0)
    $script:fp.db = [ZKFP]::ZKFPM_DBInit()
    $script:fp.ready = $true
    Write-Log "Lector de huellas listo ($($script:fp.width)x$($script:fp.height))"
  } catch {
    $script:fp.error = $_.Exception.Message
    Write-Log "Lector de huellas: $($script:fp.error)"
  }
}

# Devuelve la plantilla (bytes) si hay un dedo apoyado, o $null.
function Get-Capture {
  if ($script:fp.type -eq 'simulate') {
    $t = $script:fp.pending
    $script:fp.pending = $null
    if ($null -eq $t) { return $null }
    return ,$t
  }
  $image = New-Object byte[] ($script:fp.width * $script:fp.height)
  $tpl = New-Object byte[] 2048
  $size = 2048
  $r = [ZKFP]::ZKFPM_AcquireFingerprint($script:fp.device, $image, $image.Length, $tpl, [ref]$size)
  if ($r -ne 0 -or $size -le 0) { return $null }
  $out = New-Object byte[] $size
  [Array]::Copy($tpl, $out, $size)
  return ,$out
}

function Test-SameFinger([byte[]]$a, [byte[]]$b) {
  if ($script:fp.type -eq 'simulate') { return ([Convert]::ToBase64String($a) -eq [Convert]::ToBase64String($b)) }
  return ([ZKFP]::ZKFPM_DBMatch($script:fp.db, $a, $a.Length, $b, $b.Length) -gt 0)
}

function Merge-Captures($caps) {
  if ($script:fp.type -eq 'simulate') { return [Convert]::ToBase64String($caps[0]) }
  $merged = New-Object byte[] 2048
  $size = 2048
  $r = [ZKFP]::ZKFPM_DBMerge($script:fp.db, $caps[0], $caps[1], $caps[2], $merged, [ref]$size)
  if ($r -ne 0) { throw "No se pudieron unir las 3 lecturas (codigo $r)." }
  $out = New-Object byte[] $size
  [Array]::Copy($merged, $out, $size)
  return [Convert]::ToBase64String($out)
}

# Reemplaza las huellas conocidas por las que manda el kiosco.
function Set-Templates($rows) {
  $ids = New-Object System.Collections.ArrayList
  $templates = @{}
  if ($script:fp.type -eq 'zkfinger') { [void][ZKFP]::ZKFPM_DBClear($script:fp.db) }
  $skipped = 0
  foreach ($row in $rows) {
    $fmt = [string]$row.format
    $expected = 'ZKFINGER10'
    if ($script:fp.type -eq 'simulate') { $expected = 'SIMULATED' }
    if ($fmt -ne $expected) { $skipped++; continue }
    try { $bytes = [Convert]::FromBase64String([string]$row.template) } catch { $skipped++; continue }
    $fid = $ids.Count + 1
    if ($script:fp.type -eq 'zkfinger') {
      if ([ZKFP]::ZKFPM_DBAdd($script:fp.db, $fid, $bytes, $bytes.Length) -ne 0) { $skipped++; continue }
    } else {
      $templates[[string]$row.template] = $fid
    }
    [void]$ids.Add([string]$row.id)
  }
  $script:fp.ids = $ids
  $script:fp.templates = $templates
  $script:fp.count = $ids.Count
  $script:fp.syncedAt = Get-Date
  return @{ loaded = $ids.Count; skipped = $skipped }
}

function Find-Finger([byte[]]$tpl) {
  $fid = 0
  $score = 0
  if ($script:fp.type -eq 'simulate') {
    $key = [Convert]::ToBase64String($tpl)
    if ($script:fp.templates.ContainsKey($key)) { $fid = $script:fp.templates[$key]; $score = 100 }
  } else {
    $r = [ZKFP]::ZKFPM_DBIdentify($script:fp.db, $tpl, $tpl.Length, [ref]$fid, [ref]$score)
    if ($r -ne 0) { $fid = 0 }
  }
  if ($fid -le 0 -or $fid -gt $script:fp.ids.Count -or $score -lt [int]$fpCfg.minScore) { return $null }
  return @{ fingerprintId = $script:fp.ids[$fid - 1]; score = $score }
}

function Add-FpEvent([hashtable]$evt) {
  $script:fp.seq++
  $evt.seq = $script:fp.seq
  $evt.at = (Get-Date).ToString('s')
  [void]$script:fp.events.Add($evt)
  while ($script:fp.events.Count -gt 20) { $script:fp.events.RemoveAt(0) }
}

# Se llama seguido desde el bucle principal: lee el dedo y registra lo que paso.
function Invoke-FingerprintPoll {
  if (-not $script:fp.ready) { return }
  $now = Get-Date
  if (($now - $script:fp.lastPoll).TotalMilliseconds -lt 120) { return }
  $script:fp.lastPoll = $now
  if ($script:enroll.active -and $script:enroll.startedAt -and ($now - $script:enroll.startedAt).TotalSeconds -gt 90) {
    $script:enroll.active = $false
    $script:enroll.error = 'Se termino el tiempo para registrar la huella.'
  }
  $tpl = Get-Capture
  if ($null -eq $tpl) { return }
  if (($now - $script:fp.lastCaptureAt).TotalMilliseconds -lt [int]$fpCfg.cooldownMs) { $script:fp.lastCaptureAt = $now; return }
  $script:fp.lastCaptureAt = $now

  if ($script:enroll.active) {
    $caps = $script:enroll.captures
    if ($caps.Count -gt 0 -and -not (Test-SameFinger $caps[0] $tpl)) {
      $script:enroll.error = 'Ese no es el mismo dedo. Apoya siempre el mismo.'
      return
    }
    $script:enroll.error = $null
    [void]$caps.Add($tpl)
    $script:enroll.step = $caps.Count
    if ($caps.Count -ge $script:enroll.needed) {
      try {
        $script:enroll.template = Merge-Captures $caps
      } catch {
        $script:enroll.error = $_.Exception.Message
        $caps.Clear()
        $script:enroll.step = 0
        return
      }
      $script:enroll.active = $false
      Write-Log 'Huella registrada (3 lecturas)'
    }
    return
  }

  $match = Find-Finger $tpl
  if ($match) {
    Add-FpEvent @{ kind = 'match'; fingerprintId = $match.fingerprintId; score = $match.score }
  } else {
    Add-FpEvent @{ kind = 'unknown' }
  }
}

function Get-EnrollState {
  return @{
    active = $script:enroll.active; step = $script:enroll.step; needed = $script:enroll.needed
    template = $script:enroll.template; format = $(if ($script:fp.type -eq 'simulate') { 'SIMULATED' } else { 'ZKFINGER10' })
    error = $script:enroll.error
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

$reasons = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 405 = 'Method Not Allowed'; 409 = 'Conflict'; 500 = 'Internal Server Error' }

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
  $parts = $first[1] -split '\?', 2
  $query = @{}
  if ($parts.Count -gt 1) {
    foreach ($pair in ($parts[1] -split '&')) {
      $kv = $pair -split '=', 2
      if ($kv[0]) { $query[[Uri]::UnescapeDataString($kv[0])] = $(if ($kv.Count -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { '' }) }
    }
  }
  # Cuerpo (lo que ya llego despues de los encabezados + el resto segun Content-Length).
  $body = ''
  $length = 0
  if ($headers['content-length']) { [void][int]::TryParse($headers['content-length'], [ref]$length) }
  if ($length -gt 16MB) { return $null }
  if ($length -gt 0) {
    $bodyBytes = New-Object byte[] $length
    $already = [Math]::Min($total - ($headEnd + 4), $length)
    if ($already -gt 0) { [Array]::Copy($buffer, $headEnd + 4, $bodyBytes, 0, $already) }
    $got = $already
    while ($got -lt $length) {
      $n = $stream.Read($bodyBytes, $got, $length - $got)
      if ($n -le 0) { break }
      $got += $n
    }
    $body = [System.Text.Encoding]::UTF8.GetString($bodyBytes, 0, $got)
  }
  return @{ method = $first[0].ToUpperInvariant(); path = $parts[0]; query = $query; headers = $headers; body = $body }
}

function Get-Json($obj) { return ($obj | ConvertTo-Json -Compress) }

function Get-Health {
  $last = $null
  if ($script:lastOpen) { $last = $script:lastOpen.ToString('s') }
  $synced = $null
  if ($script:fp.syncedAt) { $synced = $script:fp.syncedAt.ToString('s') }
  return @{
    ok = $true; agent = 'pique-molinete'; version = $Version; relay = [string]$relayCfg.type; lastOpenAt = $last; lastError = $script:lastError
    fingerprint = @{ type = $script:fp.type; ready = $script:fp.ready; error = $script:fp.error; templates = $script:fp.count; syncedAt = $synced; seq = $script:fp.seq }
  }
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
    $cors['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
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

  if ($req.path.StartsWith('/fingerprint')) {
    return (Invoke-FingerprintRequest $req $stream $cors)
  }

  Send-Response $stream 404 $cors ''
  return $null
}

function Invoke-FingerprintRequest($req, $stream, $cors) {
  if ($script:fp.type -eq 'none') {
    Send-Response $stream 404 $cors (Get-Json @{ ok = $false; error = 'Este agente no tiene lector de huellas configurado.' })
    return $null
  }
  $route = "$($req.method) $($req.path)"
  switch ($route) {
    'GET /fingerprint/events' {
      $after = 0
      [void][int]::TryParse([string]$req.query['after'], [ref]$after)
      $list = @($script:fp.events | Where-Object { $_.seq -gt $after })
      Send-Response $stream 200 $cors (Get-Json @{ ok = $true; seq = $script:fp.seq; ready = $script:fp.ready; error = $script:fp.error; events = $list })
      return $null
    }
    'POST /fingerprint/templates' {
      try { $data = $req.body | ConvertFrom-Json } catch { $data = $null }
      if ($null -eq $data -or $null -eq $data.fingerprints) {
        Send-Response $stream 400 $cors (Get-Json @{ ok = $false; error = 'Lista de huellas invalida.' })
        return $null
      }
      $res = Set-Templates @($data.fingerprints)
      Send-Response $stream 200 $cors (Get-Json @{ ok = $true; loaded = $res.loaded; skipped = $res.skipped })
      return "huellas cargadas: $($res.loaded) (salteadas $($res.skipped))"
    }
    'POST /fingerprint/enroll' {
      if (-not $script:fp.ready) {
        Send-Response $stream 409 $cors (Get-Json @{ ok = $false; error = "El lector no esta listo. $($script:fp.error)" })
        return $null
      }
      $script:enroll.active = $true
      $script:enroll.step = 0
      $script:enroll.captures.Clear()
      $script:enroll.template = $null
      $script:enroll.error = $null
      $script:enroll.startedAt = Get-Date
      Send-Response $stream 200 $cors (Get-Json (Get-EnrollState))
      return 'registro de huella iniciado'
    }
    'GET /fingerprint/enroll' {
      Send-Response $stream 200 $cors (Get-Json (Get-EnrollState))
      return $null
    }
    'DELETE /fingerprint/enroll' {
      $script:enroll.active = $false
      $script:enroll.captures.Clear()
      $script:enroll.step = 0
      $script:enroll.template = $null
      Send-Response $stream 200 $cors (Get-Json @{ ok = $true })
      return $null
    }
    'POST /fingerprint/simulate' {
      # Solo para pruebas: hace de cuenta que se apoyo un dedo con esta plantilla.
      if ($script:fp.type -ne 'simulate') { Send-Response $stream 404 $cors ''; return $null }
      try { $data = $req.body | ConvertFrom-Json; $script:fp.pending = [Convert]::FromBase64String([string]$data.template) } catch {
        Send-Response $stream 400 $cors (Get-Json @{ ok = $false; error = 'Plantilla invalida.' })
        return $null
      }
      Send-Response $stream 200 $cors (Get-Json @{ ok = $true })
      return $null
    }
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
Initialize-Fingerprint
Write-Log "Agente del molinete $Version escuchando en http://127.0.0.1:$($cfg.port) (rele: $($relayCfg.type), huella: $($script:fp.type), origenes: $($origins -join ', '))"

try {
  while ($true) {
    if (-not $listener.Pending()) {
      try { Invoke-FingerprintPoll } catch { Write-Log "Lector de huellas: $($_.Exception.Message)" }
      Start-Sleep -Milliseconds 40
      continue
    }
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
