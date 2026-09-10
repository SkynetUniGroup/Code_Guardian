import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  AnalysisContext,
  AnalysisContextSchema,
} from "../contexts/schemas/analysis-context.schema";
import { CredentialsModule } from "../credentials/credentials.module";
import { EventsModule } from "../events/events.module";
import { GithubModule } from "../github/github.module";
import { OperationsModule } from "../operations/operations.module";
import { ReportsModule } from "../reports/reports.module";
import { TemplatesModule } from "../templates/templates.module";
import { AgentInvocationService } from "./agent-invocation.service";
import { ProposalPublisherService } from "./proposal-publisher.service";
import { Task, TaskSchema } from "./schemas/task.schema";
import { UsageCounter, UsageCounterSchema } from "./schemas/usage-counter.schema";
import { TaskCancellationService } from "./task-cancellation.service";
import { TaskProcessor } from "./task-processor";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";
import { UsageLimitService } from "./usage-limit.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: UsageCounter.name, schema: UsageCounterSchema },
      // Registered directly here rather than importing ContextsModule: this
      // module only needs the AnalysisContext model, for the ownership
      // check on POST /tasks, not ContextsModule's controllers/services
      // (RepositoriesService, ContextsService, the GitHub/Credentials chain
      // they pull in). Same schema, same underlying collection — see
      // EventsModule's Task registration for why this pattern is safe.
      { name: AnalysisContext.name, schema: AnalysisContextSchema },
    ]),
    BullModule.registerQueue({ name: "tasks" }),
    CredentialsModule,
    OperationsModule,
    // BE-9: GithubWriteService, per aprire la PR che porta la Proposal
    // dell'agente Docs. GithubModule non dipende da nulla a livello
    // applicativo, quindi importarlo qui non crea cicli.
    GithubModule,
    EventsModule,
    // BE-18: TaskProcessor assembles and persists a Report via
    // ReportAssemblyService once a Task reaches COMPLETED or FAILED.
    ReportsModule,
    // RF.79-RF.81: AgentInvocationService legge il template README
    // dell'utente per allegarlo al payload di DOCS_README.
    TemplatesModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TaskProcessor,
    AgentInvocationService,
    UsageLimitService,
    TaskCancellationService,
    ProposalPublisherService,
  ],
  // Re-exports the forFeature registration so other modules (BE-8's
  // internal GitHub facade needs to look up a Task by id) can inject
  // Model<Task> without this module having to expose a service of its own
  // for that.
  exports: [MongooseModule],
})
export class TasksModule {}
