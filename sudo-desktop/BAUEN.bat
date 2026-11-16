@echo off
chcp 65001 >nul
title Sudo - bauen
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Bitte zuerst START.bat ausfuehren, das installiert Node.js.
  pause
  exit /b 1
)

rem Neue Abhaengigkeiten seit 1.1 (z. B. japanische Schrift) ebenfalls nachladen
set FEHLT=
if not exist node_modules set FEHLT=1
if not exist node_modules\@fontsource\dotgothic16\package.json set FEHLT=1
if defined FEHLT (
  echo Abhaengigkeiten werden geladen ...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo Installation fehlgeschlagen. & pause & exit /b 1 )
)

echo.
echo  Was soll gebaut werden?
echo.
echo   [1] Portable EXE         - ohne Installation, zum Ausprobieren
echo   [2] Setup mit Updates    - fuer dich und Kollegen, aktualisiert sich selbst
echo   [3] MSI fuer Intune      - zentrale Verteilung, Installation fuer alle Benutzer
echo   [4] Alles                - 1 + 2 + 3
echo.
choice /c 1234 /n /m "Auswahl (1-4): "
set WAHL=%errorlevel%
if %WAHL%==1 set ZIEL=dist:portable
if %WAHL%==2 set ZIEL=dist:setup
if %WAHL%==3 set ZIEL=dist:msi
if %WAHL%==4 set ZIEL=dist:all

echo.
echo Baue ... das dauert ein paar Minuten. Beim ersten Mal laedt der Builder noch Werkzeuge nach.
call npm run %ZIEL%
if errorlevel 1 ( echo. & echo Build fehlgeschlagen. Bitte die Meldungen oben an Claude schicken. & pause & exit /b 1 )

echo.
echo Fertig. Die Dateien liegen im Ordner dist:
dir /b dist\*.exe dist\*.msi dist\latest.yml 2>nul
if %WAHL%==2 goto upd
if %WAHL%==4 goto upd
goto ende
:upd
echo.
echo Fuer automatische Updates diese Dateien auf deinen Webspace hochladen
echo (Adresse steht in package.json unter build.publish.url):
echo   - dist\latest.yml
echo   - dist\Sudo-Setup-*.exe
echo   - dist\Sudo-Setup-*.exe.blockmap
:ende
explorer dist
pause
