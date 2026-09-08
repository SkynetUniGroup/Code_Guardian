import request from 'supertest';
import { AmbienteE2E, avviaAmbiente } from './e2e-helpers';

/**
 * TNF_02 (RQ.9) — il processo di autenticazione resta sotto i due secondi.
 *
 * Misurato «end-to-end su POST /auth/login», come dice la voce: la richiesta
 * parte da supertest e il cronometro si ferma quando la risposta è completa,
 * quindi comprende la lettura dell'utente da MongoDB, la verifica Argon2id e
 * l'emissione del JWT. L'applicazione è quella reale, costruita
 * dall'impalcatura condivisa: misurare un servizio isolato darebbe un numero
 * più basso e senza rapporto con quello che l'utente aspetta.
 *
 * Perché più misure e non una. Argon2id con i parametri di
 * `password.service.ts` (memoryCost 65536, timeCost 3, parallelism 4) costa
 * qualche decina di millisecondi, contro un tetto di 2000: il margine è
 * enorme, quindi una singola misura fortunata non direbbe nulla e una
 * singola misura sfortunata --- il garbage collector, il primo accesso a un
 * indice, la macchina occupata --- renderebbe il test intermittente senza
 * che nulla sia peggiorato davvero. Si misura più volte e si giudica sulla
 * mediana e sul massimo: la mediana dice come va di solito, il massimo è
 * la lettura stretta del requisito, che parla di un tetto e non di una
 * media.
 *
 * La prima misura viene scartata di proposito: la prima login di un
 * processo paga la compilazione JIT del percorso e l'apertura del pool di
 * connessioni, costi che l'utente reale non vede perché il server è già
 * caldo quando lui arriva.
 */
describe('TNF_02 (RQ.9) — tempo del processo di autenticazione', () => {
  let ambiente: AmbienteE2E;

  /** Tetto dichiarato da RQ.9, in millisecondi. */
  const TETTO_MS = 2_000;

  /** Misure valutate, oltre a quella di riscaldamento scartata. */
  const RIPETIZIONI = 10;

  const PASSWORD = 'password-di-prova-123';
  let email: string;

  function mediana(valori: number[]): number {
    const ordinati = [...valori].sort((a, b) => a - b);
    const meta = Math.floor(ordinati.length / 2);
    return ordinati.length % 2
      ? ordinati[meta]
      : (ordinati[meta - 1] + ordinati[meta]) / 2;
  }

  /** Esegue una login e restituisce quanto è durata, in millisecondi. */
  async function cronometraLogin(
    passwordUsata = PASSWORD,
    statoAtteso = 200,
  ): Promise<number> {
    const inizio = Date.now();
    await request(ambiente.server)
      .post('/api/v1/auth/login')
      .send({ email, password: passwordUsata })
      .expect(statoAtteso);
    return Date.now() - inizio;
  }

  /** Ripete la misura, scartando la prima. */
  async function campione(
    passwordUsata = PASSWORD,
    statoAtteso = 200,
  ): Promise<number[]> {
    await cronometraLogin(passwordUsata, statoAtteso);
    const misure: number[] = [];
    for (let i = 0; i < RIPETIZIONI; i += 1) {
      misure.push(await cronometraLogin(passwordUsata, statoAtteso));
    }
    return misure;
  }

  /** Stampa il campione, perché il numero misurato è il risultato del test. */
  function riporta(etichetta: string, misure: number[]): void {
    const ordinati = [...misure].sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `TNF_02 ${etichetta}: mediana ${mediana(misure)} ms, ` +
        `minimo ${ordinati[0]} ms, massimo ${ordinati[ordinati.length - 1]} ms ` +
        `(${misure.length} misure, tetto ${TETTO_MS} ms) — [${ordinati.join(', ')}]`,
    );
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente();

    email = `tnf02-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@esempio.invalid`;
    await request(ambiente.server)
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email,
        password: PASSWORD,
        role: 'DEVELOPER',
      })
      .expect(201);
  }, 60_000);

  afterAll(async () => {
    await ambiente?.chiudi();
  });

  it('una login riuscita resta entro i due secondi, sulla mediana e sul massimo', async () => {
    const misure = await campione();
    riporta('login riuscita', misure);

    expect(mediana(misure)).toBeLessThanOrEqual(TETTO_MS);
    expect(Math.max(...misure)).toBeLessThanOrEqual(TETTO_MS);
  }, 120_000);

  it('anche il tentativo con password sbagliata resta nel budget', async () => {
    // Il percorso di rifiuto non è più economico: `login` verifica comunque
    // l'hash --- contro un DUMMY_HASH quando l'utente non esiste --- per non
    // far trapelare dai tempi quali email siano registrate. È quindi un caso
    // che RQ.9 deve reggere quanto quello riuscito, ed è anche il più
    // frequente sotto un attacco a forza bruta, cioè quando il tetto conta.
    const misure = await campione('password-sbagliata-123', 401);
    riporta('login rifiutata', misure);

    expect(mediana(misure)).toBeLessThanOrEqual(TETTO_MS);
    expect(Math.max(...misure)).toBeLessThanOrEqual(TETTO_MS);
  }, 120_000);

  it('il tempo misurato comprende davvero la verifica della password', async () => {
    // Senza questo controllo il test resterebbe verde anche se qualcuno
    // disattivasse Argon2id: una login che non verifica nulla è velocissima,
    // e «sotto i due secondi» sarebbe vero nel modo peggiore possibile. Il
    // termine di paragone è un endpoint dello stesso server che non fa
    // lavoro crittografico: la login deve costare visibilmente di più.
    //
    // La soglia è una differenza assoluta e non un rapporto: il riferimento
    // misura 1 o 2 millisecondi e su un rapporto la sua variazione peserebbe
    // quanto quella della login. Dieci millisecondi stanno molto sotto il
    // costo reale di Argon2id con i parametri attuali (qualche decina) e
    // molto sopra il costo di una richiesta che non calcola nulla, quindi
    // distingue le due situazioni senza essere sensibile al rumore.
    const riferimento: number[] = [];
    for (let i = 0; i < RIPETIZIONI; i += 1) {
      const inizio = Date.now();
      await request(ambiente.server).get('/api/v1/auth/health').expect(200);
      riferimento.push(Date.now() - inizio);
    }
    const login = await campione();

    riporta('login', login);
    riporta('GET /auth/health (riferimento)', riferimento);

    expect(mediana(login) - mediana(riferimento)).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
