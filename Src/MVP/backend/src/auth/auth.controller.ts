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
/**
 * @swagger
 * /auth/health:
 *   get:
 *     summary: Liveness del processo
 *     description: Non autenticato di proposito: e' quello che interrogano Docker e il monitoraggio, prima che esista un utente.
 *     responses:
 *       200:
 *         description: Status response object
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 */
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
/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Registra un nuovo utente
 *     operationId: register
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileResponse'
 *       409:
 *         description: Email già registrata.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Registra un nuovo utente" })
  @ApiCreatedResponse({ type: UserProfileResponse })
  @ApiConflictResponse({ description: "Email gia' registrata.", type: ApiErrorResponse })
  register(@Body() dto: RegisterDto): Promise<UserProfileDto> {
    return this.authService.register(dto);
  }

  @Post("login")
/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Autentica e restituisce il JWT
 *     operationId: login
 *     responses:
 *       200:
 *         description: Token returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthTokenResponse'
 *       401:
 *         description: Credenziali non valide.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Autentica e restituisce il JWT" })
  @ApiOkResponse({ type: AuthTokenResponse })
  @ApiUnauthorizedResponse({ description: "Credenziali non valide.", type: ApiErrorResponse })
  login(@Body() dto: LoginDto): Promise<AuthTokenDto> {
    return this.authService.login(dto);
  }

  @Get("me")
/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Il profilo di chi chiama
 *     operationId: getMe
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserProfileResponse'
 *       401:
 *         description: Unauthorized operation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Chiude la sessione lato client
 *     description: Il JWT e' stateless e resta valido fino alla scadenza: questo endpoint esiste per dare a un token mancante o scaduto un 401 vero su cui fallire.
 *     operationId: logout
 *     responses:
 *       204:
 *         description: No content returned
 *       401:
 *         description: Unauthorized access
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
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
