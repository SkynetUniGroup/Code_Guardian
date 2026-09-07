// TI_18 (RF.73, RF.74) — prova di carico sull'esportazione PDF.
//
// Deliberatamente fuori dalla suite Jest, e vale la pena dire perche':
// jest-e2e gira a ogni PR e deve restare veloce e deterministica, mentre una
// prova di carico eseguita su una macchina di sviluppo misura quella
// macchina, non il sistema. Il requisito parla di un backend dimensionato a
// 0,5 vCPU / 1 GB: il numero ha senso solo se il backend gira davvero con
// quei limiti, cioe' in un container vincolato. Nella suite sarebbe un test
// lento che non misura cio' che dichiara di misurare.
//
// Nessuno script npm lo richiama e nessun modulo lo importa, come
// try-github-write.ts qui accanto.
//
// ---------------------------------------------------------------------------
// Procedura
//
// 1. Vincolare il backend alle risorse del requisito. In Src/MVP, con un
//    file di sovrascrittura (docker-compose.carico.yml):
//
//      services:
//        backend:
//          deploy:
//            resources:
//              limits: { cpus: '0.5', memory: 1G }
//
//    e avviarlo con:
//      docker compose -f docker-compose.yml -f docker-compose.carico.yml up -d
//
//    Senza `deploy.resources` la prova gira comunque, ma misura la macchina
//    dell'operatore e il risultato non e' confrontabile con RF.74.
//
// 2. Procurarsi un Report COMPLETED e il token del suo proprietario. Il modo
//    piu' rapido e' l'interfaccia; in alternativa vale qualunque Report gia'
//    presente, purche' dell'utente che fornisce il token.
//
// 3. Eseguire:
//
//      cd Src/MVP/backend
//      $env:BASE_URL   = 'http://localhost:3000'
//      $env:TOKEN      = '<jwt del proprietario>'
//      $env:REPORT_ID  = '<id del report>'
//      npx ts-node scripts/ti18-carico-esportazione-pdf.ts
//
// 4. Criteri di esito, che lo script applica da solo e riporta in coda:
//    - nessuna richiesta fallita e nessuno stato diverso da 200;
//    - nessun file troncato: ogni risposta comincia per %PDF-, finisce con
//      %%EOF e ha esattamente i byte dichiarati da Content-Length;
//    - tutte le risposte identiche per lunghezza fra loro (stesso Report,
//      stesso documento);
//    - nessun errore inatteso nei log del container
//      (`docker compose logs backend`), che vanno guardati a mano: un 500
//      con code EXPORT_FAILED comparirebbe li' prima che qui.
// ---------------------------------------------------------------------------

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const token = process.env.TOKEN;
const reportId = process.env.REPORT_ID;
const concorrenza = Number(process.env.CONCORRENZA ?? '20');

if (!token || !reportId) {
  console.error(
    'Servono TOKEN (JWT del proprietario del Report) e REPORT_ID. Vedi la procedura in testa a questo file.',
  );
  process.exit(1);
}

interface Esito {
  indice: number;
  stato: number;
  byte: number;
  contentLength: number | null;
  inizioValido: boolean;
  fineValida: boolean;
  ms: number;
  errore?: string;
}

/** Una singola esportazione, misurata e verificata sui byte ricevuti. */
async function esporta(indice: number): Promise<Esito> {
  const inizio = Date.now();
  try {
    const risposta = await fetch(
      `${baseUrl}/api/v1/reports/${reportId}/export?format=pdf`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const byte = Buffer.from(await risposta.arrayBuffer());
    const dichiarata = risposta.headers.get('content-length');

    return {
      indice,
      stato: risposta.status,
      byte: byte.length,
      contentLength: dichiarata === null ? null : Number(dichiarata),
      // Le due estremita' del file: un PDF troncato perde la seconda molto
      // prima della prima, ed e' esattamente il guasto che RF.74 teme.
      inizioValido: byte.subarray(0, 5).toString('latin1') === '%PDF-',
      fineValida: byte.subarray(-8).toString('latin1').includes('%%EOF'),
      ms: Date.now() - inizio,
    };
  } catch (errore) {
    return {
      indice,
      stato: 0,
      byte: 0,
      contentLength: null,
      inizioValido: false,
      fineValida: false,
      ms: Date.now() - inizio,
      errore: errore instanceof Error ? errore.message : String(errore),
    };
  }
}

function percentile(valori: number[], quantile: number): number {
  const ordinati = [...valori].sort((a, b) => a - b);
  const posizione = Math.min(
    ordinati.length - 1,
    Math.floor(quantile * ordinati.length),
  );
  return ordinati[posizione];
}

async function main(): Promise<void> {
  console.log(
    `TI_18 — ${concorrenza} esportazioni concorrenti del Report ${reportId} su ${baseUrl}`,
  );

  const inizio = Date.now();
  // Tutte insieme, non a scaglioni: il requisito parla di richieste
  // concorrenti, e scaglionarle misurerebbe un carico diverso da quello.
  const esiti = await Promise.all(
    Array.from({ length: concorrenza }, (_, i) => esporta(i)),
  );
  const totaleMs = Date.now() - inizio;

  const fallite = esiti.filter((e) => e.stato !== 200);
  const troncate = esiti.filter(
    (e) =>
      e.stato === 200 &&
      (!e.inizioValido ||
        !e.fineValida ||
        (e.contentLength !== null && e.contentLength !== e.byte)),
  );
  const lunghezze = new Set(esiti.filter((e) => e.stato === 200).map((e) => e.byte));
  const tempi = esiti.map((e) => e.ms);

  console.log('');
  console.log(`Durata complessiva ....... ${totaleMs} ms`);
  console.log(`Latenza mediana .......... ${percentile(tempi, 0.5)} ms`);
  console.log(`Latenza 95° percentile ... ${percentile(tempi, 0.95)} ms`);
  console.log(`Latenza massima .......... ${Math.max(...tempi)} ms`);
  console.log(`Risposte non 200 ......... ${fallite.length}`);
  console.log(`File troncati ............ ${troncate.length}`);
  console.log(`Lunghezze distinte ....... ${lunghezze.size} (attesa: 1)`);

  for (const e of [...fallite, ...troncate]) {
    console.log(
      `  #${e.indice}: stato=${e.stato} byte=${e.byte} contentLength=${e.contentLength} ` +
        `inizio=${e.inizioValido} fine=${e.fineValida}${e.errore ? ` errore=${e.errore}` : ''}`,
    );
  }

  const superato =
    fallite.length === 0 && troncate.length === 0 && lunghezze.size === 1;
  console.log('');
  console.log(superato ? 'ESITO: superato' : 'ESITO: NON superato');
  process.exit(superato ? 0 : 1);
}

void main();
