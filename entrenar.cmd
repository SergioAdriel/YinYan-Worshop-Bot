@echo off
setlocal
cd /d "%~dp0"
title YinYan Workshop - Nueva jornada de entrenamiento
echo Entrenando dos clasificadores con la base y los ejemplos aprobados.
echo Se guardara una jornada nueva y provisional, sin reemplazar el modelo activo.
echo Para registrar un responsable, usa la pagina o ejecuta entrenar.cmd --author sergio
call scripts\run-python.cmd -m src.training_runs start %*
pause
