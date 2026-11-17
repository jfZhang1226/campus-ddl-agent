param(
  [Parameter(Mandatory=$true)][string]$GatewayDirectory,
  [string]$Hdc = 'C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
)
$ErrorActionPreference = 'Stop'
$gateway = (Resolve-Path -LiteralPath $GatewayDirectory).Path
$python = Join-Path $gateway '.venv\Scripts\python.exe'
foreach ($item in @($python, $Hdc, (Join-Path $gateway 'main.py'), (Join-Path $gateway '.env'))) {
  if (!(Test-Path -LiteralPath $item -PathType Leaf)) { throw 'Missing local gateway, environment or HDC. See the demo guide.' }
}
$probe = [System.Net.Sockets.TcpClient]::new()
try { $probe.Connect('127.0.0.1',8000); throw 'Port 8000 is already occupied. Close the existing gateway before starting this launcher.' }
catch [System.Net.Sockets.SocketException] { }
finally { $probe.Dispose() }
$devices = & $Hdc list targets
if ($LASTEXITCODE -ne 0 -or @($devices | Where-Object { $_ -and $_ -notmatch '\[Empty\]' }).Count -ne 1) { throw 'Connect exactly one unlocked, authorized phone.' }
# Refuse an existing mapping rather than deleting another session's forwarding.
$existing = & $Hdc fport ls
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect USB forwarding.' }
if ($existing -match 'tcp:8000') { throw 'USB port 8000 is already mapped. Reuse that session or close it first.' }
$logDirectory = Join-Path $PSScriptRoot '..\runtime\demo-gateway'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$process = $null
$mapped = $false
try {
  $process = Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','main:app','--host','127.0.0.1','--port','8000','--no-access-log') -WorkingDirectory $gateway -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory "$stamp-out.log") -RedirectStandardError (Join-Path $logDirectory "$stamp-error.log")
  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    if ($process.HasExited) { throw 'Gateway exited. Inspect the local runtime log; do not share keys or the .env file.' }
    $socket = [System.Net.Sockets.TcpClient]::new()
    try { $socket.Connect('127.0.0.1',8000); $ready = $true; break }
    catch [System.Net.Sockets.SocketException] { }
    finally { $socket.Dispose() }
  }
  if (!$ready) { throw 'Gateway did not start in time.' }
  $mapping = & $Hdc rport tcp:8000 tcp:8000
  if ($LASTEXITCODE -ne 0 -or ($mapping -join '') -notmatch 'Forwardport result:OK') { throw 'USB forwarding failed.' }
  $mapped = $true
  Write-Host 'Gateway ready. Phone Settings: http://127.0.0.1:8000 and the project GATEWAY_TOKEN.'
  Write-Host 'Keep this computer awake and USB connected. Press Ctrl+C to stop this demo session.'
  while (!$process.HasExited) { Start-Sleep -Seconds 1 }
  throw 'Gateway stopped. Restart this launcher to restore the connection.'
}
finally {
  if ($mapped) { & $Hdc fport rm tcp:8000 tcp:8000 | Out-Null }
  if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id }
}
