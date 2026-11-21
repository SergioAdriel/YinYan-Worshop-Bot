@echo off
setlocal
cd /d "%~dp0"
title YinYan Workshop - Reproducir notebook local
call scripts\run-python.cmd -m src.create_notebook
pause
