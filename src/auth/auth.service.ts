import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { Role } from '../users/enums/role.enum';
import { LoginDto } from './dto/login.dto';

interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
  tokenVersion: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(
    createUserDto: CreateUserDto,
  ) {
    return this.usersService.create(
      createUserDto,
    );
  }

  async login(
    loginDto: LoginDto,
  ) {
    const user =
      await this.usersService.findByEmail(
        loginDto.email,
      );

    if (!user) {
      throw new UnauthorizedException(
        'Credenciales incorrectas',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'El usuario está suspendido',
      );
    }

    const passwordValid =
      await bcrypt.compare(
        loginDto.password,
        user.password,
      );

    if (!passwordValid) {
      throw new UnauthorizedException(
        'Credenciales incorrectas',
      );
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion:
        user.tokenVersion,
    };

    const accessToken =
      await this.jwtService.signAsync(
        payload,
      );

    return {
      access_token: accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async logout(
    userId: number,
  ) {
    await this.usersService.updateTokenVersion(
      userId,
    );

    return {
      message:
        'Sesión cerrada correctamente',
    };
  }
}