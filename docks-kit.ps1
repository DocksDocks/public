# docks-kit.ps1 — Windows launcher. Resolution order:
#   1. version-matching compiled binary in cli/dist/ (bun build --compile output)
#   2. Bun from source (auto-installs Bun + node_modules when missing)
# No-Bun recovery path: download a release binary for your platform.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# BEGIN GENERATED BUN PIN
$BunPin = "1.3.14"
# END GENERATED BUN PIN

$ProcessorArchitecture = if (-not [string]::IsNullOrWhiteSpace($env:PROCESSOR_ARCHITEW6432)) {
  $env:PROCESSOR_ARCHITEW6432
} else {
  $env:PROCESSOR_ARCHITECTURE
}
if ([string]::IsNullOrWhiteSpace($ProcessorArchitecture)) {
  $ProcessorArchitecture = '<unknown>'
}
$KitBin = switch ($ProcessorArchitecture) {
  'AMD64' { 'docks-kit-windows-x64.exe' }
  'ARM64' { 'docks-kit-windows-arm64.exe' }
  default {
    $HostName = "Windows-$ProcessorArchitecture"
    [Console]::Error.WriteLine("[docks-kit] unsupported host $HostName; docks-kit supports Linux, macOS, and Windows on x64 or arm64.")
    exit 1
  }
}

$KitPath = Join-Path (Join-Path $RepoDir 'cli\dist') $KitBin
if (Test-Path -LiteralPath $KitPath -PathType Leaf) {
  $CheckoutVersion = ''
  try {
    $Manifest = Get-Content -LiteralPath (Join-Path $RepoDir 'package.json') -Raw | ConvertFrom-Json
    if ($Manifest.version -is [string]) {
      $CheckoutVersion = $Manifest.version
    }
  } catch {
    $CheckoutVersion = ''
  }

  $BinVersion = ''
  try {
    $BinOutput = & $KitPath --version 2>$null
    if ($LASTEXITCODE -eq 0) {
      $BinVersion = ([string]($BinOutput -join "`n")).TrimEnd("`r")
    }
  } catch {
    $BinVersion = ''
  }

  if (-not [string]::IsNullOrEmpty($CheckoutVersion) -and $BinVersion -eq $CheckoutVersion) {
    & $KitPath @args
    exit $LASTEXITCODE
  }

  $DisplayedBinVersion = if ([string]::IsNullOrEmpty($BinVersion)) { '<unknown>' } else { $BinVersion }
  $DisplayedCheckoutVersion = if ([string]::IsNullOrEmpty($CheckoutVersion)) { '<unknown>' } else { $CheckoutVersion }
  [Console]::Error.WriteLine("[docks-kit] ignoring stale cli/dist/$KitBin $DisplayedBinVersion; checkout is $DisplayedCheckoutVersion — running from source")
}

function Find-Bun {
  $Command = Get-Command bun -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $Command) {
    return $Command.Source
  }

  $Candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($env:BUN_INSTALL)) {
    $Candidates += Join-Path $env:BUN_INSTALL 'bin\bun.exe'
  }
  if (-not [string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    $Candidates += Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
  }
  foreach ($Candidate in $Candidates) {
    if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
      return $Candidate
    }
  }
  return $null
}

$Bun = Find-Bun
if ($null -eq $Bun) {
  [Console]::Error.WriteLine('[docks-kit] Bun not found — installing (download-then-run)...')
  $TempInstaller = Join-Path ([IO.Path]::GetTempPath()) "bun-install-$([Guid]::NewGuid().ToString('N')).ps1"
  try {
    Invoke-WebRequest -Uri 'https://bun.sh/install.ps1' -OutFile $TempInstaller -UseBasicParsing
    # A downloaded .ps1 carries a Mark-of-the-Web, so calling it directly is
    # blocked under the default RemoteSigned policy. Use the invocation form
    # upstream documents, matching os/windows.ts bunInstaller.
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $TempInstaller -Version $BunPin *> $null
  } catch {
    # The recovery guidance below is shared by download and installer failures.
  } finally {
    Remove-Item -LiteralPath $TempInstaller -Force -ErrorAction SilentlyContinue
  }
  $Bun = Find-Bun
  if ($null -eq $Bun) {
    [Console]::Error.WriteLine('[docks-kit] Bun install failed. Download a docks-kit release binary for a no-Bun recovery path.')
    exit 1
  }
}

# Sentinel is a real dependency dir, not bare node_modules\ — a failed or
# partial install leaves node_modules\ present and would suppress the repair.
if (-not (Test-Path -LiteralPath (Join-Path $RepoDir 'node_modules\effect') -PathType Container)) {
  [Console]::Error.WriteLine('[docks-kit] Installing CLI dependencies (bun install --frozen-lockfile)...')
  Push-Location $RepoDir
  try {
    & $Bun install --frozen-lockfile *> $null
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  } finally {
    Pop-Location
  }
}

& $Bun (Join-Path $RepoDir 'cli\src\main.ts') @args
exit $LASTEXITCODE
