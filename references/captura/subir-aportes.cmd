@echo off
setlocal
cd /d "%~dp0"
title YinYan - Subir aportes del equipo
where git >nul 2>nul
if errorlevel 1 goto missinggit
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto missingrepo
set "repo_prefix="
for /f "delims=" %%G in ('git rev-parse --show-prefix') do set "repo_prefix=%%G"
if defined repo_prefix goto wrongroot
echo Guardando consultas, ejemplos y jornadas del equipo...
set "record_paths=data/team"
if exist "data\training\" set "record_paths=data/team data/training"
git add -- %record_paths%
if errorlevel 1 goto failed
git diff --cached --quiet -- %record_paths%
if not errorlevel 1 goto push
git commit --only -m "Consultas, ejemplos y jornadas del equipo YinYan" -- %record_paths%
if errorlevel 1 goto failed
:push
git push
if errorlevel 1 goto failed
echo.
echo Aportes enviados. Tu companero puede abrir recibir-aportes.cmd.
goto end
:missinggit
echo Instala Git para Windows y configura el repositorio del equipo.
goto end
:missingrepo
echo Esta carpeta todavia no es una copia Git del proyecto.
echo Sigue docs\publicar-en-github.md antes de usar este boton.
goto end
:failed
echo No se pudieron subir los aportes. Revisa el mensaje de Git.
echo Los registros y los commits locales permanecen guardados.
goto end
:wrongroot
echo Abre este archivo desde la carpeta raiz del repositorio YinYan.
:end
pause
