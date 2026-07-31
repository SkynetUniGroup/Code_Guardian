# Immagine slim di Python
FROM python:3.12-slim

WORKDIR /app

# Installiamo make per eventuali dipendenze di sistema (opzionale)
RUN apt-get update \
    && apt-get install -y --no-install-recommends make \
    && rm -rf /var/lib/apt/lists/*

# Copiamo la gestione dipendenze
COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Installiamo le dipendenze
RUN pip install --no-cache-dir -e ".[dev]"

COPY prompts ./prompts

# Esponiamo la porta interna
EXPOSE 8000

# ENTRYPOINT configurato per FastAPI tramite Uvicorn (punta a src/main.py)
ENTRYPOINT ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]