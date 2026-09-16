# Python slim image. 3.12 not 3.14: it is the minimum declared in pyproject
# (requires-python = ">=3.12") and it is the version for which prebuilt
# wheels exist for the whole langchain/langgraph stack — on 3.14 pip would
# try to build them from source.
FROM python:3.12-slim

WORKDIR /app

# No system packages to install: nothing is compiled here.
# (The previous line used `apk`, which is Alpine's and on this Debian
# image does not even exist: the build failed on the second instruction.)

# Copy dependency management files and source code
COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install project dependencies
RUN pip install --no-cache-dir -e ".[dev]"

# Pre-download the Semgrep rulesets into the image, so the first scan does
# not pay the download cost (and does not depend on the network at runtime).
#
# An empty folder is analyzed: there is nothing to find, but the rule
# download still happens and that is what we want to cache.
# `--metrics=off` disables telemetry to semgrep.dev; `|| true` ensures
# that a non-zero exit code (no network at build time, for example) does
# not break the image — at worst the download repeats on first use.
RUN mkdir -p /tmp/warmup && semgrep --config p/owasp-top-ten --metrics=off /tmp/warmup 2>/dev/null || true

# Copy prompt templates
COPY prompts ./prompts

# Expose internal port
EXPOSE 8000

# Healthcheck via urllib: the slim image has no curl and installing it just
# for this is not worth the extra layer.
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status == 200 else 1)"

# Configure ENTRYPOINT for FastAPI via Uvicorn (points to src/main.py)
ENTRYPOINT ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
