import { DocumentBuilder } from "@nestjs/swagger";

// La configurazione del documento, in un file suo.
//
// Sta separata dalla fabbrica usata dai test perche' quella tira dentro tutti
// i controller e un modulo di sola anteprima: main.ts ha bisogno del solo
// titolo/versione/schema di autenticazione, e non deve importare l'impalcatura
// di test per averli. Averla in un posto solo e' comunque necessario: due
// DocumentBuilder distinti divergono senza che nulla se ne accorga.
export const SWAGGER_CONFIG = new DocumentBuilder()
  .setTitle("Code Guardian — Backend MVP")
  .setDescription("API del backend di Code Guardian")
  .setVersion("0.1")
  .addBearerAuth()
  .build();
