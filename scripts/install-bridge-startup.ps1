$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$private='E:/Codex/content/secure/remoteapp'
$state=Join-Path $repo '.state'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $state /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not protect local device state'}
$configPath=Join-Path $private 'bridge-launch.json'
@{NodePath=(Get-Command node).Source;PythonPath=(Get-Command python).Source;BridgePath=(Join-Path $repo 'dist/bridge.mjs');WorkDir=$repo;StateDir=$state;RelayUrl='wss://daxuechengminiapp.site/codex-remote/ws';AdminPort=18887} |
 ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
# Stop only this workspace's manually started Bridge before handing ownership to the watcher.
$lockPath=Join-Path $state 'bridge.lock'
if(Test-Path $lockPath){
  $lock=Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
  $existing=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$lock.pid)" -ErrorAction SilentlyContinue
  if($existing){
    if($existing.Name -ne 'node.exe' -or $existing.CommandLine -notmatch '(packages[\\/]bridge[\\/]src[\\/]main\.ts|remoteapp[\\/]dist[\\/]bridge\.mjs)') {throw 'Existing Bridge lock belongs to an unexpected process'}
    Stop-Process -Id $existing.ProcessId
  }
}
$watcher=Join-Path $PSScriptRoot 'watch-bridge.ps1'
$command='powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$watcher+'" -ConfigPath "'+$configPath+'"'
New-ItemProperty -Path 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Run' -Name 'CodexRemoteBridge' -PropertyType String -Value $command -Force | Out-Null
Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$watcher`"",'-ConfigPath',"`"$configPath`"") -WindowStyle Hidden
# User-facing entry contains no pairing code or credential.
@("@echo off",'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'open-bridge-control.ps1')+'"') |
 Set-Content -LiteralPath (Join-Path $private 'Open Codex Remote.cmd') -Encoding ascii
Write-Output 'Installed current-user startup watcher and local pairing control entry.'
