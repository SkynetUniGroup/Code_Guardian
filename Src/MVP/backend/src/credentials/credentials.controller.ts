import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { AuthenticatedUser } from "../common/authenticated-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { ApiErrorResponse, ServiceCredentialResponse } from "../common/openapi/api-schemas";
import { CredentialsService } from "./credentials.service";
import { CreateCredentialDto } from "./dto/create-credential.dto";
import type { ServiceCredentialDto } from "./dto/service-credential.dto";
import { SONARQUBE_PROVIDER } from "./supported-providers";

// Every route here is personal to the caller — no RolesGuard, just proof of
// identity via JwtAuthGuard, applied once at the controller level since
// nothing on this controller is public (unlike AuthController, which mixes
// public and protected routes).
@ApiTags("credentials")
@ApiBearerAuth()
@Controller("credentials")
@UseGuards(JwtAuthGuard)
export class CredentialsController {
  constructor(private readonly credentialsService: CredentialsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Salva un Personal Access Token",
    description: "Il token e' validato contro il provider prima di essere cifrato e salvato.",
  })
  @ApiCreatedResponse({ type: ServiceCredentialResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiBadRequestResponse({
    description:
      "Corpo non valido, oppure token rifiutato da GitHub o privo dello scope `repo` (code CREDENTIAL_INVALID).",
    type: ApiErrorResponse,
  })
  @ApiForbiddenResponse({
    description: "Only Developers can configure a SonarQube credential.",
    type: ApiErrorResponse,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCredentialDto,
  ): Promise<ServiceCredentialDto> {
    if (dto.provider === SONARQUBE_PROVIDER && user.role !== "DEVELOPER") {
      throw new ForbiddenException("Only Developers can configure SonarQube credentials");
    }
    return this.credentialsService.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: "Le credenziali salvate",
    description: "Il token non compare mai nella risposta.",
  })
  @ApiOkResponse({ type: [ServiceCredentialResponse] })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  list(@CurrentUser("userId") userId: string): Promise<ServiceCredentialDto[]> {
    return this.credentialsService.list(userId);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Elimina una credenziale" })
  @ApiParam({ name: "id", description: "Id della credenziale." })
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Credenziale inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  remove(@CurrentUser("userId") userId: string, @Param("id") id: string): Promise<void> {
    return this.credentialsService.remove(userId, id);
  }

  @Post(":id/validate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Riverifica una credenziale contro il provider" })
  @ApiParam({ name: "id", description: "Id della credenziale." })
  @ApiOkResponse({ type: ServiceCredentialResponse })
  @ApiUnauthorizedResponse({ type: ApiErrorResponse })
  @ApiNotFoundResponse({
    description: "Credenziale inesistente o di un altro utente.",
    type: ApiErrorResponse,
  })
  @ApiBadRequestResponse({
    description: "Il provider non riconosce piu' il token (code CREDENTIAL_INVALID).",
    type: ApiErrorResponse,
  })
  revalidate(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
  ): Promise<ServiceCredentialDto> {
    return this.credentialsService.revalidate(userId, id);
  }
}
