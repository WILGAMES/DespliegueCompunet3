import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RolesGuard } from './roles.guard';
import { Role } from '../../../users/enums/role.enum';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as Reflector;

    guard = new RolesGuard(reflector);
  });

  const createContext = (user?: any) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue({
          user,
        }),
      }),
    }) as unknown as ExecutionContext;

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('debe permitir acceso si no se requieren roles', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(undefined);

    const context = createContext();

    expect(
      guard.canActivate(context),
    ).toBe(true);
  });

  it('debe rechazar si no existe usuario autenticado', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([
        Role.ADMIN,
      ]);

    const context = createContext();

    expect(() =>
      guard.canActivate(context),
    ).toThrow(ForbiddenException);
  });

  it('debe permitir a un administrador', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([
        Role.ADMIN,
      ]);

    const context = createContext({
      id: 1,
      role: Role.ADMIN,
    });

    expect(
      guard.canActivate(context),
    ).toBe(true);
  });

  it('debe rechazar a un usuario sin el rol requerido', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([
        Role.ADMIN,
      ]);

    const context = createContext({
      id: 2,
      role: Role.USER,
    });

    expect(() =>
      guard.canActivate(context),
    ).toThrow(ForbiddenException);
  });
});