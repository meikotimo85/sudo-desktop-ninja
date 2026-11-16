@echo off
chcp 65001 >nul
title Sudo - Entra-Setup
rem Startet das Entra-Setup der Sudo-Zentrale (Windows PowerShell 5.1). Parameter werden durchgereicht,
rem z. B.  Sudo-Entra-Setup.cmd -Pruefen -ZentraleUrl https://sudo.meikosoft.net
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sudo-Entra-Setup.ps1" %*
echo.
pause
