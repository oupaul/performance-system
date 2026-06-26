#!/bin/bash

# 設定文字編碼
export LANG=zh_TW.UTF-8

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     維護記錄單績效評比系統 - 安裝腳本                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 檢查 Node.js 是否已安裝
if ! command -v node &> /dev/null; then
    echo "[錯誤] 未偵測到 Node.js，請先安裝 Node.js 18 或更高版本"
    echo "安裝方式:"
    echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  或前往: https://nodejs.org/"
    exit 1
fi

echo "[1/5] 檢查 Node.js 版本..."
NODE_VERSION=$(node -v)
echo "目前 Node.js 版本: $NODE_VERSION"
echo ""

# 檢查 npm 是否已安裝
if ! command -v npm &> /dev/null; then
    echo "[錯誤] 未偵測到 npm，請先安裝 npm"
    exit 1
fi

# 取得當前目錄（原始專案位置）
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR=""

# 詢問安裝位置
echo "[2/5] 選擇安裝位置"
echo "1. 安裝到當前目錄: $SOURCE_DIR"
echo "2. 安裝到系統目錄: /opt/performance-system"
read -p "請選擇 (1 或 2，直接按 Enter 預設為 2): " INSTALL_CHOICE

if [ -z "$INSTALL_CHOICE" ] || [ "$INSTALL_CHOICE" = "2" ]; then
    INSTALL_DIR="/opt/performance-system"
    
    # 檢查是否為 root 或可使用 sudo
    if [ "$EUID" -eq 0 ]; then
        SUDO_CMD=""
    else
        if ! command -v sudo &> /dev/null; then
            echo "[錯誤] 需要 root 權限或 sudo 來安裝到 /opt 目錄"
            echo "請以 root 身份執行此腳本，或先安裝 sudo"
            exit 1
        fi
        SUDO_CMD="sudo"
    fi
    
    echo "將安裝到: $INSTALL_DIR"
    
    # 建立目標目錄
    $SUDO_CMD mkdir -p "$INSTALL_DIR"
    
    # 複製所有檔案（排除 node_modules 和特定檔案）
    echo "複製專案檔案到 $INSTALL_DIR..."
    $SUDO_CMD cp -r "$SOURCE_DIR"/* "$INSTALL_DIR"/ 2>/dev/null
    $SUDO_CMD cp -r "$SOURCE_DIR"/. "$INSTALL_DIR"/ 2>/dev/null 2>&1 | grep -v "cannot stat" || true
    
    # 確保目錄權限正確
    $SUDO_CMD chown -R $USER:$USER "$INSTALL_DIR" 2>/dev/null || true
    
    # 切換到安裝目錄
    cd "$INSTALL_DIR"
else
    INSTALL_DIR="$SOURCE_DIR"
    cd "$INSTALL_DIR"
    echo "使用當前目錄: $INSTALL_DIR"
fi

echo "安裝目錄: $INSTALL_DIR"
echo ""

# 設定預設端口
DEFAULT_PORT=3000

# 詢問是否要自訂端口
echo "[3/5] 設定服務端口"
read -p "請輸入服務端口 (直接按 Enter 使用預設 $DEFAULT_PORT): " CUSTOM_PORT

if [ -z "$CUSTOM_PORT" ]; then
    SERVICE_PORT=$DEFAULT_PORT
else
    SERVICE_PORT=$CUSTOM_PORT
fi

# 驗證端口是否為數字
if ! [[ "$SERVICE_PORT" =~ ^[0-9]+$ ]] || [ "$SERVICE_PORT" -lt 1 ] || [ "$SERVICE_PORT" -gt 65535 ]; then
    echo "[錯誤] 端口必須是 1-65535 之間的數字"
    exit 1
fi

echo "使用端口: $SERVICE_PORT"
echo ""

# 檢查是否需要安裝編譯工具 (better-sqlite3 需要)
echo "[4/5] 檢查系統依賴..."
if command -v gcc &> /dev/null && command -v python3 &> /dev/null; then
    echo "編譯工具已安裝"
else
    echo "[警告] 偵測到缺少編譯工具，better-sqlite3 可能需要編譯依賴"
    echo "建議執行: sudo apt-get install -y build-essential python3"
fi
echo ""

# 安裝依賴
echo "[5/5] 安裝專案依賴套件..."
npm install

if [ $? -ne 0 ]; then
    echo ""
    echo "[錯誤] 依賴安裝失敗，請檢查錯誤訊息"
    echo "如果 better-sqlite3 安裝失敗，請先安裝編譯工具:"
    echo "  sudo apt-get install -y build-essential python3"
    exit 1
fi

# 使用安裝目錄作為腳本目錄
SCRIPT_DIR="$INSTALL_DIR"
SERVICE_NAME="performance-system"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NODE_PATH=$(which node)
NPM_PATH=$(which npm)

# 確定是否需要 sudo
if [ "$EUID" -eq 0 ]; then
    SUDO_CMD=""
else
    SUDO_CMD="sudo"
fi

# 建立啟動腳本
echo ""
echo "建立啟動腳本 start.sh..."
cat > start.sh << EOF
#!/bin/bash
cd "$SCRIPT_DIR"
export PORT=$SERVICE_PORT
npm start
EOF
chmod +x start.sh

# 建立 systemd 服務檔案
echo ""
echo "建立 systemd 服務（需要 sudo 權限）..."

# 取得當前用戶（如果不是 root）
if [ "$EUID" -eq 0 ]; then
    SERVICE_USER="root"
else
    SERVICE_USER="$USER"
fi

# 建立服務檔案
cat > /tmp/${SERVICE_NAME}.service << EOF
[Unit]
Description=維護記錄單績效評比系統
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SCRIPT_DIR
Environment="PORT=$SERVICE_PORT"
Environment="NODE_ENV=production"
ExecStart=$NODE_PATH $SCRIPT_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# 安裝服務
if $SUDO_CMD cp /tmp/${SERVICE_NAME}.service $SERVICE_FILE 2>/dev/null; then
    $SUDO_CMD systemctl daemon-reload
    
    echo ""
    echo "開機自啟動服務已建立"
    echo ""
    read -p "是否要現在啟動服務並設定開機自啟動？(Y/N): " START_NOW
    
    if [ "$START_NOW" = "Y" ] || [ "$START_NOW" = "y" ]; then
        $SUDO_CMD systemctl enable ${SERVICE_NAME}.service
        $SUDO_CMD systemctl start ${SERVICE_NAME}.service
        echo "服務已啟動並設定為開機自啟動"
        
        # 等待一下讓服務啟動
        sleep 2
        
        # 檢查服務狀態
        if $SUDO_CMD systemctl is-active --quiet ${SERVICE_NAME}.service; then
            echo "✅ 服務運行中，可訪問: http://localhost:$SERVICE_PORT"
        else
            echo "⚠️  服務可能啟動失敗，請檢查日誌: sudo journalctl -u ${SERVICE_NAME} -n 50"
        fi
    else
        echo "服務已建立，但尚未啟動"
        echo "您可以稍後執行以下命令來啟動服務:"
        echo "  sudo systemctl start ${SERVICE_NAME}"
        echo "  sudo systemctl enable ${SERVICE_NAME}"
    fi
else
    echo "[警告] 無法建立 systemd 服務，可能需要 sudo 權限"
    echo "您可以手動建立服務檔案或使用 start.sh 啟動服務"
    echo ""
    echo "手動建立服務的步驟:"
    echo "  1. sudo cp /tmp/${SERVICE_NAME}.service $SERVICE_FILE"
    echo "  2. sudo systemctl daemon-reload"
    echo "  3. sudo systemctl enable ${SERVICE_NAME}"
    echo "  4. sudo systemctl start ${SERVICE_NAME}"
fi

# 清理暫存檔
rm -f /tmp/${SERVICE_NAME}.service

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    安裝完成！                               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "安裝目錄: $INSTALL_DIR"
echo "服務端口: $SERVICE_PORT"
echo "服務網址: http://localhost:$SERVICE_PORT"
echo ""
echo "服務管理命令:"
echo "  啟動服務: sudo systemctl start ${SERVICE_NAME}"
echo "  停止服務: sudo systemctl stop ${SERVICE_NAME}"
echo "  重啟服務: sudo systemctl restart ${SERVICE_NAME}"
echo "  查看狀態: sudo systemctl status ${SERVICE_NAME}"
echo "  查看日誌: sudo journalctl -u ${SERVICE_NAME} -f"
echo "  開機自啟: sudo systemctl enable ${SERVICE_NAME}"
echo "  取消自啟: sudo systemctl disable ${SERVICE_NAME}"
echo ""
echo "手動啟動方式:"
echo "  cd $INSTALL_DIR"
echo "  ./start.sh"
echo "  或: PORT=$SERVICE_PORT npm start"
echo ""
echo "資料目錄:"
echo "  資料庫: $INSTALL_DIR/db/"
echo "  上傳檔案: $INSTALL_DIR/uploads/"
echo ""


