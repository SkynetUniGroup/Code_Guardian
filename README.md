# Code Guardian

> Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026.

Il progetto riguarda la creazione e la manutenzione di un ambiente di lavoro strutturato e documentato, in grado di soddisfare i requisiti del corso seguendo standard tecnologici e documentativi elevati. Tutti gli artefatti sono raccolti in un unico repository per garantire una gestione chiara e una facile accessibilità.

## Table of Contents
- [Features](#features)
- [Installation](#installation)
- [Project Structure](#project-structure)
- [License](#license)

## Features
- Struttura repository ben organizzata
- Documentazione completa in formato LaTeX e PDF
- Supporto per sviluppo MVP e PoC (Proof of Concept)
- Configurazioni per CI/CD tramite GitHub Actions
- Ambiente backend e frontend configurati
- Template e strumenti di supporto
- Generazione automatica del sito web del progetto

## Installation
Il progetto non richiede installazione specifica. Per interagirvi:

```bash
# Clona il repository
git clone https://github.com/SkyNetUnigroup/Code_Guardian.git
cd Code_Guardian

# Esplora i sottoprogetti come MVP o PoC
cd Src/MVP
```

Le dipendenze e installazioni sono gestite all'interno di sottodirectory specifiche.

## Project Structure
```text
Code_Guardian/
├── .github/                # Configurazioni GitHub (azioni, verifiche)
├── Documentazione/         # Documenti e report progetto
├── LICENSE               # Licenza
├── README.md             # Questo file
├── Src/                  # Codice del progetto
│   ├── MVP/              # Implementazione Minima Verificabile
│   ├── PoC/              # Proof of Concept
│   └── Tools/            # Strumenti utili
├── Tools/                # Strumenti esterni e di utilità
├── Website/              # Sito web
└── package.json (non disponibile)
```

## License
MIT License
