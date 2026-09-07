import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import {
  AmbienteE2E,
  attendiEsito,
  avviaAmbiente,
  utentePronto,
} from './e2e-helpers';

/**
 * TI_17 (RF.73) — esportazione del Report in PDF, archiviazione nel bucket
 * privato e restituzione con header corretti e nome file deterministico.
 *
 * Gira contro il MinIO di docker-compose, non contro un doppio dell'SDK: il
 * punto del test e' proprio che l'oggetto finisca davvero nel bucket, e un
 * doppio di S3Client verificherebbe soltanto che il codice chiama il metodo
 * che gli abbiamo detto di chiamare. L'archivio viene quindi riletto con un
 * client costruito qui dalla stessa configurazione dell'applicazione.
 *
 * Corrispondenza PARZIALE su un punto, dichiarato invece che nascosto: RF.73
 * dice "in streaming", mentre l'implementazione compone l'intero PDF in
 * memoria e lo invia in un colpo solo con Content-Length. E' una scelta
 * deliberata e documentata in ReportsExportService (un errore a meta'
 * generazione non deve poter produrre un file troncato), ma resta una
 * divergenza dalla formulazione del requisito: qui si verifica cio' che il
 * codice fa — un PDF completo, con gli header giusti e la lunghezza
 * dichiarata — non lo streaming.
 */
