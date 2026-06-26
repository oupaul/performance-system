#!/bin/bash
# ============================================================
#  維護記錄單績效評比系統 — 一鍵還原
#  從 backups/ 中選擇一份備份還原 db/ 與 uploads/
#  用法:
#    ./restore.sh                       # 還原最新一份備份
#    ./restore.sh backups/backup_xxx.tar.gz   # 還原指定備份
# ============================================================
set -euo pipefail
export LANG=zh_TW.UTF-8

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BACKUP_DIR="$SCRIPT_DIR/backups"
SERVICE_NAME="performance-system"
SUDO_CMD=$([ "$EUID" -eq 0 ] && echo "" || echo "sudo")

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     績效評比系統 — 還原                                      ║"
echo "╚════════════════════════════════════════════════════════════╝"

# 決定要還原的備份檔
ARCHIVE="${1:-}"
if [ -z "$ARCHIVE" ]; then
    ARCHIVE=$(ls -1t "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null | head -n 1 || true)
    if [ -z "$ARCHIVE" ]; then
        echo "[錯誤] backups/ 中找不到任何備份檔。"
        exit 1
    fi
    echo "未指定備份檔，將使用最新一份:"
fi

if [ ! -f "$ARCHIVE" ]; then
    echo "[錯誤] 找不到備份檔: $ARCHIVE"
    echo "可用的備份:"
    ls -1t "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null || echo "  (無)"
    exit 1
fi

echo "  將還原: $ARCHIVE"
echo ""
read -p "⚠️  這會覆蓋目前的 db/ 與 uploads/，確定要繼續？(yes/N): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "已取消。"
    exit 0
fi

# 還原前先把現有資料另存安全備份，避免誤操作無法回復
if [ -d db ] || [ -d uploads ]; then
    SAFETY="$BACKUP_DIR/pre-restore_$(date +%Y%m%d_%H%M%S).tar.gz"
    mkdir -p "$BACKUP_DIR"
    SAFE_ITEMS=()
    [ -d db ] && SAFE_ITEMS+=("db")
    [ -d uploads ] && SAFE_ITEMS+=("uploads")
    tar -czf "$SAFETY" "${SAFE_ITEMS[@]}"
    echo "[1/3] 已將現有資料另存: $SAFETY"
fi

# 若服務正在執行，先停止
if command -v systemctl &>/dev/null && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    echo "[2/3] 停止服務 ${SERVICE_NAME}..."
    $SUDO_CMD systemctl stop "${SERVICE_NAME}" || true
fi

echo "[3/3] 解壓還原..."
tar -xzf "$ARCHIVE" -C "$SCRIPT_DIR"

# 重新啟動服務（若有）
if command -v systemctl &>/dev/null && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    $SUDO_CMD systemctl start "${SERVICE_NAME}" || true
    echo "      服務已重新啟動。"
fi

echo ""
echo "✅ 還原完成（來源: $(basename "$ARCHIVE")）"
