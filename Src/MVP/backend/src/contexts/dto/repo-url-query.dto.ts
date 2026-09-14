import { ApiProperty } from "@nestjs/swagger";
import { Matches } from "class-validator";
import { GITHUB_REPO_URL_REGEX } from "../github-url";

export class RepoUrlQueryDto {
  @ApiProperty({
    type: String,
    example: "https://github.com/SkynetUniGroup/Code_Guardian",
  })
  @Matches(GITHUB_REPO_URL_REGEX, {
    message: "repoUrl must be a GitHub repository URL (https://github.com/:owner/:repo)",
  })
  repoUrl!: string;
}
