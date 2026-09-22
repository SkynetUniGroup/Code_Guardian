# Code Guardian

Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026

[![Link al sito web](https://skynetunigroup.github.io/Code_Guardian/)](https://skynetunigroup.github.io/Code_Guardian/)

> Il progetto Code Guardian mira a fornire un sistema intelligente per l'analisi del codice sorgente, con lo scopo di migliorare la sicurezza, la leggibilità e la conformità degli standard di programmazione all'interno dei repository GitHub. È concepito come una piattaforma modulare e personalizzabile in grado di offrire analisi tecniche e business-oriented.

- [Documentazione completa e tracciata](Documentazione) del progetto sviluppata durante l'intero ciclo di vita
- [Specifica delle funzionalità di MVP e architettura](Documentazione/LaTeX/Progettazione/Progettazione MVP.tex) avanzata in termini concettuali e tecnologici
- [Codice e documentazione generata in tempo reale](Src/MVP/backend) per il prodotto MVP

## Features

- Analisi automatizzata del codice sorgente
- Integrazione con GitHub per gestire repository e repository privati
- Rilevamento di vulnerabilità di sicurezza con OWASP scans
- Generazione di rapporti tecnici
- Monitoraggio di complessità e criticità
- Analisi di conformità con policy business e standard interni
- Interfaccia frontend con funzionalità di visualizzazione avanzata e gestione task
- Architettura modulare e configurabile via backend
- Orchestrazione avanzata e reporting
- Supporto ai templates e integrazione di documentazione (README, API docs, etc.)

## Prerequisites

- Node.js (>=18.x) per frontend e backend
- Docker e Docker Compose per gli ambienti di testing e deployment
- Python 3.10+ per modelli agenti ed estrazione testi
- MongoDB per immagazzinamento dati interni
- GitHub repository accessibile tramite API (token necessario)

## Installation

```bash
# Clone the repository
git clone https://github.com/skynetunigroup/Code_Guardian.git
cd Code_Guardian

# Per avviare l'ambiente MVP (backend, frontend e infrastruttura) utilizzare:
cd Src/MVP
docker-compose up --build
```

## Configuration

- Per configurazioni di ambiente specifiche (token di accesso a GitHub, API, ecc.), consultare `.env.example` nei folder specifici (`Src/MVP/backend`, `Src/MVP/agents`).
- Per le configurazioni avanzate, leggere i documenti di riferimento in `Documentazione/LaTeX/Piano di Progetto`.

## Project Structure

- `Documentazione/`: contiene documenti gestionali (Verbali, Candidature, etc.) e tecnici (Analisi Requisiti, Specifiche Tecniche, ecc.)
- `Src/`: codice sorgente del prodotto MVP e del PoC
- `Tools/`: utilità ausiliarie
- `Website/`: sito statico del progetto

```text
Code_Guardian/
├── .github/             # Configurazioni CI/CD
├── Documentazione/     # Tutta la documentazione del progetto
├── Src/                # Sorgenti dei prodotti e componenti
│   ├── MVP/            # Prodotto Minimo Funzionale completato
│   │   ├── agents/     # Moduli di analisi automatica
│   │   ├── backend/    # Backend NestJS del sistema
│   │   ├── frontend/   # Frontend Vite/Nuxt
│   │   └── infra/      # Architettura cloud e deploy
│   └── PoC/            # Prova di concetto iniziale
├── Tools/              # Strumenti di supporto
└── Website/            # Sito web statico con documentazione
```

## License
[MIT License](LICENSE)
