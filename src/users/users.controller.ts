import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { UsersService } from './users.service';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

import { Role } from './enums/role.enum';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PositiveIntPipe } from '../common/pipes/positive-int-pipe';

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  // ==========================================
  // PERFIL DEL USUARIO AUTENTICADO
  // ==========================================

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({
    summary: 'Obtener mi perfil',
    description:
      'Obtiene la información del usuario autenticado.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Perfil obtenido correctamente.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado o token inválido.',
  })
  getMe(@Req() req: any) {
    return this.usersService.findById(
      req.user.id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @ApiOperation({
    summary: 'Actualizar mi perfil',
    description:
      'Permite cambiar el nombre y/o la contraseña del usuario autenticado. Para cambiar la contraseña se debe enviar la contraseña actual; al cambiarla se cierran las sesiones abiertas y hay que iniciar sesión de nuevo.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Perfil actualizado correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos o contraseña actual incorrecta.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado o token inválido.',
  })
  updateMe(
    @Req() req: any,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateProfile(
      req.user.id,
      updateUserDto,
    );
  }

  // ==========================================
  // RUTA DE PRUEBA EXCLUSIVA PARA ADMIN
  // ==========================================

  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(Role.ADMIN)
  @Get('admin')
  @ApiOperation({
    summary: 'Verificar acceso administrativo',
    description:
      'Endpoint protegido exclusivamente para administradores.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Acceso administrativo autorizado.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene rol ADMIN.',
  })
  getAdminData() {
    return {
      message:
        'Contenido exclusivo para administradores',
    };
  }

  // ==========================================
  // LISTAR USUARIOS
  // ADMIN
  // ==========================================

  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Listar usuarios',
    description:
      'Obtiene todos los usuarios. Disponible únicamente para administradores.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Usuarios obtenidos correctamente.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene permisos de administrador.',
  })
  findAll() {
    return this.usersService.findAll();
  }

  // ==========================================
  // CAMBIAR ROL
  // ADMIN
  // ==========================================

  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(Role.ADMIN)
  @Patch(':id/role')
  @ApiOperation({
    summary: 'Cambiar rol de usuario',
    description:
      'Actualiza el rol de un usuario e invalida sus tokens anteriores.',
  })
  @ApiParam({
    name: 'id',
    example: 2,
    description:
      'ID del usuario cuyo rol será modificado.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Rol actualizado correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'El rol enviado no es válido.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene permisos de administrador.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Usuario no encontrado.',
  })
  @ApiResponse({
    status: 409,
    description:
      'No se puede quitar el propio rol de administrador.',
  })
  updateRole(
    @Param(
      'id',
      PositiveIntPipe,
    )
    id: number,
    @Body()
    updateRoleDto: UpdateRoleDto,
    @Req() req: any,
  ) {
    return this.usersService.updateRole(
      id,
      updateRoleDto.role,
      req.user.id,
    );
  }

  // ==========================================
  // ACTIVAR / SUSPENDER USUARIO
  // ADMIN
  // ==========================================

  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(Role.ADMIN)
  @Patch(':id/status')
  @ApiOperation({
    summary: 'Activar o suspender usuario',
    description:
      'Cambia el estado de un usuario e invalida sus tokens anteriores.',
  })
  @ApiParam({
    name: 'id',
    example: 2,
    description:
      'ID del usuario cuyo estado será modificado.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Estado actualizado correctamente.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene permisos de administrador.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Usuario no encontrado.',
  })
  @ApiResponse({
    status: 409,
    description:
      'No se puede suspender al último administrador activo.',
  })
  updateStatus(
    @Param(
      'id',
      PositiveIntPipe,
    )
    id: number,
    @Body()
    updateStatusDto: UpdateStatusDto,
  ) {
    return this.usersService.updateStatus(
      id,
      updateStatusDto.isActive,
    );
  }

  // ==========================================
  // ELIMINAR USUARIO
  // ADMIN
  // ==========================================

  @UseGuards(
    JwtAuthGuard,
    RolesGuard,
  )
  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({
    summary: 'Eliminar usuario',
    description:
      'Elimina un usuario. No permite eliminar al propio usuario ni al último administrador.',
  })
  @ApiParam({
    name: 'id',
    example: 2,
    description:
      'ID del usuario que será eliminado.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Usuario eliminado correctamente.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Usuario no autenticado.',
  })
  @ApiResponse({
    status: 403,
    description:
      'El usuario no tiene permisos de administrador.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Usuario no encontrado.',
  })
  @ApiResponse({
    status: 409,
    description:
      'No se puede eliminar el propio usuario ni el último administrador.',
  })
  delete(
    @Param(
      'id',
      PositiveIntPipe,
    )
    id: number,
    @Req() req: any,
  ) {
    return this.usersService.delete(
      id,
      req.user.id,
    );
  }
}