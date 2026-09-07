import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { AuthTokenDto } from './dto/auth-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser('userId') userId: string): Promise<UserProfileDto> {
    return this.authService.getProfile(userId);
  }

  // A public route in the sense of no role restriction — any authenticated
  // user can call it — but it still requires a valid JWT. The handler does
  // nothing with it beyond that: stateless JWTs mean there's no session to
  // invalidate, so the guard's only job is giving a missing/expired/invalid
  // token a real 401 to fail on, which is the whole reason this endpoint
  // exists rather than the frontend just discarding the token locally.
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(): void {}
}
