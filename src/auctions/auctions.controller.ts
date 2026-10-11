import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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

import { AuctionsService } from './auctions.service';
import { CreateAuctionDto } from './dto/create-auction.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';

@ApiTags('Auctions')
@ApiBearerAuth('JWT-auth')
@Controller('auctions')
export class AuctionsController {
  constructor(
    private readonly auctionsService: AuctionsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Crear una subasta',
  })
  @ApiResponse({
    status: 201,
    description: 'Subasta creada correctamente',
  })
  @ApiResponse({
    status: 400,
    description:
      'Los datos de la subasta no cumplen las reglas',
  })
  @ApiResponse({
    status: 404,
    description:
      'La publicación no fue encontrada',
  })
  create(
    @Body() createAuctionDto: CreateAuctionDto,
    @Req() req: any,
  ) {
    return this.auctionsService.create(
      createAuctionDto,
      req.user.id,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Obtener todas las subastas',
  })
  findAll() {
    return this.auctionsService.findAll();
  }

  @Get('active')
  @ApiOperation({
    summary: 'Obtener las subastas activas',
  })
  @ApiResponse({
    status: 200,
    description: 'Subastas activas obtenidas',
  })
  findActive() {
    return this.auctionsService.findActive();
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Obtener mis subastas',
  })
  findMine(@Req() req: any) {
    return this.auctionsService.findMine(
      req.user.id,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener una subasta por ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Subasta encontrada',
  })
  @ApiResponse({
    status: 404,
    description: 'Subasta no encontrada',
  })
  findOne(
    @Param('id', PositiveIntPipe) id: number,
  ) {
    return this.auctionsService.findOne(id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Cancelar una subasta',
    description:
      'Solo el vendedor y solo si la subasta no tiene ofertas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Subasta cancelada',
  })
  @ApiResponse({
    status: 403,
    description: 'La subasta no te pertenece',
  })
  @ApiResponse({
    status: 404,
    description: 'Subasta no encontrada',
  })
  @ApiResponse({
    status: 409,
    description:
      'La subasta ya terminó, está cancelada o tiene ofertas',
  })
  cancel(
    @Param('id', PositiveIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.auctionsService.cancel(
      id,
      req.user.id,
    );
  }
}