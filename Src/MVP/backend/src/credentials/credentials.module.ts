import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GithubModule } from '../github/github.module';
import { CredentialCipherService } from './credential-cipher.service';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import {
  ServiceCredential,
  ServiceCredentialSchema,
} from './schemas/service-credential.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServiceCredential.name, schema: ServiceCredentialSchema },
    ]),
    GithubModule,
  ],
  controllers: [CredentialsController],
  providers: [CredentialCipherService, CredentialsService],
  // CredentialCipherService and CredentialsService both exported: later
  // modules (repository browsing, context creation, PR opening) need
  // CredentialsService.getDecryptedToken(), not just the raw cipher.
  exports: [CredentialCipherService, CredentialsService],
})
export class CredentialsModule {}
