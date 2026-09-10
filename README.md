# Code Guardian

Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026

Link al sito web: [https://skynetunigroup.github.io/Code_Guardian/](https://skynetunigroup.github.io/Code_Guardian/)

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [License](#license)

## Features
- Gestione di documenti tecnici e progetti utilizzati durante il corso di Ingegneria del Software (SWE)
- Repository centralizzato per normative tecniche, relazioni, verbali e progettazioni del gruppo SkyNet
- Documentazione strutturata con LaTeX e report in formato PDF
- Strumenti di integrazione continua e automatizzazioni con GitHub Actions
- Moduli e script di supporto per lo sviluppo e la gestione del progetto

## Prerequisites
- Git per clonare il repository
- Node.js (non richiesto esplicitamente ma necessario se si lavora con i moduli in `Src`)

## Installation
```bash
# Clone the repository
git clone https://github.com/skynetunigroup/Code_Guardian.git
cd Code_Guardian
```

## Configuration
Il repository non richiede una configurazione specifica, salvo l'accesso a GitHub per i file `.env` o per eventuali automazioni aggiuntive in ambiente di lavoro.

## Project Structure
```
Code_Guardian/
├── .github/
│   └── workflows/                     # GitHub Actions workflows
├── Documentazione/
│   ├── LaTeX/
│   │   ├── Analisi dei Requisiti/
│   │   ├── Glossario/
│   │   ├── Norme di Progetto/
│   │   ├── Piano di Progetto/
│   │   └── Piano di Qualifica/
│   ├── PB/
│   ├── Progettazione/
│   └── Verbali/                       # Documenti interni ed esterni
├── Src/
│   ├── MVP/                           # Modulo MVP (Minimum Viable Product)
│   ├── PoC/                           # Modulo PoC (Proof of Concept)
│   └── README.md
├── Tools/
│   └── calclGulp.py                   # Strumento ausiliario per la gestione
├── Website/
│   ├── Img/
│   ├── generate_index.py
│   └── index.html                     # Pagina principale del sito
├── LICENSE
├── README.md
```

## License
MIT License

Preso in considerazione il contenuto del `README.md` esistente, il progetto è ritenuto essere distribuito con una licenza MIT. Per informazioni dettagliate, consultare il file LICENSE all'interno del repository.
