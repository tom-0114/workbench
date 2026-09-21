@echo off
cd /d "%~dp0"
set "WEB_BASE_PATH=/workbench/"
node "%~dp0..\.deploy\deploy.mjs" workbench %*
pause
