import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { Role } from '../users/enums/role.enum';

describe('AuthService', () => {
  let service: AuthService;

  const usersServiceMock = {
    findByEmail: jest.fn(),
    updateTokenVersion: jest.fn(),
  };

  const jwtServiceMock = {
    signAsync: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          AuthService,
          {
            provide: UsersService,
            useValue: usersServiceMock,
          },
          {
            provide: JwtService,
            useValue: jwtServiceMock,
          },
        ],
      }).compile();

    service = module.get<AuthService>(
      AuthService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('login', () => {
    it('debe rechazar un usuario inexistente', async () => {
      usersServiceMock.findByEmail.mockResolvedValue(
        null,
      );

      await expect(
        service.login({
          email: 'noexiste@test.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('debe rechazar un usuario suspendido', async () => {
      usersServiceMock.findByEmail.mockResolvedValue({
        id: 1,
        email: 'user@test.com',
        password: '$2b$10$hash',
        isActive: false,
        role: Role.USER,
        tokenVersion: 0,
      });

      await expect(
        service.login({
          email: 'user@test.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('debe incrementar la versión del token', async () => {
      usersServiceMock.updateTokenVersion.mockResolvedValue(
        undefined,
      );

      const result =
        await service.logout(1);

      expect(
        usersServiceMock.updateTokenVersion,
      ).toHaveBeenCalledWith(1);

      expect(result).toEqual({
        message:
          'Sesión cerrada correctamente',
      });
    });
  });
});