import {
  Body,
  Controller,
  Delete,
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

import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';

@ApiTags('Listings')
@ApiBearerAuth('JWT-auth')
@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listingsService: ListingsService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Crear una publicación',
  })
  @ApiResponse({
    status: 201,
    description:
      'Publicación creada correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos de la publicación inválidos.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Ya existe una publicación activa con ese título.',
  })
  create(
    @Body()
    createListingDto: CreateListingDto,
    @Req() req: any,
  ) {
    return this.listingsService.create(
      createListingDto,
      req.user.id,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Obtener publicaciones públicas',
    description:
      'Obtiene únicamente publicaciones disponibles para consulta pública.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Listado de publicaciones públicas.',
  })
  findAll() {
    return this.listingsService.findAll();
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Obtener mis publicaciones',
  })
  @ApiResponse({
    status: 200,
    description:
      'Publicaciones del usuario autenticado.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  findMine(@Req() req: any) {
    return this.listingsService.findMine(
      req.user.id,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener una publicación pública',
  })
  @ApiResponse({
    status: 200,
    description:
      'Publicación pública encontrada.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Publicación no encontrada o no disponible públicamente.',
  })
  findOne(
    @Param('id', PositiveIntPipe) id: number,
  ) {
    return this.listingsService.findPublicOne(
      id,
    );
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Actualizar una publicación propia',
    description:
      'Actualiza la publicación y vuelve a ejecutar la validación mediante IA.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Publicación actualizada correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos de la publicación inválidos.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 409,
    description:
      'El usuario no puede modificar la publicación.',
  })
  update(
    @Param('id', PositiveIntPipe) id: number,
    @Body()
    updateListingDto: UpdateListingDto,
    @Req() req: any,
  ) {
    return this.listingsService.update(
      id,
      updateListingDto,
      req.user.id,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Eliminar una publicación propia',
  })
  @ApiResponse({
    status: 200,
    description:
      'Publicación eliminada correctamente.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Publicación no encontrada.',
  })
  @ApiResponse({
    status: 409,
    description:
      'El usuario no puede eliminar la publicación.',
  })
  delete(
    @Param('id', PositiveIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.listingsService.remove(
      id,
      req.user.id,
    );
  }
}
