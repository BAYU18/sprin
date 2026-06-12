@echo off
:: ============================================================
:: PrintServer Pro - Node Agent Manager
:: Kelola agent di komputer ini: status / start / stop / restart / log / update / uninstall
:: Jalankan sebagai Administrator (klik kanan - Run as administrator)
:: ============================================================
setlocal EnableDelayedExpansion
title PrintServer Node Agent Manager

set TASK_NAME=PrintServerNodeAgent
set TARGET_DIR=%APPDATA%\printserver-agent
set EXE_PATH=%TARGET_DIR%\printserver-agent.exe
set PROC_NAME=printserver-agent.exe
set SERVER_URL=http://192.168.1.141:3000
set VERSION_FILE=%TARGET_DIR%\version.txt
:: --- Pastikan hak Administrator ---
net session >nul 2>&1
if not %errorLevel% == 0 (
    echo.
    echo ERROR: Script ini harus dijalankan sebagai Administrator.
    echo Klik kanan file ini - pilih "Run as administrator".
    echo.
    pause
    exit /b 1
)

:: --- Fetch versi server sekali saat startup ---
set SERVER_VER=unknown
set SERVER_SIZE=0
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%SERVER_URL%/downloads/agent/info' -TimeoutSec 5; $r.version } catch { 'unavailable' }"`) do set SERVER_VER=%%R
for /f "usebackq delims=" %%S in (`powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%SERVER_URL%/downloads/agent/info' -TimeoutSec 5; [math]::Round($r.size/1MB,1).ToString() + ' MB' } catch { '?' }"`) do set SERVER_SIZE=%%S

:: --- Baca versi lokal ---
set LOCAL_VER=unknown
if exist "%VERSION_FILE%" (
    set /p LOCAL_VER=<"%VERSION_FILE%"
)

:: --- Bandingkan versi ---
set NEED_UPDATE=0
if /I not "%LOCAL_VER%"=="%SERVER_VER%" (
    if not "%SERVER_VER%"=="unavailable" (
        if not "%SERVER_VER%"=="unknown" (
            set NEED_UPDATE=1
        )
    )
)

:MENU
cls
echo ==============================================================
echo            PRINTSERVER PRO - NODE AGENT MANAGER
echo ==============================================================
echo  Komputer : %COMPUTERNAME%
echo  Task     : %TASK_NAME%
echo  Lokasi   : %TARGET_DIR%
echo --------------------------------------------------------------

:: --- Cek status proses ---
tasklist /FI "IMAGENAME eq %PROC_NAME%" 2>nul | find /I "%PROC_NAME%" >nul
if !errorLevel! == 0 (
    set PROC_STATUS=RUNNING
) else (
    set PROC_STATUS=STOPPED
)

:: --- Cek status task ---
schtasks /Query /TN "%TASK_NAME%" >nul 2>&1
if !errorLevel! == 0 (
    set TASK_EXISTS=YES
) else (
    set TASK_EXISTS=NO
)

echo  Status Proses : !PROC_STATUS!
echo  Task Terdaftar: !TASK_EXISTS!
echo --------------------------------------------------------------

:: --- Tampilkan versi ---
echo  Versi Lokal  : !LOCAL_VER!
echo  Versi Server : !SERVER_VER! ^(!SERVER_SIZE!^)

if "!NEED_UPDATE!"=="1" (
    echo  --------------------------------------------------------
    echo   *** UPDATE TERSEDIA: !LOCAL_VER! - ^> !SERVER_VER! ***
    echo   Pilih menu [9] untuk update, atau jalankan otomatis.
    echo  --------------------------------------------------------

    :: --- Tawarkan auto-update ---
    set /p AUTO_UP="  Update sekarang? (Y/n): "
    if /I not "!AUTO_UP!"=="n" (
        call :DO_UPDATE
        goto MENU
    )
) else (
    echo  Status       : UP TO DATE
)
echo ==============================================================

echo.
echo   [1] Lihat Status Lengkap
echo   [2] START  agent (nyalakan)
echo   [3] STOP   agent (matikan sementara)
echo   [4] RESTART agent
echo   [5] Lihat Log terakhir
echo   [6] NONAKTIFKAN auto-start saat boot
echo   [7] AKTIFKAN auto-start saat boot
echo   [8] UNINSTALL agent (hapus total)
if "!NEED_UPDATE!"=="1" (
    echo   [9] UPDATE agent (download versi !SERVER_VER!)
)
echo   [0] Keluar
echo.
set /p CHOICE="Pilih menu [0-9]: "

