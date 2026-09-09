# Code Guardian

> Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026.

[![Web Version](https://img.shields.io/website-up-down-green-red/https%3A%2F%2Fskynetunigroup.github.io%2FCode_Guardian.svg)](https://skynetunigroup.github.io/Code_Guardian)

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [Documentazione del Progetto](#documentazione-del-progetto)
- [License](#license)

## Features
- Documentazione completa del progetto in formato LaTeX e PDF.
- File tecnici e analisi dei requisiti.
- Backend e frontend sviluppati per MVP del progetto Code Guardian per attività di analisi su repository GitHub.
- Struttura modulare con agenti dedicati (docs, changelog, security ecc.).
- Workflow di compilazione e distribuzione basati su GitHub Actions.
- Documentazione estesa su pianificazione, progettazione, norme e verifiche per il corso di Ingegneria del Software.
- Esempi e test automatizzati per qualità e gestione del codice sorgente.

## Prerequisites
- Git
- Docker (per esecuzione locale)
- Node.js (per alcune parti del frontend e del backend)
- Python 3.x (dove richiesto per gli agenti)

## Installation
```bash
# Clone the repository
git clone https://github.com/skynetunigroup/Code_Guardian.git
cd Code_Guardian

# Per installazione e esecuzione di alcune componenti
# (esempio: installazione in una directory specifica come Src/MVP)
cd Src/MVP/agents
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Per backend
cd ../backend
npm install

# Per infrastruttura AWS
cd ../../infra
npm install
```

## Project Structure
```
.
├── .github            # Workflow di CI/CD
├── Documentazione     # LaTeX, PDF, Norme, Requisiti, Verbali
├── Src                # Codice sorgente del progetto
│   ├── MVP            # Minimum Viable Product
│   │   ├── agents     # Agenti per analisi (changelog, docs ecc.)
│   │   ├── backend    # API backend per orchestrazione e gestione
│   │   └── frontend   # Frontend web-based
│   └── PoC            # Proof of Concept
├── Tools              # Strumenti di utilità
├── Website            # Versione demo o info page web
├── LICENSE            # Licenza di utilizzo
├── README.md          # Informazioni principali
```

## Documentazione del Progetto
### Documenti Tecnici
La documentazione del progetto è organizzata in:
- **Analisi dei Requisiti** – definizione completa delle funzionalità richieste.
- **Progettazione MVP** – architettura e design del sistema.
- **Piano di Progetto** – strumenti di pianificazione e gestione del lavoro.
- **Piano di Qualifica** – criteri di test e verifica.
- **Norme di Progetto** – norme adottate per la qualità del prodotto (stile, test, documentazione).
- **Glossario** – terminologia specifica relativa al progetto.

### File Disponibili
- **Lettera di Presentazione**
- **Preventivo Costi**
- **Valutazione Capitolati**
- **Verbali Interni ed Esterni**
- **Template LaTeX per la redazione**

Tutti i documenti sono disponibili nella directory `Documentazione/`.

## License
MIT License

Per i dettagli, consulta il file [LICENSE](LICENSE).
