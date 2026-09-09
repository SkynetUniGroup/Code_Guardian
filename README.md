# Code Guardian

> **Code Guardian** è la piattaforma sviluppata dal gruppo SkyNet per il corso di Ingegneria del Software (a.a. 2025/2026) che automatizza l'analisi di repository software. Il progetto offre strumenti per la generazione di changelog, documentazione tecnica, analisi di sicurezza (OWASP) e verifica delle policy di progetto, integrandosi con GitHub per fornire report dettagliati e actionable.

## Table of Contents
- [Features](#features)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Available Scripts](#available-scripts)
- [CI/CD Workflows](#cicd-workflows)
- [Documentation](#documentation)
- [License](#license)

## Features
- **Analisi automatizzata di repository GitHub**:
  - Generazione di changelog tecnici e di business.
  - Documentazione inline e README aggiornati.
  - Scansione di vulnerabilità OWASP e verifica delle policy di sicurezza.
- **Architettura modulare**:
  - Backend in NestJS con supporto per autenticazione JWT e gestione delle credenziali.
  - Agenti Python per l'elaborazione dei task (LLM-based).
  - Frontend in React con interfaccia utente reattiva e real-time (WebSocket).
- **Infrastruttura cloud**:
  - Deploy su AWS con CDK (CloudFormation).
  - Supporto per MongoDB Atlas e storage S3.
- **Testing e qualità**:
  - Test end-to-end (Playwright), unitari (Vitest/Jest) e di integrazione.
  - Linting con ESLint, Prettier e Biome.

## Project Structure
```text
.
├── .github/workflows/          # CI/CD pipelines (GitHub Actions)
├── Documentazione/             # Documenti ufficiali del progetto (LaTeX/PDF)
│   ├── Analisi dei Requisiti/
│   ├── Norme di Progetto/
│   ├── Piano di Progetto/
│   ├── Piano di Qualifica/
│   └── Verbali/
├── Src/
│   ├── MVP/                    # Implementazione Minimal Viable Product
│   │   ├── agents/             # Agenti Python per l'analisi dei repository
│   │   ├── backend/            # Backend NestJS (API, autenticazione, task)
│   │   ├── frontend/           # Frontend React (UI, routing, store)
│   │   └── infra/              # Infrastruttura AWS (CDK)
│   └── PoC/                    # Proof of Concept (versione iniziale)
├── Tools/                      # Script di supporto (es. calcolo indici)
├── Website/                    # Sito web statico del progetto
└── LICENSE                     # Licenza del progetto
```

## Prerequisites
- **Node.js** >= 20.x (per backend/frontend)
- **Python** >= 3.10 (per gli agenti)
- **Docker** (per l'esecuzione locale dei container)
- **pnpm** (gestore di pacchetti consigliato)
- **AWS CLI** e **CDK** (per il deploy dell'infrastruttura)
- **MongoDB Atlas** (per il database)

## Installation
1. Clona il repository e installa le dipendenze:
```bash
git clone https://github.com/SkyNetUniGroup/Code_Guardian.git
cd Code_Guardian/Src/MVP

# Installa le dipendenze per backend e frontend
pnpm install --frozen-lockfile
```

2. Configura gli agenti Python:
```bash
cd agents
pip install -r requirements.txt
```

## Configuration
Crea un file `.env` nel backend basato su `.env.example`:
```ini
# Backend (NestJS)
DATABASE_URL=mongodb+srv://<user>:<password>@cluster0.example.mongodb.net/codeguardian
JWT_SECRET=your_jwt_secret_key
GITHUB_APP_ID=your_github_app_id
GITHUB_PRIVATE_KEY=your_github_private_key
AWS_REGION=eu-south-1
```

## Usage
### Esecuzione locale
1. Avvia i servizi con Docker Compose:
```bash
cd Src/MVP
docker-compose up --build
```

2. Avvia il frontend in modalità sviluppo:
```bash
cd frontend
pnpm dev
```

3. Avvia il backend:
```bash
cd backend
pnpm start:dev
```

### Deploy su AWS
```bash
cd infra
pnpm deploy:prod
```

## Available Scripts
### Backend (NestJS)
| Comando               | Descrizione                          |
|-----------------------|--------------------------------------|
| `pnpm start`          | Avvia il server in produzione.       |
| `pnpm start:dev`      | Avvia il server in modalità sviluppo.|
| `pnpm test`           | Esegue i test unitari.                |
| `pnpm test:e2e`       | Esegue i test end-to-end.             |
| `pnpm lint`           | Esegue il linting del codice.         |

### Frontend (React)
| Comando               | Descrizione                          |
|-----------------------|--------------------------------------|
| `pnpm dev`            | Avvia il server di sviluppo.         |
| `pnpm build`          | Crea la build di produzione.         |
| `pnpm test`           | Esegue i test con Vitest.            |
| `pnpm e2e`            | Esegue i test end-to-end con Playwright. |

### Agenti (Python)
| Comando               | Descrizione                          |
|-----------------------|--------------------------------------|
| `python -m src.main`  | Avvia l'agente principale.           |
| `pytest`              | Esegue i test degli agenti.           |

## CI/CD Workflows
I workflow GitHub Actions includono:
- **CI Staging**: Esegue test e linting su ogni push.
- **PR Check**: Verifica la qualità del codice per le pull request.
- **Release**: Gestisce il versionamento e il deploy automatico.
- **Static Analysis**: Analisi statica del codice con SonarQube.

## Documentation
La documentazione ufficiale è disponibile nella cartella `Documentazione/`:
- [Analisi dei Requisiti](Documentazione/LaTeX/Analisi%20dei%20Requisiti/Analisi%20dei%20Requisiti.tex)
- [Norme di Progetto](Documentazione/LaTeX/Norme%20di%20Progetto/Norme%20di%20Progetto.tex)
- [Piano di Progetto](Documentazione/LaTeX/Piano%20di%20Progetto/Piano%20di%20Progetto.tex)
- [Piano di Qualifica](Documentazione/LaTeX/Piano%20di%20Qualifica/Piano%20di%20Qualifica.tex)

## License
Il progetto è rilasciato sotto licenza **MIT**. Vedi il file [LICENSE](LICENSE) per i dettagli.
