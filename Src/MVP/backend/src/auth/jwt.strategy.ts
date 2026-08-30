import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../common/authenticated-user';
import { UserRole } from './schemas/user.schema';

interface JwtPayload {
  sub: string;
  role: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Non-null: JWT_SECRET is required by env.validation.ts's Joi schema —
      // the app refuses to boot at all without it, so it's never actually
      // undefined here despite ConfigService's generic (string | undefined)
      // return type.
      secretOrKey: config.get<string>('JWT_SECRET')!,
    });
  }

  // Whatever this returns becomes request.user. Passport has already
  // verified the signature and expiry by the time this runs — this only
  // shapes the payload, no further checks needed.
  validate(payload: JwtPayload): AuthenticatedUser {
    return { userId: payload.sub, role: payload.role };
  }
}
