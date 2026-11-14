$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (Test-Path '.test-tmp/services.json') { throw 'Existing test settings detected. Start the named containers or explicitly archive the old test setup first.' }
$phasePassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
New-Item -ItemType Directory -Force '.test-tmp' | Out-Null
@{ databaseUrl = "postgresql://phase3:$phasePassword@127.0.0.1:55432/st_robot_phase3_test" } | ConvertTo-Json | Set-Content '.test-tmp/services.json'
docker run -d --name st-robot-phase3-test-postgres -e POSTGRES_USER=phase3 -e POSTGRES_DB=st_robot_phase3_test -e "POSTGRES_PASSWORD=$phasePassword" -p 127.0.0.1:55432:5432 postgres:16-alpine
if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable PostgreSQL; inspect Docker before retrying.' }
docker run -d --name st-robot-phase3-test-redis -p 127.0.0.1:56379:6379 redis:7-alpine redis-server --appendonly no
if ($LASTEXITCODE -ne 0) { throw 'Could not create disposable Redis; inspect Docker before retrying.' }
Write-Output 'Disposable services created. Wait for PostgreSQL readiness, then run node scripts/phase3-check.cjs migrate.'
