@echo off
setlocal
cd /d "%~dp0.."
set "PYTHONUTF8=1"
set "PYTHONDONTWRITEBYTECODE=1"
if exist "runtime\python\python.exe" goto bundled
if exist "..\.runtime\python\python.exe" goto workspace
where py >nul 2>nul
if not errorlevel 1 goto installedpy
where python >nul 2>nul
if not errorlevel 1 goto installedpython
echo Falta Python. Instala Python y las dependencias de requirements-lock.txt.
echo Consulta docs\EJECUTAR-EN-LOCAL.md para configurar tu copia del repositorio.
exit /b 1
:bundled
"runtime\python\python.exe" %*
exit /b %errorlevel%
:workspace
"..\.runtime\python\python.exe" %*
exit /b %errorlevel%
:installedpy
py -3 %*
exit /b %errorlevel%
:installedpython
python %*
exit /b %errorlevel%
