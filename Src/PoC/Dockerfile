# Immagine dell'app code-guardian: CLI, non un servizio a lunga esecuzione.
# Multi-stage non necessario (nessuna compilazione nativa nelle dipendenze).
FROM python:3.12-slim

WORKDIR /app

# `make` non è incluso nell'immagine slim: serve per riusare gli stessi
# target (`make test`, `make coverage`) dell'installazione nativa.
RUN apt-get update \
    && apt-get install -y --no-install-recommends make \
    && rm -rf /var/lib/apt/lists/*

# Livello separato per le dipendenze: cambia raramente, resta in cache anche
# se il codice sorgente cambia ad ogni commit.
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir -e ".[dev]"

# Il resto del progetto (Makefile, esempi, script, test): cambia più spesso.
COPY Makefile ./
COPY examples ./examples
COPY scripts ./scripts
COPY tests ./tests

# ENTRYPOINT fisso sulla CLI: gli argomenti si passano dopo il nome
# dell'immagine/servizio, es. `docker compose run code-guardian owasp --repo ...`.
# CMD vuoto (non "--help"): senza argomenti la CLI entra nella modalità
# guidata, coerente con `python -m code_guardian.cli` lanciato a mani nude.
ENTRYPOINT ["python3", "-m", "code_guardian.cli"]
CMD []
