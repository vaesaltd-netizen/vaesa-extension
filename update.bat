@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Che do "auto" — goi tu Startup luc bat may: chay NGAM, khong pause, loi thi lang le thoat.
REM Chay tay (double-click, khong tham so) — hien cua so + thong bao nhu binh thuong.
set "AUTO="
if /I "%~1"=="auto" set "AUTO=1"

REM Log file de debug — moi lan chay ghi de, user check %TEMP%\vaesa_update.log de biet
REM da chay den buoc nao. Quan trong cho AUTO mode (silent — khong co cua so).
set "LOG=%TEMP%\vaesa_update.log"
set "TS=%date% %time%"
> "%LOG%" echo [%TS%] === VAESA Extension Update START ===
>> "%LOG%" echo [%TS%] Mode: %AUTO% (1=AUTO/Startup, ^<empty^>=manual)
>> "%LOG%" echo [%TS%] Folder: %CD%

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
>> "%LOG%" echo [%time%] [1/3] curl tai ZIP...
curl -L -f --retry 3 --retry-delay 2 --connect-timeout 20 -o "%ZIP%" "https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip" >> "%LOG%" 2>&1
set "CURL_EXIT=%ERRORLEVEL%"
>> "%LOG%" echo [%time%] curl exit code: %CURL_EXIT%
if not exist "%ZIP%" (
  >> "%LOG%" echo [%time%] FAIL: Khong tai duoc ZIP (curl exit %CURL_EXIT%)
  if defined AUTO exit /b
  echo.
  echo [LOI] Khong tai duoc ^(curl exit=%CURL_EXIT%^).
  echo       exit=6/7 : loi mang / firewall chan GitHub.
  echo       exit=60  : loi SSL - kiem tra NGAY/GIO may co dung khong.
  echo       Log day du: %LOG%
  echo.
  pause
  exit /b
)
>> "%LOG%" echo [%time%] OK: ZIP tai ve thanh cong

if not defined AUTO echo [2/3] Dang giai nen...
>> "%LOG%" echo [%time%] [2/3] tar giai nen...
mkdir "%EXDIR%" >nul 2>&1
tar -xf "%ZIP%" -C "%EXDIR%" >> "%LOG%" 2>&1
if not exist "%EXDIR%\vaesa-extension-master" (
  >> "%LOG%" echo [%time%] FAIL: Giai nen that bai (file ZIP co the bi hong)
  del /F /Q "%ZIP%" >nul 2>&1
  if defined AUTO exit /b
  echo.
  echo [LOI] Giai nen that bai - file tai ve co the bi hong. Chay lai.
  echo       Log day du: %LOG%
  pause
  exit /b
)
>> "%LOG%" echo [%time%] OK: Giai nen thanh cong

if not defined AUTO echo [3/3] Dang cap nhat file...
>> "%LOG%" echo [%time%] [3/3] xcopy overlay file vao thu muc extension...
REM /E recursive, /Y overwrite no prompt, /Q quiet, /R overwrite read-only files (Chrome co the
REM giu file read-only khi extension dang load), /H copy hidden, /K giu attribute.
xcopy /E /Y /Q /R /H /K "%EXDIR%\vaesa-extension-master\*" "." >> "%LOG%" 2>&1
set "XC=%ERRORLEVEL%"
>> "%LOG%" echo [%time%] xcopy exit code: %XC%
rmdir /S /Q "%EXDIR%" >nul 2>&1
del /F /Q "%ZIP%" >nul 2>&1
if not "%XC%"=="0" (
  >> "%LOG%" echo [%time%] FAIL: xcopy khong ghi duoc (exit %XC%) — thu muc chi-doc hoac Chrome lock file
  if defined AUTO exit /b
  echo.
  echo [LOI] Khong ghi duoc vao thu muc extension ^(thu muc dang chi-doc^).
  echo       Hay chuyen ca thu muc extension ra Desktop roi chay lai.
  echo       Log day du: %LOG%
  pause
  exit /b
)
>> "%LOG%" echo [%time%] OK: xcopy thanh cong, file da duoc cap nhat

REM Doc version moi tu manifest.json va ghi vao log de verify
for /f "tokens=2 delims=:," %%v in ('findstr /R /C:"\"version\"" manifest.json') do (
  set "NEWVER=%%v"
)
>> "%LOG%" echo [%time%] === DONE: Da cap nhat. Version moi: %NEWVER% ===

REM Che do auto: xong, thoat ngam (Chrome se tu nap ban moi o lan mo ke tiep).
if defined AUTO exit /b

echo.
echo ============================================
echo    XONG ! Da cap nhat ban moi nhat.
echo.
echo    Neu Chrome dang mo: vao chrome://extensions bam Reload.
echo    Lan sau bat may - extension tu cap nhat, khoi can lam gi.
echo.
echo    Log day du: %LOG%
echo ============================================
echo.
pause
