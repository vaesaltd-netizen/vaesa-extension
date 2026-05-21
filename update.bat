@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Che do "auto" goi tu Startup: chay NGAM, khong pause, loi thi lang le thoat.
REM Chay tay (double-click): hien cua so + thong bao.
set "AUTO="
if /I "%~1"=="auto" set "AUTO=1"

REM Log debug — moi lan chay ghi de. Redirect dat CUOI dong + dung goto thay vi
REM khoi ngoac ( ) nhieu dong — tranh cmd.exe misparse (bug ban cu).
set "LOG=%TEMP%\vaesa_update.log"
echo [%date% %time%] === VAESA Extension Update START === > "%LOG%"
echo [%time%] Mode: [%AUTO%]  Folder: %CD% >> "%LOG%"

if not defined AUTO echo ============================================
if not defined AUTO echo    CAP NHAT VAESA EXTENSION
if not defined AUTO echo ============================================
if not defined AUTO echo.

REM Don rac ban updater cu (Chrome tu choi load neu co file ten "_...").
del /F /Q "_vaesa_update.zip" >nul 2>&1
rmdir /S /Q "_vaesa_extract" >nul 2>&1

set "ZIP=%TEMP%\vaesa_update.zip"
set "EXDIR=%TEMP%\vaesa_extract"
if exist "%ZIP%" del /F /Q "%ZIP%" >nul 2>&1
if exist "%EXDIR%" rmdir /S /Q "%EXDIR%" >nul 2>&1
echo [%time%] ZIP path: %ZIP% >> "%LOG%"

if not defined AUTO echo [1/3] Dang tai ban moi nhat tu GitHub...
echo [%time%] [1/3] curl tai ZIP... >> "%LOG%"
curl -L -f --retry 3 --retry-delay 2 --connect-timeout 20 -o "%ZIP%" "https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip" >> "%LOG%" 2>&1
set "CURL_EXIT=%ERRORLEVEL%"
echo [%time%] curl exit code: %CURL_EXIT% >> "%LOG%"

REM curl exit 0 nhung file co the bi AV xoa — thu lai bang PowerShell.
if exist "%ZIP%" goto :zip_ok
echo [%time%] curl khong tao duoc file, thu PowerShell... >> "%LOG%"
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri 'https://github.com/vaesaltd-netizen/vaesa-extension/archive/refs/heads/master.zip' -OutFile $env:TEMP+'\vaesa_update.zip' -UseBasicParsing}catch{exit 1}" >> "%LOG%" 2>&1
if exist "%ZIP%" goto :zip_ok
goto :fail_download

:zip_ok
echo [%time%] OK: ZIP tai ve thanh cong >> "%LOG%"
if not defined AUTO echo [2/3] Dang giai nen...
echo [%time%] [2/3] tar giai nen... >> "%LOG%"
mkdir "%EXDIR%" >nul 2>&1
tar -xf "%ZIP%" -C "%EXDIR%" >> "%LOG%" 2>&1
if not exist "%EXDIR%\vaesa-extension-master" goto :fail_extract
echo [%time%] OK: Giai nen thanh cong >> "%LOG%"

if not defined AUTO echo [3/3] Dang cap nhat file...
echo [%time%] [3/3] xcopy overlay... >> "%LOG%"
xcopy /E /Y /Q /R /H /K "%EXDIR%\vaesa-extension-master\*" "." >> "%LOG%" 2>&1
set "XC=%ERRORLEVEL%"
echo [%time%] xcopy exit code: %XC% >> "%LOG%"
rmdir /S /Q "%EXDIR%" >nul 2>&1
del /F /Q "%ZIP%" >nul 2>&1
if not "%XC%"=="0" goto :fail_copy
echo [%time%] === DONE: Da cap nhat thanh cong === >> "%LOG%"

if defined AUTO exit /b
echo.
echo ============================================
echo    XONG ! Da cap nhat ban moi nhat.
echo.
echo    Neu Chrome dang mo: vao chrome://extensions bam Reload.
echo    Log: %LOG%
echo ============================================
echo.
pause
exit /b

:fail_download
echo [%time%] FAIL: Khong tai duoc ZIP. curl exit %CURL_EXIT% >> "%LOG%"
if defined AUTO exit /b
echo.
echo [LOI] Khong tai duoc file tu GitHub.
echo       curl exit=%CURL_EXIT% ^| exit 6/7 = loi mang, exit 60 = loi SSL/ngay-gio.
echo       Co the Antivirus chan/xoa file ZIP. Hay them thu muc nay vao Exclusion.
echo       Log: %LOG%
echo.
pause
exit /b

:fail_extract
echo [%time%] FAIL: Giai nen that bai >> "%LOG%"
del /F /Q "%ZIP%" >nul 2>&1
if defined AUTO exit /b
echo.
echo [LOI] Giai nen that bai - file tai ve co the bi hong. Chay lai.
echo       Log: %LOG%
echo.
pause
exit /b

:fail_copy
echo [%time%] FAIL: xcopy khong ghi duoc (exit %XC%) >> "%LOG%"
if defined AUTO exit /b
echo.
echo [LOI] Khong ghi duoc vao thu muc extension.
echo       Thu muc co the bi chi-doc hoac Antivirus chan. Chuyen ra o C:/D: folder thuong.
echo       Log: %LOG%
echo.
pause
exit /b
