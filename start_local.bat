@echo off
rem ================================================================
rem  Smart Parking - chay Local 1 cham (nhap dup file nay)
rem  Mo 2 cua so song song: Backend :8000 va Frontend :5173 (0.0.0.0 -> may khac trong LAN / ESP32 goi duoc)
rem  Cau hinh (DATABASE_URL, SEPAY_API_KEY...) nam trong backend\.env
rem ================================================================
setlocal
chcp 65001 >nul
title Smart Parking - Khoi dong Local
set "ROOT=%~dp0"
set "PY=C:\Users\LENOVO\AppData\Local\Programs\Python\Python312\python.exe"
if not exist "%PY%" set "PY=python"

echo.
echo  [1/3] Kiem tra Backend (Python venv + thu vien)...
if not exist "%ROOT%backend\venv\Scripts\python.exe" (
  echo        Tao moi truong ao backend\venv ...
  "%PY%" -m venv "%ROOT%backend\venv" || (echo  [LOI] Khong tao duoc venv - kiem tra Python 3.10+ & pause & exit /b 1)
  "%ROOT%backend\venv\Scripts\python.exe" -m pip install -r "%ROOT%backend\requirements.txt" || (echo  [LOI] Cai thu vien Python that bai & pause & exit /b 1)
)
if not exist "%ROOT%backend\.env" (
  echo        Chua co backend\.env - backend se dung SQLite backend\parking.db
)

echo  [2/3] Kiem tra Frontend (node_modules)...
where npm >nul 2>nul || (echo  [LOI] Khong tim thay Node.js / npm - cai Node.js LTS roi chay lai & pause & exit /b 1)
if not exist "%ROOT%frontend\node_modules" (
  echo        Cai thu vien frontend ^(npm install^) ...
  pushd "%ROOT%frontend" & call npm install & popd
)

echo  [3/3] Mo 2 cua so Backend + Frontend...
start "Smart Parking - BACKEND :8000" cmd /k "cd /d "%ROOT%backend" && venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
start "Smart Parking - FRONTEND :5173" cmd /k "cd /d "%ROOT%frontend" && npm run dev -- --host 0.0.0.0 --port 5173 --strictPort"

rem Dia chi IP LAN de dien thoai / ESP32 cung Wi-Fi truy cap
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do if not defined LANIP set "LANIP=%%b"
)

echo.
echo  ===============================================================
echo   Web (may nay)      : http://localhost:5173
if defined LANIP echo   Dien thoai cung LAN: http://%LANIP%:5173
echo   API / Swagger      : http://localhost:8000/docs
if defined LANIP echo   ESP32 / Webcam ALPR: http://%LANIP%:8000/api/hardware/...
echo   Dung server: dong 2 cua so BACKEND / FRONTEND (hoac Ctrl+C)
echo  ===============================================================
echo.
rem Cho backend khoi dong roi mo trinh duyet
timeout /t 6 /nobreak >nul
start "" http://localhost:5173
endlocal
