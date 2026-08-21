# install.ps1 — global docks-kit install for Windows.
# Recommended invocation (download-then-run):
#   Invoke-WebRequest https://raw.githubusercontent.com/DocksDocks/public/main/install.ps1 -OutFile "$env:TEMP\docks-kit-install.ps1"
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\docks-kit-install.ps1"
#   Remove-Item "$env:TEMP\docks-kit-install.ps1"
# Installs Bun when absent, then `bun add -g docks-kit@latest` and copies the
# CLI + bun into %USERPROFILE%\.local\bin.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# BEGIN GENERATED BUN PIN
$BunPin = "1.4.0"
# END GENERATED BUN PIN

function Write-Ok([string]$Message) {
  [Console]::Error.WriteLine("[ok] $Message")
}

function Write-Warn([string]$Message) {
  [Console]::Error.WriteLine("[warn] $Message")
}

function Write-ErrorMessage([string]$Message) {
  [Console]::Error.WriteLine("[err] $Message")
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

function Copy-If-Distinct([string]$Source, [string]$Destination) {
  if ([IO.Path]::GetFullPath($Source) -ieq [IO.Path]::GetFullPath($Destination)) {
    return
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Test-PathEntry([string]$Entry) {
  $NormalizedEntry = [IO.Path]::GetFullPath($Entry).TrimEnd('\')
  foreach ($Candidate in ([string]$env:PATH -split ';')) {
    if ([string]::IsNullOrWhiteSpace($Candidate)) {
      continue
    }
    try {
      if ([IO.Path]::GetFullPath($Candidate).TrimEnd('\') -ieq $NormalizedEntry) {
        return $true
      }
    } catch {
      # Ignore malformed PATH entries and continue checking the usable ones.
    }
  }
  return $false
}

$Bun = Find-Bun
if ($null -eq $Bun) {
  Write-Warn 'Bun not found — installing (download-then-run)...'
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
    Write-ErrorMessage 'Bun install failed. Install manually: https://bun.sh'
    exit 1
  }
  $BunVersion = & $Bun --version 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$BunVersion)) {
    $BunVersion = 'version unknown'
  }
  Write-Ok "Bun installed ($([string]($BunVersion -join "`n")))"
}

Write-Ok 'Installing docks-kit via bun...'
& $Bun add -g docks-kit@latest
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$GlobalBinOutput = & $Bun pm -g bin 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-ErrorMessage 'Bun could not report its global binary directory.'
  exit 1
}
$GlobalBin = ([string]($GlobalBinOutput | Select-Object -First 1)).Trim()
if ([string]::IsNullOrWhiteSpace($GlobalBin)) {
  Write-ErrorMessage 'Bun could not report its global binary directory.'
  exit 1
}

$KitSource = @(
  (Join-Path $GlobalBin 'docks-kit.exe'),
  (Join-Path $GlobalBin 'docks-kit.cmd'),
  (Join-Path $GlobalBin 'docks-kit')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($null -eq $KitSource) {
  Write-ErrorMessage "The installed docks-kit binary was not found under '$GlobalBin'."
  exit 1
}

$InstallBin = Join-Path $env:USERPROFILE '.local\bin'
New-Item -ItemType Directory -Path $InstallBin -Force | Out-Null
Copy-If-Distinct $Bun (Join-Path $InstallBin 'bun.exe')
Copy-If-Distinct $KitSource (Join-Path $InstallBin (Split-Path -Leaf $KitSource))
Write-Ok 'docks-kit installed (copied into %USERPROFILE%\.local\bin)'

if (Test-PathEntry $InstallBin) {
  Write-Ok 'docks-kit ready'
  Write-Ok 'Next: docks-kit sync   (or docks-kit docs overview)'
} else {
  Write-Warn 'Add %USERPROFILE%\.local\bin to PATH before running docks-kit:'
  $EscapedInstallBin = $InstallBin.Replace("'", "''")
  [Console]::Error.WriteLine("[Environment]::SetEnvironmentVariable('Path', '$EscapedInstallBin;' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')")
}
