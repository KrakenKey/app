import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

// groups come from the identity provider at login and gate admin access,
// so they must never be writable through the API.
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['groups'] as const),
) {}