describe('TI_17 (RF.73) — esportazione PDF, archivio e header', () => {
  let ambiente: AmbienteE2E;
  let archivio: S3Client;
  let bucket: string;

  /**
   * Legge il corpo della risposta come byte grezzi.
   *
   * Senza, supertest tratterebbe application/pdf come testo e il confronto
   * sulla lunghezza sarebbe falsato dalla codifica.
   */
  function parserBinario(
    res: NodeJS.ReadableStream & { setEncoding: (e: string) => void },
    callback: (err: Error | null, body: Buffer) => void,
  ): void {
    res.setEncoding('binary');
    let dati = '';
    res.on('data', (chunk: string) => {
      dati += chunk;
    });
    res.on('end', () => callback(null, Buffer.from(dati, 'binary')));
  }

  /** Porta una task fino al Report completato e ne restituisce l'id. */
  async function reportCompletato(utente: {
    token: string;
    contextId: string;
  }): Promise<string> {
    ambiente.agente.invoke.mockResolvedValue({
      status: 'COMPLETED',
      payload: {
        body: [
          {
            kind: 'FINDING',
            category: 'A03:2021 Injection',
            severity: 'HIGH',
            filePath: 'app/data/user-dao.js',
            startLine: 12,
            endLine: 14,
            explanation: 'Query costruita per concatenazione di stringhe.',
            remediationKind: 'TEXT',
            remediation: 'Usare query parametrizzate.',
          },
        ],
        summary: 'Trovata 1 vulnerabilita.',
        tokensConsumed: 350,
      },
    });

    const avvio = await request(ambiente.server)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${utente.token}`)
      .send({ contextId: utente.contextId, operations: ['SECURITY_OWASP'] })
      .expect(202);

    const conclusa = await attendiEsito(
      ambiente.taskModel,
      avvio.body.taskIds[0] as string,
    );
    expect(conclusa.status).toBe('COMPLETED');
    return String(conclusa.reportId);
  }

  /** Scarica l'esportazione, restituendo header e byte. */
  async function esporta(token: string, reportId: string, atteso = 200) {
    return request(ambiente.server)
      .get(`/api/v1/reports/${reportId}/export?format=pdf`)
      .set('Authorization', `Bearer ${token}`)
      .buffer()
      .parse(parserBinario as never)
      .expect(atteso);
  }

  beforeAll(async () => {
    ambiente = await avviaAmbiente();
    const config = ambiente.app.get(ConfigService);
    bucket = config.get<string>('REPORTS_BUCKET_NAME')!;
    // Stessa configurazione del servizio, client separato: il test legge
    // l'archivio dall'esterno, come farebbe chiunque altro.
    archivio = new S3Client({
      region: config.get<string>('S3_REGION'),
      endpoint: config.get<string>('S3_ENDPOINT'),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE'),
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY_ID')!,
        secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY')!,
      },
    });
  }, 60_000);

  afterAll(async () => {
    archivio?.destroy();
    await ambiente?.chiudi();
  });

  beforeEach(() => {
    ambiente.agente.invoke.mockReset();
    ambiente.agente.resume.mockReset();
  });

  it('restituisce un PDF completo con gli header previsti', async () => {
    const utente = await utentePronto(ambiente.server);
    const reportId = await reportCompletato(utente);

    const risposta = await esporta(utente.token, reportId);
    const pdf = risposta.body as Buffer;

    expect(risposta.headers['content-type']).toContain('application/pdf');
    expect(risposta.headers['content-disposition']).toBe(
      `attachment; filename="code-guardian-SECURITY_OWASP-${reportId}.pdf"`,
    );
    // Il file non e' troncato: l'intestazione PDF c'e', la lunghezza
    // dichiarata coincide con quella trasmessa e il documento e' chiuso.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
    expect(Number(risposta.headers['content-length'])).toBe(pdf.length);
    expect(pdf.length).toBeGreaterThan(1000);
  }, 180_000);

  it('il nome del file e\' deterministico: dipende solo da operazione e id', async () => {
    // RF.73 chiede un nome deterministico perche' due scaricamenti dello
    // stesso Report non devono lasciare due file diversi nella cartella
    // Download dell'utente.
    const utente = await utentePronto(ambiente.server);
    const reportId = await reportCompletato(utente);

    const prima = await esporta(utente.token, reportId);
    const seconda = await esporta(utente.token, reportId);

    expect(seconda.headers['content-disposition']).toBe(
      prima.headers['content-disposition'],
    );
    expect(prima.headers['content-disposition']).toContain(reportId);
    expect(prima.headers['content-disposition']).toContain('SECURITY_OWASP');
  }, 180_000);

  it('archivia il PDF nel bucket privato, sotto l\'id del Report', async () => {
    const utente = await utentePronto(ambiente.server);
    const reportId = await reportCompletato(utente);

    const risposta = await esporta(utente.token, reportId);

    const archiviato = await archivio.send(
      new GetObjectCommand({ Bucket: bucket, Key: reportId }),
    );
    expect(archiviato.ContentType).toBe('application/pdf');

    const byteArchiviati = Buffer.from(
      await archiviato.Body!.transformToByteArray(),
    );
    // Stesso documento, non un segnaposto: e' l'oggetto archiviato a dover
    // valere come copia durevole di quello consegnato.
    expect(byteArchiviati.length).toBe((risposta.body as Buffer).length);
    expect(byteArchiviati.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  }, 180_000);

  it('il bucket non e\' pubblico: senza credenziali l\'oggetto non si legge', async () => {
    const utente = await utentePronto(ambiente.server);
    const reportId = await reportCompletato(utente);
    await esporta(utente.token, reportId);

    const config = ambiente.app.get(ConfigService);
    const anonimo = new S3Client({
      region: config.get<string>('S3_REGION'),
      endpoint: config.get<string>('S3_ENDPOINT'),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE'),
      credentials: { accessKeyId: 'chiave-non-valida', secretAccessKey: 'segreto-non-valido' },
    });

    await expect(
      anonimo.send(new GetObjectCommand({ Bucket: bucket, Key: reportId })),
    ).rejects.toBeDefined();

    anonimo.destroy();
  }, 180_000);

  it('un Report fallito non si esporta: 409 con corpo vuoto', async () => {
    // Non c'e' niente da mettere in un PDF, e un file vuoto sarebbe peggio
    // di un rifiuto esplicito.
    const utente = await utentePronto(ambiente.server);
    ambiente.agente.invoke.mockResolvedValue({
      status: 'FAILED',
      error: {
        code: 'TIMEOUT',
        message: 'nessuna risposta dal modello',
        stage: 'EXECUTION',
      },
    });

    const avvio = await request(ambiente.server)
      .post('/api/v1/tasks')
      .set('Authorization', `Bearer ${utente.token}`)
      .send({ contextId: utente.contextId, operations: ['SECURITY_OWASP'] })
      .expect(202);
    const conclusa = await attendiEsito(
      ambiente.taskModel,
      avvio.body.taskIds[0] as string,
    );

    const risposta = await request(ambiente.server)
      .get(`/api/v1/reports/${conclusa.reportId}/export?format=pdf`)
      .set('Authorization', `Bearer ${utente.token}`)
      .expect(409);

    expect(risposta.text).toBe('');
  }, 180_000);

  it('il Report di un altro utente non si esporta', async () => {
    const proprietario = await utentePronto(ambiente.server);
    const estraneo = await utentePronto(ambiente.server);
    const reportId = await reportCompletato(proprietario);

    await request(ambiente.server)
      .get(`/api/v1/reports/${reportId}/export?format=pdf`)
      .set('Authorization', `Bearer ${estraneo.token}`)
      .expect(404);
  }, 180_000);

  it('il formato e’ parte del contratto: senza, o con uno diverso, e’ un 400', async () => {
    // GET /reports/:id/export?format=pdf e' cio' che il frontend chiama
    // (api/client.ts): 'pdf' e' l'unico formato definito, e un valore diverso
    // non deve produrre un file dal contenuto inatteso.
    const utente = await utentePronto(ambiente.server);
    const reportId = await reportCompletato(utente);

    await request(ambiente.server)
      .get(`/api/v1/reports/${reportId}/export`)
      .set('Authorization', `Bearer ${utente.token}`)
      .expect(400);

    await request(ambiente.server)
      .get(`/api/v1/reports/${reportId}/export?format=docx`)
      .set('Authorization', `Bearer ${utente.token}`)
      .expect(400);
  }, 180_000);
});
