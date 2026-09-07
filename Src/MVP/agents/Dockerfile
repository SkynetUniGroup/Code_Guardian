# Python slim image
FROM python:3.12-slim

WORKDIR /app

# Install make for potential system dependencies (optional)
RUN apt-get update \
    && apt-get install -y --no-install-recommends make \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency management files and source code
COPY pyproject.toml ./
COPY src ./src
COPY tests ./tests

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install project dependencies
RUN pip install --no-cache-dir -e ".[dev]"

# Copy prompt templates
COPY prompts ./prompts

# Expose internal port
EXPOSE 8000

# Configure ENTRYPOINT for FastAPI via Uvicorn (points to src/main.py)
ENTRYPOINT ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]