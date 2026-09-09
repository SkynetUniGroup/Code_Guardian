# Python slim image. 3.12 e non 3.14: e' il minimo dichiarato in pyproject
# (requires-python = ">=3.12") ed e' la versione per cui esistono wheel
# precompilate di tutto lo stack langchain/langgraph — su 3.14 pip proverebbe a
# compilarle dai sorgenti.
FROM python:3.12-slim

WORKDIR /app

# Nessun pacchetto di sistema da installare: qui non si compila nulla.
# (La riga precedente usava `apk`, che e' di Alpine e su questa immagine
# Debian non esiste nemmeno: il build falliva alla seconda istruzione.)

# Copy dependency management files and source code
COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install project dependencies
RUN pip install --no-cache-dir -e ".[dev]"

# Pre-scarica i ruleset Semgrep dentro l'immagine, cosi' la prima scansione non
# paga il download (e non dipende dalla rete a runtime).
#
# Si analizza una cartella vuota: non c'e' nulla da trovare, ma il download
# delle regole avviene comunque ed e' quello che si vuole mettere in cache.
# `--metrics=off` disattiva la telemetria verso semgrep.dev; `|| true` fa si'
# che un exit code diverso da zero (rete assente in fase di build, per dire)
# non rompa l'immagine — al massimo il download si ripete al primo utilizzo.
RUN mkdir -p /tmp/warmup && semgrep --config p/owasp-top-ten --metrics=off /tmp/warmup 2>/dev/null || true

# Copy prompt templates
COPY prompts ./prompts

# Expose internal port
EXPOSE 8000

# Healthcheck via urllib: l'immagine slim non ha curl e installarlo solo per
# questo non vale il livello in piu'.
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=20s \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status == 200 else 1)"

# Configure ENTRYPOINT for FastAPI via Uvicorn (points to src/main.py)
ENTRYPOINT ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
