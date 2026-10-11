import {
  Body,
  Controller,
  Get,
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

import { ListingsService } from './listings.service';
import { RejectListingDto } from './dto/reject-listing.dto';
import { ReasonDto } from '../common/dto/reason.dto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../users/enums/role.enum';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';

@ApiTags('Admin - Listings')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class ListingsAdminController {
  constructor(
    private readonly listingsService: ListingsService,
  ) {}

  @Get('reviews')
  @ApiOperation({
    summary:
      'Cola de publicaciones pendientes de revisión',
    description:
      'Publicaciones que la IA o las reglas automáticas enviaron a revisión administrativa, de la más antigua a la más reciente. Incluye la recomendación de la IA (decisión, riesgo, razón y confianza).',
  })
  @ApiResponse({
    status: 200,
    description:
      'Listado de publicaciones pendientes de revisión.',
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
  findReviews() {
    return this.listingsService.findPendingReview();
  }

  @Patch('listings/:id/approve')
  @ApiOperation({
    summary: 'Aprobar una publicación',
    description:
      'Aprueba una publicación pendiente de revisión. La recomendación de la IA se conserva sin cambios.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Publicación aprobada correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'La publicación no está pendiente de revisión.',
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
    description: 'Publicación no encontrada.',
  })
  approve(
    @Param('id', PositiveIntPipe) id: number,
    @Req() req: any,
  ) {
    return this.listingsService.approve(
      id,
      req.user.id,
    );
  }

  @Patch('listings/:id/reject')
  @ApiOperation({
    summary: 'Rechazar una publicación',
    description:
      'Rechaza una publicación pendiente de revisión. El motivo se guarda como decisión administrativa, separado de la razón de la IA.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Publicación rechazada correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'La publicación no está pendiente de revisión.',
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
    description: 'Publicación no encontrada.',
  })
  reject(
    @Param('id', PositiveIntPipe) id: number,
    @Body() rejectListingDto: RejectListingDto,
    @Req() req: any,
  ) {
    return this.listingsService.reject(
      id,
      req.user.id,
      rejectListingDto.reason,
    );
  }

  @Patch('listings/:id/suspend')
  @ApiOperation({
    summary: 'Suspender una publicación',
    description:
      'Retira la publicación de la vista pública. Si tiene una subasta programada o activa, también se cancela: sus ofertas quedan canceladas y no se genera ganador ni orden. No aplica a publicaciones finalizadas.',
  })
  @ApiResponse({
    status: 200,
    description: 'Publicación suspendida correctamente.',
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
    description: 'Publicación no encontrada.',
  })
  @ApiResponse({
    status: 409,
    description:
      'La publicación ya está suspendida o su estado no permite suspenderla.',
  })
  suspend(
    @Param('id', PositiveIntPipe) id: number,
    @Body() dto: ReasonDto,
    @Req() req: any,
  ) {
    return this.listingsService.suspend(
      id,
      req.user.id,
      dto.reason,
    );
  }

  @Patch('listings/:id/unsuspend')
  @ApiOperation({
    summary: 'Levantar la suspensión de una publicación',
    description:
      'La publicación vuelve a revisión (PENDING_REVIEW). No es posible si ya tuvo una subasta.',
  })
  @ApiResponse({
    status: 200,
    description: 'Suspensión levantada.',
  })
  @ApiResponse({
    status: 400,
    description: 'La publicación no está suspendida.',
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
    description: 'Publicación no encontrada.',
  })
  @ApiResponse({
    status: 409,
    description:
      'La publicación ya tuvo una subasta y no puede reactivarse.',
  })
  unsuspend(
    @Param('id', PositiveIntPipe) id: number,
    @Body() dto: ReasonDto,
    @Req() req: any,
  ) {
    return this.listingsService.unsuspend(
      id,
      req.user.id,
      dto.reason,
    );
  }
}
