@echo off
chcp 65001 >nul
REM Mo tunnel ngrok voi ten mien co dinh toi frontend Vite (cong 5173).
REM Can chay run-backend.bat va run-frontend.bat truoc.
REM Link cong khai: https://frantic-mustang-endocrine.ngrok-free.dev
REM CANH BAO: ai co link deu vao duoc -> hay doi mat khau Admin mac dinh truoc khi chia se.

set "NG=ngrok"
where ngrok >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_*") do if exist "%%D\ngrok.exe" set "NG=%%D\ngrok.exe"
)

"%NG%" http --domain=frantic-mustang-endocrine.ngrok-free.dev 5173
if errorlevel 1 (
  echo.
  echo Khong chay duoc ngrok. Cai bang: winget install --id Ngrok.Ngrok
  echo Sau do them authtoken: ngrok config add-authtoken ^<token cua ban^>
)
pause
