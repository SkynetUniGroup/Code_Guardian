<#
.SYNOPSIS
    Installs Husky 9.1.7 in the Git repository root and configure hooks.
.DESCRIPTION
    This script:
    1. Verifies Git is installed and in PATH
    2. Automatically finds the Git repository root
    3. Verifies pnpm is installed
    4. Installs Husky 9.1.7 in the root using pnpm (--ignore-workspace)
    5. Runs husky Install
    Generated files (node_modules/, .husky/_/, package.json, pnpm-lock.yaml) must NOT be versioned.
#>

# Checks if Git is available and in PATH
try {
    git --version | Out-null
} catch {
    Write-Error "Git is not installed or not in PATH. Husky requires Git."
    exit 1
}

# Finds the Git repository root
try {
    $gitRoot = git rev-parse --show-toplevel
    if (-not $gitRoot) {
        throw "Unable to determine the Git repository root."
    }
} catch {
    Write-Error "Error detecting Git root: $_"
    exit 1
}

# Verifies pnpm is available
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error "pnpm is not installed or not in PATH."
    exit 1
}

Write-Host "Found Git repository root: $gitRoot"
Write-Host "Installing Husky 9.1.7..."

# Changes directory to the root
Set-Location $gitRoot

# Installs Husky 9.1.7 as a dev dependency (ignores workspaces)
try {
    pnpm add husky@9.1.7 -D --ignore-workspace
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm add husky failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Error "Error during Husky installation: $_"
    exit 1
}

# Runs husky
try {
    pnpm exec husky
    if ($LASTEXITCODE -ne 0) {
        throw "husky install failed with exit code $LASTEXITCODE"
    }
} catch {
    Write-Error "Error during husky install: $_"
    exit 1
}

Write-Host "`n Husky installed successfully in $gitRoot"
Write-Host "Generated files (node_modules/, .husky/_/, package.json, pnpm-lock.yaml) must NOT be versioned."
Write-Host "Ensure the .gitignore file in the root is up to date."