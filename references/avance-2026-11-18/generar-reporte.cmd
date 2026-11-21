@echo off
setlocal
cd /d "%~dp0"
call scripts\run-python.cmd scripts\generate-report.py
pause
