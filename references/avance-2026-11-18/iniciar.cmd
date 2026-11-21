@echo off
setlocal
cd /d "%~dp0"
title YinYan Workshop - Chatbot local
echo.
echo YinYan Workshop - Ejecucion local, sin internet
echo El navegador se abrira cuando el servidor este listo.
echo Manten esta ventana abierta mientras usas el chatbot.
echo.
if exist "runtime\node.exe" (
  "runtime\node.exe" "scripts\serve.mjs" --open
  goto end
)
if exist "..\.runtime\node.exe" (
  "..\.runtime\node.exe" "scripts\serve.mjs" --open
  goto end
)
where node >nul 2>nul
if not errorlevel 1 (
  node "scripts\serve.mjs" --open
  goto end
)
if exist "runtime\python\python.exe" (
  "runtime\python\python.exe" "scripts\serve.py" --open
  goto end
)
where py >nul 2>nul
if not errorlevel 1 (
  py -3 "scripts\serve.py" --open
  goto end
)
where python >nul 2>nul
if not errorlevel 1 (
  python "scripts\serve.py" --open
  goto end
)
echo No se encontro Node.js ni Python en esta computadora.
echo Instala Node.js 22 o Python 3.12 y vuelve a abrir iniciar.cmd.
echo Consulta docs\EJECUTAR-EN-LOCAL.md para configurar tu copia del repositorio.
:end
if errorlevel 1 echo No se pudo completar el inicio. Consulta LEEME-PRIMERO.txt.
pause
