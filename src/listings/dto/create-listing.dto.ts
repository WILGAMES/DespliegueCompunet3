import {
  ApiProperty,
} from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateListingDto {
  @ApiProperty({
    example: 'Laptop Lenovo ThinkPad',
    description:
      'Título de la publicación.',
    minLength: 3,
    maxLength: 150,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @ApiProperty({
    example:
      'Laptop Lenovo ThinkPad en excelente estado, ideal para trabajo y estudio.',
    description:
      'Descripción detallada del producto.',
    minLength: 10,
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(5000)
  description: string;

  @ApiProperty({
    example: 'Tecnología',
    description:
      'Categoría del producto.',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  category: string;

  @ApiProperty({
    example: 1500000,
    description:
      'Precio inicial de la subasta.',
    minimum: 0.01,
  })
  @IsNumber()
  @Min(0.01)
  initialPrice: number;

  @ApiProperty({
    example: 50000,
    description:
      'Incremento mínimo permitido entre ofertas.',
    minimum: 0.01,
  })
  @IsNumber()
  @Min(0.01)
  minimumIncrement: number;

  @ApiProperty({
    example: 12,
    description:
      'Duración de la subasta en horas.',
    minimum: 1,
    maximum: 24,
  })
  @IsInt()
  @Min(1)
  @Max(24)
  durationHours: number;
}