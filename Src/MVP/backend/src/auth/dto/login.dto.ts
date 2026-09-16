import type { LoginDto as LoginDtoInterface } from "@codeguardian/shared";
import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, MinLength } from "class-validator";

export class LoginDto implements LoginDtoInterface {
  @ApiProperty({ type: String, format: "email", example: "marco@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, format: "password" })
  @IsString()
  @MinLength(1)
  password!: string;
}
