import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { AuthController } from "../../auth/auth.controller";
import { AuthService } from "../../auth/auth.service";
import { ContextsController } from "../../contexts/contexts.controller";
import { ContextsService } from "../../contexts/contexts.service";
import { RepositoriesController } from "../../contexts/repositories.controller";
import { RepositoriesService } from "../../contexts/repositories.service";
import { CredentialsController } from "../../credentials/credentials.controller";
import { CredentialsService } from "../../credentials/credentials.service";
import { AgentRegistry } from "../../operations/agent-registry.service";
import { OperationsController } from "../../operations/operations.controller";
import { ReportsController } from "../../reports/reports.controller";
import { ReportsService } from "../../reports/reports.service";
import { ReportsExportService } from "../../reports/reports-export.service";
import { TasksController } from "../../tasks/tasks.controller";
import { TasksService } from "../../tasks/tasks.service";
import { SWAGGER_CONFIG } from "./swagger.config";

// I controller pubblici, in un modulo che serve solo a generare il documento.
//
// I due controller interni (/internal/...) non ci sono, coerentemente con il
// loro @ApiExcludeController: non fanno parte dell'API pubblica e non vanno
// documentati.
@Module({
  controllers: [
    AuthController,
    ContextsController,
    RepositoriesController,
    CredentialsController,
    OperationsController,
    ReportsController,
    TasksController,
  ],
  // I servizi iniettati dai controller, sostituiti da oggetti vuoti.
  //
  // Nessun metodo viene mai chiamato: qui si legge solo la forma dell'API, non
  // il suo comportamento. Servono perche' Nest istanzia comunque i controller
  // per costruire il grafo delle rotte, e senza questi cerchercebbe il servizio
  // vero — con dentro Mongoose, Redis e le variabili d'ambiente.
  providers: [
    { provide: AuthService, useValue: {} },
    { provide: ContextsService, useValue: {} },
    { provide: RepositoriesService, useValue: {} },
    { provide: CredentialsService, useValue: {} },
    { provide: AgentRegistry, useValue: {} },
    { provide: ReportsService, useValue: {} },
    { provide: ReportsExportService, useValue: {} },
    { provide: TasksService, useValue: {} },
  ],
})
class OpenApiPreviewModule {}

/**
 * Genera il documento OpenAPI senza avviare l'applicazione.
 *
 * Non serve nessuna infrastruttura: i controller sono elencati a mano e i loro
 * servizi sostituiti da oggetti vuoti, cosi' che il documento si possa
 * verificare in un test di unita' invece che in un e2e con MongoDB e Redis
 * accesi. E' anche il motivo per cui questo modulo non importa AppModule.
 *
 * Il documento cosi' prodotto e' lo stesso che l'applicazione mette sotto
 * /api/docs: le proprieta' degli schemi vengono dai decoratori @ApiProperty
 * scritti a mano, e ogni @ApiProperty dichiara il proprio `type` per esteso.
 * E' voluto, ed e' il motivo per cui il plugin di @nestjs/swagger resta
 * disabilitato in nest-cli.json: il plugin gira solo dentro `nest build`, non
 * sotto il transform dei test, e accenderlo vorrebbe dire avere due documenti
 * diversi a seconda di come lo si genera — esattamente quello che questi test
 * dovrebbero impedire.
 */
export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(OpenApiPreviewModule, {
    logger: false,
    preview: true,
    abortOnError: false,
  });
  try {
    return SwaggerModule.createDocument(app, SWAGGER_CONFIG);
  } finally {
    await app.close();
  }
}
