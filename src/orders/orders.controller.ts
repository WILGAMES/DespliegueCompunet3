import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { PayOrderDto } from './dto/pay-order.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { FindOrdersQueryDto } from './dto/find-orders-query.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';

@ApiTags('Orders')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar mis órdenes',
    description:
      'Devuelve las órdenes donde el usuario es comprador o vendedor. Un administrador ve todas.',
  })
  @ApiResponse({ status: 200, description: 'Órdenes obtenidas' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  findAll(
    @Query() query: FindOrdersQueryDto,
    @Req() req: any,
  ) {
    return this.ordersService.findAll(
      req.user,
      query.status,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una orden por ID' })
  @ApiResponse({ status: 200, description: 'Orden encontrada' })
  @ApiResponse({
    status: 403,
    description: 'El usuario no participa en la orden',
  })
  @ApiResponse({ status: 404, description: 'Orden no encontrada' })
  findOne(
    @Param('id', PositiveIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.ordersService.findOne(id, req.user);
  }

  @Post(':id/payment')
  @ApiOperation({
    summary: 'Registrar pago simulado',
    description:
      'Solo el ganador. APPROVED deja la orden en PAID; REJECTED en PAYMENT_REJECTED (se puede reintentar).',
  })
  @ApiResponse({ status: 201, description: 'Pago registrado' })
  @ApiResponse({
    status: 403,
    description: 'Solo el comprador puede pagar',
  })
  @ApiResponse({ status: 404, description: 'Orden no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'La orden no admite pagos en su estado actual',
  })
  pay(
    @Param('id', PositiveIntPipe) id: number,
    @Body() dto: PayOrderDto,
    @Req() req: any,
  ) {
    return this.ordersService.pay(id, dto, req.user);
  }

  @Patch(':id/delivery')
  @ApiOperation({
    summary:
      'Registrar entrega, cancelación o incumplimiento',
    description:
      'DELIVERED (vendedor, orden PAID). CANCELLED (antes del pago: comprador o vendedor; pagada: vendedor). DEFAULTED (vendedor si no hubo pago; comprador si pagó y no recibió). El admin puede en todos los casos válidos.',
  })
  @ApiResponse({ status: 200, description: 'Orden actualizada' })
  @ApiResponse({
    status: 403,
    description: 'Sin permisos para esta transición',
  })
  @ApiResponse({ status: 404, description: 'Orden no encontrada' })
  @ApiResponse({
    status: 409,
    description: 'Transición no válida desde el estado actual',
  })
  updateDelivery(
    @Param('id', PositiveIntPipe) id: number,
    @Body() dto: UpdateDeliveryDto,
    @Req() req: any,
  ) {
    return this.ordersService.updateDelivery(
      id,
      dto,
      req.user,
    );
  }
}
