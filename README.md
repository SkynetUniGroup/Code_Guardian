# Code Guardian

> Repository del gruppo SkyNet contenente tutti gli artefatti del progetto del corso di Ingegneria del software (SWE) a.a. 2025/2026.

Link al sito web: [https://skynetunigroup.github.io/Code_Guardian/](https://skynetunigroup.github.io/Code_Guardian/)

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [License](#license)

## Features
- Repository principale con documentazione completa per il progetto SWE a.a. 2025/2026
- Include analisi dei requisiti, piano di progetto, progettazione dettagliata e verbali
- Contiene documentazione in formato PDF e LaTeX
- Struttura modulare per sviluppo frontend, backend e infrastruttura
- Documentazione di Candidatura, RTB e PB
- Sistemazione grafici per documenti tecnici e di progetto
- Templates ed esempi di verbali e documenti

## Prerequisites
- Git per clonare il repository
- Node.js (se necessario per strumenti di build frontend)
- Docker (facoltativo, per esecuzione in ambiente containerizzato)

## Installation
```bash
# Clona il repository
git clone https://github.com/skynetunigroup/Code_Guardian.git
cd Code_Guardian

# Installa eventuali dipendenze (se necessari sono presenti file package.json)
# Esempio comune:
# npm install
```

## Configuration
Il progetto include diverse configurazioni e ambienti come MVP e PoC. 
Per alcune directory sono disponibili file `.env.example` di esempio (ad esempio `Src/PoC/.env.example`). 
Per ulteriori informazioni, consultare i file `README.md` inclusi nelle sottodirectory del progetto.

## Project Structure
Gli artefatti principali si trovano nella directory `Documentazione` e in `Src`, dove sono divisi in sottoparti per front-end e back-end. La directory `Tools` contiene script ausiliari per il progetto, mentre `Website` contiene il codice per la visualizzazione online.
```
Code_Guardian/
├── .github/           # Configurazione di GitHub Actions
├── Documentazione/    # File tecnici e verbali del progetto
├── LICENSE            # Licenza del progetto
├── README.md          # Questo README
├── Src/               # Struttura per codice sorgente
├── Tools/             # Script ausiliari
├── Website/           # Sito web con documentazione
```

## License
Questo progetto è rilasciato con una licenza MIT. Per informazioni dettagliate, consulta il file `LICENSE`.
