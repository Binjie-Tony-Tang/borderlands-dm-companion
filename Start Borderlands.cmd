@echo off
setlocal EnableExtensions DisableDelayedExpansion

if not exist "%~dp0launch_borderlands.py" goto missing_launcher
set "launch_mode="
if /i "%~1"=="--no-browser" set "launch_mode=--no-browser"

py -3 -c "import sys; raise SystemExit(sys.version_info < (3, 9))" >nul 2>&1
if errorlevel 1 goto try_python
py -3 "%~dp0launch_borderlands.py" %launch_mode%
goto launch_finished

:try_python
python -c "import sys; raise SystemExit(sys.version_info < (3, 9))" >nul 2>&1
if errorlevel 1 goto missing_python
python "%~dp0launch_borderlands.py" %launch_mode%

:launch_finished
set "launch_code=%errorlevel%"
if "%launch_code%"=="0" exit /b 0
echo.
echo Borderlands could not start. See the error above.
pause
exit /b %launch_code%

:missing_launcher
echo Borderlands could not start. launch_borderlands.py is missing from the project folder.
pause
exit /b 1

:missing_python
echo Borderlands could not start. Install Python 3.9 or later for Windows and try again.
pause
exit /b 1
