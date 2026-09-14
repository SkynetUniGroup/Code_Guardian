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
    description: "URL of a GitHub repository, in the form https://github.com/:owner/:repo",
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
    description: "If omitted, the analysis anchors to the current HEAD of the branch (RF.17).",
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
      "Required for FILES and DIRECTORIES, to be omitted for FULL_REPOSITORY: the cross-field rule is verified by ContextsService (RF.29), not here.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paths?: string[];
}
