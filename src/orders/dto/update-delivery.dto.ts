import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { DeliveryAction } from '../enums/order-status.enum';

export class UpdateDeliveryDto {
  @ApiProperty({
    enum: DeliveryAction,
    example: DeliveryAction.DELIVERED,
  })
  @IsEnum(DeliveryAction)
  status: DeliveryAction;

  @ApiPropertyOptional({
    example: 'Entregado en persona',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
