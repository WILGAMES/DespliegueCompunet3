import {
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RejectListingDto {
  @ApiPropertyOptional({
    example: 'El producto no cumple con las políticas de publicación.',
    description: 'Motivo opcional del rechazo.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}