if "%CHOICE%"=="1" goto STATUS
if "%CHOICE%"=="2" goto START
if "%CHOICE%"=="3" goto STOP
if "%CHOICE%"=="4" goto RESTART
if "%CHOICE%"=="5" goto LOG
if "%CHOICE%"=="6" goto DISABLE
if "%CHOICE%"=="7" goto ENABLE
if "%CHOICE%"=="8" goto UNINSTALL
if "%CHOICE%"=="9" goto UPDATE
if "%CHOICE%"=="0" goto END
goto MENU

:STATUS
cls
echo ===================== STATUS LENGKAP =====================
echo.
echo --- Version ---
echo  Local  : !LOCAL_VER!
echo  Server : !SERVER_VER! ^(!SERVER_SIZE!^)
if "!NEED_UPDATE!"=="1" (
    echo  Status : UPDATE TERSEDIA
) else (
    echo  Status : UP TO DATE
)
echo.
echo --- Task Scheduler ---
schtasks /Query /TN "%TASK_NAME%" /V /FO LIST 2>nul | findstr /I "TaskName Status Next Last"
echo.
echo --- Status Proses ---
tasklist /FI "IMAGENAME eq %PROC_NAME%" 2>nul | find /I "%PROC_NAME%" >nul
if !errorLevel! == 0 (
    echo Agent SEDANG BERJALAN:
    tasklist /FI "IMAGENAME eq %PROC_NAME%"
) else (
    echo Agent TIDAK berjalan.
)
echo.
echo --- File Executable ---
if exist "%EXE_PATH%" (
    echo Ditemukan: %EXE_PATH%
    for %%A in ("%EXE_PATH%") do echo    Ukuran : %%~zA bytes
) else (
    echo TIDAK ditemukan: %EXE_PATH%
)
echo.
echo --- Server Status ---
powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%SERVER_URL%/downloads/node-status?hostname=%COMPUTERNAME%' -TimeoutSec 4; if ($r.online) { Write-Output ('  Server    : ONLINE (heartbeat ' + $r.secondsAgo + 's ago, IP: ' + $r.ip + ')') } else { Write-Output ('  Server    : OFFLINE (last seen ' + $r.secondsAgo + 's ago)') } } catch { Write-Output '  Server    : unreachable' }"
echo.
pause
goto MENU

:START
cls
echo Menjalankan agent...
schtasks /Run /TN "%TASK_NAME%" 2>nul
if !errorLevel! == 0 (
    echo [OK] Perintah start dikirim. Menunggu agent konek ke server...
    call :WAIT_ONLINE
) else (
    echo [GAGAL] Task tidak ditemukan. Mungkin agent belum terinstall.
)
echo.
pause
goto MENU

:STOP
cls
echo Menghentikan agent...
schtasks /End /TN "%TASK_NAME%" 2>nul
taskkill /IM "%PROC_NAME%" /F >nul 2>&1
echo [OK] Proses agent dimatikan. Memberitahu server...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri '%SERVER_URL%/downloads/node-offline?hostname=%COMPUTERNAME%' -Method Post -TimeoutSec 4 | Out-Null } catch {}" >nul 2>&1
call :WAIT_OFFLINE
echo.
echo Catatan: agent akan nyala lagi saat PC restart kecuali auto-start dinonaktifkan (menu 6).
echo.
pause
goto MENU

:RESTART
cls
echo Me-restart agent...
schtasks /End /TN "%TASK_NAME%" 2>nul
taskkill /IM "%PROC_NAME%" /F >nul 2>&1
timeout /t 2 /nobreak >nul
schtasks /Run /TN "%TASK_NAME%" 2>nul
if !errorLevel! == 0 (
    echo [OK] Perintah restart dikirim. Menunggu agent konek ke server...
    call :WAIT_ONLINE
) else (
    echo [GAGAL] Task tidak ditemukan.
)
echo.
pause
goto MENU

