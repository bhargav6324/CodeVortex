# Start the AI service for the team over Tailscale (http://100.114.163.7:8001).
# Run from ai-service/:  powershell -ExecutionPolicy Bypass -File run.ps1
Set-Location $PSScriptRoot
if (-not (Test-Path .env)) { Write-Error "Missing .env: copy .env.example to .env and fill in the values."; exit 1 }
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --no-server-header
