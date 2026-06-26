#!/bin/bash
# ============================================================
#  維護記錄單績效評比系統 — 一鍵佈署 (Ubuntu / systemd)
#  自動安裝依賴、建立並啟動 systemd 服務、設定開機自啟。
#  用法:
#    ./deploy.sh                 # 預設 port 3000
#    PORT=8080 ./deploy.sh       # 自訂 port
# ============================================================
set -euo pipefail
export LANG=zh_TW.UTF-8

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SERVICE_NAME="performance-system"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
SERVICE_PORT="${PORT:-3000}"
SUDO_CMD=$([ "$EUID" -eq 0 ] && echo "" || echo "sudo")
SERVICE_USER=$([ "$EUID" -eq 0 ] && echo "root" || echo "$USER")

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     績效評比系統 — 一鍵佈署                                  ║"
echo "╚════════════════════════════════════════════════════════════╝"

# 1. 檢查 Node.js / npm
echo "[1/4] 檢查環境..."
command -v node >/dev/null 2>&1 || { echo "[錯誤] 未安裝 Node.js（需 18+）"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "[錯誤] 未安裝 npm"; exit 1; }
echo "      Node.js $(node -v) / npm $(npm -v) / 服務 port: $SERVICE_PORT"

# 2. 安裝依賴
echo "[2/4] 安裝依賴 (npm install)..."
if ! npm install; then
    echo "[錯誤] 依賴安裝失敗。若為 better-sqlite3 編譯問題，請先安裝編譯工具:"
    echo "       sudo apt-get install -y build-essential python3"
    exit 1
fi

# 確保資料目錄存在
mkdir -p db uploads

# 3. 建立 systemd 服務
echo "[3/4] 建立 systemd 服務..."
TMP_UNIT="$(mktemp)"
cat > "$TMP_UNIT" <<EOF
[Unit]
Description=維護記錄單績效評比系統
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SCRIPT_DIR
Environment="PORT=$SERVICE_PORT"
Environment="NODE_ENV=production"
ExecStart=$(command -v node) $SCRIPT_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
$SUDO_CMD cp "$TMP_UNIT" "$SERVICE_FILE"
rm -f "$TMP_UNIT"
$SUDO_CMD systemctl daemon-reload

# 4. 啟用並啟動
echo "[4/4] 啟用並啟動服務..."
$SUDO_CMD systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1 || true
$SUDO_CMD systemctl restart "${SERVICE_NAME}"
sleep 2

echo ""
if $SUDO_CMD systemctl is-active --quiet "${SERVICE_NAME}"; then
    echo "✅ 佈署完成！服務運行中: http://localhost:$SERVICE_PORT"
else
    echo "⚠️  服務未成功啟動，請查看日誌:"
    echo "    sudo journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
fi
echo ""
echo "常用指令:"
echo "  狀態: sudo systemctl status ${SERVICE_NAME}"
echo "  日誌: sudo journalctl -u ${SERVICE_NAME} -f"
echo "  更新: ./update.sh   | 備份: ./backup.sh   | 還原: ./restore.sh"
echo ""
echo "⚠️  預設管理員 admin / admin123，請登入後立即至「修改密碼」變更。"
