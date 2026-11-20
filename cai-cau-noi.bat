@echo off
chcp 65001 >nul
REM ========================================================================================
REM CAI CAU NOI CAP NHAT VAESA — chay 1 LAN tren may. Sau do app co nut "Cap nhat" bam duoc.
REM Khong can quyen admin. Toan bo viec cai nam trong cau-noi\cai-dat.ps1 (tranh loi escape batch).
REM ========================================================================================
echo ============================================
echo    CAI CAU NOI CAP NHAT VAESA EXTENSION
echo ============================================
echo.

if not exist "%~dp0cau-noi\cai-dat.ps1" (
  echo [LOI] Khong thay cau-noi\cai-dat.ps1. Hay chay file nay TRONG thu muc extension VAESA.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cau-noi\cai-dat.ps1"
echo.
pause
