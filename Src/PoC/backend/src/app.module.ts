import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '@nestjs-modules/ioredis';
import * as Joi from 'joi'; 
import { DomainModule } from './domain/domain.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { PublicModule } from './public/public.module';
import { InternalModule } from './internal/internal.module.js';
import { EventsModule } from './events.module.js';
import { ReportModule } from './domain/report.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../.env',
      // Aggiungiamo lo schema di validazione Joi
        validationSchema: Joi.object({
        // Database & Coda
        MONGO_URI: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        
        // Segreti e Crittografia
        JWT_SECRET: Joi.string().required(),
        CREDENTIAL_MASTER_KEY: Joi.string().required(),
        INTERNAL_SHARED_SECRET: Joi.string().required(),
        
        // Servizi Esterni (Opzionali per sviluppo)
        AGENTS_BASE_URL: Joi.string().optional(),
        SMTP_HOST: Joi.string().optional(),
        SMTP_PORT: Joi.number().optional(),
        S3_ENDPOINT: Joi.string().optional(),
        S3_KEY: Joi.string().optional(),
        S3_SECRET: Joi.string().optional(),
      }),
    }),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Ora possiamo fidarci che get() non restituirà undefined
        uri: configService.get<string>('MONGO_URI'), 
      }),
    }),

    RedisModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'single',
        url: configService.get<string>('REDIS_URL'),
      }),
    }),

    DomainModule,
    OrchestrationModule,
    PublicModule,
    InternalModule,
    EventsModule,
    ReportModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}