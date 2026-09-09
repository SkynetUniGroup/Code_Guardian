import type { CreateCredentialDto as CreateCredentialDtoInterface } from "@codeguardian/shared";
import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsString } from "class-validator";
import { SUPPORTED_PROVIDERS } from "../supported-providers";

export class CreateCredentialDto implements CreateCredentialDtoInterface {
  @ApiProperty({ enum: SUPPORTED_PROVIDERS, example: "GITHUB" })
  @IsIn(SUPPORTED_PROVIDERS)
  provider!: string;

  // Deliberately no format pattern: GitHub's PAT format has changed over
  // time (classic 40-char hex, `ghp_`-prefixed, fine-grained
  // `github_pat_...`), and the spec calls for "un controllo di forma, non
  // un pattern rigido" (§4.2). Non-emptiness is all that's checked here —
  // whether it actually works is verified live against GitHub, not guessed
  // from its shape.
  @ApiProperty({
    type: String,
    format: "password",
    description:
      "Personal Access Token. Nessun pattern imposto: la validita' e' verificata contro GitHub, non dedotta dalla forma.",
  })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
