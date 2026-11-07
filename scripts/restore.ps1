# TeX Sync View を元に戻す(Windows / PowerShell)。※ Windows 実機では未検証。
#   使い方: powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 [-Settings] [-Backup DIR] [-DryRun]
#   既定      : 拡張をアンインストールするだけ(設定ファイルは触らない)
#   -Settings : さらに settings.json / keybindings.json / snippets を導入前のバックアップへ戻す(戻す前の状態は退避)
param([switch]$Settings, [string]$Backup = "", [switch]$DryRun)
$ErrorActionPreference = "Stop"
$ExtId = "fatcorn753.tex-sync-view"
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

Write-Host "1) 拡張 $ExtId をアンインストール"
if (Test-Installed) {
  if ($DryRun) { Write-Host "[dry-run] code --uninstall-extension $ExtId" }
  else { Invoke-Code --uninstall-extension $ExtId; if (Test-Installed) { throw "アンインストールできなかった" } }
} else { Write-Host "   未導入のためスキップ" }

if (-not $Settings) {
  Write-Host ""
  Write-Host "拡張を削除した。設定ファイルは変更していない。"
  Write-Host "設定ファイルも導入前へ戻す場合: restore.ps1 -Settings"
  Write-Host "VS Code で「Developer: Reload Window」を実行してください。"
  exit 0
}

if (-not $Backup) {
  $latest = Join-Path $BackupRoot "latest"
  if (-not (Test-Path $latest)) { throw "バックアップが無い: $BackupRoot(install.ps1 を実行していない?)" }
  $Backup = Join-Path $BackupRoot ((Get-Content $latest -Raw).Trim())
}
if (-not (Test-Path $Backup)) { throw "バックアップが見つからない: $Backup" }
Write-Host "2) 設定を復元: $Backup"
$ud = Join-Path $UserData "User"
$safe = Join-Path $ud (".tex-sync-view-before-restore-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$saved = if (Test-Path (Join-Path $Backup "files.txt")) { Get-Content (Join-Path $Backup "files.txt") } else { @() }
if (-not $DryRun) { New-Item -ItemType Directory -Path $safe -Force | Out-Null }
foreach ($f in "settings.json", "keybindings.json") {
  $cur = Join-Path $ud $f
  if ((Test-Path $cur) -and -not $DryRun) { Copy-Item $cur (Join-Path $safe $f) }
  if ($saved -contains $f) {
    if ($DryRun) { Write-Host "[dry-run] $f を復元" } else { Copy-Item (Join-Path $Backup $f) $cur -Force; Write-Host "   $f を復元" }
  } elseif (Test-Path $cur) {
    if ($DryRun) { Write-Host "[dry-run] $f を削除" } else { Remove-Item $cur -Force; Write-Host "   $f は導入前に無かったので削除(退避済み)" }
  }
}
if (Test-Path (Join-Path $Backup "snippets")) {
  if ($DryRun) { Write-Host "[dry-run] snippets を復元" }
  else { New-Item -ItemType Directory -Path "$ud\snippets" -Force | Out-Null; Copy-Item "$Backup\snippets\*" "$ud\snippets" -Recurse -Force; Write-Host "   snippets を復元" }
}
if ($DryRun) { Write-Host "dry-run 終了(何も変更していない)"; exit 0 }
Write-Host ""
Write-Host "復元完了。戻す前の設定は退避してある: $safe"
Write-Host "VS Code で「Developer: Reload Window」を実行してください。"
