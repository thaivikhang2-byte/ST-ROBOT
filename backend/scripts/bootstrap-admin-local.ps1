$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$credentialFile = Join-Path $repoRoot '.private/admin-bootstrap.env'
if (!(Test-Path -LiteralPath $credentialFile)) { throw 'Missing .private/admin-bootstrap.env' }
$values = @{}
Get-Content -LiteralPath $credentialFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { $values[$matches[1]] = $matches[2].Trim() }
}
if (!$values['BOOTSTRAP_ADMIN_EMAIL'] -or !$values['BOOTSTRAP_ADMIN_PASSWORD']) {
    throw 'Fill the private bootstrap email and password before running this operator command.'
}
Push-Location $repoRoot
try {
    $arguments = @('compose', '--profile', 'tools', 'run', '--rm')
    foreach ($key in $values.Keys) {
        [Environment]::SetEnvironmentVariable($key, $values[$key], 'Process')
        $arguments += @('-e', $key)
    }
    $arguments += @('db-tools', 'npx', 'ts-node', 'scripts/bootstrap-admin.ts')
    & docker @arguments
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap failed; credentials were not printed.' }
} finally {
    foreach ($key in $values.Keys) { [Environment]::SetEnvironmentVariable($key, $null, 'Process') }
    Pop-Location
}
