import {
  ApiProperty,
} from '@nestjs/swagger';
import {
  IsEnum,
} from 'class-validator';

import { Role } from '../enums/role.enum';

export class UpdateRoleDto {
  @ApiProperty({
    enum: Role,
    example: Role.ADMIN,
    description: 'Nuevo rol del usuario.',
  })
  @IsEnum(Role)
  role: Role;
}