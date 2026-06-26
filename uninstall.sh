#!/bin/bash

# 設定文字編碼
export LANG=zh_TW.UTF-8

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     維護記錄單績效評比系統 - 移除腳本                        ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# 取得當前目錄
CURRENT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_NAME="performance-system"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# 檢查可能的安裝位置（優先檢查 /opt）
INSTALL_DIR=""
if [ -f "/opt/performance-system/server.js" ]; then
    INSTALL_DIR="/opt/performance-system"
    echo "偵測到系統安裝目錄: $INSTALL_DIR"
elif [ -f "$CURRENT_DIR/server.js" ]; then
    INSTALL_DIR="$CURRENT_DIR"
    echo "偵測到當前目錄安裝: $INSTALL_DIR"
else
    echo "[錯誤] 未找到安裝目錄"
    echo "請確認系統是否已安裝，或從安裝目錄執行此腳本"
    exit 1
fi

# 判斷是否為系統目錄
IS_SYSTEM_DIR=false
if [ "$INSTALL_DIR" = "/opt/performance-system" ]; then
    IS_SYSTEM_DIR=true
fi

# 確定是否需要 sudo
if [ "$EUID" -eq 0 ]; then
    SUDO_CMD=""
else
    SUDO_CMD="sudo"
fi

echo ""
echo "[警告] 此操作將移除以下內容:"
echo "  - node_modules/ 目錄 (依賴套件)"
echo "  - package-lock.json"
echo "  - start.sh (啟動腳本)"
if [ -f "$SERVICE_FILE" ]; then
    echo "  - systemd 服務 ($SERVICE_NAME)"
fi

if [ "$IS_SYSTEM_DIR" = true ]; then
    echo ""
    echo "[注意] 偵測到系統目錄安裝 (/opt/performance-system)"
    read -p "是否要完全移除整個安裝目錄（包括所有資料）？(Y/N): " REMOVE_ALL
    if [ "$REMOVE_ALL" = "Y" ] || [ "$REMOVE_ALL" = "y" ]; then
        REMOVE_DIRECTORY=true
    else
        REMOVE_DIRECTORY=false
        echo ""
        echo "[注意] 以下資料將被保留:"
        echo "  - db/ 目錄 (資料庫檔案)"
        echo "  - uploads/ 目錄 (上傳檔案)"
        echo "  - public/ 目錄 (前端檔案)"
        echo "  - server.js 及其他原始碼檔案"
    fi
else
    REMOVE_DIRECTORY=false
    echo ""
    echo "[注意] 以下資料將被保留:"
    echo "  - db/ 目錄 (資料庫檔案)"
    echo "  - uploads/ 目錄 (上傳檔案)"
    echo "  - public/ 目錄 (前端檔案)"
    echo "  - server.js 及其他原始碼檔案"
fi

echo ""
read -p "確定要繼續嗎？(Y/N): " CONFIRM

if [ "$CONFIRM" != "Y" ] && [ "$CONFIRM" != "y" ]; then
    echo "操作已取消"
    exit 0
fi

# 建立備份
echo ""
echo "[備份] 建立資料備份..."
BACKUP_DIR="$HOME/performance-system-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# 備份資料庫
if [ -d "$INSTALL_DIR/db" ]; then
    echo "  備份資料庫目錄..."
    cp -r "$INSTALL_DIR/db" "$BACKUP_DIR/" 2>/dev/null || $SUDO_CMD cp -r "$INSTALL_DIR/db" "$BACKUP_DIR/"
fi

# 備份上傳檔案
if [ -d "$INSTALL_DIR/uploads" ]; then
    echo "  備份上傳檔案目錄..."
    cp -r "$INSTALL_DIR/uploads" "$BACKUP_DIR/" 2>/dev/null || $SUDO_CMD cp -r "$INSTALL_DIR/uploads" "$BACKUP_DIR/"
fi

