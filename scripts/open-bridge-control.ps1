$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath 'E:/Codex/content/secure/remoteapp/bridge-launch.json' -Raw | ConvertFrom-Json
$token=(Get-Content -LiteralPath (Join-Path $config.StateDir 'admin-token') -Raw).Trim()
Start-Process "http://127.0.0.1:$($config.AdminPort)/#$token"
