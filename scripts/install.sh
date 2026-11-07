#!/bin/bash
# TeX Sync View を VS Code に導入する(macOS / Linux)。
#   使い方: scripts/install.sh [--vsix FILE] [--dry-run]
# 導入の前に、現在のユーザー設定をバックアップする。設定ファイルは書き換えない。
# 環境変数: CODE_BIN(code の場所) / CODE_USER_DIR / CODE_EXT_DIR(別プロファイル用) / TEXSYNC_BACKUP_DIR
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

VSIX=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --vsix) VSIX="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) die "不明な引数: $1" ;;
  esac
done

find_code
find_user_dir
say "VS Code CLI : $CODE_BIN"
say "設定フォルダ: $USER_DATA/User"

# 導入する .vsix を決める(指定 > リポジトリ直下の最新 > ソースからビルド)
if [ -z "$VSIX" ]; then
  VSIX="$(ls -t "$HERE"/../tex-sync-view-*.vsix 2>/dev/null | head -1 || true)"
fi
if [ -z "$VSIX" ]; then
  say "同梱の .vsix が無いのでソースからビルドする"
  [ $DRY = 1 ] && say "[dry-run] package.sh を実行" || VSIX="$("$HERE/package.sh")"
fi
[ $DRY = 1 ] || [ -f "$VSIX" ] || die ".vsix が見つからない: $VSIX"
say "導入ファイル: ${VSIX:-<ビルド予定>}"

# バックアップ
STAMP="$(date +%Y%m%d-%H%M%S)"
BK="$BACKUP_ROOT/$STAMP"
SKIP_BK=0
# 更新(導入済みへの再導入)では、導入前のバックアップを上書きしないよう新規作成しない
if is_installed && [ -f "$BACKUP_ROOT/latest" ]; then SKIP_BK=1; say "導入済みのため、既存のバックアップを維持する: $BACKUP_ROOT/$(cat "$BACKUP_ROOT/latest")"; else say "バックアップ先: $BK"; fi
if [ $DRY = 0 ] && [ $SKIP_BK = 0 ]; then
  mkdir -p "$BK"
  : > "$BK/files.txt"
  for f in settings.json keybindings.json; do
    if [ -f "$USER_DATA/User/$f" ]; then cp -p "$USER_DATA/User/$f" "$BK/$f"; echo "$f" >> "$BK/files.txt"; fi
  done
  if [ -d "$USER_DATA/User/snippets" ]; then cp -Rp "$USER_DATA/User/snippets" "$BK/snippets"; fi
  code_cmd --list-extensions --show-versions > "$BK/extensions.txt" 2>/dev/null || true
  printf 'USER_DATA=%s\nCODE_BIN=%s\n' "$USER_DATA" "$CODE_BIN" > "$BK/meta.env"
  printf '%s\n' "$STAMP" > "$BACKUP_ROOT/latest"
fi

# 導入
if [ $DRY = 1 ]; then
  say "[dry-run] $CODE_BIN --install-extension ${VSIX:-<ビルド予定>} --force"
  say "dry-run 終了(何も変更していない)"; exit 0
fi
code_cmd --install-extension "$VSIX" --force 2>&1 | grep -v -i "deprecat\|trace-deprecation" || true
is_installed || die "導入後の確認に失敗した(拡張が一覧に無い)。上のメッセージを確認してください。"

say ""
say "導入完了。VS Code で「Developer: Reload Window」を実行してください。"
say "元に戻す: $HERE/restore.sh"
say "設定ファイルまで戻す: $HERE/restore.sh --settings"
