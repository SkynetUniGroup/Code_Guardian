import {
  type RegisterDto as RegisterDtoInterface,
  USER_ROLES,
  type UserRole,
} from "@codeguardian/shared";
import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class RegisterDto implements RegisterDtoInterface {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 40,
    example: "Marco",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  firstName!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 40, example: "Barbiero" })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  lastName!: string;

  @ApiProperty({ type: String, format: "email", example: "marco@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({
    type: String,
    minLength: 8,
    description: "Almeno 8 caratteri, con almeno una lettera e almeno una cifra.",
    format: "password",
  })
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, {
    message: "password must contain at least one letter and one digit",
  })
  password!: string;

  @ApiProperty({
    enum: USER_ROLES,
    description: "Scelto qui una volta per tutte: non e' piu' modificabile.",
  })
  @IsIn(USER_ROLES)
  role!: UserRole;
}
