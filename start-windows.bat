@echo off
rem Blueprint Studio - double-click to run on this computer.
rem First run sets things up (about a minute); after that it starts in seconds.
title Blueprint Studio
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto nopython

if not exist ".venv\Scripts\python.exe" (
    echo Setting up Blueprint Studio for the first time...
    %PY% -m venv .venv
    if errorlevel 1 goto nopython
)

".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 goto failed

set "BPS_OPEN_BROWSER=1"
".venv\Scripts\python.exe" wsgi.py
pause
exit /b 0

:nopython
echo.
echo Python 3.10 or newer is needed. Get it from https://www.python.org/downloads/
echo During install, tick "Add python.exe to PATH", then run this file again.
echo.
pause
exit /b 1

:failed
echo.
echo Setup failed - see the message above. Check your internet connection and try again.
echo.
pause
exit /b 1
