import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class CreateBidDto {
  @ApiProperty({
    example: 1600000,
    description:
      'Valor de la oferta (máximo 2 decimales)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  // Límite de la columna decimal(12,2)
  @Max(9999999999.99)
  amount: number;
}
