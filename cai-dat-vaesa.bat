@echo off
chcp 65001 >nul
setlocal
REM ========================================================================================
REM CAI DAT VAESA (1 LAN) — gop 2 viec: (1) bat tu dong cap nhat moi lan bat may,
REM (2) cai cau noi de bam "Cap nhat" ngay tren app. Khong can quyen admin.
REM Chay sau khi da Load unpacked extension vao Chrome.
REM ========================================================================================
echo ============================================
echo    CAI DAT VAESA EXTENSION (chay 1 lan)
echo ============================================
echo.

REM --- (1) Bat tu dong cap nhat: tao VBS trong Startup goi update.bat che do auto ngam ---
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\VAESA-AutoUpdate.vbs"
echo CreateObject("WScript.Shell").Run """%~dp0update.bat"" auto", 0, False>"%VBS%"
if exist "%VBS%" (echo [1/2] Da bat tu dong cap nhat.) else (echo [1/2] [canh bao] Khong tao duoc tu dong cap nhat — co the chay tay update.bat.)

REM --- (2) Cai cau noi (native messaging) de app bam "Cap nhat" duoc ---
if exist "%~dp0cau-noi\cai-dat.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cau-noi\cai-dat.ps1"
) else (
  echo [2/2] [canh bao] Khong thay cau-noi\cai-dat.ps1 — bo qua buoc cau noi.
)

echo.
echo ============================================
echo    XONG! Tu gio may tu cap nhat + bam "Cap nhat" tren app duoc.
echo    (Neu Chrome dang mo: thoat han Chrome roi mo lai 1 lan.)
echo ============================================
echo.
pause
endlocal
