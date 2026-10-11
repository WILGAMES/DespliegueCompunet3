import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';

/**
 * Límite más estricto para registro y login (fuerza bruta).
 * AUTH_THROTTLE_LIMIT peticiones por minuto y por IP (30 por defecto).
 */
const AUTH_THROTTLE = {
  default: {
    limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 30),
    ttl: 60_000,
  },
};

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Registrar usuario',
  })
  @ApiResponse({
    status: 201,
    description:
      'Usuario registrado correctamente.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos de registro inválidos.',
  })
  @ApiResponse({
    status: 409,
    description:
      'El correo ya está registrado.',
  })
  register(
    @Body()
    createUserDto: CreateUserDto,
  ) {
    return this.authService.register(
      createUserDto,
    );
  }

  @Post('login')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary: 'Iniciar sesión',
  })
  @ApiResponse({
    status: 201,
    description:
      'Inicio de sesión correcto. Devuelve un JWT.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Credenciales incorrectas o usuario suspendido.',
  })
  login(
    @Body() loginDto: LoginDto,
  ) {
    return this.authService.login(
      loginDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @Post('logout')
  @ApiOperation({
    summary: 'Cerrar sesión',
    description:
      'Invalida los tokens emitidos anteriormente para el usuario.',
  })
  @ApiResponse({
    status: 201,
    description:
      'Sesión cerrada correctamente.',
  })
  @ApiResponse({
    status: 401,
    description:
      'Token ausente, inválido o expirado.',
  })
  logout(@Req() req: any) {
    return this.authService.logout(
      req.user.id,
    );
  }
}