# Code Guardian Agents Service - Development Tasks

.PHONY: lint format test

# Default target
all: lint

# Lint all Python code (Black + Ruff)
lint: format-lint

# Run Black formatter check
format-check:
	@echo "🔍 Checking code formatting with Black..."
	@python -m black --check src/ tests/ 2>&1 || (echo "❌ Black formatting check failed" && exit 1)
	@echo "✅ Black formatting check passed!"

# Run Ruff linter check
ruff-check:
	@echo "🔍 Linting with Ruff..."
	@python -m ruff check src/ tests/ 2>&1 || (echo "❌ Ruff linting check failed" && exit 1)
	@echo "✅ Ruff linting check passed!"

# Combined: Format check + Ruff check
format-lint: format-check ruff-check

# Apply Black formatting
format:
	@echo "🎨 Formatting code with Black..."
	@python -m black src/ tests/
	@echo "✅ Code formatted with Black!"

# Apply Ruff auto-fixes
ruff-fix:
	@echo "🔧 Auto-fixing issues with Ruff..."
	@python -m ruff check --fix src/ tests/
	@echo "✅ Auto-fixes applied with Ruff!"

# Apply all fixes (Black + Ruff)
fix: format ruff-fix

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	@rm -rf dist/ __pycache__/ *.pyc
	@echo "✅ Cleaned build artifacts!"

# Install development dependencies
install-dev:
	@echo "📦 Installing development dependencies..."
	@pip install -e ".[dev]"
	@echo "✅ Development dependencies installed!"
