import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ReadmeTemplateDto } from "./dto/readme-template.dto";
import { SaveReadmeTemplateDto } from "./dto/save-readme-template.dto";
import { TemplatesService } from "./templates.service";

/**
 * RF.79 / RF.80 / RF.81 — il template README dell'utente autenticato.
 *
 * This is a single resource rather than a collection: each Developer owns
 * one template, and identity always comes from the verified JWT.
 *
 * PUT e non POST perché salvare due volte lo stesso template deve lasciare
 * il sistema nello stesso stato: il caricamento sostituisce, non accumula.
 */
@Controller("templates/readme")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("DEVELOPER")
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Put()
/**
 * @swagger
 * /templates/readme:
 *   put:
 *     summary: Save a README template
 *     operationId: save
 *     responses:
 *       200:
 *         description: README template saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReadmeTemplateDto'
 */
  @HttpCode(HttpStatus.OK)
  save(
    @CurrentUser("userId") userId: string,
    @Body() dto: SaveReadmeTemplateDto,
  ): Promise<ReadmeTemplateDto> {
    return this.templatesService.save(userId, dto);
  }

  @Get()
/**
 * @swagger
 * /templates/readme:
 *   get:
 *     summary: Retrieve the README template
 *     operationId: find
 *     responses:
 *       200:
 *         description: Retrieved README template
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ReadmeTemplateDto'
 */
  find(@CurrentUser("userId") userId: string): Promise<ReadmeTemplateDto> {
    return this.templatesService.find(userId);
  }

  @Delete()
/**
 * @swagger
 * /templates/readme:
 *   delete:
 *     summary: Remove the README template
 *     operationId: remove
 *     responses:
 *       204:
 *         description: No content returned
 */
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser("userId") userId: string): Promise<void> {
    return this.templatesService.remove(userId);
  }
}
