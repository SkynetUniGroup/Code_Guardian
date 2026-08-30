import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { MongooseModule } from '@nestjs/mongoose';
import { GithubClientService } from './github-client.service';
import { AccessLog, AccessLogSchema } from './schemas/access-log.schema';

@Module({
  imports: [
    RedisModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'single',
        url: config.get<string>('REDIS_URL'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: AccessLog.name, schema: AccessLogSchema },
    ]),
  ],
  providers: [GithubClientService],
  exports: [GithubClientService],
})
export class GithubModule {}
