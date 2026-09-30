# Start the Celery worker on every pipeline queue.
#
#   powershell -ExecutionPolicy Bypass -File scripts\run_worker.ps1
#
# Refuses to start while the database is behind its migrations: the worker
# would write rows the schema cannot hold. It never migrates by itself -- the
# database is shared, so `python manage.py migrate` is run on purpose.
#
# --pool=solo because Celery's default pool does not run on Windows.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { $python = 'python' }

& $python manage.py migrate --plan --check
if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'The database is not ready - see above. To apply migrations, run:  python manage.py migrate' -ForegroundColor Yellow
    exit 1
}

& $python -m celery -A accorder_backend worker -Q streaming_io_queue,parsing_queue,llm_queue,default -l INFO --pool=solo
exit $LASTEXITCODE
