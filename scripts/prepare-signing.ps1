$ErrorActionPreference='Stop'
$dir='E:/Codex/content/secure/remoteapp'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $dir /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not protect signing directory'}
$keyFile=Join-Path $dir 'remoteapp-release.jks'
$properties=Join-Path $dir 'signing.properties'
if((Test-Path $keyFile) -ne (Test-Path $properties)){throw 'Incomplete signing configuration; refusing to replace identity'}
if(-not (Test-Path $keyFile)){
  $bytes=[byte[]]::new(32);$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose()
  $password=[Convert]::ToBase64String($bytes)
  $env:REMOTEAPP_SIGNING_PASSWORD=$password
  try {
    & 'E:/Codex/content/tools/remoteapp-jdk17/jdk-17.0.21.0.2+1/bin/keytool.exe' -genkeypair -keystore $keyFile -storepass:env REMOTEAPP_SIGNING_PASSWORD -keypass:env REMOTEAPP_SIGNING_PASSWORD -alias codexremote -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Codex Remote, O=Personal Remote App, C=CN'
    if($LASTEXITCODE -ne 0){throw 'Signing identity creation failed'}
    $portableKey=$keyFile.Replace('\','/')
    @("storeFile=$portableKey","storePassword=$password","keyAlias=codexremote","keyPassword=$password") | Set-Content -LiteralPath $properties -Encoding ascii
  } finally {Remove-Item Env:REMOTEAPP_SIGNING_PASSWORD -ErrorAction SilentlyContinue;$password=$null}
}
Write-Output 'Private release signing identity is ready.'
