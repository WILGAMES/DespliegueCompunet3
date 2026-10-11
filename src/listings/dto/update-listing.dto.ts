import {
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';

import { CreateListingDto } from './create-listing.dto';

export class UpdateListingDto extends PartialType(
  CreateListingDto,
) {
  @ApiPropertyOptional({
    example: 'Laptop Lenovo ThinkPad T14',
    description:
      'Nuevo título de la publicación.',
  })
  title?: string;

  @ApiPropertyOptional({
    example:
      'Laptop Lenovo ThinkPad en excelente estado y con poco uso.',
    description:
      'Nueva descripción de la publicación.',
  })
  description?: string;

  @ApiPropertyOptional({
    example: 'Tecnología',
    description:
      'Nueva categoría de la publicación.',
  })
  category?: string;

  @ApiPropertyOptional({
    example: 1600000,
    description:
      'Nuevo precio inicial.',
  })
  initialPrice?: number;

  @ApiPropertyOptional({
    example: 50000,
    description:
      'Nuevo incremento mínimo.',
  })
  minimumIncrement?: number;

  @ApiPropertyOptional({
    example: 12,
    description:
      'Nueva duración de la subasta en horas.',
    minimum: 1,
    maximum: 24,
  })
  durationHours?: number;
}