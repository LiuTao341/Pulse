@echo off
chcp 65001 >nul
REM 在本机拉取最新代码并打包，exe 输出到 release\ 文件夹
cd /d "%~dp0.."
git pull
call npm install || goto :err
call npm run dist || goto :err
echo.
echo 构建完成，exe 在 release 文件夹：
start "" "%cd%\release"
goto :eof
:err
echo 构建失败，请查看上面的错误信息。
pause
