import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { AuthTokenDto } from './dto/auth-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Unauthenticated on purpose: this is what Docker / infrastructure monitoring
  // polls to check the process is alive, before any user has ever logged in.
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<UserProfileDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthTokenDto> {
    return this.authService.login(dto);
  }
}
