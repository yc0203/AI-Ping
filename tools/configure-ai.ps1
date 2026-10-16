param(
  [Parameter(Mandatory=$true)][ValidateSet('codex','api')][string]$Provider,
  [string]$ExePath,
  [string]$BaseUrl,
  [string]$Model,
  [ValidateSet('responses','chat')][string]$ApiMode = 'responses',
  [string]$CodexPath,
  [string]$CodexModel,
  [string]$Language,
  [switch]$PromptForKey,
  [switch]$UseEnvironmentKey,
  [switch]$NoApiKey
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSVersion.Major -ge 6) { throw 'This installer currently supports Windows only.' }
if (-not $ExePath) {
  foreach ($candidate in @((Join-Path $PSScriptRoot '..\AI-Ping.exe'), (Join-Path $PSScriptRoot '..\dist\win-unpacked\AI-Ping.exe'))) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $ExePath = $candidate; break }
  }
}
if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { throw 'AI-Ping.exe was not found. Set -ExePath to the installed executable.' }
$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
if ([IO.Path]::GetFileName($ExePath) -ne 'AI-Ping.exe') { throw 'Select the AI-Ping.exe executable.' }
$keyOptions = [int]$PromptForKey.IsPresent + [int]$UseEnvironmentKey.IsPresent + [int]$NoApiKey.IsPresent
if ($keyOptions -gt 1) { throw 'Choose only one key input method.' }
$request = @{ provider = $Provider }
foreach ($field in @('BaseUrl','Model','CodexPath','CodexModel','Language')) {
  $value = Get-Variable -Name $field -ValueOnly
  if ($value) { $request[$field.Substring(0,1).ToLowerInvariant()+$field.Substring(1)] = $value }
}
if ($Provider -eq 'api') {
  if (-not $BaseUrl -or -not $Model) { throw 'API setup requires -BaseUrl and -Model.' }
  $request.apiMode = $ApiMode
  if ($UseEnvironmentKey) {
    if (-not $env:AI_PING_API_KEY) { throw 'Set AI_PING_API_KEY in this process before using -UseEnvironmentKey.' }
    $request.key = $env:AI_PING_API_KEY
  } elseif ($NoApiKey) { $request.key = '' }
  else {
    $secret = Read-Host 'API key (hidden; not saved to shell history)' -AsSecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $request.key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer) }
    if (-not $request.key) { throw 'An API key is required. For an unauthenticated local service, use -NoApiKey.' }
  }
}
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $ExePath
$start.Arguments = '--configure-ai'
$start.WorkingDirectory = Split-Path -Parent $ExePath
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.StandardOutputEncoding = [System.Text.Encoding]::UTF8
$start.StandardErrorEncoding = [System.Text.Encoding]::UTF8
$start.EnvironmentVariables['AI_PING_SETUP_CONFIG'] = ($request | ConvertTo-Json -Compress)
$start.EnvironmentVariables.Remove('AI_PING_API_KEY')
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $start
try {
  $null = $process.Start()
  $output = $process.StandardOutput.ReadToEndAsync()
  $errors = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(90000)) { $process.Kill(); throw 'AI setup timed out.' }
  if ($process.ExitCode -ne 0) { throw ('AI setup failed: '+$errors.Result.Trim()) }
  Write-Output $output.Result.Trim()
} finally {
  $request.Remove('key')
  $start.EnvironmentVariables.Remove('AI_PING_SETUP_CONFIG')
  $process.Dispose()
}
