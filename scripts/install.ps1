# TeX Sync View を VS Code に導入する(Windows / PowerShell)。※ Windows 実機では未検証。
#   使い方: powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Vsix FILE] [-DryRun]
param([string]$Vsix = "", [switch]$DryRun)
$ErrorActionPreference = "Stop"
$ExtId = "fatcorn753.tex-sync-view"
$Root = Split-Path -Parent $PSScriptRoot
$BackupRoot = if ($env:TEXSYNC_BACKUP_DIR) { $env:TEXSYNC_BACKUP_DIR } else { Join-Path $HOME ".tex-sync-view-backup" }

function Find-Code {
  if ($env:CODE_BIN) { return $env:CODE_BIN }
  foreach ($n in "code.cmd", "code", "code-insiders.cmd", "codium.cmd") {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
  }
  foreach ($p in "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd", "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd") {
    if (Test-Path $p) { return $p }
  }
  throw "VS Code の CLI(code)が見つからない。CODE_BIN にパスを指定してください。"
}
$Code = Find-Code
$UserData = if ($env:CODE_USER_DIR) { $env:CODE_USER_DIR } else { Join-Path $env:APPDATA "Code" }
$CodeArgs = @()
if ($env:CODE_USER_DIR) { $CodeArgs += @("--user-data-dir", $env:CODE_USER_DIR) }
if ($env:CODE_EXT_DIR)  { $CodeArgs += @("--extensions-dir", $env:CODE_EXT_DIR) }
function Invoke-Code { & $Code @CodeArgs @args }
function Test-Installed { (Invoke-Code --list-extensions 2>$null) -contains $ExtId }

Write-Host "VS Code CLI : $Code"
Write-Host "設定フォルダ: $UserData\User"

if (-not $Vsix) {
  $found = Get-ChildItem -Path $Root -Filter "tex-sync-view-*.vsix" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($found) { $Vsix = $found.FullName }
}
if (-not $Vsix) {
  # .vsix は zip なので、ソースを集めて Compress-Archive で作る
  $ver = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("texsync-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Path "$tmp\extension" | Out-Null
  Copy-Item "$Root\package.json", "$Root\extension.js" -Destination "$tmp\extension"
  Copy-Item "$Root\media" -Destination "$tmp\extension" -Recurse
  Copy-Item "$Root\README.md", "$Root\LICENSE" -Destination "$tmp\extension" -ErrorAction SilentlyContinue
  Set-Content "$tmp\[Content_Types].xml" '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".mjs" ContentType="application/javascript"/><Default Extension=".css" ContentType="text/css"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension=".bcmap" ContentType="application/octet-stream"/><Default Extension=".pfb" ContentType="application/octet-stream"/><Default Extension=".ttf" ContentType="application/octet-stream"/><Default Extension="" ContentType="text/plain"/></Types>' -Encoding UTF8
  Set-Content "$tmp\extension.vsixmanifest" "<?xml version=`"1.0`" encoding=`"utf-8`"?><PackageManifest Version=`"2.0.0`" xmlns=`"http://schemas.microsoft.com/developer/vsx-schema/2011`"><Metadata><Identity Language=`"en-US`" Id=`"tex-sync-view`" Version=`"$ver`" Publisher=`"fatcorn753`"/><DisplayName>TeX Sync View</DisplayName><Description>TeX PDF preview with SyncTeX</Description></Metadata><Installation><InstallationTarget Id=`"Microsoft.VisualStudio.Code`"/></Installation><Dependencies/><Assets><Asset Type=`"Microsoft.VisualStudio.Code.Manifest`" Path=`"extension/package.json`" Addressable=`"true`"/></Assets></PackageManifest>" -Encoding UTF8
  $zip = Join-Path $Root "tex-sync-view-$ver.zip"
  $Vsix = Join-Path $Root "tex-sync-view-$ver.vsix"
  Compress-Archive -Path "$tmp\*" -DestinationPath $zip -Force
  Move-Item $zip $Vsix -Force
  Remove-Item $tmp -Recurse -Force
}
Write-Host "導入ファイル: $Vsix"

$already = Test-Installed
$hasLatest = Test-Path (Join-Path $BackupRoot "latest")
if ($already -and $hasLatest) {
  Write-Host "導入済みのため、既存のバックアップを維持する"
} elseif (-not $DryRun) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $bk = Join-Path $BackupRoot $stamp
  New-Item -ItemType Directory -Path $bk -Force | Out-Null
  $files = @()
  foreach ($f in "settings.json", "keybindings.json") {
    $src = Join-Path "$UserData\User" $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $bk $f); $files += $f }
  }
  Set-Content (Join-Path $bk "files.txt") $files
  if (Test-Path "$UserData\User\snippets") { Copy-Item "$UserData\User\snippets" (Join-Path $bk "snippets") -Recurse }
  Invoke-Code --list-extensions --show-versions 2>$null | Set-Content (Join-Path $bk "extensions.txt")
  Set-Content (Join-Path $BackupRoot "latest") $stamp
  Write-Host "バックアップ先: $bk"
}
if ($DryRun) { Write-Host "[dry-run] code --install-extension $Vsix --force"; Write-Host "dry-run 終了(何も変更していない)"; exit 0 }

Invoke-Code --install-extension $Vsix --force
if (-not (Test-Installed)) { throw "導入後の確認に失敗した(拡張が一覧に無い)" }
Write-Host ""
Write-Host "導入完了。VS Code で「Developer: Reload Window」を実行してください。"
Write-Host "元に戻す: powershell -ExecutionPolicy Bypass -File $PSScriptRoot\restore.ps1"
