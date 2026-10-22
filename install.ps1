# install.ps1 - global docks-kit install for Windows.
# Recommended invocation (download-then-run):
#   Invoke-WebRequest https://raw.githubusercontent.com/DocksDocks/public/main/install.ps1 -OutFile "$env:TEMP\docks-kit-install.ps1"
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\docks-kit-install.ps1"
#   Remove-Item "$env:TEMP\docks-kit-install.ps1"
# Installs Bun when absent, then runs `bun add -g docks-kit@latest`. The CLI
# stays in Bun's global bin directory (%USERPROFILE%\.bun\bin by default).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# BEGIN GENERATED BUN PIN
$BunPin = "1.4.4"
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

function Test-SameFile([string]$First, [string]$Second) {
  return [IO.Path]::GetFullPath($First) -ieq [IO.Path]::GetFullPath($Second)
}

function Test-SameDirectory([string]$First, [string]$Second) {
  $FirstPath = [IO.Path]::GetFullPath($First).TrimEnd('\')
  $SecondPath = [IO.Path]::GetFullPath($Second).TrimEnd('\')
  return $FirstPath -ieq $SecondPath
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
  Write-Warn 'Bun not found - installing (download-then-run)...'
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

# Windows PowerShell 5.1 turns redirected native stderr lines into errors,
# and the 'Stop' preference makes them terminate the script. The exit code
# decides success, so scope a 'Continue' preference to each native call.
$PreviousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  $GlobalBinOutput = & $Bun pm -g bin 2>$null
  $GlobalBinExit = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $PreviousPreference
}
if ($GlobalBinExit -ne 0) {
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

# Bun links the CLI as a shim docks-kit.exe plus a docks-kit.bunx metadata
# file. The shim reads the .bunx file next to itself, so a copy of the shim in
# another directory cannot run. Earlier installs made such a copy. Remove the
# copy only when it is identical to the current shim.
$InstallBin = Join-Path $env:USERPROFILE '.local\bin'
$StaleShim = Join-Path $InstallBin 'docks-kit.exe'
$BunShim = Join-Path $GlobalBin 'docks-kit.exe'
if (-not (Test-SameFile $StaleShim $BunShim) -and
    (Test-Path -LiteralPath $StaleShim -PathType Leaf) -and
    (Test-Path -LiteralPath $BunShim -PathType Leaf) -and
    -not (Test-Path -LiteralPath (Join-Path $InstallBin 'docks-kit.bunx') -PathType Leaf) -and
    (Get-FileHash -LiteralPath $StaleShim).Hash -eq (Get-FileHash -LiteralPath $BunShim).Hash) {
  Remove-Item -LiteralPath $StaleShim -Force
  Write-Warn "Removed the unusable docks-kit.exe copy from '$InstallBin'."
}

$PreviousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
  & $KitSource --version *> $null
  $KitExit = $LASTEXITCODE
} catch {
  $KitExit = 1
} finally {
  $ErrorActionPreference = $PreviousPreference
}
if ($KitExit -ne 0) {
  Write-ErrorMessage "The installed docks-kit command '$KitSource' did not run."
  exit 1
}
Write-Ok "docks-kit installed in '$GlobalBin'"

# Another docks-kit executable earlier on PATH can shadow Bun's shim. The
# installer cannot identify such a file, so it names the file and stops.
$ResolvedKit = Get-Command docks-kit -CommandType Application, ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
$ShadowKit = $null
if ($null -ne $ResolvedKit -and -not (Test-SameDirectory (Split-Path -Parent $ResolvedKit.Source) $GlobalBin)) {
  $ShadowKit = $ResolvedKit.Source
}

$GlobalBinOnPath = Test-PathEntry $GlobalBin
if (-not $GlobalBinOnPath) {
  Write-Warn "Add '$GlobalBin' to PATH before running docks-kit:"
  $EscapedGlobalBin = $GlobalBin.Replace("'", "''")
  [Console]::Error.WriteLine("[Environment]::SetEnvironmentVariable('Path', '$EscapedGlobalBin;' + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')")
}

if ($null -ne $ShadowKit) {
  Write-Warn "The docks-kit command on PATH runs '$ShadowKit' instead of '$KitSource'."
  Write-Warn 'Remove that file with this command, then run docks-kit sync:'
  $EscapedShadowKit = $ShadowKit.Replace("'", "''")
  [Console]::Error.WriteLine("Remove-Item -LiteralPath '$EscapedShadowKit'")
  exit 1
}

if ($GlobalBinOnPath) {
  Write-Ok 'docks-kit ready'
  Write-Ok 'Next: docks-kit sync   (or docks-kit docs overview)'
}