:LOG
cls
echo ===================== LOG TERAKHIR =====================
set LOG_FOUND=0
for %%F in ("%TARGET_DIR%\*.log") do (
    set LOG_FOUND=1
    echo.
    echo --- %%~nxF ^(50 baris terakhir^) ---
    powershell -NoProfile -Command "Get-Content -Path '%%F' -Tail 50 -ErrorAction SilentlyContinue"
)
if !LOG_FOUND! == 0 (
    echo Tidak ada file .log di %TARGET_DIR%
    echo Folder agent:
    dir "%TARGET_DIR%" 2>nul
)
echo.
pause
goto MENU

:DISABLE
cls
echo Menonaktifkan auto-start saat boot...
schtasks /Change /TN "%TASK_NAME%" /DISABLE 2>nul
if !errorLevel! == 0 (
    echo [OK] Auto-start DINONAKTIFKAN. Agent tidak akan nyala otomatis saat PC boot.
    echo Agent yang sedang berjalan TIDAK ikut berhenti — pakai menu 3 untuk stop.
) else (
    echo [GAGAL] Task tidak ditemukan.
)
echo.
pause
goto MENU

:ENABLE
cls
echo Mengaktifkan auto-start saat boot...
schtasks /Change /TN "%TASK_NAME%" /ENABLE 2>nul
if !errorLevel! == 0 (
    echo [OK] Auto-start DIAKTIFKAN kembali. Agent akan nyala otomatis saat PC boot.
) else (
    echo [GAGAL] Task tidak ditemukan.
)
echo.
pause
goto MENU

:UNINSTALL
cls
echo ===================== UNINSTALL AGENT =====================
echo PERINGATAN: Ini akan menghapus agent dari komputer ini secara TOTAL:
echo  - Hentikan proses agent
echo  - Hapus Task Scheduler "%TASK_NAME%"
echo  - Hapus folder %TARGET_DIR%
echo.
set /p CONFIRM="Yakin uninstall? Ketik YA untuk lanjut: "
if /I not "%CONFIRM%"=="YA" (
    echo Dibatalkan.
    pause
    goto MENU
)
echo.
echo [1/3] Menghentikan agent...
schtasks /End /TN "%TASK_NAME%" 2>nul
taskkill /IM "%PROC_NAME%" /F >nul 2>&1
echo [2/3] Menghapus task...
schtasks /Delete /TN "%TASK_NAME%" /F 2>nul
echo [3/3] Menghapus folder agent...
timeout /t 2 /nobreak >nul
rmdir /S /Q "%TARGET_DIR%" 2>nul
echo.
echo [SELESAI] Agent sudah di-uninstall dari komputer ini.
echo Untuk install lagi, jalankan install-agent.bat
echo.
pause
goto END

:UPDATE
cls
call :DO_UPDATE
echo.
pause
goto MENU

:: ============================================================
:: DO_UPDATE — delegasi ke PowerShell script di server.
:: Semua logika update (download, backup, replace, restart, wait)
:: ada di update-agent.ps1 supaya bebas dari masalah escaping batch.
:: ============================================================
:DO_UPDATE
set UPDATER_PS=%TEMP%\printserver-update-agent.ps1
echo Mengunduh updater script...
powershell -NoProfile -Command "Invoke-WebRequest -Uri '%SERVER_URL%/downloads/update-agent.ps1' -OutFile '%UPDATER_PS%' -TimeoutSec 30"
if not exist "%UPDATER_PS%" (
    echo [GAGAL] Tidak bisa download updater script dari server.
    goto :UPDATE_DONE
)

:: Jalankan updater PowerShell. Semua step + progress bar ditangani di sana.
powershell -NoProfile -ExecutionPolicy Bypass -File "%UPDATER_PS%" -ServerUrl "%SERVER_URL%" -TargetDir "%TARGET_DIR%" -TaskName "%TASK_NAME%"
set UPD_RESULT=!ERRORLEVEL!

del "%UPDATER_PS%" 2>nul

if "!UPD_RESULT!"=="0" (
    :: Update sukses — refresh variabel lokal
    set LOCAL_VER=!SERVER_VER!
    set NEED_UPDATE=0
)

:UPDATE_DONE
goto :eof

:END
echo.
echo Keluar dari Node Agent Manager.
timeout /t 1 /nobreak >nul
endlocal
exit /b 0

