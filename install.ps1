# 維護記錄單績效評比系統 - 安裝腳本 (PowerShell)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     維護記錄單績效評比系統 - 安裝腳本                        ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# 檢查 Node.js 是否已安裝
try {
    $nodeVersion = node -v 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js not found"
    }
} catch {
    Write-Host "[錯誤] 未偵測到 Node.js，請先安裝 Node.js 18 或更高版本" -ForegroundColor Red
    Write-Host "下載網址: https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "按 Enter 鍵結束"
    exit 1
}

Write-Host "[1/3] 檢查 Node.js 版本..." -ForegroundColor Green
Write-Host "目前 Node.js 版本: $nodeVersion"
Write-Host ""

# 設定預設端口
$DEFAULT_PORT = 3000

# 詢問是否要自訂端口
Write-Host "[2/3] 設定服務端口" -ForegroundColor Green
$customPort = Read-Host "請輸入服務端口 (直接按 Enter 使用預設 $DEFAULT_PORT)"

if ([string]::IsNullOrWhiteSpace($customPort)) {
    $SERVICE_PORT = $DEFAULT_PORT
} else {
    $portNum = 0
    if ([int]::TryParse($customPort, [ref]$portNum) -and $portNum -ge 1 -and $portNum -le 65535) {
        $SERVICE_PORT = $portNum
    } else {
        Write-Host "[錯誤] 端口必須是 1-65535 之間的數字" -ForegroundColor Red
        Read-Host "按 Enter 鍵結束"
        exit 1
    }
}

Write-Host "使用端口: $SERVICE_PORT"
Write-Host ""

# 安裝依賴
Write-Host "[3/3] 安裝專案依賴套件..." -ForegroundColor Green
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[錯誤] 依賴安裝失敗，請檢查錯誤訊息" -ForegroundColor Red
    Read-Host "按 Enter 鍵結束"
    exit 1
}

# 建立啟動腳本
Write-Host ""
Write-Host "建立啟動腳本 start.ps1..." -ForegroundColor Green
$startScript = @"
`$env:PORT = "$SERVICE_PORT"
npm start
"@
$startScript | Out-File -FilePath "start.ps1" -Encoding UTF8

Write-Host ""
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                    安裝完成！                               ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "服務端口: $SERVICE_PORT"
Write-Host ""
Write-Host "啟動服務請執行:" -ForegroundColor Yellow
Write-Host "  .\start.ps1"
Write-Host ""
Write-Host "或直接執行:" -ForegroundColor Yellow
Write-Host "  `$env:PORT = $SERVICE_PORT; npm start"
Write-Host ""
Read-Host "按 Enter 鍵結束"

