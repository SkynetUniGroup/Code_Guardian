import type { CreateCredentialDto as CreateCredentialDtoInterface } from "@codeguardian/shared";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, ValidateIf } from "class-validator";
import { SONARQUBE_PROVIDER, SUPPORTED_PROVIDERS } from "../supported-providers";

export class CreateCredentialDto implements CreateCredentialDtoInterface {
  @ApiProperty({ enum: SUPPORTED_PROVIDERS, example: "GITHUB" })
  @IsIn(SUPPORTED_PROVIDERS)
  provider!: string;

  // Deliberately no format pattern: GitHub's PAT format has changed over
  // time (classic 40-char hex, `ghp_`-prefixed, fine-grained
  // `github_pat_...`), and the spec calls for "un controllo di forma, non
  // un pattern rigido" (§4.2). Non-emptiness is all that's checked here —
  // whether it actually works is verified live against the provider, not
  // guessed from its shape. Same reasoning for a SonarQube token.
  @ApiProperty({
    type: String,
    format: "password",
    description:
      "Token di accesso. Nessun pattern imposto: la validita' e' verificata contro il provider, non dedotta dalla forma.",
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  // The three fields below only exist for SONARQUBE, and for it they are
  // mandatory — @ValidateIf makes them required exactly when
  // provider === "SONARQUBE" and absent-friendly otherwise, so the GITHUB
  // body stays {provider, token} unchanged. instanceUrl must be a real URL
  // because CredentialsService builds the SonarQube API base off it.
  @ApiPropertyOptional({
    type: String,
    example: "https://sonarcloud.io",
    description: "Solo SONARQUBE — URL dell'istanza SonarQube o SonarCloud.",
  })
  @ValidateIf((dto: CreateCredentialDto) => dto.provider === SONARQUBE_PROVIDER)
  // require_protocol so CredentialsService can concatenate paths onto it and
  // fetch() them; require_tld off so a self-hosted host like
  // https://sonar.internal (or https://localhost:9000) still validates.
  @IsUrl({ require_tld: false, require_protocol: true })
  instanceUrl?: string;

  @ApiPropertyOptional({
    type: String,
    example: "my-org_my-project",
    description: "Solo SONARQUBE — chiave del progetto sull'istanza.",
  })
  @ValidateIf((dto: CreateCredentialDto) => dto.provider === SONARQUBE_PROVIDER)
  @IsString()
  @IsNotEmpty()
  projectKey?: string;

  // Optional even for SonarQube: self-hosted instances have no organization,
  // SonarCloud requires one. Left to the user rather than sniffed from the
  // URL — a self-hosted instance can sit on any hostname.
  @ApiPropertyOptional({
    type: String,
    description: "Solo SONARQUBE — organizzazione, richiesta da SonarCloud.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  organizationKey?: string;
}
