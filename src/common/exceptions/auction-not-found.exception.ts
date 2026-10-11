import { NotFoundException } from '@nestjs/common';

export class AuctionNotFoundException extends NotFoundException {
  constructor(id: number, internalCode?: string) {
    super({
      error: 'Auction Not Found',
      message: 'Subasta no encontrada',
      code: internalCode,
      id,
    });
  }
}
