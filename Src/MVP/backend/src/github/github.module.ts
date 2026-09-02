import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RedisModule } from '@nestjs-modules/ioredis';
import { GithubClientService } from './github-client.service';
import { GithubWriteService } from './github-write.service';

// AccessLog's registration moved to InternalGithubModule (BE-8): nothing in
// here ever writes to it — GithubClientService itself doesn't know it's
// being called on an agent's behalf versus the backend's own direct calls
// (BE-6, BE-9 onward) — so it belongs with the one module that actually logs
// to it, not with the client every caller shares.
//
// GithubWriteService (BE-9) lives here too but is a separate provider, not a
// new method on GithubClientService: that class enforces read-only by
// construction (an Octokit hook that throws on any non-GET request), and
// bolting a write path onto it would either break that guarantee or require
// punching a hole through it. GithubWriteService builds its own Octokit
// client for the three write calls it needs, and reuses GithubClientService
// only for the reads it needs first (resolving the base branch's HEAD,
// fetching the file being changed).
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
  providers: [GithubClientService, GithubWriteService],
  exports: [GithubClientService, GithubWriteService],
})
export class GithubModule {}
