@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo Flight Copilot - SimConnect self-check
echo Start MSFS 2020 and load into a flight first (not the main menu).
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0selfcheck.ps1"
echo.
echo Result written to selfcheck-result.txt
pause
