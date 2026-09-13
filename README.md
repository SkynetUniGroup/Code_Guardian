# Code Guardian

Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026

Link al sito web: https://skynetunigroup.github.io/Code_Guardian/

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/SkyNetUnigroup/Code_Guardian/blob/main/LICENSE)

> **Code Guardian** è un progetto software nato all'interno del corso di Ingegneria del Software presso l'Università degli Studi di Padova. L'obiettivo principale del progetto è sviluppare un sistema in grado di effettuare un'analisi su repository GitHub per identificare vulnerabilità, miglioramenti strutturali e rischi nella gestione del codice sorgente.

Il progetto include una serie di tool progettati per esaminare repository open-source e fornire una serie di risultati in termini di vulnerabilità rilevate, proposte di corretta sicurezza e riferimenti a documentazioni o best practices da seguire.

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [Documentation](#documentation)

## Features
- Analisi della sicurezza su repository GitHub
- Identificazione di vulnerabilità con riferimento a OWASP
- Scansioni di policy interne e verifiche di conformità
- Generazione di rapporti completi in formato testuale
- Backend orchestratore per pipeline di analisi
- Frontend accessibile utente con dashboard interattive

## Installation
Il progetto non fornisce istruzioni di installazione diretta poiché contiene esclusivamente documentazione e artefatti per sviluppo. Si consiglia di consultare il file [`README.md`](https://github.com/SkyNetUnigroup/Code_Guardian/blob/main/Src/README.md) nella directory `/ Src` per ulteriori informazioni.

## Project Structure
L'architettura del repository è organizzata nelle seguenti directory principali:
```
.
├── .github/                      # Configuration for GitHub Actions
├── Documentazione/             # All project documentation in LaTeX format
│   ├── LaTeX/                  # Project LaTeX documentation with reports, analyses, norms, glossary, etc.
│   ├── RTB/                    # Project documentation in PDF format for deliverables (RTB)
│   ├── Verbali/                # Meeting reports in both .tex and .pdf formats
│   └── README.md               # Documentation README
├── Src/                        # Core project code
│   ├── MVP/                    # Minimum Viable Product implementation
│   ├── PoC/                    # Proof of Concept implementation
│   └── README.md               # Source README
├── Tools/                      # Utility tools and scripts
├── Website/                    # Project website files
│   ├── Img/                    # Static images
│   ├── index.html              # Project home page
│   └── style.css               # Project styles
└── README.md                   # This file
```

## Documentation
La documentazione tecnica e di progetto è disponibile nella directory `Documentazione/`. Essa contiene:
- Analisi dei Requisiti in formato .tex
- Piano di Progetto con stime, schedule e organigramma
- Norme di Progetto con procedure interne e linee guida
- Piano di Qualifica con criteri di test e metriche
- Verbali degli incontri interni ed esterni
- File PDF dei deliverables e degli output

I file sono organizzati in formato LaTeX all'interno di `Documentazione/LaTeX/`, mentre le versioni PDF dei documenti richiesti dal corso sono reperibili in `Documentazione/RTB/`.

## License
Distribuito con licenza [MIT](https://github.com/SkyNetUnigroup/Code_Guardian/blob/main/LICENSE).
