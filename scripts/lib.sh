#!/bin/bash
# install.sh / restore.sh 共通の関数。単独では実行しない。

EXT_ID="fatcorn753.tex-sync-view"
BACKUP_ROOT="${TEXSYNC_BACKUP_DIR:-$HOME/.tex-sync-view-backup}"

say() { printf '%s\n' "$*"; }
die() { printf 'エラー: %s\n' "$*" >&2; exit 1; }

# VS Code の CLI を探す。環境変数 CODE_BIN で明示指定もできる。
find_code() {
  if [ -n "${CODE_BIN:-}" ]; then
    [ -x "$CODE_BIN" ] || die "CODE_BIN が実行できない: $CODE_BIN"
    return
  fi
  local c
  for c in code code-insiders codium; do
    if command -v "$c" >/dev/null 2>&1; then CODE_BIN="$(command -v "$c")"; return; fi
  done
  for c in \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders" \
    "/Applications/VSCodium.app/Contents/Resources/app/bin/codium" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/usr/share/code/bin/code" "/snap/bin/code" "/usr/local/bin/code"; do
    if [ -x "$c" ]; then CODE_BIN="$c"; return; fi
  done
  die "VS Code の CLI(code)が見つからない。VS Code のコマンドパレットで 'Shell Command: Install code command in PATH' を実行するか、CODE_BIN=/path/to/code を指定する。"
}

# 設定フォルダ(User/ の親)を決める。CODE_USER_DIR で差し替え可(試験・別プロファイル用)。
find_user_dir() {
  if [ -n "${CODE_USER_DIR:-}" ]; then USER_DATA="$CODE_USER_DIR"; return; fi
  local name="Code"
  case "$CODE_BIN" in
    *[Ii]nsiders*) name="Code - Insiders" ;;
    *codium*|*VSCodium*) name="VSCodium" ;;
  esac
  case "$(uname -s)" in
    Darwin) USER_DATA="$HOME/Library/Application Support/$name" ;;
    *)      USER_DATA="${XDG_CONFIG_HOME:-$HOME/.config}/$name" ;;
  esac
}

# code に渡す共通引数(隔離環境のときだけ入る)
code_cmd() {
  local a=()
  [ -n "${CODE_USER_DIR:-}" ] && a+=(--user-data-dir "$CODE_USER_DIR")
  [ -n "${CODE_EXT_DIR:-}" ] && a+=(--extensions-dir "$CODE_EXT_DIR")
  "$CODE_BIN" ${a[@]+"${a[@]}"} "$@"
}

is_installed() { code_cmd --list-extensions 2>/dev/null | grep -qix "$EXT_ID"; }
