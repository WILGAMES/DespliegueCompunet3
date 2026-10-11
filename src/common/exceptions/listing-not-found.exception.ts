import { NotFoundException } from '@nestjs/common';

export class ListingNotFoundException extends NotFoundException {
  constructor(id: number, internalCode?: string) {
    super({
      error: 'Listing Not Found',
      message: 'Publicación no encontrada',
      code: internalCode,
      id,
    });
  }
}