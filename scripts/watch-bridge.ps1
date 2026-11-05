param([string]$ConfigPath='E:/Codex/content/secure/remoteapp/bridge-launch.json',[int]$TestDesktopPid=0)
$ErrorActionPreference='Stop'
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$mutexName=if($TestDesktopPid){"Local\CodexRemoteWatcherTest-$TestDesktopPid"}else{'Local\CodexRemoteWatcher'}
$mutex=[Threading.Mutex]::new($false,$mutexName)
if(-not $mutex.WaitOne(0)){exit 0}
$child=$null
$statusFile=Join-Path $config.StateDir 'watcher-status.json'
function Save-Status([string]$state){
  @{state=$state;watcherPid=$PID;bridgePid=if($child -and -not $child.HasExited){$child.Id}else{$null};updatedAt=(Get-Date).ToUniversalTime().ToString('o')} |
    ConvertTo-Json | Set-Content -LiteralPath $statusFile -Encoding utf8
}
function Desktop-Running {
  if($TestDesktopPid){return $(if(Get-Process -Id $TestDesktopPid -ErrorAction SilentlyContinue){$TestDesktopPid}else{0})}
  $desktop=@((Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" -ErrorAction SilentlyContinue) |
    Where-Object {$_.ExecutablePath -match '\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$' -and $_.CommandLine -notmatch '--type='})
  if($desktop.Count){return [int]$desktop[0].ProcessId};return 0
}
try {
  while($true){
    $desktopId=Desktop-Running
    $running=$desktopId -gt 0
    if($running -and ($null -eq $child -or $child.HasExited)){
      $start=[Diagnostics.ProcessStartInfo]::new()
      $start.FileName=$config.NodePath
      $start.Arguments='"'+$config.BridgePath+'"'
      $start.WorkingDirectory=$config.WorkDir
      $start.UseShellExecute=$false;$start.CreateNoWindow=$true
      $start.RedirectStandardInput=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
      $start.EnvironmentVariables['RELAY_URL']=$config.RelayUrl
      $start.EnvironmentVariables['REMOTE_STATE_DIR']=$config.StateDir
      $start.EnvironmentVariables['BRIDGE_MANAGED']='1'
      $start.EnvironmentVariables['BRIDGE_ADMIN_PORT']=[string]$config.AdminPort
      $start.EnvironmentVariables['CODEX_DESKTOP_PID']=[string]$desktopId
      if($config.PythonPath){$start.EnvironmentVariables['PATH']=(Split-Path $config.PythonPath)+';'+$env:PATH}
      $child=[Diagnostics.Process]::Start($start)
      # Drain privately; pairing codes and device names are never written to logs.
      $null=$child.StandardOutput.ReadToEndAsync();$null=$child.StandardError.ReadToEndAsync()
      Save-Status 'running'
    }
    if(-not $running -and $child -and -not $child.HasExited){$child.Kill();$child.WaitForExit();$child=$null;Save-Status 'waiting-for-codex'}
    if(-not $running){Save-Status 'waiting-for-codex'}
    Start-Sleep -Seconds 2
  }
} finally {
  if($child -and -not $child.HasExited){$child.Kill();$child.WaitForExit()}
  Save-Status 'stopped';$mutex.ReleaseMutex();$mutex.Dispose()
}
