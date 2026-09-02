import {
  CanActivate,
  ExecutionContext,
  Injectable,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

// Authenticates every /internal/* request from the agent service — a
// service identity, not a user, so this checks a shared secret instead of a
// JWT. Message format and header names are fixed by the design (PoC §6.3):
//   HMAC-SHA256(timestamp + ":" + method + ":" + path + ":" + bodyHash, secret)
// sent as X-Internal-Timestamp / X-Internal-Signature. bodyHash is the
// SHA-256 hex of the exact request body bytes — which is why rawBody: true
// is enabled in main.ts; hashing a re-serialized parsed body could produce
// different bytes than what the caller actually signed.
@Injectable()
export class InternalAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();

    const timestampHeader = request.headers['x-internal-timestamp'];
    const signatureHeader = request.headers['x-internal-signature'];
    if (
      typeof timestampHeader !== 'string' ||
      typeof signatureHeader !== 'string'
    ) {
      throw new UnauthorizedException(
        'Missing X-Internal-Timestamp or X-Internal-Signature header',
      );
    }

    this.assertFreshTimestamp(timestampHeader);

    const bodyHash = createHash('sha256')
      .update(request.rawBody ?? Buffer.alloc(0))
      .digest('hex');
    const message = `${timestampHeader}:${request.method}:${request.path}:${bodyHash}`;
    const expectedSignature = createHmac('sha256', this.getSharedSecret())
      .update(message)
      .digest('hex');

    if (!this.signaturesMatch(signatureHeader, expectedSignature)) {
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }

  private assertFreshTimestamp(timestampHeader: string): void {
    const timestamp = Number(timestampHeader);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const windowSeconds = this.config.get<number>('HMAC_WINDOW_S') ?? 30;

    if (
      !Number.isFinite(timestamp) ||
      Math.abs(nowSeconds - timestamp) > windowSeconds
    ) {
      throw new UnauthorizedException('Stale or invalid timestamp');
    }
  }

  // Timing-safe on purpose: a plain `===` comparison returns as soon as the
  // first mismatched byte is found, so how long the comparison takes leaks
  // how many leading bytes an attacker's guess got right. timingSafeEqual
  // takes the same time regardless.
  private signaturesMatch(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      providedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(providedBuffer, expectedBuffer)
    );
  }

  private getSharedSecret(): string {
    const secret = this.config.get<string>('INTERNAL_SHARED_SECRET');
    if (!secret) {
      throw new Error('INTERNAL_SHARED_SECRET is not configured');
    }
    return secret;
  }
}
