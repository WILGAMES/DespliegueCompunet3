import { NotFoundException } from '@nestjs/common';

export class UserNotFoundException extends NotFoundException {
  constructor(id: number, internalCode?: string) {
    super({
      error: 'User Not Found',
      message: 'Usuario no encontrado',
      code: internalCode,
      id,
    });
  }
}
