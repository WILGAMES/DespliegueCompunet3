import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Motivo opcional de una decisión administrativa. */
export class ReasonDto {
  @ApiPropertyOptional({
    example: 'Incumple las políticas de la plataforma.',
    description: 'Motivo de la decisión (se guarda para trazabilidad).',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
