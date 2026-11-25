@echo off
setlocal
cd /d "%~dp0"
title YinYan Workshop - Jupyter local
call scripts\run-python.cmd scripts\notebook-local.py %*
pause
