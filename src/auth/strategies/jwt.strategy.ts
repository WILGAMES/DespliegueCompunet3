import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PassportStrategy,
} from '@nestjs/passport';
import {
  ExtractJwt,
  Strategy,
} from 'passport-jwt';

import { UsersService } from '../../users/users.service';
import { Role } from '../../users/enums/role.enum';

interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(
  Strategy,
) {
  constructor(
    private readonly usersService: UsersService,
    configService: ConfigService,
  ) {
    const secret =
      configService.getOrThrow<string>(
        'JWT_SECRET',
      );

    if (!secret.trim()) {
      throw new Error(
        'JWT_SECRET no puede estar vacío',
      );
    }

    super({
      jwtFromRequest:
        ExtractJwt.fromAuthHeaderAsBearerToken(),

      ignoreExpiration: false,

      secretOrKey: secret,
    });
  }

  async validate(
    payload: JwtPayload,
  ) {
    if (
      !payload ||
      !Number.isInteger(payload.sub) ||
      !payload.email ||
      !Object.values(Role).includes(
        payload.role,
      ) ||
      !Number.isInteger(
        payload.tokenVersion,
      ) ||
      payload.tokenVersion < 0
    ) {
      throw new UnauthorizedException(
        'Token inválido',
      );
    }

    const user =
      await this.usersService.findByIdWithPassword(
        payload.sub,
      );

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Usuario suspendido',
      );
    }

    if (
      user.tokenVersion !==
      payload.tokenVersion
    ) {
      throw new UnauthorizedException(
        'Token invalidado',
      );
    }

    if (
      user.email !== payload.email
    ) {
      throw new UnauthorizedException(
        'Token inválido',
      );
    }

    if (
      user.role !== payload.role
    ) {
      throw new UnauthorizedException(
        'Token inválido',
      );
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }
}