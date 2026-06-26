#!/bin/bash
# ============================================================
#  維護記錄單績效評比系統 — 一鍵備份
#  備份 db/（資料庫）與 uploads/（上傳檔）成 backups/backup_時間戳.tar.gz
#  用法: ./backup.sh
# ============================================================
set -euo pipefail
export LANG=zh_TW.UTF-8

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BACKUP_DIR="$SCRIPT_DIR/backups"
KEEP=10                                   # 保留最近幾份備份
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE="$BACKUP_DIR/backup_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     績效評比系統 — 備份                                      ║"
echo "╚════════════════════════════════════════════════════════════╝"

# 收集要備份的項目（存在才納入）
ITEMS=()
[ -d "$SCRIPT_DIR/db" ]      && ITEMS+=("db")
[ -d "$SCRIPT_DIR/uploads" ] && ITEMS+=("uploads")

if [ ${#ITEMS[@]} -eq 0 ]; then
    echo "[警告] 找不到 db/ 或 uploads/，沒有可備份的資料。"
    exit 1
fi

echo "[1/2] 打包資料: ${ITEMS[*]}"
tar -czf "$ARCHIVE" "${ITEMS[@]}"
echo "      → $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# 清理舊備份，只保留最近 $KEEP 份
echo "[2/2] 清理舊備份（保留最近 $KEEP 份）..."
ls -1t "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "      移除舊備份: $(basename "$old")"
    rm -f "$old"
done

echo ""
echo "✅ 備份完成: $ARCHIVE"
