import { IsEmail, IsString, MinLength } from "class-validator";
import type { LoginDto as LoginDtoInterface } from "@codeguardian/shared";

export class LoginDto implements LoginDtoInterface {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
