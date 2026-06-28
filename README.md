# 維護記錄單績效評比系統

多因子複雜度評分的績效評比系統，支援權重調整、關鍵字管理、Excel 報表匯出。

## 系統需求

- Ubuntu 24.04
- Node.js 18+
- npm

## 安裝步驟

### 1. 安裝 Node.js (如尚未安裝)

```bash
# 使用 NodeSource 安裝 Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 驗證安裝
node -v
npm -v
```

### 2. 安裝 better-sqlite3 編譯依賴

```bash
sudo apt-get install -y build-essential python3
```

### 3. 安裝專案依賴

```bash
cd performance-system
npm install
```

### 4. 啟動系統

```bash
npm start
```

### 5. 開啟瀏覽器

```
http://localhost:3000
```

## 功能說明

### 📤 上傳資料
- 支援 .xlsx, .xls 格式
- 自動解析欄位並計算複雜度
- 保留歷史批次紀錄

### 📈 績效結果
- 多維度績效評分
- 獎金分配建議
- 與純工單數分配的差異比較

### 📋 工單明細
- 每筆工單的複雜度分數
- 匹配的技術關鍵字
- 依複雜度排序

### ⚙️ 權重設定
- 7 個可調整的指標權重
- 即時重新計算績效

### 🏷️ 關鍵字管理
- 高/中/低專業度關鍵字
- 新增/刪除關鍵字

## 預設權重配置 (V3)

| 指標 | 權重 |
|-----|-----|
| 平均案件複雜度 | 35% |
| 工單完成數 | 15% |
| 高複雜度案件數 | 15% |
| 總服務工時 | 15% |
| 非例行工作比例 | 10% |
| 服務多樣性 | 5% |
| 平均案件工時效率 | 5% |

## 複雜度計算公式

```
複雜度分數 = 技術關鍵字(40%) + 處理工時(30%) + 設備類型(20%) + 非例行加分(10%)
```

### 技術關鍵字分數
- 高專業度 (25分): DNS, DHCP, VPN, SQL, 防火牆, 還原, VM, 故障排除...
- 中專業度 (10分): NAS, Outlook, M365, 備份, 權限, Switch, AP...
- 低專業度 (2分): 密碼重設, 印表機, 簽名檔, 例行維護...

### 複雜度等級
- 高: > 60 分
- 中: 30-60 分
- 低: < 30 分

## API 端點

| 方法 | 路徑 | 說明 |
|-----|-----|-----|
| POST | /api/upload | 上傳 Excel 檔案 |
| GET | /api/results/:batch | 取得績效結果 |
| GET | /api/records/:batch | 取得工單明細 |
| GET | /api/weights | 取得權重設定 |
| PUT | /api/weights | 更新權重設定 |
| POST | /api/recalculate/:batch | 重新計算績效 |
| GET | /api/keywords | 取得關鍵字列表 |
| POST | /api/keywords | 新增關鍵字 |
| DELETE | /api/keywords/:id | 刪除關鍵字 |
| GET | /api/export/:batch | 匯出 Excel 報表 |
| GET | /api/batches | 取得歷史批次 |

## 目錄結構

```
performance-system/
├── server.js          # 主程式
├── package.json       # 依賴設定
├── public/
│   └── index.html     # 前端頁面
├── uploads/           # 上傳檔案暫存
└── db/
    └── performance.db # SQLite 資料庫
```

## 常見問題

### Q: better-sqlite3 安裝失敗？
```bash
sudo apt-get install -y build-essential python3
npm rebuild better-sqlite3
```

### Q: 如何重置資料庫？
```bash
rm db/performance.db
npm start  # 會自動重建
```

### Q: 如何修改預設權重？
編輯 `server.js` 中的 `defaultWeights` 陣列，或透過網頁介面調整。

## 維運腳本（Ubuntu / systemd）

| 腳本 | 用途 | 用法 |
|------|------|------|
| `deploy.sh` | **一鍵佈署**：安裝依賴、建立並啟動 systemd 服務、設定開機自啟 | `./deploy.sh` 或 `PORT=8080 ./deploy.sh` |
| `update.sh` | **一鍵更新**：自動備份 → `git pull` → `npm install` → 重啟服務 | `./update.sh` |
| `backup.sh` | **一鍵備份**：打包 `db/` 與 `uploads/` 至 `backups/`，自動保留最近 10 份 | `./backup.sh` |
| `restore.sh` | **一鍵還原**：從備份還原（還原前會先自動安全備份現有資料） | `./restore.sh` 或 `./restore.sh backups/backup_xxx.tar.gz` |

首次部署：

```bash
git clone <repo-url> performance-system
cd performance-system
chmod +x *.sh
./deploy.sh
```

> ⚠️ 備份檔含個資與資料庫，請妥善保管，勿外傳或上傳公開空間。

### 設備類型資料救援

若「設備類型管理」的資料異常消失，可用此工具從各 db 副本與備份中找回：

```bash
# 1) 先掃描，看哪一份最完整（唯讀，不會修改任何資料）
node recover-device-types.js

# 2) 還原最完整的一份到目前使用中的資料庫
node recover-device-types.js --apply

# 或指定還原目標（例如正式環境的 db）
node recover-device-types.js --apply --target /opt/perfom-dev/db/performance.db
```

還原採 `INSERT ... ON CONFLICT` 更新分數，不會刪除既有資料；完成後重啟服務並 `Ctrl+F5`。

## License

MIT
