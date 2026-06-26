@echo off
chcp 65001 >nul
echo ╔════════════════════════════════════════════════════════════╗
echo ║     維護記錄單績效評比系統 - 安裝腳本                        ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

:: 檢查 Node.js 是否已安裝
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [錯誤] 未偵測到 Node.js，請先安裝 Node.js 18 或更高版本
    echo 下載網址: https://nodejs.org/
    pause
    exit /b 1
)

echo [1/3] 檢查 Node.js 版本...
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo 目前 Node.js 版本: %NODE_VERSION%
echo.

:: 設定預設端口
set DEFAULT_PORT=3000

:: 詢問是否要自訂端口
echo [2/3] 設定服務端口
set /p CUSTOM_PORT="請輸入服務端口 (直接按 Enter 使用預設 %DEFAULT_PORT%): "

if "%CUSTOM_PORT%"=="" (
    set SERVICE_PORT=%DEFAULT_PORT%
) else (
    set SERVICE_PORT=%CUSTOM_PORT%
)

echo 使用端口: %SERVICE_PORT%
echo.

:: 安裝依賴
echo [3/4] 安裝專案依賴套件...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [錯誤] 依賴安裝失敗，請檢查錯誤訊息
    pause
    exit /b 1
)

:: 取得當前目錄
set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%

:: 建立啟動腳本
echo.
echo [4/4] 建立啟動腳本和開機自啟動服務...

:: 建立啟動腳本
echo @echo off > start.bat
echo cd /d "%~dp0" >> start.bat
echo set PORT=%SERVICE_PORT% >> start.bat
echo npm start >> start.bat

:: 建立 VBS 腳本（後台運行，不顯示命令視窗）
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo WshShell.CurrentDirectory = "%SCRIPT_DIR%"
echo WshShell.Run "cmd /c ""set PORT=%SERVICE_PORT% ^&^& npm start""", 0, False
) > start-service.vbs

:: 刪除舊的計劃任務（如果存在）
schtasks /Delete /TN "PerformanceSystem" /F >nul 2>&1

:: 建立新的計劃任務（開機自啟動）
schtasks /Create /TN "PerformanceSystem" /TR "\"%SCRIPT_DIR%\start-service.vbs\"" /SC ONLOGON /RL HIGHEST /F >nul 2>&1

if %ERRORLEVEL% EQU 0 (
    echo 開機自啟動服務已建立
) else (
    echo [警告] 無法建立開機自啟動服務，可能需要管理員權限
    echo 您可以手動執行 start.bat 啟動服務
)

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                    安裝完成！                               ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 服務端口: %SERVICE_PORT%
echo 專案目錄: %SCRIPT_DIR%
echo.
echo 啟動方式:
echo   1. 手動啟動: 執行 start.bat
echo   2. 開機自啟動: 已設定為登入時自動啟動
echo.
echo 管理服務:
echo   查看任務: schtasks /Query /TN PerformanceSystem
echo   刪除任務: schtasks /Delete /TN PerformanceSystem /F
echo.
pause


