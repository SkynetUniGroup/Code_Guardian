import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import {
  ApiErrorResponse,
  AuthTokenResponse,
  HealthResponse,
  UserProfileResponse,
} from "../common/openapi/api-schemas";
import { AuthService } from "./auth.service";
import type { AuthTokenDto } from "./dto/auth-token.dto";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import type { UserProfileDto } from "./dto/user-profile.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Unauthenticated on purpose: this is what Docker / infrastructure monitoring
  // polls to check the process is alive, before any user has ever logged in.
  @Get("health")
  @ApiOperation({
    summary: "Liveness del processo",
    description:
      "Non autenticato di proposito: e' quello che interrogano Docker e il monitoraggio, prima che esista un utente.",
  })
  @ApiOkResponse({ type: HealthResponse })
  health() {
    return { status: "ok" };
  }

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Registra un nuovo utente" })
  @ApiCreatedResponse({ type: UserProfileResponse })
  @ApiConflictResponse({ description: "Email gia' registrata.", type: ApiErrorResponse })
  register(@Body() dto: RegisterDto): Promise<UserProfileDto> {
    return this.authService.register(dto);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Autentica e restituisce il JWT" })
  @ApiOkResponse({ type: AuthTokenResponse })
  @ApiUnauthorizedResponse({ description: "Credenziali non valide.", type: ApiErrorResponse })
  login(@Body() dto: LoginDto): Promise<AuthTokenDto> {
    return this.authService.login(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Il profilo di chi chiama" })
  @ApiOkResponse({ type: UserProfileResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  getMe(@CurrentUser("userId") userId: string): Promise<UserProfileDto> {
    return this.authService.getProfile(userId);
  }

  // A public route in the sense of no role restriction — any authenticated
  // user can call it — but it still requires a valid JWT. The handler does
  // nothing with it beyond that: stateless JWTs mean there's no session to
  // invalidate, so the guard's only job is giving a missing/expired/invalid
  // token a real 401 to fail on, which is the whole reason this endpoint
  // exists rather than the frontend just discarding the token locally.
  @Post("logout")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Chiude la sessione lato client",
    description:
      "Il JWT e' stateless e resta valido fino alla scadenza: questo endpoint esiste per dare a un token mancante o scaduto un 401 vero su cui fallire.",
  })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  logout(): void {}
}
