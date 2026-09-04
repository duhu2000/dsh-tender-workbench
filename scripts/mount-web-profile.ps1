#Requires -Version 7.0

[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$PluginName = 'dsh-tender-workbench'
$ProfileName = 'web'
$DshReferenceVersion = '0.1.1-rc.2'
$WebPort = 3080

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Get-PnpmVersion {
  param([string]$PackageManager)
  $match = [regex]::Match($PackageManager, '^pnpm@(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$')
  if (-not $match.Success) { throw "Expected exact pnpm version, received '$PackageManager'." }
  return $match.Groups['version'].Value
}

function Read-ModulesMetadata {
  param([string]$Path)
  if (-not [IO.File]::Exists($Path)) { throw "Missing Profile pnpm metadata: $Path" }
  $text = [IO.File]::ReadAllText($Path)
  try {
    $value = $text | ConvertFrom-Json -ErrorAction Stop
    if ($value.packageManager -and $value.storeDir) {
      return [pscustomobject]@{
        PackageManager = [string]$value.packageManager
        StoreDir = [string]$value.storeDir
      }
    }
  } catch {
    # Older pnpm releases may emit plain YAML.
  }
  $manager = [regex]::Match($text, '(?m)^\s*"?packageManager"?\s*:\s*"?(?<value>pnpm@[^"\s,]+)')
  $store = [regex]::Match($text, '(?m)^\s*"?storeDir"?\s*:\s*"?(?<value>[^"\r\n,]+)')
  if (-not $manager.Success -or -not $store.Success) {
    throw 'Profile .modules.yaml does not contain packageManager and storeDir.'
  }
  return [pscustomobject]@{
    PackageManager = $manager.Groups['value'].Value.Trim()
    StoreDir = $store.Groups['value'].Value.Trim()
  }
}

function Resolve-Corepack {
  $command = Get-Command corepack.cmd, corepack -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandType -in @('Application', 'ExternalScript') } |
    Select-Object -First 1
  if ($command -and $command.Source) { return $command.Source }
  $candidates = @()
  if ($env:NVM_SYMLINK) { $candidates += Join-Path $env:NVM_SYMLINK 'corepack.cmd' }
  $programFiles = [Environment]::GetFolderPath('ProgramFiles')
  if ($programFiles) { $candidates += Join-Path $programFiles 'nodejs\corepack.cmd' }
  foreach ($candidate in $candidates) {
    if ([IO.File]::Exists($candidate)) { return [IO.Path]::GetFullPath($candidate) }
  }
  throw 'Corepack is unavailable. Restore the repository Node.js runtime before mounting.'
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [switch]$Capture
  )
  $previous = @{}
  foreach ($key in $Environment.Keys) {
    $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
  }
  Push-Location -LiteralPath $WorkingDirectory
  try {
    if ($Capture) {
      $lines = @(& $FilePath @Arguments 2>&1)
      $exitCode = $LASTEXITCODE
      $output = ($lines | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    } else {
      & $FilePath @Arguments
      $exitCode = $LASTEXITCODE
      $output = ''
    }
  } finally {
    Pop-Location
    foreach ($key in $Environment.Keys) {
      [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
    }
  }
  if ($exitCode -ne 0) {
    throw ('Command failed (' + $exitCode + '): ' + $FilePath + ' ' + ($Arguments -join ' ') +
      [Environment]::NewLine + $output)
  }
  return $output
}

function Invoke-Pnpm {
  param(
    [string]$Corepack,
    [string]$Version,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [switch]$Capture
  )
  $parameters = @{
    FilePath = $Corepack
    Arguments = @("pnpm@$Version") + $Arguments
    WorkingDirectory = $WorkingDirectory
    Environment = $Environment
    Capture = $Capture
  }
  return Invoke-External @parameters
}

function Get-Sha256 {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-EqualPath {
  param([string]$Left, [string]$Right)
  $a = [IO.Path]::GetFullPath($Left).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $b = [IO.Path]::GetFullPath($Right).TrimEnd([IO.Path]::DirectorySeparatorChar)
  return $a.Equals($b, [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-FileSpecifier {
  param([string]$Specifier, [string]$BaseDirectory)
  if (-not $Specifier.StartsWith('file:', [StringComparison]::OrdinalIgnoreCase)) { return $null }
  $path = $Specifier.Substring(5).Replace('/', [IO.Path]::DirectorySeparatorChar)
  if ([IO.Path]::IsPathRooted($path)) { return [IO.Path]::GetFullPath($path) }
  return [IO.Path]::GetFullPath((Join-Path $BaseDirectory $path))
}

function Get-ContentAddressedName {
  param([string]$Name, [string]$Version, [string]$Sha256)
  return "$Name-$Version-$($Sha256.Substring(0, 12).ToLowerInvariant()).tgz"
}

function Test-ContentAddressedTarball {
  param(
    [AllowNull()] [string]$Path,
    [string]$StableDirectory,
    [string]$Version
  )
  if (-not $Path -or -not [IO.File]::Exists($Path)) { return $false }
  $fullPath = [IO.Path]::GetFullPath($Path)
  $fullDirectory = [IO.Path]::GetFullPath($StableDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
  if (-not $fullPath.StartsWith(
    $fullDirectory + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )) {
    return $false
  }
  $sha256 = Get-Sha256 $fullPath
  $expectedName = Get-ContentAddressedName $PluginName $Version $sha256
  return [IO.Path]::GetFileName($fullPath).Equals($expectedName, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-Tarball {
  param([string]$Tarball, [string]$RepositoryRoot, [string]$Version)
  $listParameters = @{
    FilePath = 'tar'
    Arguments = @('-tf', $Tarball)
    WorkingDirectory = $RepositoryRoot
    Capture = $true
  }
  $entries = @((Invoke-External @listParameters) -split '\r?\n' | Where-Object { $_ })
  foreach ($required in @(
    'package/package.json',
    'package/LICENSE',
    'package/cordis.patch.yml',
    'package/lib/index.js',
    'package/lib/client.js'
  )) {
    Assert-True ($entries -contains $required) "Tarball is missing $required."
  }
  Assert-True (@($entries | Where-Object { $_ -match '^package/lib/types/.+\.d\.ts$' }).Count -gt 0) 'Tarball has no declarations.'
  $forbidden = @($entries | Where-Object {
    $_ -match '^package/(?:src|tests|node_modules)/' -or $_ -match '(?:^|/)\.env(?:\.|$)'
  })
  Assert-True ($forbidden.Count -eq 0) "Tarball contains forbidden entries: $($forbidden -join ', ')"

  $extractRoot = Join-Path ([IO.Path]::GetTempPath()) "dsh-mount-$([guid]::NewGuid().ToString('N'))"
  [IO.Directory]::CreateDirectory($extractRoot) | Out-Null
  try {
    $extractParameters = @{
      FilePath = 'tar'
      Arguments = @('-xf', $Tarball, '-C', $extractRoot)
      WorkingDirectory = $RepositoryRoot
    }
    Invoke-External @extractParameters
    $packedRoot = Join-Path $extractRoot 'package'
    $manifest = Get-Content -LiteralPath (Join-Path $packedRoot 'package.json') -Raw | ConvertFrom-Json
    Assert-True ($manifest.name -eq $PluginName -and $manifest.version -eq $Version) 'Packed identity is stale.'
    foreach ($relative in @('lib\index.js', 'lib\client.js')) {
      Assert-True (
        (Get-Sha256 (Join-Path $RepositoryRoot $relative)) -eq
        (Get-Sha256 (Join-Path $packedRoot $relative))
      ) "Packed $relative is stale."
    }
  } finally {
    if ([IO.Directory]::Exists($extractRoot)) { [IO.Directory]::Delete($extractRoot, $true) }
  }
}

function Enter-MountLock {
  param([string]$LockDirectory)
  if ([IO.Directory]::Exists($LockDirectory)) {
    $ownerPath = Join-Path $LockDirectory 'owner.json'
    $entries = @(Get-ChildItem -LiteralPath $LockDirectory -Force)
    if ($entries.Count -ne 1 -or $entries[0].Name -ne 'owner.json') {
      throw "Unexpected mount lock contents: $LockDirectory"
    }
    $owner = Get-Content -LiteralPath $ownerPath -Raw | ConvertFrom-Json
    if (Get-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue) {
      throw "Another Profile mount is active (PID $($owner.pid))."
    }
    [IO.File]::Delete($ownerPath)
    [IO.Directory]::Delete($LockDirectory, $false)
  }
  New-Item -ItemType Directory -Path $LockDirectory -ErrorAction Stop | Out-Null
  $owner = [ordered]@{ pid = $PID; startedAt = [DateTimeOffset]::Now.ToString('O') } | ConvertTo-Json
  [IO.File]::WriteAllText((Join-Path $LockDirectory 'owner.json'), $owner)
}

function Exit-MountLock {
  param([string]$LockDirectory)
  $ownerPath = Join-Path $LockDirectory 'owner.json'
  if ([IO.File]::Exists($ownerPath)) { [IO.File]::Delete($ownerPath) }
  if ([IO.Directory]::Exists($LockDirectory)) { [IO.Directory]::Delete($LockDirectory, $false) }
}

function New-PnpmShim {
  param([string]$Corepack, [string]$Version)
  Assert-True $IsWindows 'This local Profile runner currently supports Windows only.'
  $directory = Join-Path ([IO.Path]::GetTempPath()) "dsh-pnpm-$([guid]::NewGuid().ToString('N'))"
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  $newLine = [Environment]::NewLine
  $content = '@echo off' + $newLine +
    'call "' + $Corepack.Replace('"', '""') + '" pnpm@' + $Version + ' %*' + $newLine +
    'exit /b %ERRORLEVEL%' + $newLine
  [IO.File]::WriteAllText((Join-Path $directory 'pnpm.cmd'), $content)
  return $directory
}

function Get-WebListener {
  $listeners = @(Get-NetTCPConnection -LocalPort $WebPort -State Listen -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $null }
  $processIds = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($processIds.Count -ne 1) { throw "Port $WebPort has multiple owners." }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($processIds[0])"
  if (-not $process) { throw "Cannot inspect the process on port $WebPort." }
  return [pscustomobject]@{ Pid = [int]$processIds[0]; CommandLine = [string]$process.CommandLine }
}

function Assert-DshListener {
  param([AllowNull()]$Listener)
  if ($null -eq $Listener) { return }
  $isDsh = $Listener.CommandLine -match '(?i)(?:@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js|\bdsh(?:\.cmd)?\b).*\bweb\b'
  Assert-True $isDsh "Port $WebPort belongs to an unrecognized PID $($Listener.Pid)."
}

function Assert-Installed {
  param(
    [string]$ProfileDirectory,
    [string]$Tarball,
    [string]$RepositoryRoot,
    [string]$Corepack,
    [string]$ProfilePnpm,
    [hashtable]$PinnedEnvironment,
    [switch]$VerifyDump
  )
  $manifest = Get-Content -LiteralPath (Join-Path $ProfileDirectory 'package.json') -Raw | ConvertFrom-Json
  $dependency = Resolve-FileSpecifier ([string]$manifest.dependencies.$PluginName) $ProfileDirectory
  Assert-True ($dependency -and (Test-EqualPath $dependency $Tarball)) 'Profile dependency is not the current tarball.'
  $bundles = @($manifest.dsh.profile.bundles)
  Assert-True (@($bundles | Where-Object { $_ -eq $PluginName }).Count -eq 1) 'Workbench bundle is duplicated or missing.'
  $sidebarIndex = [Array]::IndexOf($bundles, 'dsh-better-sidebar')
  $pluginIndex = [Array]::IndexOf($bundles, $PluginName)
  Assert-True (
    $sidebarIndex -ge 0 -and $pluginIndex -ge 0 -and $sidebarIndex -lt $pluginIndex
  ) 'Better Sidebar must precede the workbench.'
  $installedRoot = Join-Path $ProfileDirectory "node_modules\$PluginName"
  foreach ($relative in @('lib\index.js', 'lib\client.js')) {
    Assert-True (
      (Get-Sha256 (Join-Path $RepositoryRoot $relative)) -eq
      (Get-Sha256 (Join-Path $installedRoot $relative))
    ) "Installed $relative does not match the build."
  }
  if ($VerifyDump) {
    $dumpParameters = @{
      Corepack = $Corepack
      Version = $ProfilePnpm
      Arguments = @('dlx', "@deepseek-ai/dsh@$DshReferenceVersion", 'web', '--dump-config')
      WorkingDirectory = $ProfileDirectory
      Environment = $PinnedEnvironment
      Capture = $true
    }
    $dump = Invoke-Pnpm @dumpParameters
    $count = [regex]::Matches($dump, '(?m)^\s*-\s*id:\s*tender-workbench\s*$').Count
    Assert-True ($count -eq 1) "Expected one Loader row, found $count."
  }
}

function Start-DshWeb {
  param(
    [string]$Corepack,
    [string]$ProfilePnpm,
    [string]$ProfileDirectory,
    [string]$RepositoryRoot,
    [hashtable]$PinnedEnvironment
  )
  $logDirectory = Join-Path $RepositoryRoot 'artifacts\profile-validation'
  [IO.Directory]::CreateDirectory($logDirectory) | Out-Null
  $stamp = [DateTimeOffset]::Now.ToString('yyyyMMdd-HHmmss')
  $stdout = Join-Path $logDirectory "dsh-web-mount-$stamp.stdout.log"
  $stderr = Join-Path $logDirectory "dsh-web-mount-$stamp.stderr.log"
  $oldPath = $env:PATH
  try {
    $env:PATH = [string]$PinnedEnvironment['PATH']
    $arguments = @(
      "pnpm@$ProfilePnpm",
      'dlx',
      "@deepseek-ai/dsh@$DshReferenceVersion",
      'web',
      '--no-open',
      '--port',
      [string]$WebPort
    )
    $process = Start-Process -FilePath $Corepack -ArgumentList $arguments -WorkingDirectory $ProfileDirectory -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
  } finally {
    $env:PATH = $oldPath
  }
  $deadline = [DateTimeOffset]::Now.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $listener = Get-WebListener
    if ($listener) {
      Assert-DshListener $listener
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 10
      Assert-True ($response.StatusCode -eq 200) "DSH Web returned HTTP $($response.StatusCode)."
      return $listener.Pid
    }
  } while ([DateTimeOffset]::Now -lt $deadline)
  throw "DSH Web did not start. Logs: $stdout ; $stderr"
}

function Invoke-SelfTest {
  Assert-True ((Get-PnpmVersion 'pnpm@11.7.0') -eq '11.7.0') 'pnpm parser failed.'
  Assert-True (
    ([System.Management.Automation.SemanticVersion]'0.2.1-beta.2') -gt
    ([System.Management.Automation.SemanticVersion]'0.2.1-beta.1')
  ) 'SemVer comparison failed.'
  $name = Get-ContentAddressedName 'dsh-tender-workbench' '0.2.1-beta.2' ('a' * 64)
  Assert-True ($name -eq 'dsh-tender-workbench-0.2.1-beta.2-aaaaaaaaaaaa.tgz') 'Filename generation failed.'
  $testRoot = Join-Path ([IO.Path]::GetTempPath()) "dsh-mount-self-test-$([guid]::NewGuid().ToString('N'))"
  [IO.Directory]::CreateDirectory($testRoot) | Out-Null
  try {
    $modulesPath = Join-Path $testRoot '.modules.yaml'
    [IO.File]::WriteAllText(
      $modulesPath,
      '{"packageManager":"pnpm@10.34.0","storeDir":"C:\\store\\v10"}'
    )
    $metadata = Read-ModulesMetadata $modulesPath
    Assert-True ($metadata.PackageManager -eq 'pnpm@10.34.0') 'Profile pnpm metadata parsing failed.'
    Assert-True ($metadata.StoreDir -eq 'C:\store\v10') 'Profile store metadata parsing failed.'
    $lockPath = Join-Path $testRoot '.mount.lock'
    Enter-MountLock $lockPath
    Assert-True ([IO.File]::Exists((Join-Path $lockPath 'owner.json'))) 'Mount lock acquisition failed.'
    Exit-MountLock $lockPath
    $firstSource = Join-Path $testRoot 'first.tgz'
    $secondSource = Join-Path $testRoot 'second.tgz'
    [IO.File]::WriteAllText($firstSource, 'first bundle')
    [IO.File]::WriteAllText($secondSource, 'second bundle')
    $firstName = Get-ContentAddressedName $PluginName '0.2.1-beta.2' (Get-Sha256 $firstSource)
    $secondName = Get-ContentAddressedName $PluginName '0.2.1-beta.2' (Get-Sha256 $secondSource)
    Assert-True ($firstName -ne $secondName) 'Changed bytes reused a tarball filename.'
    $firstStable = Join-Path $testRoot $firstName
    [IO.File]::Copy($firstSource, $firstStable)
    Assert-True (
      Test-ContentAddressedTarball $firstStable $testRoot '0.2.1-beta.2'
    ) 'Content-addressed tarball validation failed.'
    Assert-True (
      -not (Test-ContentAddressedTarball $firstSource $testRoot '0.2.1-beta.2')
    ) 'A fixed tarball filename passed content-address validation.'
  } finally {
    if ([IO.Directory]::Exists($testRoot)) { [IO.Directory]::Delete($testRoot, $true) }
  }
  Write-Output 'mount-web-profile self-test: OK'
}

if ($SelfTest) {
  Invoke-SelfTest
  return
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $PSCommandPath) '..'))
$repositoryManifest = Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw | ConvertFrom-Json
Assert-True ($repositoryManifest.name -eq $PluginName) "This is not the $PluginName repository."
$repositoryPnpm = Get-PnpmVersion ([string]$repositoryManifest.packageManager)
$profileHome = if ($env:USERPROFILE) {
  [IO.Path]::GetFullPath($env:USERPROFILE)
} else {
  [Environment]::GetFolderPath('UserProfile')
}
$dshHome = if ($env:DSH_HOME) {
  [IO.Path]::GetFullPath($env:DSH_HOME)
} else {
  Join-Path $profileHome '.dsh'
}
$profileDirectory = [IO.Path]::GetFullPath((Join-Path $dshHome "profiles\$ProfileName"))
$profileManifestPath = Join-Path $profileDirectory 'package.json'
if (-not [IO.File]::Exists($profileManifestPath)) { throw "Missing web Profile: $profileDirectory" }
$modules = Read-ModulesMetadata (Join-Path $profileDirectory 'node_modules\.modules.yaml')
$profilePnpm = Get-PnpmVersion $modules.PackageManager
$corepack = Resolve-Corepack
$stableDirectory = Join-Path $profileDirectory "tarballs\$PluginName"

if ($CheckOnly) {
  $profileManifest = Get-Content -LiteralPath $profileManifestPath -Raw | ConvertFrom-Json
  $currentDependency = [string]$profileManifest.dependencies.$PluginName
  $currentTarball = Resolve-FileSpecifier $currentDependency $profileDirectory
  $installedManifestPath = Join-Path $profileDirectory "node_modules\$PluginName\package.json"
  $currentVersion = if ([IO.File]::Exists($installedManifestPath)) {
    [string](Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json).version
  } else {
    [string]$repositoryManifest.version
  }
  $repositoryVersionCheck = @{
    Corepack = $corepack
    Version = $repositoryPnpm
    Arguments = @('--version')
    WorkingDirectory = $repositoryRoot
    Capture = $true
  }
  $actualRepositoryPnpm = (Invoke-Pnpm @repositoryVersionCheck).Trim()
  Assert-True ($actualRepositoryPnpm -eq $repositoryPnpm) "Repository pnpm is $actualRepositoryPnpm, expected $repositoryPnpm."
  $checkShim = New-PnpmShim $corepack $profilePnpm
  try {
    $checkEnvironment = @{ PATH = "$checkShim$([IO.Path]::PathSeparator)$env:PATH" }
    $versionCheck = @{
      FilePath = 'pnpm'
      Arguments = @('--version')
      WorkingDirectory = $profileDirectory
      Environment = $checkEnvironment
      Capture = $true
    }
    $actualPnpm = (Invoke-External @versionCheck).Trim()
    Assert-True ($actualPnpm -eq $profilePnpm) "Profile pnpm is $actualPnpm, expected $profilePnpm."
    $storeCheck = @{
      FilePath = 'pnpm'
      Arguments = @('store', 'path')
      WorkingDirectory = $profileDirectory
      Environment = $checkEnvironment
      Capture = $true
    }
    $actualStore = (Invoke-External @storeCheck).Trim()
    Assert-True (Test-EqualPath $actualStore $modules.StoreDir) "Profile store mismatch: $actualStore."
    [ordered]@{
      repositoryPnpm = $actualRepositoryPnpm
      profilePnpm = $actualPnpm
      profileStore = $actualStore
      currentDependency = $currentDependency
      dependencyIsContentAddressed = Test-ContentAddressedTarball $currentTarball $stableDirectory $currentVersion
      dshReferenceVersion = $DshReferenceVersion
      corepack = $corepack
    } | ConvertTo-Json
  } finally {
    if ([IO.Directory]::Exists($checkShim)) { [IO.Directory]::Delete($checkShim, $true) }
  }
  return
}

$packageDirectory = $null
try {
  Write-Output "Building and packing with pnpm@$repositoryPnpm..."
  $repositoryEnvironment = @{ pnpm_config_verify_deps_before_run = 'false' }
  $buildParameters = @{
    Corepack = $corepack
    Version = $repositoryPnpm
    Arguments = @('run', 'build')
    WorkingDirectory = $repositoryRoot
    Environment = $repositoryEnvironment
  }
  Invoke-Pnpm @buildParameters
  # pnpm may reuse a same-version local tarball when its specifier path is unchanged.
  $packageDirectory = Join-Path ([IO.Path]::GetTempPath()) "dsh-tender-pack-$([guid]::NewGuid().ToString('N'))"
  [IO.Directory]::CreateDirectory($packageDirectory) | Out-Null
  $packParameters = @{
    Corepack = $corepack
    Version = $repositoryPnpm
    Arguments = @('--config.ignore-scripts=true', 'pack', '--json', '--pack-destination', $packageDirectory)
    WorkingDirectory = $repositoryRoot
    Environment = $repositoryEnvironment
    Capture = $true
  }
  $null = Invoke-Pnpm @packParameters
  $version = [string]$repositoryManifest.version
  $packageTarball = Join-Path $packageDirectory "$PluginName-$version.tgz"
  Assert-True ([IO.File]::Exists($packageTarball)) "Pack did not create $packageTarball."
  Assert-Tarball $packageTarball $repositoryRoot $version
  $sha256 = Get-Sha256 $packageTarball

  [IO.Directory]::CreateDirectory($stableDirectory) | Out-Null
  $lockDirectory = Join-Path $stableDirectory '.mount.lock'
  Enter-MountLock $lockDirectory
  $shimDirectory = $null
  try {
  $profileBefore = [IO.File]::ReadAllText($profileManifestPath)
  $profileBeforeHash = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($profileBefore))
  )
  $profileManifest = $profileBefore | ConvertFrom-Json
  $currentDependency = [string]$profileManifest.dependencies.$PluginName
  $installedManifestPath = Join-Path $profileDirectory "node_modules\$PluginName\package.json"
  if ([IO.File]::Exists($installedManifestPath)) {
    $installedVersion = [string](Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json).version
    $candidateSemVer = [System.Management.Automation.SemanticVersion]$version
    $installedSemVer = [System.Management.Automation.SemanticVersion]$installedVersion
    Assert-True ($candidateSemVer -ge $installedSemVer) "Refusing downgrade from $installedVersion to $version."
  }
  $listenerBefore = Get-WebListener
  Assert-DshListener $listenerBefore

  $contentName = Get-ContentAddressedName $PluginName $version $sha256
  $stableTarball = [IO.Path]::GetFullPath((Join-Path $stableDirectory $contentName))
  Assert-True (
    $stableTarball.StartsWith($stableDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
  ) 'Tarball escaped its stable directory.'
  if ([IO.File]::Exists($stableTarball)) {
    Assert-True ((Get-Sha256 $stableTarball) -eq $sha256) 'Existing content-addressed tarball differs.'
  } else {
    [IO.File]::Copy($packageTarball, $stableTarball, $false)
  }
  Assert-True (
    Test-ContentAddressedTarball $stableTarball $stableDirectory $version
  ) 'The DSH install candidate is not a verified content-addressed tarball.'

  $shimDirectory = New-PnpmShim $corepack $profilePnpm
  $pinnedEnvironment = @{ PATH = "$shimDirectory$([IO.Path]::PathSeparator)$env:PATH" }
  $versionCheck = @{
    FilePath = 'pnpm'
    Arguments = @('--version')
    WorkingDirectory = $profileDirectory
    Environment = $pinnedEnvironment
    Capture = $true
  }
  $actualPnpm = (Invoke-External @versionCheck).Trim()
  Assert-True ($actualPnpm -eq $profilePnpm) "DSH child pnpm is $actualPnpm, expected $profilePnpm."
  $storeCheck = @{
    FilePath = 'pnpm'
    Arguments = @('store', 'path')
    WorkingDirectory = $profileDirectory
    Environment = $pinnedEnvironment
    Capture = $true
  }
  $actualStore = (Invoke-External @storeCheck).Trim()
  Assert-True (Test-EqualPath $actualStore $modules.StoreDir) "Profile store mismatch: $actualStore."

  $currentTarball = Resolve-FileSpecifier $currentDependency $profileDirectory
  if ($currentTarball -and -not (Test-ContentAddressedTarball $currentTarball $stableDirectory $version)) {
    Write-Warning "Replacing non-content-addressed Profile dependency: $currentDependency"
  }
  $installedRoot = Join-Path $profileDirectory "node_modules\$PluginName"
  $alreadyMounted = $currentTarball -and (Test-EqualPath $currentTarball $stableTarball) -and
    [IO.File]::Exists((Join-Path $installedRoot 'lib\index.js')) -and
    (Get-Sha256 (Join-Path $repositoryRoot 'lib\index.js')) -eq (Get-Sha256 (Join-Path $installedRoot 'lib\index.js')) -and
    (Get-Sha256 (Join-Path $repositoryRoot 'lib\client.js')) -eq (Get-Sha256 (Join-Path $installedRoot 'lib\client.js'))

  $profileNowHash = [Convert]::ToHexString(
    [Security.Cryptography.SHA256]::HashData(
      [Text.Encoding]::UTF8.GetBytes([IO.File]::ReadAllText($profileManifestPath))
    )
  )
  Assert-True ($profileNowHash -eq $profileBeforeHash) 'Profile changed during preparation; refusing stale write.'

  if (-not $alreadyMounted) {
    Write-Output "Mounting $contentName with DSH $DshReferenceVersion and pnpm@$profilePnpm..."
    $installParameters = @{
      Corepack = $corepack
      Version = $profilePnpm
      Arguments = @(
        'dlx',
        "@deepseek-ai/dsh@$DshReferenceVersion",
        'plugin',
        '--profile',
        $ProfileName,
        'add',
        $stableTarball,
        '--reporter=append-only'
      )
      WorkingDirectory = $profileDirectory
      Environment = $pinnedEnvironment
    }
    Invoke-Pnpm @installParameters
  } else {
    Write-Output "Already mounted: $contentName"
  }

  $verifyParameters = @{
    ProfileDirectory = $profileDirectory
    Tarball = $stableTarball
    RepositoryRoot = $repositoryRoot
    Corepack = $corepack
    ProfilePnpm = $profilePnpm
    PinnedEnvironment = $pinnedEnvironment
    VerifyDump = -not $alreadyMounted
  }
  Assert-Installed @verifyParameters

  if ($listenerBefore -and $alreadyMounted) {
    Write-Output "DSH Web is already current on port $WebPort."
  } else {
    if ($listenerBefore) {
      Stop-Process -Id $listenerBefore.Pid
      Wait-Process -Id $listenerBefore.Pid -Timeout 15 -ErrorAction SilentlyContinue
    }
    $startParameters = @{
      Corepack = $corepack
      ProfilePnpm = $profilePnpm
      ProfileDirectory = $profileDirectory
      RepositoryRoot = $repositoryRoot
      PinnedEnvironment = $pinnedEnvironment
    }
    $listenerPid = Start-DshWeb @startParameters
    Write-Output "DSH Web ready: http://127.0.0.1:$WebPort/ (PID $listenerPid)"
  }

  [ordered]@{
    package = $contentName
    sha256 = $sha256
    repositoryPnpm = $repositoryPnpm
    profilePnpm = $profilePnpm
    store = $modules.StoreDir
    installed = -not $alreadyMounted
    url = "http://127.0.0.1:$WebPort/"
  } | ConvertTo-Json
  } finally {
    if ($shimDirectory -and [IO.Directory]::Exists($shimDirectory)) {
      [IO.Directory]::Delete($shimDirectory, $true)
    }
    Exit-MountLock $lockDirectory
  }
} finally {
  if ($packageDirectory -and [IO.Directory]::Exists($packageDirectory)) {
    [IO.Directory]::Delete($packageDirectory, $true)
  }
}