# 如果完全移除，也備份原始碼
if [ "$REMOVE_DIRECTORY" = true ]; then
    echo "  備份原始碼檔案..."
    # 只備份重要的原始碼檔案
    for file in server.js package.json README.md; do
        if [ -f "$INSTALL_DIR/$file" ]; then
            cp "$INSTALL_DIR/$file" "$BACKUP_DIR/" 2>/dev/null || $SUDO_CMD cp "$INSTALL_DIR/$file" "$BACKUP_DIR/"
        fi
    done
    # 備份 public 目錄
    if [ -d "$INSTALL_DIR/public" ]; then
        cp -r "$INSTALL_DIR/public" "$BACKUP_DIR/" 2>/dev/null || $SUDO_CMD cp -r "$INSTALL_DIR/public" "$BACKUP_DIR/"
    fi
fi

echo "  備份完成: $BACKUP_DIR"
echo ""

# 切換到安裝目錄
cd "$INSTALL_DIR"

# 停止服務
if [ -f "$SERVICE_FILE" ]; then
    echo "[1/5] 停止 systemd 服務..."
    $SUDO_CMD systemctl stop ${SERVICE_NAME}.service 2>/dev/null
    echo "服務已停止"
fi

echo ""
echo "[2/5] 移除 node_modules 目錄..."
if [ -d "$INSTALL_DIR/node_modules" ]; then
    if [ "$IS_SYSTEM_DIR" = true ]; then
        $SUDO_CMD rm -rf "$INSTALL_DIR/node_modules"
    else
        rm -rf "$INSTALL_DIR/node_modules"
    fi
    echo "node_modules 已移除"
else
    echo "node_modules 目錄不存在，略過"
fi

echo ""
echo "[3/5] 移除 package-lock.json 和啟動腳本..."
if [ -f "$INSTALL_DIR/package-lock.json" ]; then
    if [ "$IS_SYSTEM_DIR" = true ]; then
        $SUDO_CMD rm -f "$INSTALL_DIR/package-lock.json"
    else
        rm -f "$INSTALL_DIR/package-lock.json"
    fi
    echo "package-lock.json 已移除"
fi

if [ -f "$INSTALL_DIR/start.sh" ]; then
    if [ "$IS_SYSTEM_DIR" = true ]; then
        $SUDO_CMD rm -f "$INSTALL_DIR/start.sh"
    else
        rm -f "$INSTALL_DIR/start.sh"
    fi
    echo "start.sh 已移除"
fi

echo ""
echo "[4/5] 移除 systemd 服務..."
if [ -f "$SERVICE_FILE" ]; then
    $SUDO_CMD systemctl disable ${SERVICE_NAME}.service 2>/dev/null
    $SUDO_CMD systemctl daemon-reload 2>/dev/null
    
    if $SUDO_CMD rm -f "$SERVICE_FILE" 2>/dev/null; then
        echo "systemd 服務已移除"
    else
        echo "[警告] 無法移除 systemd 服務，可能需要管理員權限"
        echo "請手動執行: sudo rm -f $SERVICE_FILE"
    fi
else
    echo "systemd 服務不存在，略過"
fi

# 如果選擇完全移除目錄
if [ "$REMOVE_DIRECTORY" = true ]; then
    echo ""
    echo "[5/5] 移除安裝目錄..."
    $SUDO_CMD rm -rf "$INSTALL_DIR"
    echo "安裝目錄 $INSTALL_DIR 已完全移除"
else
    echo ""
    echo "[5/5] 保留安裝目錄: $INSTALL_DIR"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    移除完成！                               ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
if [ "$REMOVE_DIRECTORY" = true ]; then
    echo "系統已完全移除。"
else
    echo "依賴套件、啟動腳本和系統服務已移除，但原始碼和資料已保留。"
fi
echo ""
echo "📦 備份位置: $BACKUP_DIR"
echo "   包含: db/ 資料庫檔案、uploads/ 上傳檔案"
if [ "$REMOVE_DIRECTORY" = true ]; then
    echo "   以及: server.js、package.json、public/ 等原始碼檔案"
fi
echo ""
echo "若要重新安裝，請執行: ./install.sh"
echo ""


