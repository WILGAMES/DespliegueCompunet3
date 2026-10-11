import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from './enums/role.enum';
import { UserNotFoundException } from '../common/exceptions';
import { isForeignKeyViolation } from '../common/utils/db-errors';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  // ==========================================
  // CREAR USUARIO
  // ==========================================

  async create(
    createUserDto: CreateUserDto,
  ): Promise<User> {
    const name =
      createUserDto.name.trim();

    const email =
      createUserDto.email
        .trim()
        .toLowerCase();

    if (name.length < 2) {
      throw new BadRequestException(
        'El nombre debe tener al menos 2 caracteres',
      );
    }

    if (!email) {
      throw new BadRequestException(
        'El correo es obligatorio',
      );
    }

    const existingUser =
      await this.usersRepository.findOne({
        where: { email },
      });

    if (existingUser) {
      throw new ConflictException(
        'El correo ya está registrado',
      );
    }

    const hashedPassword =
      await bcrypt.hash(
        createUserDto.password,
        10,
      );

    const user =
      this.usersRepository.create({
        name,
        email,
        password: hashedPassword,
        role: Role.USER,
        isActive: true,
        tokenVersion: 0,
      });

    const savedUser =
      await this.usersRepository.save(user);

    return this.removePassword(
      savedUser,
    );
  }

  // ==========================================
  // BUSCAR POR EMAIL
  // ==========================================

  async findByEmail(
    email: string,
  ): Promise<User | null> {
    const normalizedEmail =
      email.trim().toLowerCase();

    return this.usersRepository.findOne({
      where: {
        email: normalizedEmail,
      },
    });
  }

  // ==========================================
  // BUSCAR POR ID
  // SIN PASSWORD
  // ==========================================

  async findById(
    id: number,
  ): Promise<User> {
    const user =
      await this.usersRepository.findOne({
        where: { id },
      });

    if (!user) {
      throw new UserNotFoundException(id);
    }

    return this.removePassword(
      user,
    );
  }

  // ==========================================
  // BUSCAR POR ID
  // USO INTERNO CON PASSWORD
  // ==========================================

  async findByIdWithPassword(
    id: number,
  ): Promise<User> {
    const user =
      await this.usersRepository.findOne({
        where: { id },
      });

    if (!user) {
      throw new UserNotFoundException(id);
    }

    return user;
  }

  // ==========================================
  // ACTUALIZAR MI PERFIL
  // ==========================================

  async updateProfile(
    id: number,
    updateUserDto: UpdateUserDto,
  ): Promise<User> {
    const name =
      updateUserDto.name?.trim();

    if (
      name === undefined &&
      updateUserDto.newPassword ===
        undefined
    ) {
      throw new BadRequestException(
        'Debes indicar al menos un dato para actualizar',
      );
    }

    if (
      name !== undefined &&
      name.length < 2
    ) {
      throw new BadRequestException(
        'El nombre debe tener al menos 2 caracteres',
      );
    }

    const user =
      await this.findByIdWithPassword(id);

    if (name !== undefined) {
      user.name = name;
    }

    if (
      updateUserDto.newPassword !==
      undefined
    ) {
      const currentPasswordValid =
        await bcrypt.compare(
          updateUserDto.currentPassword ??
            '',
          user.password,
        );

      if (!currentPasswordValid) {
        throw new BadRequestException(
          'La contraseña actual es incorrecta',
        );
      }

      const samePassword =
        await bcrypt.compare(
          updateUserDto.newPassword,
          user.password,
        );

      if (samePassword) {
        throw new BadRequestException(
          'La nueva contraseña debe ser distinta de la actual',
        );
      }

      user.password = await bcrypt.hash(
        updateUserDto.newPassword,
        10,
      );

      // Invalidar JWT existentes: hay que iniciar sesión de nuevo.
      user.tokenVersion += 1;
    }

    const updatedUser =
      await this.usersRepository.save(
        user,
      );

    return this.removePassword(
      updatedUser,
    );
  }

  // ==========================================
  // LISTAR TODOS LOS USUARIOS
  // ==========================================

  async findAll(): Promise<User[]> {
    const users =
      await this.usersRepository.find({
        order: {
          id: 'ASC',
        },
      });

    return users.map((user) =>
      this.removePassword(user),
    );
  }

  // ==========================================
  // INVALIDAR TOKENS
  // ==========================================

  async updateTokenVersion(
    id: number,
  ): Promise<void> {
    await this.usersRepository.increment(
      { id },
      'tokenVersion',
      1,
    );
  }

  // ==========================================
  // CAMBIAR ROL
  // ==========================================

  async updateRole(
    id: number,
    role: User['role'],
    requestingUserId: number,
  ): Promise<User> {
    if (
      !Object.values(Role).includes(
        role as Role,
      )
    ) {
      throw new BadRequestException(
        'El rol especificado no es válido',
      );
    }

    if (
      id === requestingUserId &&
      role !== Role.ADMIN
    ) {
      throw new ConflictException(
        'No puedes quitarte tus propios permisos de administrador',
      );
    }

    const user =
      await this.findByIdWithPassword(id);

    // No hacemos nada si el rol ya es el mismo.
    if (user.role === role) {
      return this.removePassword(
        user,
      );
    }

    user.role = role;

    // Invalidar JWT existentes.
    user.tokenVersion += 1;

    const updatedUser =
      await this.usersRepository.save(
        user,
      );

    return this.removePassword(
      updatedUser,
    );
  }

  // ==========================================
  // ACTIVAR / SUSPENDER USUARIO
  // ==========================================

  async updateStatus(
    id: number,
    isActive: boolean,
  ): Promise<User> {
    const user =
      await this.findByIdWithPassword(id);

    // Si el estado ya es el mismo,
    // no modificamos el usuario ni
    // invalidamos sus tokens.
    if (user.isActive === isActive) {
      return this.removePassword(
        user,
      );
    }

    // No permitir dejar el sistema
    // sin ningún administrador activo.
    if (
      user.role === Role.ADMIN &&
      !isActive
    ) {
      const activeAdmins =
        await this.usersRepository.count({
          where: {
            role: Role.ADMIN,
            isActive: true,
          },
        });

      if (activeAdmins <= 1) {
        throw new ConflictException(
          'No puedes suspender al último administrador activo',
        );
      }
    }

    user.isActive = isActive;

    // Invalidar JWT existentes.
    user.tokenVersion += 1;

    const updatedUser =
      await this.usersRepository.save(
        user,
      );

    return this.removePassword(
      updatedUser,
    );
  }

  // ==========================================
  // ELIMINAR USUARIO
  // ==========================================

  async delete(
    id: number,
    requestingUserId: number,
  ): Promise<void> {
    if (id === requestingUserId) {
      throw new ConflictException(
        'No puedes eliminar tu propio usuario',
      );
    }

    const user =
      await this.findByIdWithPassword(id);

    // Nunca permitir eliminar al último
    // administrador del sistema.
    if (user.role === Role.ADMIN) {
      const totalAdmins =
        await this.usersRepository.count({
          where: {
            role: Role.ADMIN,
          },
        });

      if (totalAdmins <= 1) {
        throw new ConflictException(
          'No puedes eliminar al último administrador del sistema',
        );
      }
    }

    try {
      await this.usersRepository.remove(user);
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'No se puede eliminar el usuario porque tiene publicaciones, subastas u ofertas asociadas. Puedes suspenderlo en su lugar.',
        );
      }

      throw error;
    }
  }

  // ==========================================
  // ELIMINAR PASSWORD DE LAS RESPUESTAS
  // ==========================================

  private removePassword(
    user: User,
  ): User {
    const {
      password,
      ...safeUser
    } = user;

    return safeUser as User;
  }
}