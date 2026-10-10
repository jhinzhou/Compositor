# Compositor Electron: install the official x64 Microsoft VC++ runtime prerequisite.
# This downloads from Microsoft; it does not redistribute third-party DLL binaries.
[CmdletBinding()]
param([string]$InstallerPath)
$ErrorActionPreference = 'Stop'
$ExpectedSHA256 = '843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c'
$OfficialURL = 'https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This Compositor release requires 64-bit Windows.' }
$TemporaryDownload = [string]::IsNullOrEmpty($InstallerPath)
if ($TemporaryDownload) {
  $InstallerPath = Join-Path ([IO.Path]::GetTempPath()) ('Compositor-VC-redist-' + [Guid]::NewGuid().ToString('N') + '.exe')
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $OfficialURL -OutFile $InstallerPath -UseBasicParsing
}
try {
  $ActualSHA256 = (Get-FileHash -Path $InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSHA256 -ne $ExpectedSHA256) { throw 'Microsoft runtime download checksum mismatch. Installer will not run.' }
  $Signature = Get-AuthenticodeSignature -FilePath $InstallerPath
  if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw 'Runtime installer must have a valid Microsoft Corporation Authenticode signature.'
  }
  Write-Host 'Installing Microsoft x64 Visual C++ runtime. Windows may request administrator approval.'
  $Installed = Start-Process -FilePath $InstallerPath -ArgumentList '/install', '/passive', '/norestart' -Wait -PassThru
  if ($Installed.ExitCode -notin @(0,3010,1638)) { throw ('Microsoft runtime installer failed, exit code ' + $Installed.ExitCode) }
  $Runtime = $null
  foreach ($View in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
    $Base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, $View)
    try {
      $Key = $Base.OpenSubKey('SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')
      if ($null -ne $Key) {
        try {
          if ($Key.GetValue('Installed') -eq 1) {
            $Version = [Version]($Key.GetValue('Version').TrimStart('v'))
            if ($Version -ge [Version]'14.51.36247.0') { $Runtime = $Version }
          }
        } finally { $Key.Dispose() }
      }
    } finally { $Base.Dispose() }
  }
  if ($null -eq $Runtime) { throw 'A compatible Microsoft x64 runtime registry entry could not be verified.' }
  foreach ($DLL in @('msvcp140.dll','msvcp140_1.dll','msvcp140_atomic_wait.dll','vcruntime140.dll','vcruntime140_1.dll')) {
    $SystemDirectory = if ([Environment]::Is64BitProcess) { 'System32' } else { 'Sysnative' }
    if (-not (Test-Path (Join-Path $env:WINDIR ($SystemDirectory + '\' + $DLL)))) { throw ('Installed runtime is missing ' + $DLL) }
  }
  Write-Host ('Microsoft x64 runtime installation verified: ' + $Runtime)
  if ($Installed.ExitCode -eq 3010) { Write-Host 'Windows reports that a restart is required.' }
  Write-Host 'Launch Compositor and test Subject Selection on Windows to complete runtime acceptance.'
} finally {
  if ($TemporaryDownload) { Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue }
}
