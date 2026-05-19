@echo off
chcp 65001 >nul
echo ============================================
echo    BAT TU DONG CAP NHAT VAESA EXTENSION
echo ============================================
echo.
echo Chi can chay file nay 1 LAN tren may. Tu gio moi lan bat may,
echo extension se tu cap nhat ban moi nhat (chay ngam, khong hien cua so).
echo.

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\VAESA-AutoUpdate.vbs"

REM Tao file chay ngam trong thu muc Startup cua Windows — moi lan dang nhap
REM se goi update.bat o che do "auto" (chay ngam, khong cua so, khong pause).
echo CreateObject("WScript.Shell").Run """%~dp0update.bat"" auto", 0, False>"%VBS%"

if exist "%VBS%" (
  echo [OK] Da BAT tu dong cap nhat thanh cong.
  echo.
  echo      Tu gio: bat may  --^>  extension tu cap nhat  --^>  mo Chrome la co ban moi.
  echo      Khong ai phai chay updater hay bam Reload nua.
  echo.
  echo      Muon TAT tu dong cap nhat sau nay: xoa file duoi day di:
  echo      %VBS%
) else (
  echo [LOI] Khong tao duoc file tu dong chay.
  echo       Thu: chuot phai vao file nay --^> Run as administrator.
)
echo.
pause
