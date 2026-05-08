# =============================================================================
# refresh-shims.ps1
#
# Copies the canonical BitBox/portal-shim/portal-shim-standalone.js into
# each sub-app's static/ folder.
#
# Run from BitBox/portal-shim/ after editing the canonical file:
#
#   .\refresh-shims.ps1
#
# Output lists each destination and a brief OK/FAIL status.
# =============================================================================

$ErrorActionPreference = 'Stop'
$canonical = Join-Path $PSScriptRoot 'portal-shim-standalone.js'

if (-not (Test-Path $canonical)) {
    Write-Host "ERROR: canonical shim not found at $canonical" -ForegroundColor Red
    exit 1
}

# Each sub-app that consumes the shim. Add new entries here when more sub-apps
# adopt the Portal Host Contract.
$targets = @(
    (Join-Path $PSScriptRoot '..\planner\static\portal-shim-standalone.js'),
    (Join-Path $PSScriptRoot '..\purchasing\static\portal-shim-standalone.js')
)

$canonicalSize = (Get-Item $canonical).Length
Write-Host "Canonical: $canonical ($canonicalSize bytes)"
Write-Host ""

foreach ($target in $targets) {
    $resolved = [System.IO.Path]::GetFullPath($target)
    $destDir  = Split-Path -Parent $resolved
    if (-not (Test-Path $destDir)) {
        Write-Host "  SKIP   $resolved  (parent folder doesn't exist)" -ForegroundColor Yellow
        continue
    }
    try {
        Copy-Item -Path $canonical -Destination $resolved -Force
        $copiedSize = (Get-Item $resolved).Length
        if ($copiedSize -eq $canonicalSize) {
            Write-Host "  OK     $resolved" -ForegroundColor Green
        } else {
            Write-Host "  WARN   $resolved  (size mismatch: $copiedSize vs $canonicalSize)" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  FAIL   $resolved  ($($_.Exception.Message))" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Done. Reload each sub-app's page in the browser to pick up the new shim."
