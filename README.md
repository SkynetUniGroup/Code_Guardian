# Code Guardian

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&labelColor=lightgrey&logo=github)](https://github.com/SkyNetUNIGroup/Code_Guardian)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](https://github.com/SkyNetUNIGroup/Code_Guardian/blob/main/LICENSE)

> Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026.

Il progetto mira a sviluppare e implementare un sistema per l'analisi automatica e la protezione del codice sorgente, denominato **Code Guardian**. L'applicativo è progettato per identificare vulnerabilità, rivedere le pratiche di sicurezza, generare documentazione automatica e fornire report di qualità e conformità in base ai requisiti specifici.

Per ulteriori informazioni o per accedere al front-end della piattaforma, visita il [sito web di Code Guardian](https://skynetunigroup.github.io/Code_Guardian/).

### Funzionalità principali:
- **Analisi statica** del codice per individuare potenziali vulnerabilità
- **Generazione automatica di documentazione** leggibile
- **Verifica di policy di sicurezza** e standard OWASP
- **Integrazione con GitHub** per l'analisi diretta di repository
- **Gestione dei report** e visualizzazione delle vulnerabilità con priorità
- **Interfaccia utente completa**, con strumenti per gestire i repository e gli ambienti di credenziali

---

## Indice

- [Documentazione](#documentazione)
- [Struttura del progetto](#struttura-del-progetto)
- [Installazione e avvio](#installazione-e-avvio)
- [Licenza](#licenza)

---

## Documentazione

Tutti i documenti, analisi e verbali del progetto sono presenti nella cartella [`Documentazione`](https://github.com/SkyNetUNIGroup/Code_Guardian/tree/main/Documentazione). Sono inclusi i seguenti contenuti:

- **Norme di Progetto**
- **Piano di Progetto**
- **Analisi dei Requisiti**
- **Piano di Qualifica**
- **Glossario**
- **Verbali esterni e interni**
- **Lettere di Presentazione**
- **Preventivo Costi**
- **Template LaTeX** e report generati
- **Analisi dei Requisiti con tracciamento**

---

## Struttura del progetto

Il progetto è organizzato in tre principali directory:
```
.
├── Documentazione/
│   ├── LaTeX/
│   ├── PB/
│   ├── RTB/
│   └── Verbali/
├── Src/
│   ├── MVP/
│   └── PoC/
└── Tools/
```

### MVP (Minimum Viable Product)
La directory [`MVPR`](https://github.com/SkyNetUNIGroup/Code_Guardian/tree/main/Src/MVP) contiene la versione prodotta di Code Guardian, con:

- Backend su **NestJS**
- Frontend su **React**
- Agenti Python per:
  - OWASP scanning
  - Analisi documentazione
  - Generazione report

I Dockerfile, test completi, CI/CD e la struttura infrastrutturale sono pronti per il deployment.

### PoC (Proof of Concept)
La directory [`PoC`](https://github.com/SkyNetUNIGroup/Code_Guardian/tree/main/Src/PoC) include una versione iniziale, usata per il test funzionale delle funzioni principali (scanning, report, ciclo di task).

---

## Installazione e Avvio

Per avviare il progetto `MVP`, segui questi passaggi:

### 1. Clona il repository

```bash
git clone https://github.com/SkyNetUNIGroup/Code_Guardian.git
cd Code_Guardian
```

### 2. Avvio del backend

```bash
cd Src/MVP/backend
docker-compose up -d
```

Assicurati di fornire i seguenti file di supporto in `.env` con chiavi per i servizi terzi (GitHub, Sonarqube, ecc.).

### 3. Avvio del frontend

```bash
cd Src/MVP/frontend
docker-compose up -d
```

Una volta completato, accedi all'interfaccia principale del progetto via `http://localhost`.

---

## Licenza

[MIT License](https://choosealicense.com/licenses/mit/)

Codice rilasciato con licenza MIT. Per ulteriori informazioni consulta il file [`LICENSE`](https://github.com/SkyNetUNIGroup/Code_Guardian/blob/main/LICENSE) nel repository.
