import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';

import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { Role } from './enums/role.enum';
import { UserNotFoundException } from '../common/exceptions';

describe('UsersService', () => {
  let service: UsersService;

  const repositoryMock = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    increment: jest.fn(),
    count: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          UsersService,
          {
            provide: getRepositoryToken(User),
            useValue: repositoryMock,
          },
        ],
      }).compile();

    service = module.get<UsersService>(
      UsersService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('debe crear un usuario con contraseña hasheada', async () => {
      const dto = {
        name: '  Felipe  ',
        email: '  FELIPE@TEST.COM  ',
        password: 'Password123',
      };

      repositoryMock.findOne.mockResolvedValue(
        null,
      );

      repositoryMock.create.mockImplementation(
        (user) => user,
      );

      repositoryMock.save.mockImplementation(
        async (user) => ({
          id: 1,
          ...user,
        }),
      );

      const result =
        await service.create(dto);

      expect(
        repositoryMock.findOne,
      ).toHaveBeenCalledWith({
        where: {
          email: 'felipe@test.com',
        },
      });

      expect(
        repositoryMock.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Felipe',
          email: 'felipe@test.com',
          role: Role.USER,
          isActive: true,
          tokenVersion: 0,
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 1,
          name: 'Felipe',
          email: 'felipe@test.com',
          role: Role.USER,
          isActive: true,
          tokenVersion: 0,
        }),
      );

      expect(result).not.toHaveProperty(
        'password',
      );

      expect(
        repositoryMock.create.mock
          .calls[0][0].password,
      ).not.toBe('Password123');
    });

    it('debe rechazar un correo duplicado', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        email: 'felipe@test.com',
      });

      await expect(
        service.create({
          name: 'Felipe',
          email: 'felipe@test.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(
        ConflictException,
      );

      expect(
        repositoryMock.create,
      ).not.toHaveBeenCalled();

      expect(
        repositoryMock.save,
      ).not.toHaveBeenCalled();
    });

    it('debe rechazar un nombre demasiado corto', async () => {
      await expect(
        service.create({
          name: 'F',
          email: 'felipe@test.com',
          password: 'Password123',
        }),
      ).rejects.toThrow(
        BadRequestException,
      );

      expect(
        repositoryMock.findOne,
      ).not.toHaveBeenCalled();
    });

    it('debe normalizar el correo antes de buscarlo', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        email: 'felipe@test.com',
      });

      await expect(
        service.create({
          name: 'Felipe',
          email: '  FELIPE@TEST.COM  ',
          password: 'Password123',
        }),
      ).rejects.toThrow(
        ConflictException,
      );

      expect(
        repositoryMock.findOne,
      ).toHaveBeenCalledWith({
        where: {
          email: 'felipe@test.com',
        },
      });
    });
  });

  describe('findByEmail', () => {
    it('debe buscar el correo normalizado', async () => {
      const user = {
        id: 1,
        email: 'felipe@test.com',
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      const result =
        await service.findByEmail(
          '  FELIPE@TEST.COM  ',
        );

      expect(
        repositoryMock.findOne,
      ).toHaveBeenCalledWith({
        where: {
          email: 'felipe@test.com',
        },
      });

      expect(result).toEqual(user);
    });

    it('debe devolver null si el usuario no existe', async () => {
      repositoryMock.findOne.mockResolvedValue(
        null,
      );

      const result =
        await service.findByEmail(
          'noexiste@test.com',
        );

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('debe lanzar error si el usuario no existe', async () => {
      repositoryMock.findOne.mockResolvedValue(
        null,
      );

      await expect(
        service.findById(999),
      ).rejects.toThrow(
        NotFoundException,
      );
    });

    it('debe devolver el usuario sin contraseña', async () => {
      repositoryMock.findOne.mockResolvedValue({
        id: 1,
        name: 'Felipe',
        email: 'felipe@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
      });

      const result =
        await service.findById(1);

      expect(result).toEqual({
        id: 1,
        name: 'Felipe',
        email: 'felipe@test.com',
        role: Role.USER,
        isActive: true,
      });

      expect(result).not.toHaveProperty(
        'password',
      );
    });
  });

  describe('findByIdWithPassword', () => {
    it('debe devolver el usuario con contraseña para uso interno', async () => {
      const user = {
        id: 1,
        name: 'Felipe',
        email: 'felipe@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      const result =
        await service.findByIdWithPassword(
          1,
        );

      expect(result).toEqual(user);
      expect(result.password).toBe(
        'hash',
      );
    });

    it('debe lanzar error si el usuario no existe', async () => {
      repositoryMock.findOne.mockResolvedValue(
        null,
      );

      await expect(
        service.findByIdWithPassword(999),
      ).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('debe devolver usuarios sin contraseña', async () => {
      const users = [
        {
          id: 1,
          name: 'Felipe',
          email: 'felipe@test.com',
          password: 'hash1',
          role: Role.USER,
          isActive: true,
        },
        {
          id: 2,
          name: 'Admin',
          email: 'admin@test.com',
          password: 'hash2',
          role: Role.ADMIN,
          isActive: true,
        },
      ];

      repositoryMock.find.mockResolvedValue(
        users,
      );

      const result =
        await service.findAll();

      expect(
        repositoryMock.find,
      ).toHaveBeenCalledWith({
        order: {
          id: 'ASC',
        },
      });

      expect(result).toEqual([
        {
          id: 1,
          name: 'Felipe',
          email: 'felipe@test.com',
          role: Role.USER,
          isActive: true,
        },
        {
          id: 2,
          name: 'Admin',
          email: 'admin@test.com',
          role: Role.ADMIN,
          isActive: true,
        },
      ]);

      expect(
        result[0],
      ).not.toHaveProperty(
        'password',
      );

      expect(
        result[1],
      ).not.toHaveProperty(
        'password',
      );
    });
  });

  describe('updateTokenVersion', () => {
    it('debe incrementar la versión del token', async () => {
      repositoryMock.increment.mockResolvedValue(
        undefined,
      );

      await service.updateTokenVersion(1);

      expect(
        repositoryMock.increment,
      ).toHaveBeenCalledWith(
        { id: 1 },
        'tokenVersion',
        1,
      );
    });
  });

  describe('updateRole', () => {
    it('debe impedir que un administrador se quite sus propios permisos', async () => {
      await expect(
        service.updateRole(
          1,
          Role.USER,
          1,
        ),
      ).rejects.toThrow(
        ConflictException,
      );

      expect(
        repositoryMock.findOne,
      ).not.toHaveBeenCalled();
    });

    it('debe rechazar un rol inválido', async () => {
      await expect(
        service.updateRole(
          2,
          'SUPERADMIN' as Role,
          1,
        ),
      ).rejects.toThrow(
        BadRequestException,
      );

      expect(
        repositoryMock.findOne,
      ).not.toHaveBeenCalled();
    });

    it('debe actualizar el rol y aumentar tokenVersion', async () => {
      const user = {
        id: 2,
        name: 'Usuario',
        email: 'user@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
        tokenVersion: 0,
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      repositoryMock.save.mockImplementation(
        async (value) => value,
      );

      const result =
        await service.updateRole(
          2,
          Role.ADMIN,
          1,
        );

      expect(user.role).toBe(
        Role.ADMIN,
      );

      expect(
        user.tokenVersion,
      ).toBe(1);

      expect(
        repositoryMock.save,
      ).toHaveBeenCalledWith(user);

      expect(result).not.toHaveProperty(
        'password',
      );
    });

    it('no debe guardar si el usuario ya tiene ese rol', async () => {
      const user = {
        id: 2,
        name: 'Usuario',
        email: 'user@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
        tokenVersion: 3,
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      const result =
        await service.updateRole(
          2,
          Role.USER,
          1,
        );

      expect(
        repositoryMock.save,
      ).not.toHaveBeenCalled();

      expect(
        user.tokenVersion,
      ).toBe(3);

      expect(result).not.toHaveProperty(
        'password',
      );
    });
  });

  describe('updateStatus', () => {
    it('debe impedir suspender al último administrador activo', async () => {
      const admin = {
        id: 1,
        name: 'Admin',
        email: 'admin@test.com',
        password: 'hash',
        role: Role.ADMIN,
        isActive: true,
        tokenVersion: 0,
      };

      repositoryMock.findOne.mockResolvedValue(
        admin,
      );

      repositoryMock.count.mockResolvedValue(
        1,
      );

      await expect(
        service.updateStatus(
          1,
          false,
        ),
      ).rejects.toThrow(
        ConflictException,
      );

      expect(
        repositoryMock.save,
      ).not.toHaveBeenCalled();
    });

    it('debe permitir suspender un administrador cuando existe otro administrador activo', async () => {
      const admin = {
        id: 1,
        name: 'Admin',
        email: 'admin@test.com',
        password: 'hash',
        role: Role.ADMIN,
        isActive: true,
        tokenVersion: 0,
      };

      repositoryMock.findOne.mockResolvedValue(
        admin,
      );

      repositoryMock.count.mockResolvedValue(
        2,
      );

      repositoryMock.save.mockImplementation(
        async (value) => value,
      );

      const result =
        await service.updateStatus(
          1,
          false,
        );

      expect(
        admin.isActive,
      ).toBe(false);

      expect(
        admin.tokenVersion,
      ).toBe(1);

      expect(
        repositoryMock.save,
      ).toHaveBeenCalledWith(admin);

      expect(result).not.toHaveProperty(
        'password',
      );
    });

    it('no debe guardar si el estado ya es el mismo', async () => {
      const user = {
        id: 2,
        name: 'Usuario',
        email: 'user@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
        tokenVersion: 3,
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      const result =
        await service.updateStatus(
          2,
          true,
        );

      expect(
        repositoryMock.save,
      ).not.toHaveBeenCalled();

      expect(
        user.tokenVersion,
      ).toBe(3);

      expect(result).not.toHaveProperty(
        'password',
      );
    });

    it('debe suspender un usuario normal e incrementar tokenVersion', async () => {
      const user = {
        id: 2,
        name: 'Usuario',
        email: 'user@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
        tokenVersion: 1,
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      repositoryMock.save.mockImplementation(
        async (value) => value,
      );

      const result =
        await service.updateStatus(
          2,
          false,
        );

      expect(
        user.isActive,
      ).toBe(false);

      expect(
        user.tokenVersion,
      ).toBe(2);

      expect(result).not.toHaveProperty(
        'password',
      );
    });
  });

  describe('delete', () => {
    it('debe impedir que un usuario se elimine a sí mismo', async () => {
      await expect(
        service.delete(1, 1),
      ).rejects.toThrow(
        ConflictException,
      );

      expect(
        repositoryMock.findOne,
      ).not.toHaveBeenCalled();
    });

    it('debe impedir eliminar al último administrador', async () => {
      const admin = {
        id: 2,
        name: 'Admin',
        email: 'admin@test.com',
        password: 'hash',
        role: Role.ADMIN,
        isActive: true,
        tokenVersion: 0,
      };

      repositoryMock.findOne.mockResolvedValue(
        admin,
      );

      repositoryMock.count.mockResolvedValue(
        1,
      );

      await expect(
        service.delete(2, 1),
      ).rejects.toThrow(
        ConflictException,
      );

      expect(
        repositoryMock.remove,
      ).not.toHaveBeenCalled();
    });

    it('debe eliminar otro usuario', async () => {
      const user = {
        id: 2,
        name: 'Usuario',
        email: 'user@test.com',
        password: 'hash',
        role: Role.USER,
        isActive: true,
      };

      repositoryMock.findOne.mockResolvedValue(
        user,
      );

      repositoryMock.remove.mockResolvedValue(
        user,
      );

      await service.delete(2, 1);

      expect(
        repositoryMock.remove,
      ).toHaveBeenCalledWith(user);
    });

    it('debe permitir eliminar un administrador cuando existe otro administrador', async () => {
      const admin = {
        id: 2,
        name: 'Admin',
        email: 'admin2@test.com',
        password: 'hash',
        role: Role.ADMIN,
        isActive: true,
        tokenVersion: 0,
      };

      repositoryMock.findOne.mockResolvedValue(
        admin,
      );

      repositoryMock.count.mockResolvedValue(
        2,
      );

      repositoryMock.remove.mockResolvedValue(
        admin,
      );

      await service.delete(2, 1);

      expect(
        repositoryMock.count,
      ).toHaveBeenCalledWith({
        where: {
          role: Role.ADMIN,
        },
      });

      expect(
        repositoryMock.remove,
      ).toHaveBeenCalledWith(admin);
    });
  });

  describe('updateProfile', () => {
    const buildUser = async () => ({
      id: 5,
      name: 'Felipe',
      email: 'felipe@test.com',
      password: await bcrypt.hash('Password123', 4),
      role: Role.USER,
      isActive: true,
      tokenVersion: 0,
    });

    beforeEach(() => {
      repositoryMock.save.mockImplementation(
        async (user) => user,
      );
    });

    it('debe actualizar el nombre (sin espacios sobrantes) y no devolver la contraseña', async () => {
      repositoryMock.findOne.mockResolvedValue(
        await buildUser(),
      );

      const result = await service.updateProfile(5, {
        name: '  Felipe Murillo  ',
      });

      expect(result.name).toBe('Felipe Murillo');
      expect(result).not.toHaveProperty('password');
      expect(result.tokenVersion).toBe(0);
    });

    it('debe rechazar una petición sin datos para actualizar', async () => {
      await expect(
        service.updateProfile(5, {}),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.findOne).not.toHaveBeenCalled();
      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('debe rechazar un nombre demasiado corto tras quitar espacios', async () => {
      await expect(
        service.updateProfile(5, { name: '  a ' }),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('debe cambiar la contraseña con la contraseña actual correcta e invalidar los tokens', async () => {
      const user = await buildUser();
      repositoryMock.findOne.mockResolvedValue(user);

      await service.updateProfile(5, {
        currentPassword: 'Password123',
        newPassword: 'NuevaPassword456',
      });

      const saved =
        repositoryMock.save.mock.calls[0][0];

      expect(
        await bcrypt.compare(
          'NuevaPassword456',
          saved.password,
        ),
      ).toBe(true);
      expect(saved.password).not.toBe(
        'NuevaPassword456',
      );
      expect(saved.tokenVersion).toBe(1);
    });

    it('debe rechazar el cambio si la contraseña actual es incorrecta', async () => {
      repositoryMock.findOne.mockResolvedValue(
        await buildUser(),
      );

      await expect(
        service.updateProfile(5, {
          currentPassword: 'Incorrecta123',
          newPassword: 'NuevaPassword456',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('debe rechazar una nueva contraseña igual a la actual', async () => {
      repositoryMock.findOne.mockResolvedValue(
        await buildUser(),
      );

      await expect(
        service.updateProfile(5, {
          currentPassword: 'Password123',
          newPassword: 'Password123',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(repositoryMock.save).not.toHaveBeenCalled();
    });

    it('debe lanzar UserNotFoundException si el usuario no existe', async () => {
      repositoryMock.findOne.mockResolvedValue(null);

      await expect(
        service.updateProfile(999, { name: 'Felipe' }),
      ).rejects.toThrow(UserNotFoundException);
    });
  });
});
