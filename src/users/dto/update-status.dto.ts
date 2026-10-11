import {
  ApiProperty,
} from '@nestjs/swagger';
import {
  IsBoolean,
} from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({
    example: true,
    description:
      'Indica si el usuario quedará activo.',
  })
  @IsBoolean()
  isActive: boolean;
}