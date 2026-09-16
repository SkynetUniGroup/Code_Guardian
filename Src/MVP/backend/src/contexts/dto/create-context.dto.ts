import {
  type CreateContextDto as CreateContextDtoInterface,
  SCOPE_TYPES,
  type ScopeType,
} from "@codeguardian/shared";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";
import { GITHUB_REPO_URL_REGEX } from "../github-url";

export class CreateContextDto implements CreateContextDtoInterface {
  @ApiProperty({
    type: String,
    example: "https://github.com/SkynetUniGroup/Code_Guardian",
    description: "URL di un repository GitHub, nella forma https://github.com/:owner/:repo",
  })
  @Matches(GITHUB_REPO_URL_REGEX, {
    message: "repoUrl must be a GitHub repository URL (https://github.com/:owner/:repo)",
  })
  repoUrl!: string;

  @ApiProperty({
    type: String,
    example: "develop",
  })
  @IsString()
  @IsNotEmpty()
  branch!: string;

  @ApiPropertyOptional({
    type: String,
    description: "Se omesso, l'analisi si ancora all'HEAD corrente del branch (RF.17).",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  commitSha?: string;

  @ApiProperty({ enum: SCOPE_TYPES })
  @IsIn(SCOPE_TYPES)
  scopeType!: ScopeType;

  // Non-emptiness (for FILES/DIRECTORIES) and emptiness (for
  // FULL_REPOSITORY) are cross-field rules that depend on scopeType — not
  // expressible cleanly with class-validator decorators alone, so that
  // check lives in ContextsService instead (RF.29).
  @ApiPropertyOptional({
    type: [String],
    description:
      "Obbligatorio per FILES e DIRECTORIES, da omettere per FULL_REPOSITORY: la regola incrociata e' verificata da ContextsService (RF.29), non qui.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];
}
