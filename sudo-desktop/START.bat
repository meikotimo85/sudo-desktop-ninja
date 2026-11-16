@echo off
chcp 65001 >nul
title Sudo - Desktop-Ninja
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Ich installiere die LTS-Version per winget ...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo Fertig. Bitte dieses Fenster schliessen und START.bat noch einmal doppelklicken.
  pause
  exit /b
)

rem Neue Abhaengigkeiten seit 1.1 (z. B. japanische Schrift) ebenfalls nachladen
set FEHLT=
if not exist node_modules set FEHLT=1
if not exist node_modules\@fontsource\dotgothic16\package.json set FEHLT=1
if defined FEHLT (
  echo Erster Start: Abhaengigkeiten werden geladen, das dauert ein bis zwei Minuten ...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo Installation fehlgeschlagen. & pause & exit /b 1 )
)

echo Sudo startet. Dieses Fenster offen lassen, Schliessen beendet Sudo.
call npm start
