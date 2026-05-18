@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo    CAP NHAT VAESA EXTENSION
echo ============================================
echo.

REM Tai ve thu muc tam (luon ghi duoc) — tranh truong hop thu muc extension chi-doc.
set "ZIP=%TEMP%\_vaesa_update.zip"
set "EXDIR=%TEMP%\_vaesa_extract"
if exist "%ZIP%" del /F /Q "%ZIP%" >nul 2>&1
if exist "%EXDIR%" rmdir /S /Q "%EXDIR%" >nul 2>&1

echo [1/3] Dang tai ban moi nhat tu GitHub...
curl -L -f --retry 3 --retry-delay 2 --connect-timeout 20 -o "%ZIP%" "https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip"
set "CURL_EXIT=%ERRORLEVEL%"
if not exist "%ZIP%" (
  echo.
  echo [LOI] Khong tai duoc ^(curl exit=%CURL_EXIT%^).
  echo       exit=6   : khong phan giai duoc ten mien ^(DNS / mang^).
  echo       exit=7   : khong ket noi duoc ^(firewall / proxy chan GitHub^).
  echo       exit=60  : loi chung chi SSL - kiem tra NGAY/GIO may co dung khong.
  echo       exit=9009: may chua co lenh curl ^(Windows qua cu^).
  echo       Kiem tra mang va Ngay/Gio may, roi chay lai.
  echo.
  pause
  exit /b
)

echo [2/3] Dang giai nen...
mkdir "%EXDIR%" >nul 2>&1
tar -xf "%ZIP%" -C "%EXDIR%"
if not exist "%EXDIR%\vaesa-extension-master" (
  echo.
  echo [LOI] Giai nen that bai - file tai ve co the bi hong. Chay lai.
  del /F /Q "%ZIP%" >nul 2>&1
  pause
  exit /b
)

echo [3/3] Dang cap nhat file...
xcopy /E /Y /Q "%EXDIR%\vaesa-extension-master\*" "." >nul
if errorlevel 1 (
  echo.
  echo [LOI] Khong ghi duoc vao thu muc extension ^(thu muc dang chi-doc^).
  echo       Hay chuyen ca thu muc extension ra Desktop roi chay lai.
  rmdir /S /Q "%EXDIR%" >nul 2>&1
  del /F /Q "%ZIP%" >nul 2>&1
  pause
  exit /b
)
rmdir /S /Q "%EXDIR%" >nul 2>&1
del /F /Q "%ZIP%" >nul 2>&1

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
