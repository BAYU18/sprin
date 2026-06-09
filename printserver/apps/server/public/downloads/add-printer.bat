@echo off
:: ============================================================
:: PrintServer Pro - Add Printer (Universal)
:: Ambil daftar printer dari server, pilih nomor, otomatis install.
:: Auto: bikin IPP port + pakai driver yang benar + verifikasi.
:: ============================================================
setlocal EnableDelayedExpansion
title PrintServer Pro - Tambah Printer

set SERVER_URL=http://192.168.1.141:3000
set DRIVER=Microsoft IPP Class Driver
set TMPJSON=%TEMP%\ps_printer_list.json

:: --- Pastikan hak Administrator ---
net session >nul 2>&1
if not !errorLevel! == 0 (
    echo.
    echo  [PERLU ADMIN] Klik kanan file ini, pilih "Run as administrator".
    echo.
    pause
    exit /b 1
)

:MENU
cls
echo ==============================================================
echo            PRINTSERVER PRO - TAMBAH PRINTER
echo ==============================================================
echo  Server : %SERVER_URL%
echo  Mengambil daftar printer dari server...
echo --------------------------------------------------------------

:: Ambil daftar printer (JSON) via PowerShell, tulis tiap baris: idx^|name^|node^|online^|ippUrl
set COUNT=0
for /f "usebackq tokens=1,* delims=|" %%A in (`powershell -NoProfile -Command "try { $r = Invoke-RestMethod -Uri '%SERVER_URL%/downloads/printer-list' -TimeoutSec 8; $i=0; foreach($p in $r.printers){ $i++; $on = if($p.nodeOnline){'ONLINE'}else{'OFFLINE'}; Write-Output ($i.ToString() + '|' + $p.name + ' (' + $p.node + ') [' + $on + ']|' + $p.ippUrl) } } catch { Write-Output 'ERR|Gagal konek ke server|' }`) do (
    set "LINE_%%A=%%B"
    set "URL_%%A=%%B"
    if "%%A"=="ERR" (
        echo.
        echo  [GAGAL] Tidak bisa mengambil daftar printer dari server.
        echo  Cek koneksi ke %SERVER_URL% lalu coba lagi.
        echo.
        pause
        exit /b 1
    )
    set /a COUNT+=1
    for /f "tokens=1,* delims=|" %%X in ("%%B") do (
        echo   [%%A] %%X
        set "IPP_%%A=%%Y"
    )
)

if %COUNT%==0 (
    echo.
    echo  Tidak ada printer terdaftar di server.
    echo.
    pause
    exit /b 0
)

echo --------------------------------------------------------------
echo   [0] Keluar
echo.
set /p CHOICE="Pilih printer yang mau dipasang [0-%COUNT%]: "

if "%CHOICE%"=="0" goto END
if "%CHOICE%"=="" goto MENU

:: Validasi pilihan ada
if not defined IPP_%CHOICE% (
    echo.
    echo  Pilihan tidak valid.
    timeout /t 2 /nobreak >nul
    goto MENU
)

set "SEL_IPP=!IPP_%CHOICE%!"
for /f "tokens=1 delims=|" %%X in ("!LINE_%CHOICE%!") do set "SEL_NAME=%%X"

:: Bersihkan label node/status dari nama buat nama printer Windows
:: SEL_NAME masih: "EPSON L3210 Series (IT-99) [ONLINE]" -> ambil sebelum " ("
for /f "tokens=1 delims=(" %%N in ("!SEL_NAME!") do set "PRINTER_NAME=%%N"
:: trim trailing space
if "!PRINTER_NAME:~-1!"==" " set "PRINTER_NAME=!PRINTER_NAME:~0,-1!"

cls
echo ==============================================================
echo   MEMASANG PRINTER
echo ==============================================================
echo  Nama   : !PRINTER_NAME!
echo  Port   : !SEL_IPP!
echo  Driver : %DRIVER%
echo --------------------------------------------------------------
echo.

:: 1. Buat IPP port (kalau belum ada)
echo  [1/3] Membuat port IPP...
powershell -NoProfile -Command "if (-not (Get-PrinterPort -Name '!SEL_IPP!' -ErrorAction SilentlyContinue)) { Add-PrinterPort -Name '!SEL_IPP!' }" >nul 2>&1
if !errorLevel! == 0 (echo        [OK] Port siap.) else (echo        [!] Port mungkin sudah ada, lanjut.)

:: 2. Pasang printer
echo  [2/3] Memasang printer...
powershell -NoProfile -Command "if (Get-Printer -Name '!PRINTER_NAME!' -ErrorAction SilentlyContinue) { Set-Printer -Name '!PRINTER_NAME!' -PortName '!SEL_IPP!' } else { Add-Printer -Name '!PRINTER_NAME!' -DriverName '%DRIVER%' -PortName '!SEL_IPP!' }" 2>%TEMP%\ps_addprn_err.txt
if !errorLevel! == 0 (
    echo        [OK] Perintah pasang dikirim.
) else (
    echo        [GAGAL] Gagal memasang printer.
    echo.
    echo  Pesan error:
    type %TEMP%\ps_addprn_err.txt 2>nul
    echo.
    echo  Kemungkinan: driver "Microsoft IPP Class Driver" belum tersedia.
    echo  Solusi: Settings ^> Printers ^> Add device ^> Add manually ^>
    echo          "Select a shared printer by name" ^> tempel:
    echo          http:!SEL_IPP:ipp:=! 
    echo.
    pause
    goto MENU
)

:: 3. Verifikasi printer terpasang
echo  [3/3] Verifikasi...
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command "if (Get-Printer -Name '!PRINTER_NAME!' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>&1
if !errorLevel! == 0 (
    echo        [OK] Printer terpasang dan terverifikasi.
    echo.
    echo  ============================================================
    echo   [SUKSES] "!PRINTER_NAME!" siap dipakai!
    echo   Coba print test page dari Settings ^> Printers.
    echo  ============================================================
) else (
    echo        [!] Printer tidak ditemukan setelah pemasangan.
    echo            Coba cek manual di Settings ^> Printers.
)
echo.
set /p AGAIN="Pasang printer lain? (Y/N): "
if /i "!AGAIN!"=="Y" goto MENU
goto END

:END
echo.
echo Selesai. Keluar dari Tambah Printer.
timeout /t 1 /nobreak >nul
endlocal
exit /b 0
