@echo off
chcp 65001 >nul
REM Mo duong ham Cloudflare (Quick Tunnel) toi frontend Vite o cong 5173.
REM Can chay run-backend.bat va run-frontend.bat truoc.
REM Link cong khai dang https://xxxx.trycloudflare.com se hien trong cua so nay.
REM CANH BAO: ai co link deu vao duoc -> nen dat ma PIN Admin trong muc Cai dat.

set "CF=cloudflared"
where cloudflared >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles%\cloudflared\cloudflared.exe"
  if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" set "CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
)

"%CF%" tunnel --url http://localhost:5173
if errorlevel 1 (
  echo.
  echo Khong chay duoc cloudflared. Cai bang lenh: winget install --id Cloudflare.cloudflared
)
pause
