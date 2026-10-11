import {
  ApiProperty,
} from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'felipe@example.com',
    description:
      'Correo electrónico registrado.',
    maxLength: 150,
  })
  @IsEmail()
  @MaxLength(150)
  email: string;

  @ApiProperty({
    example: 'Password123',
    description:
      'Contraseña del usuario.',
    minLength: 8,
    maxLength: 72,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}