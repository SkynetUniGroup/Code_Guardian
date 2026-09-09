import { Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import type Redis from "ioredis";

// Un Task cancellato mentre l'agente sta gia' lavorando non si ferma da solo:
// la transizione a CANCELLED avviene su Mongo, che il servizio Python non
// legge. L'agente controlla invece, a ogni nodo del grafo, una chiave Redis
// (graph._check_interrupts, "cancel:task:<id>") e alza AgentCancelled se la
// trova — ma nessuno la scriveva mai, quindi l'annullamento restava una
// scritta nell'interfaccia mentre il lavoro (e il consumo di token) proseguiva
// fino in fondo.
//
// Isolato in un servizio proprio invece che dentro TasksService perche' e' un
// effetto collaterale su un altro sistema, non parte della transizione di
// stato: se Redis non risponde, la cancellazione sul Task deve comunque
// valere.
const CANCEL_KEY_PREFIX = "cancel:task:";

// Quanto resta il flag. Deve superare la durata massima plausibile di
// un'invocazione in corso — TaskProcessor.CLAIM_LEASE_MS e' 10 minuti — perche'
// l'agente possa vederlo prima di finire; oltre quella soglia non c'e' piu'
// nulla da fermare e la chiave si cancella da sola, senza lasciare residui in
// Redis per ogni task mai annullato.
const CANCEL_TTL_SECONDS = 15 * 60;

@Injectable()
export class TaskCancellationService {
  private readonly logger = new Logger(TaskCancellationService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // Deliberatamente non rilancia: il Task e' gia' CANCELLED su Mongo quando
  // questo metodo viene chiamato, e trasformare un problema di Redis in un 500
  // direbbe all'utente che l'annullamento non e' andato a buon fine quando
  // invece e' andato. Il peggio che puo' succedere e' che l'agente porti a
  // termine un lavoro il cui risultato verra' comunque scartato da
  // persistIfStillRunning.
  async requestCancellation(taskId: string): Promise<void> {
    try {
      await this.redis.set(`${CANCEL_KEY_PREFIX}${taskId}`, "1", "EX", CANCEL_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Impossibile segnalare la cancellazione del Task ${taskId} al servizio agenti: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
