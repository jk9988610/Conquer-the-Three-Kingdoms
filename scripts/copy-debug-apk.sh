#!/usr/bin/env bash
# 将 debug APK 复制到平板「下载」目录，供文件管理器安装
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
NAME="tcg-debug.apk"

if [[ ! -f "$SRC" ]]; then
  echo "未找到 APK，请先执行: npm run apk:debug"
  echo "期望路径: $SRC"
  exit 1
fi

copy_to() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  cp "$SRC" "$dest"
  echo "已复制 → $dest"
  ls -lh "$dest"
}

if [[ -d "$HOME/storage/shared/Download" ]]; then
  copy_to "$HOME/storage/shared/Download/$NAME"
  exit 0
fi

if [[ -d /sdcard/Download ]]; then
  copy_to "/sdcard/Download/$NAME"
  exit 0
fi

FALLBACK="$HOME/$NAME"
copy_to "$FALLBACK"
echo ""
echo "未检测到共享存储。请先单独执行 termux-setup-storage，提示时只输入 y 回车。"
echo "然后重新运行: npm run apk:copy"
echo "当前 APK 已在: $FALLBACK（可用文件管理器从 Termux 主目录查找）"
