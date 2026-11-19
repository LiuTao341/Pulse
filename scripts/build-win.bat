@echo off
chcp 65001 >nul
REM 在本机拉取最新代码并打包（需要 Node.js 和 Rust），exe 输出到 release\ 文件夹
cd /d "%~dp0.."
git pull
call npm install || goto :err
call npx tauri build || goto :err
if not exist release mkdir release
copy /y src-tauri\target\release\pulse.exe release\Pulse-portable.exe >nul
echo.
echo 构建完成：
start "" "%cd%\release"
goto :eof
:err
echo 构建失败，请查看上面的错误信息。
pause
