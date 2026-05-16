@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo    CAP NHAT VAESA EXTENSION
echo ============================================
echo.
echo [1/3] Dang tai ban moi nhat tu GitHub...
curl -L -s -o "_vaesa_update.zip" "https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip"
if not exist "_vaesa_update.zip" (
  echo.
  echo [LOI] Khong tai duoc - kiem tra ket noi mang roi chay lai.
  echo.
  pause
  exit /b
)

echo [2/3] Dang giai nen...
if exist "vaesa-extension-master" rmdir /S /Q "vaesa-extension-master"
tar -xf "_vaesa_update.zip"
if not exist "vaesa-extension-master" (
  echo.
  echo [LOI] Giai nen that bai.
  del "_vaesa_update.zip" >nul 2>&1
  pause
  exit /b
)

echo [3/3] Dang cap nhat file...
xcopy /E /Y /Q "vaesa-extension-master\*" "." >nul
rmdir /S /Q "vaesa-extension-master"
del "_vaesa_update.zip" >nul 2>&1

echo.
echo ============================================
echo    XONG ! Da cap nhat ban moi nhat.
echo.
echo    Buoc cuoi - lam 1 lan:
echo    1. Mo trinh duyet, vao:  chrome://extensions
echo    2. Tim VAESA Extension, bam nut Reload
echo       (bieu tuong mui ten tron).
echo ============================================
echo.
pause
