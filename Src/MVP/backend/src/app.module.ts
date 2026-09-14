import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { RedisModule } from "@nestjs-modules/ioredis";
import { AuthModule } from "./auth/auth.module";
import { envValidationSchema } from "./config/env.validation";
import { ContextsModule } from "./contexts/contexts.module";
import { CredentialsModule } from "./credentials/credentials.module";
import { EventsModule } from "./events/events.module";
import { GithubModule } from "./github/github.module";
import { InternalGithubModule } from "./github/internal-github.module";
import { OperationsModule } from "./operations/operations.module";
import { ReportsModule } from "./reports/reports.module";
import { TasksModule } from "./tasks/tasks.module";
import { TemplatesModule } from "./templates/templates.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>("MONGODB_URI"),
      }),
      inject: [ConfigService],
    }),
    // Registrato qui e non dentro GithubModule: la connessione Redis serve a
    // due consumatori indipendenti — la cache delle letture GitHub e il flag di
    // cancellazione dei task — e tenerla dentro il modulo di uno dei due
    // rendeva l'altro dipendente da quel modulo per una risorsa che non gli
    // appartiene. forRootAsync registra il provider come globale.
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: "single",
        url: config.get<string>("REDIS_URL"),
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrlStr = config.get<string>("REDIS_URL");
        if (!redisUrlStr) {
          throw new Error("REDIS_URL is required");
        }
        const redisUrl = new URL(redisUrlStr);
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
            password: redisUrl.password || undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    AuthModule,
    CredentialsModule,
    GithubModule,
    InternalGithubModule,
    ContextsModule,
    TasksModule,
    ReportsModule,
    OperationsModule,
    EventsModule,
    TemplatesModule,
  ],
})
export class AppModule {}
