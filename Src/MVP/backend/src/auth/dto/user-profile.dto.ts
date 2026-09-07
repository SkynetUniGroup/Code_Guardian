import { UserRole } from '../schemas/user.schema';

export interface UserProfileDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: UserRole;
}
