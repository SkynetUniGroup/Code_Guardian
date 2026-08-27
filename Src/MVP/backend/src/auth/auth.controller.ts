import { Controller, Get } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  // Unauthenticated on purpose: this is what Docker / infrastructure monitoring
  // polls to check the process is alive, before any user has ever logged in.
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
