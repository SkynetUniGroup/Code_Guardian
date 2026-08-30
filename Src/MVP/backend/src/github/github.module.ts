import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { GithubClientService } from './github-client.service';

// AccessLog's registration moved to InternalGithubModule (BE-8): nothing in
// here ever writes to it — GithubClientService itself doesn't know it's
// being called on an agent's behalf versus the backend's own direct calls
// (BE-6, BE-9 onward) — so it belongs with the one module that actually logs
// to it, not with the client every caller shares.
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
  ],
  providers: [GithubClientService],
  exports: [GithubClientService],
})
export class GithubModule {}
