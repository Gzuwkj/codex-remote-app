$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$state=Join-Path $repo ('.state/lifecycle-'+[Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $state | Out-Null
Set-Content -LiteralPath (Join-Path $state 'bridge-token') -Value 'dedicated-lifecycle-fixture' -NoNewline
$config=Join-Path $state 'launch.json'
@{NodePath=(Get-Command node).Source;BridgePath=(Join-Path $repo 'dist/bridge.mjs');WorkDir=$repo;StateDir=$state;RelayUrl='wss://127.0.0.1:1';AdminPort=18899;PythonPath=(Get-Command python).Source} | ConvertTo-Json | Set-Content $config
$fake=Start-Process powershell.exe -ArgumentList @('-NoProfile','-Command','Start-Sleep -Seconds 60') -WindowStyle Hidden -PassThru
$watcher=$null
try {
  $watcher=Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSScriptRoot/watch-bridge.ps1`"",'-ConfigPath',"`"$config`"",'-TestDesktopPid',[string]$fake.Id) -WindowStyle Hidden -PassThru
  $statusFile=Join-Path $state 'watcher-status.json'
  $deadline=(Get-Date).AddSeconds(18)
  do {Start-Sleep -Milliseconds 400;if(Test-Path $statusFile){$status=Get-Content $statusFile -Raw | ConvertFrom-Json}} until(($status -and $status.bridgePid) -or (Get-Date) -gt $deadline)
  if(-not $status.bridgePid){throw 'Watcher did not launch Bridge'}
  $bridgeId=[int]$status.bridgePid
  if(-not (Get-Process -Id $bridgeId -ErrorAction SilentlyContinue)){throw 'Bridge exited before lifecycle check'}
  Stop-Process -Id $fake.Id
  $deadline=(Get-Date).AddSeconds(12)
  do {Start-Sleep -Milliseconds 400;$bridge=Get-Process -Id $bridgeId -ErrorAction SilentlyContinue} until(-not $bridge -or (Get-Date) -gt $deadline)
  if($bridge){throw 'Bridge remained running after tracked desktop exited'}
  Start-Sleep -Seconds 2
  $status=Get-Content $statusFile -Raw | ConvertFrom-Json
  if($status.state -ne 'waiting-for-codex'){throw 'Watcher did not return to idle state'}
  @{launched=$true;stoppedWithTrackedProcess=$true;idle=$true;testMode=$true} | ConvertTo-Json -Compress
} finally {
  if($watcher -and (Get-Process -Id $watcher.Id -ErrorAction SilentlyContinue)){Stop-Process -Id $watcher.Id}
  if(Get-Process -Id $fake.Id -ErrorAction SilentlyContinue){Stop-Process -Id $fake.Id}
}
