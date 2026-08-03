import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, RequestTimeoutException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class HmacGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const signature = req.headers['x-signature'];
    const timestampStr = req.headers['x-timestamp'];

    if (!signature || !timestampStr) {
      throw new UnauthorizedException('Firma HMAC o timestamp mancanti');
    }

    const timestamp = parseInt(timestampStr, 10);
    const now = Date.now();

   // Rifiuta con 408 se il timestamp è sfasato di oltre 60 secondi 
    if (Math.abs(now - timestamp) > 60000) {
      throw new RequestTimeoutException('Richiesta scaduta o timestamp non valido');
    }

    const secret = this.configService.get<string>('INTERNAL_SHARED_SECRET');
    if (!secret) throw new Error('INTERNAL_SHARED_SECRET non configurato');

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
    const payload = `${timestamp}.${rawBody}`;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const signatureBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== signatureBuffer.length || !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) {
      throw new UnauthorizedException('Firma HMAC non valida');
    }

    return true;
  }
}