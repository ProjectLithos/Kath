@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
set "KATH_ROOT=%~dp0"
set "KATH_ROOT=%KATH_ROOT:~0,-1%"
set /p KATH_VERSION=<"%KATH_ROOT%\VERSION"
set "KATH_NPM=%KATH_ROOT%\.toolchain\Node\npm.cmd"
set "KATH_NODE=%KATH_ROOT%\.toolchain\Node\node.exe"
set "KATH_PYTHON=%KATH_ROOT%\.toolchain\Python\python.exe"
set "KATH_NPM_PREFIX=%KATH_ROOT%\.toolchain\NpmWorkspace"
set "ELECTRON_MAIN=%KATH_ROOT%\applications\electron\lib\backend\electron-main.js"
if not exist "%KATH_NPM%" goto NotBuilt
if not exist "%KATH_NODE%" goto NotBuilt
if not exist "%KATH_PYTHON%" goto NotBuilt
if not exist "%ELECTRON_MAIN%" goto NotBuilt
set "PATH=%KATH_ROOT%\.toolchain\Node;%KATH_ROOT%\.toolchain\Python;%PATH%"
set "npm_config_python=%KATH_PYTHON%"
set "PYTHON=%KATH_PYTHON%"
set "NODE_ENV=development"
set "KATH_ROOT=%KATH_ROOT%"
for %%I in ("%KATH_ROOT%\..\Inu\SDK") do set "INU_SDK_ROOT=%%~fI"
echo [INFO] Starting Kath %KATH_VERSION%...
call "%KATH_NPM%" --prefix "%KATH_NPM_PREFIX%" run start --workspace @kath/electron
exit /b !ERRORLEVEL!
:NotBuilt
echo [FAIL] Kath %KATH_VERSION% has not been built completely for the current source.
echo [INFO] Run the root Build.bat once, then use Run-Kath.bat again.
exit /b 1
