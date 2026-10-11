import { Test, TestingModule } from '@nestjs/testing';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles/roles.guard';

describe('UsersController', () => {
  let controller: UsersController;

  const usersServiceMock = {
    findById: jest.fn(),
    findAll: jest.fn(),
    updateProfile: jest.fn(),
    updateRole: jest.fn(),
    updateStatus: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule =
      await Test.createTestingModule({
        controllers: [UsersController],
        providers: [
          {
            provide: UsersService,
            useValue: usersServiceMock,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: jest.fn(() => true),
        })
        .overrideGuard(RolesGuard)
        .useValue({
          canActivate: jest.fn(() => true),
        })
        .compile();

    controller =
      module.get<UsersController>(
        UsersController,
      );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('updateMe debe actualizar el perfil del usuario autenticado', async () => {
    const updated = { id: 5, name: 'Felipe Murillo' };
    usersServiceMock.updateProfile.mockResolvedValue(
      updated,
    );

    const result = await controller.updateMe(
      { user: { id: 5 } },
      { name: 'Felipe Murillo' },
    );

    expect(
      usersServiceMock.updateProfile,
    ).toHaveBeenCalledWith(5, {
      name: 'Felipe Murillo',
    });
    expect(result).toEqual(updated);
  });
});