#!/bin/sh
# 备份 Obsidian 关键配置（防 iCloud 同步清空 community-plugins.json 这类事故）
# 用法：sh scripts/backup-obsidian-config.sh [vault路径]
# 建议挂在每日定时任务或每次迭代后顺手跑。
VAULT="${1:-$HOME/Vaults/main}"
DEST="$(dirname "$0")/obsidian-config-snapshot"
mkdir -p "$DEST"
for f in community-plugins.json app.json appearance.json core-plugins.json hotkeys.json daily-notes.json; do
  [ -f "$VAULT/.obsidian/$f" ] && cp "$VAULT/.obsidian/$f" "$DEST/$f"
done
echo "snapshot -> $DEST ($(date '+%F %T'))"
ls "$DEST"
