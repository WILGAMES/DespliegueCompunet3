import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { PaymentResult } from '../enums/order-status.enum';

export class PayOrderDto {
  @ApiProperty({
    enum: PaymentResult,
    example: PaymentResult.APPROVED,
    description:
      'Resultado del pago simulado (no hay pasarela real)',
  })
  @IsEnum(PaymentResult)
  result: PaymentResult;
}
