@echo off
chcp 65001 >nul
title Sudo - Intune-Paket
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0intune\intune-paket.ps1"
pause
