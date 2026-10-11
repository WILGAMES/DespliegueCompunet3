import {
  Body,
  Controller,
  Param,
  Patch,
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

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../users/enums/role.enum';
import { ReasonDto } from '../common/dto/reason.dto';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';

@ApiTags('Admin - Auctions')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AuctionsAdminController {
  constructor(
    private readonly auctionsService: AuctionsService,
  ) {}

  @Patch('auctions/:id/cancel')
  @ApiOperation({
    summary: 'Cancelar una subasta (administrador)',
    description:
      'A diferencia del vendedor, el administrador puede cancelar una subasta con ofertas: las ofertas quedan canceladas, no hay ganador ni orden y la publicación pasa a CANCELLED. No aplica a subastas finalizadas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Subasta cancelada.',
  })
  @ApiResponse({
    status: 401,
    description: 'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene permisos de administrador.',
  })
  @ApiResponse({
    status: 404,
    description: 'Subasta no encontrada.',
  })
  @ApiResponse({
    status: 409,
    description:
      'La subasta ya terminó o ya está cancelada.',
  })
  cancel(
    @Param('id', PositiveIntPipe) id: number,
    @Body() dto: ReasonDto,
    @Req() req: any,
  ) {
    return this.auctionsService.adminCancel(
      id,
      req.user.id,
      dto.reason,
    );
  }
}
