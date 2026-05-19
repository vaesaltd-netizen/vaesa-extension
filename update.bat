@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Che do "auto" — goi tu Startup luc bat may: chay NGAM, khong pause, loi thi lang le thoat.
REM Chay tay (double-click, khong tham so) — hien cua so + thong bao nhu binh thuong.
set "AUTO="
if /I "%~1"=="auto" set "AUTO=1"

if not defined AUTO (
  echo ============================================
  echo    CAP NHAT VAESA EXTENSION
  echo ============================================
  echo.
)

REM Don file rac tu ban updater cu — Chrome TU CHOI load extension neu thu muc co
REM file/folder ten bat dau bang "_".
del /F /Q "_vaesa_update.zip" >nul 2>&1
rmdir /S /Q "_vaesa_extract" >nul 2>&1

REM Tai ve thu muc tam (luon ghi duoc) — tranh truong hop thu muc extension chi-doc.
set "ZIP=%TEMP%\vaesa_update.zip"
set "EXDIR=%TEMP%\vaesa_extract"
if exist "%ZIP%" del /F /Q "%ZIP%" >nul 2>&1
if exist "%EXDIR%" rmdir /S /Q "%EXDIR%" >nul 2>&1

if not defined AUTO echo [1/3] Dang tai ban moi nhat tu GitHub...
curl -L -f --retry 3 --retry-delay 2 --connect-timeout 20 -o "%ZIP%" "https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip"
set "CURL_EXIT=%ERRORLEVEL%"
if not exist "%ZIP%" (
  if defined AUTO exit /b
  echo.
  echo [LOI] Khong tai duoc ^(curl exit=%CURL_EXIT%^).
  echo       exit=6/7 : loi mang / firewall chan GitHub.
  echo       exit=60  : loi SSL - kiem tra NGAY/GIO may co dung khong.
  echo       Kiem tra mang va Ngay/Gio may, roi chay lai.
  echo.
  pause
  exit /b
)

if not defined AUTO echo [2/3] Dang giai nen...
mkdir "%EXDIR%" >nul 2>&1
tar -xf "%ZIP%" -C "%EXDIR%"
if not exist "%EXDIR%\vaesa-extension-master" (
  del /F /Q "%ZIP%" >nul 2>&1
  if defined AUTO exit /b
  echo.
  echo [LOI] Giai nen that bai - file tai ve co the bi hong. Chay lai.
  pause
  exit /b
)

if not defined AUTO echo [3/3] Dang cap nhat file...
xcopy /E /Y /Q "%EXDIR%\vaesa-extension-master\*" "." >nul
set "XC=%ERRORLEVEL%"
rmdir /S /Q "%EXDIR%" >nul 2>&1
del /F /Q "%ZIP%" >nul 2>&1
if not "%XC%"=="0" (
  if defined AUTO exit /b
  echo.
  echo [LOI] Khong ghi duoc vao thu muc extension ^(thu muc dang chi-doc^).
  echo       Hay chuyen ca thu muc extension ra Desktop roi chay lai.
  pause
  exit /b
)

REM Che do auto: xong, thoat ngam (Chrome se tu nap ban moi o lan mo ke tiep).
if defined AUTO exit /b

echo.
echo ============================================
echo    XONG ! Da cap nhat ban moi nhat.
echo.
echo    Neu Chrome dang mo: vao chrome://extensions bam Reload.
echo    Lan sau bat may - extension tu cap nhat, khoi can lam gi.
echo ============================================
echo.
pause
