import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString, Matches } from "class-validator";
import { GITHUB_REPO_URL_REGEX } from "../github-url";

export class RepoTreeQueryDto {
  @ApiProperty({
    type: String,
    example: "https://github.com/SkynetUniGroup/Code_Guardian",
  })
  @Matches(GITHUB_REPO_URL_REGEX, {
    message: "repoUrl must be a GitHub repository URL (https://github.com/:owner/:repo)",
  })
  repoUrl!: string;

  @ApiProperty({ type: String, example: "develop" })
  @IsString()
  @IsNotEmpty()
  branch!: string;

  // Omitted means "use branch's current HEAD" — resolved by
  // RepositoriesService, not here.
  @ApiPropertyOptional({ type: String, description: "Omesso: si usa l'HEAD corrente del branch." })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  commitSha?: string;
}
