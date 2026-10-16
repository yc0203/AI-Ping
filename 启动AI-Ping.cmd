@echo off
if exist "%~dp0dist\win-unpacked\AI-Ping.exe" (
  start "" "%~dp0dist\win-unpacked\AI-Ping.exe"
  exit /b
)
if exist "%~dp0release\win-unpacked\AI-Ping.exe" (
  start "" "%~dp0release\win-unpacked\AI-Ping.exe"
  exit /b
)
echo Build AI-Ping first or download the portable ZIP from GitHub Releases.
echo https://github.com/yc0203/AI-Ping/releases/latest
pause
