import { Module } from '@nestjs/common';
import { CredentialVaultService } from './credential-vault.service.js';
import { OctokitGitHubClient } from './github-client.service.js';
import { RepositoryContextService } from './repository-context.service.js';
import { InternalGitHubController } from './internal-github.controller.js';
import { DomainModule } from '../domain/domain.module.js';

@Module({
  imports: [DomainModule],
  controllers: [InternalGitHubController],
  providers: [
    CredentialVaultService,
    OctokitGitHubClient,
    RepositoryContextService
  ],
  exports: [
    CredentialVaultService,
    OctokitGitHubClient,
    RepositoryContextService
  ],
})
export class InternalModule {}