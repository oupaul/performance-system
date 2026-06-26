@echo off
chcp 65001 >nul
echo ╔════════════════════════════════════════════════════════════╗
echo ║     維護記錄單績效評比系統 - 移除腳本                        ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo [警告] 此操作將移除以下內容:
echo   - node_modules 目錄 (依賴套件)
echo   - package-lock.json
echo.
echo [注意] 以下資料將被保留:
echo   - db/ 目錄 (資料庫檔案)
echo   - uploads/ 目錄 (上傳檔案)
echo   - public/ 目錄 (前端檔案)
echo   - server.js 及其他原始碼檔案
echo.
set /p CONFIRM="確定要繼續嗎？(Y/N): "

if /i not "%CONFIRM%"=="Y" (
    echo 操作已取消
    pause
    exit /b 0
)

echo.
echo [1/2] 移除 node_modules 目錄...
if exist node_modules (
    rd /s /q node_modules
    echo node_modules 已移除
) else (
    echo node_modules 目錄不存在，略過
)

echo.
echo [2/4] 移除 package-lock.json...
if exist package-lock.json (
    del /q package-lock.json
    echo package-lock.json 已移除
) else (
    echo package-lock.json 不存在，略過
)

echo.
echo [3/4] 移除啟動腳本...
if exist start.bat (
    del /q start.bat
    echo start.bat 已移除
)
if exist start-service.vbs (
    del /q start-service.vbs
    echo start-service.vbs 已移除
)

echo.
echo [4/4] 移除開機自啟動服務...
schtasks /Delete /TN "PerformanceSystem" /F >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo 開機自啟動服務已移除
) else (
    echo 開機自啟動服務不存在或無法移除（可能需要管理員權限）
)

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                    移除完成！                               ║
echo ╚════════════════════════════════════════════════════════════╝
echo.
echo 依賴套件、啟動腳本和開機自啟動服務已移除，但原始碼和資料已保留。
echo 若要重新安裝，請執行 install.bat
echo.
pause


