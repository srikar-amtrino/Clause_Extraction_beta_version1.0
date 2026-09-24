@echo off
rem Start the Celery worker on every pipeline queue. Same steps as run_worker.ps1.
setlocal
cd /d "%~dp0.."

set "PY=python"
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"

"%PY%" manage.py migrate --plan --check
if errorlevel 1 (
    echo.
    echo The database is not ready - see above. To apply migrations, run:  python manage.py migrate
    exit /b 1
)

"%PY%" -m celery -A accorder_backend worker -Q streaming_io_queue,parsing_queue,llm_queue,default -l INFO --pool=solo
