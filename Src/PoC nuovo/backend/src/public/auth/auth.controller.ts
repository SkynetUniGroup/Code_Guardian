import { Controller, Post, Get, HttpCode, HttpStatus, UseGuards, Body } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private jwtService: JwtService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: any) {
    // Stub per contratto API - Logica rimandata a iterazioni future
    return { message: 'Registrazione disabilitata in questo PoC (stub)' };
  }

  // POST /auth/login 
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login() {
    // Mock login per il PoC: l'utente è noto e non controlliamo password
    const payload = { sub: 'user-123', email: 'test@skynet.com' };
    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  healthCheck() {
    return { status: 'ok', service: 'backend' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  getProfile(@CurrentUser() userId: string) {
    // Stub per contratto API 
    return { userId, email: 'test@skynet.com', role: 'DEVELOPER' };
  }
}