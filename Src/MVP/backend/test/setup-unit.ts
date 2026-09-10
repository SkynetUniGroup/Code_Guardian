import { vi } from "vitest";

// `createMockRedis` e `RedisTestModule.forTest` di @nestjs-modules/ioredis
// sono implementati con `jest.fn()`: la libreria da' per scontato Jest, e
// sotto Vitest `jest` non esiste, quindi ogni spec che li usa muore con
// "jest is not defined" prima ancora di arrivare a una asserzione.
//
// L'alternativa sarebbe sostituire quell'helper con un doppio scritto a mano
// in ogni spec che lo usa, duplicando l'elenco dei metodi Redis che la
// libreria gia' mantiene. Questo alias e' una riga e non tocca node_modules.
//
// Da rimuovere quando la libreria fornira' i propri doppi in modo neutro
// rispetto al runner.
(globalThis as unknown as { jest: typeof vi }).jest = vi;
