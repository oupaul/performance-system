#!/bin/bash
# ============================================================
#  維護記錄單績效評比系統 — 一鍵更新
#  流程: 自動備份 → git pull → npm install → 重啟服務
#  用法: ./update.sh
# ============================================================
set -euo pipefail
export LANG=zh_TW.UTF-8

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SERVICE_NAME="performance-system"
SUDO_CMD=$([ "$EUID" -eq 0 ] && echo "" || echo "sudo")

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     績效評比系統 — 一鍵更新                                  ║"
echo "╚════════════════════════════════════════════════════════════╝"

# 0. 確認是 git 專案
if [ ! -d .git ]; then
    echo "[錯誤] 此目錄不是 git 專案，無法 git pull 更新。"
    echo "       請改用 git clone 部署，或手動更新檔案。"
    exit 1
fi

# 1. 更新前先備份資料
echo "[1/4] 更新前自動備份資料..."
if [ -x ./backup.sh ]; then
    ./backup.sh || echo "      [警告] 備份失敗，仍繼續更新。"
else
    echo "      [略過] 找不到 backup.sh"
fi

# 2. 拉取最新程式碼
echo "[2/4] 拉取最新程式碼 (git pull)..."
git pull --ff-only

# 3. 更新依賴
echo "[3/4] 更新依賴 (npm install)..."
npm install

# 4. 重啟服務
echo "[4/4] 重啟服務..."
if command -v systemctl &>/dev/null && systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
    $SUDO_CMD systemctl restart "${SERVICE_NAME}"
    sleep 2
    if $SUDO_CMD systemctl is-active --quiet "${SERVICE_NAME}"; then
        echo ""
        echo "✅ 更新完成，服務運行中。"
    else
        echo ""
        echo "⚠️  服務重啟後未運行，請查看: sudo journalctl -u ${SERVICE_NAME} -n 50"
        exit 1
    fi
else
    echo "      未偵測到 systemd 服務，請手動重啟 (npm start)。"
    echo ""
    echo "✅ 程式碼與依賴已更新。"
fi
