param([ValidateSet('assembleDebug','assembleLocalTest','assembleProduction')][string]$Task='assembleDebug',[string]$Architectures='x86_64')
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
if(-not $env:JAVA_HOME){$env:JAVA_HOME='E:/Codex/content/tools/remoteapp-jdk17/jdk-17.0.21.0.2+1'}
if(-not $env:ANDROID_HOME){$env:ANDROID_HOME='E:/AndroidSDK'}
$env:GRADLE_USER_HOME='E:/Codex/content/tools/remoteapp-gradle'
Push-Location (Join-Path $repo 'apps/mobile/android')
try { & ./gradlew.bat $Task -I ../../../scripts/mirrors.gradle "-PreactNativeArchitectures=$Architectures" --console=plain; if($LASTEXITCODE -ne 0){throw "Android build failed: $LASTEXITCODE"} } finally { Pop-Location }