:: ============================================================
:: WAIT_ONLINE — polling ke server sampai heartbeat node diterima.
:: Menampilkan progress bar. Maks ~60 detik (20 x 3 detik).
:: ============================================================
:WAIT_ONLINE
set MAX_TRIES=20
set TRY=0
echo.
echo  Menunggu server menerima heartbeat dari node ini ^(%COMPUTERNAME%^)...
echo  ------------------------------------------------------------

:WAIT_LOOP
set /a TRY+=1

for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%SERVER_URL%/downloads/node-status?hostname=%COMPUTERNAME%' -TimeoutSec 4; if ($r.online) { 'ONLINE:' + $r.secondsAgo + ':' + $r.ip } else { 'WAIT' } } catch { 'ERR' }"`) do set RESULT=%%R

set BAR=
for /l %%i in (1,1,%TRY%) do set BAR=!BAR!#
set SPACE=
set /a REMAIN=%MAX_TRIES%-%TRY%
if %REMAIN% gtr 0 for /l %%i in (1,1,!REMAIN!) do set SPACE=!SPACE!.

echo(%RESULT%| findstr /B "ONLINE" >nul
if !errorLevel! == 0 (
    for /f "tokens=2,3 delims=:" %%a in ("!RESULT!") do (
        set SECS=%%a
        set NODEIP=%%b
    )
    echo  [!BAR!!SPACE!] 100%%
    echo.
    echo  ============================================================
    echo   [SUKSES] Agent ONLINE dan diterima server!
    echo   - Heartbeat terakhir : !SECS! detik lalu
    echo   - IP terdaftar       : !NODEIP!
    echo  ============================================================
    goto :eof
)

set /a PCT=%TRY%*100/%MAX_TRIES%
echo  [!BAR!!SPACE!] !PCT!%%  ^(percobaan %TRY%/%MAX_TRIES%^)

if %TRY% geq %MAX_TRIES% (
    echo.
    echo  ============================================================
    echo   [TIMEOUT] Server belum menerima heartbeat setelah 60 detik.
    echo   Kemungkinan penyebab:
    echo    - Agent gagal start ^(cek menu [1] Status / [5] Log^)
    echo    - Koneksi ke server %SERVER_URL% terputus
    echo    - Firewall memblokir agent
    echo  ============================================================
    goto :eof
)

timeout /t 3 /nobreak >nul
goto WAIT_LOOP

:: ============================================================
:: WAIT_OFFLINE — konfirmasi ke server bahwa node sudah offline.
:: Menampilkan progress bar. Maks ~30 detik (10 x 3 detik).
:: ============================================================
:WAIT_OFFLINE
set MAX_OFF=10
set OTRY=0
echo.
echo  Menunggu server menandai node ini OFFLINE...
echo  ------------------------------------------------------------

:OFF_LOOP
set /a OTRY+=1

for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%SERVER_URL%/downloads/node-status?hostname=%COMPUTERNAME%' -TimeoutSec 4; if ($r.online) { 'ONLINE' } else { 'OFFLINE' } } catch { 'ERR' }"`) do set ORES=%%R

set OBAR=
for /l %%i in (1,1,%OTRY%) do set OBAR=!OBAR!#
set OSPACE=
set /a OREMAIN=%MAX_OFF%-%OTRY%
if %OREMAIN% gtr 0 for /l %%i in (1,1,!OREMAIN!) do set OSPACE=!OSPACE!.

echo(!ORES!| findstr /B "OFFLINE" >nul
if !errorLevel! == 0 (
    echo  [!OBAR!!OSPACE!] 100%%
    echo.
    echo  ============================================================
    echo   [SUKSES] Agent sudah OFFLINE di server.
    echo  ============================================================
    goto :eof
)

set /a OPCT=%OTRY%*100/%MAX_OFF%
echo  [!OBAR!!OSPACE!] !OPCT!%%  ^(percobaan %OTRY%/%MAX_OFF%^)

if %OTRY% geq %MAX_OFF% (
    echo.
    echo  ============================================================
    echo   [INFO] Server belum konfirmasi offline setelah 30 detik.
    echo   Node akan otomatis dianggap offline oleh server dalam
    echo   maksimal 60 detik ^(heartbeat basi^). Proses lokal sudah mati.
    echo  ============================================================
    goto :eof
)

timeout /t 3 /nobreak >nul
goto OFF_LOOP
