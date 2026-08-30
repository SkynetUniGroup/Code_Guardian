import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CredentialCipherService } from './credential-cipher.service';
import {
  ServiceCredential,
  ServiceCredentialSchema,
} from './schemas/service-credential.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ServiceCredential.name, schema: ServiceCredentialSchema },
    ]),
  ],
  providers: [CredentialCipherService],
  exports: [CredentialCipherService],
})
export class CredentialsModule {}
