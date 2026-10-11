import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Datos que un usuario puede cambiar de su propio perfil.
 * El correo y el rol no se modifican desde aquí.
 */
export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Felipe Murillo',
    description: 'Nuevo nombre completo.',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'Password123',
    description:
      'Contraseña actual. Obligatoria para cambiar la contraseña.',
  })
  @ValidateIf(
    (dto: UpdateUserDto) =>
      dto.newPassword !== undefined,
  )
  @IsString()
  @IsNotEmpty()
  currentPassword?: string;

  @ApiPropertyOptional({
    example: 'NuevaPassword456',
    description:
      'Nueva contraseña. Al cambiarla se cierran las sesiones abiertas y hay que iniciar sesión de nuevo.',
    minLength: 8,
    maxLength: 72,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword?: string;
}
