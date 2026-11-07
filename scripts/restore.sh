#!/bin/bash
# TeX Sync View を元に戻す(macOS / Linux)。
#   使い方: scripts/restore.sh [--settings] [--backup DIR] [--dry-run]
#   既定      : 拡張をアンインストールするだけ(設定ファイルは触らない)
#   --settings: さらに settings.json / keybindings.json / snippets を導入前のバックアップへ戻す。
#               導入後に自分で行った設定変更も巻き戻るため、戻す直前の状態は退避コピーを残す。
# 環境変数: CODE_BIN / CODE_USER_DIR / CODE_EXT_DIR / TEXSYNC_BACKUP_DIR
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$HERE/lib.sh"

SETTINGS=0; DRY=0; BK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --settings) SETTINGS=1; shift ;;
    --backup) BK="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "不明な引数: $1" ;;
  esac
done
do_() { if [ $DRY = 1 ]; then say "[dry-run] $*"; else "$@"; fi; }

find_code
find_user_dir

say "1) 拡張 $EXT_ID をアンインストール"
if is_installed; then
  if [ $DRY = 1 ]; then say "[dry-run] code --uninstall-extension $EXT_ID"; else code_cmd --uninstall-extension "$EXT_ID" 2>&1 | grep -v -i "deprecat\|trace-deprecation" || true; fi
  [ $DRY = 1 ] || { is_installed && die "アンインストールできなかった"; }
else
  say "   未導入のためスキップ"
fi

if [ $SETTINGS = 0 ]; then
  say ""
  say "拡張を削除した。設定ファイルは変更していない。"
  say "設定ファイルも導入前へ戻す場合: $HERE/restore.sh --settings"
  say "VS Code で「Developer: Reload Window」を実行してください。"
  exit 0
fi

if [ -z "$BK" ]; then
  [ -f "$BACKUP_ROOT/latest" ] || die "バックアップが無い: $BACKUP_ROOT(install.sh を実行していない?)"
  BK="$BACKUP_ROOT/$(cat "$BACKUP_ROOT/latest")"
fi
[ -d "$BK" ] || die "バックアップが見つからない: $BK"
say "2) 設定を復元: $BK"
UD="$USER_DATA/User"
SAFE="$UD/.tex-sync-view-before-restore-$(date +%Y%m%d-%H%M%S)"
do_ mkdir -p "$UD" "$SAFE"
for f in settings.json keybindings.json; do
  if [ -f "$UD/$f" ]; then do_ cp -p "$UD/$f" "$SAFE/$f"; fi
  if grep -qx "$f" "$BK/files.txt" 2>/dev/null; then
    do_ cp -p "$BK/$f" "$UD/$f"; say "   $f を復元"
  elif [ -f "$UD/$f" ]; then
    do_ rm -f "$UD/$f"; say "   $f は導入前に無かったので削除(退避済み)"
  fi
done
if [ -d "$BK/snippets" ]; then
  do_ mkdir -p "$UD/snippets"; do_ cp -Rp "$BK/snippets/." "$UD/snippets/"; say "   snippets を復元"
fi

[ $DRY = 1 ] && { say "dry-run 終了(何も変更していない)"; exit 0; }
say ""
say "復元完了。戻す前の設定は退避してある: $SAFE"
say "VS Code で「Developer: Reload Window」を実行してください。"
