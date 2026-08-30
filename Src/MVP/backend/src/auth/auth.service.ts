import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { PasswordService } from './password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserProfileDto } from './dto/user-profile.dto';
import { AuthTokenDto } from './dto/auth-token.dto';

// A real hash of an arbitrary password, precomputed offline. Verified against
// on a login attempt for an email that doesn't exist, so that case costs the
// same Argon2id CPU time as a real password check
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,p=4,t=3$0mbQAFyhM+wVXwVdFYCNoA$wwyVRdVzlk6lFm3WEX3rUoqf093GYh0VRzWYOWdVuQ4';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<UserProfileDto> {
    try {
      const user = await this.userModel.create({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        passwordHash: await this.passwordService.hash(dto.password),
        role: dto.role,
      });
      return this.toProfile(user);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<AuthTokenDto> {
    const user = await this.userModel.findOne({ email: dto.email });
    const isValid = await this.passwordService.verify(
      user?.passwordHash ?? DUMMY_HASH,
      dto.password,
    );

    if (!user || !isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwtService.sign({
      sub: user._id.toString(),
      role: user.role,
    });

    return { accessToken };
  }

  async getProfile(userId: string): Promise<UserProfileDto> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      // The token was valid (signature + expiry checked by JwtAuthGuard) but
      // the account it names is gone — a deleted user with a still-live
      // token, not a case the caller can retry their way out of.
      throw new NotFoundException('User not found');
    }
    return this.toProfile(user);
  }

  private toProfile(user: UserDocument): UserProfileDto {
    return {
      id: user._id.toString(),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}
