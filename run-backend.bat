@echo off
cd /d "%~dp0backend"
if not exist venv (
  echo [Smart Parking] Tao moi truong ao Python...
  python -m venv venv || (echo Khong tim thay Python. Hay cai Python 3.10+ va tick "Add to PATH". & pause & exit /b 1)
  venv\Scripts\python -m pip install -r requirements.txt
)
venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
pause
