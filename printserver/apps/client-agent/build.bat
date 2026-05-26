@echo off
REM PrintServer Node Agent - Build Script for Windows
REM Run this on a Windows machine with Node.js installed

echo ========================================
echo   PrintServer Agent Build Script
echo ========================================

REM Check Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js 16+ from https://nodejs.org
    pause
    exit /b 1
)

echo [OK] Node.js found
node --version

REM Check npm
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm not found
    pause
    exit /b 1
)

echo [OK] npm found

REM Install dependencies
echo.
echo Installing dependencies...
cd /d "%~dp0"
npm install --silent

if %errorlevel% neq 0 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
)

REM Install pkg globally if not present
npm list -g pkg >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing pkg...
    npm install -g pkg --silent
)

REM Build executable
echo.
echo Building printserver-agent.exe...
npm run build

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo   BUILD SUCCESSFUL!
    echo.
    echo   Executable: dist\printserver-agent.exe
    echo.
    echo   To run:
    echo     dist\printserver-agent.exe
    echo.
    echo   To install as Windows service:
    echo     dist\printserver-agent.exe --service
    echo ========================================
) else (
    echo.
    echo [ERROR] Build failed
)

pause