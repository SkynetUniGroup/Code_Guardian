import { Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Controller('auth')
export class AuthController {
  constructor(private jwtService: JwtService) {}

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
}