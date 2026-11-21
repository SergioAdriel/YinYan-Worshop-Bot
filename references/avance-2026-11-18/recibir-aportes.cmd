@echo off
setlocal
cd /d "%~dp0"
title YinYan - Recibir aportes del equipo
where git >nul 2>nul
if errorlevel 1 goto missinggit
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto missingrepo
set "repo_prefix="
for /f "delims=" %%G in ('git rev-parse --show-prefix') do set "repo_prefix=%%G"
if defined repo_prefix goto wrongroot
echo Recibiendo cambios del equipo...
git pull --ff-only
if errorlevel 1 goto failed
echo.
echo Listo. Abre iniciar.cmd y pulsa Actualizar en Consultas.
echo Si llegaron ejemplos nuevos, vuelve a entrenar en esta computadora.
goto end
:missinggit
echo Instala Git para Windows y configura el repositorio del equipo.
goto end
:missingrepo
echo Esta carpeta todavia no es una copia Git del proyecto.
echo Sigue docs\publicar-en-github.md antes de usar este boton.
goto end
:failed
echo No se pudieron recibir los cambios. Revisa el mensaje de Git.
echo Tus registros locales se conservan. No borres archivos para resolverlo.
goto end
:wrongroot
echo Abre este archivo desde la carpeta raiz del repositorio YinYan.
:end
pause
