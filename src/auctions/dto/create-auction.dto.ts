import {
  IsDateString,
  IsInt,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAuctionDto {
  @ApiProperty({
    example: 1,
    description:
      'ID de la publicación aprobada que será subastada',
  })
  @IsInt()
  listingId: number;

  @ApiProperty({
    example: '2026-10-05T14:00:00.000Z',
    description:
      'Fecha y hora de inicio de la subasta',
  })
  @IsDateString()
  startsAt: string;

  @ApiProperty({
    example: '2026-10-05T20:00:00.000Z',
    description:
      'Fecha y hora de finalización de la subasta',
  })
  @IsDateString()
  endsAt: string;
}