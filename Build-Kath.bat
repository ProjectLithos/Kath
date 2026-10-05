@echo off
setlocal EnableExtensions
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0Build-Kath.ps1" %*
exit /b %ERRORLEVEL%
