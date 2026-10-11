import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { BidsService } from './bids.service';
import { CreateBidDto } from './dto/create-bid.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';


@ApiTags('Bids')
@ApiBearerAuth('JWT-auth')
@Controller('auctions')
export class BidsController {
  constructor(
    private readonly bidsService: BidsService,
  ) {}

  @Post(':auctionId/bids')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Realizar una oferta en una subasta',
  })
  @ApiResponse({
    status: 201,
    description: 'Oferta realizada correctamente',
  })
  @ApiResponse({
    status: 400,
    description:
      'La oferta no cumple las reglas de la subasta',
  })
  @ApiResponse({
    status: 401,
    description: 'No autenticado',
  })
  @ApiResponse({
    status: 404,
    description: 'Subasta no encontrada',
  })
  @ApiResponse({
    status: 409,
    description:
      'El vendedor no puede ofertar, o ya tienes la oferta más alta',
  })
  async create(
    @Param('auctionId', PositiveIntPipe)
    auctionId: number,
    @Body() createBidDto: CreateBidDto,
    @Req() req: any,
  ) {
    const bid = await this.bidsService.create(
      auctionId,
      createBidDto,
      req.user.id,
    );

    return {
      ...bid,
      amount: Number(bid.amount).toFixed(2),
    };
  }

  @Get('my-bids')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener mis ofertas' })
  @ApiResponse({ status: 200, description: 'Ofertas obtenidas' })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  findMine(@Req() req: any) {
    return this.bidsService.findMine(req.user.id);
  }

  @Get(':auctionId/bids')
  @ApiOperation({
    summary: 'Obtener las ofertas de una subasta',
  })
  @ApiResponse({ status: 200, description: 'Ofertas obtenidas' })
  @ApiResponse({
    status: 404,
    description: 'Subasta no encontrada',
  })
  findByAuction(
    @Param('auctionId', PositiveIntPipe)
    auctionId: number,
  ) {
    return this.bidsService.findByAuction(auctionId);
  }
}
