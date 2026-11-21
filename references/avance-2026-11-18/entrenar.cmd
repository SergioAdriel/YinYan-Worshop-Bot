@echo off
setlocal
cd /d "%~dp0"
title YinYan Workshop - Simulacion de 15 dias
echo Recreando los modelos de los 15 dias simulados.
echo Los ejemplos propios se entrenan desde la pestana Enseñarle de la pagina.
call scripts\run-python.cmd -m src.simulation
pause
