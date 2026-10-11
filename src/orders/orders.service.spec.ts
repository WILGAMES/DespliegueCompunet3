import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { OrdersService } from './orders.service';
import { Order } from './entities/order.entity';
import {
  DeliveryAction,
  OrderStatus,
  PaymentResult,
} from './enums/order-status.enum';

import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { RealtimeService } from '../realtime/realtime.service';
import { Role } from '../users/enums/role.enum';

describe('OrdersService', () => {
  let service: OrdersService;

  const BUYER = { id: 20, role: Role.USER };
  const SELLER = { id: 10, role: Role.USER };
  const STRANGER = { id: 99, role: Role.USER };
  const ADMIN = { id: 1, role: Role.ADMIN };

  const insertBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    execute: jest.fn(),
  };

  const manager = {
    findOne: jest.fn(),
    findOneOrFail: jest.fn(),
    save: jest.fn(async (o: unknown) => o),
    createQueryBuilder: jest.fn(() => insertBuilder),
  };

  const dataSourceMock = {
    manager,
    transaction: jest.fn((cb: any) => cb(manager)),
  };

  const queryBuilderMock = {
    orderBy: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const realtimeMock = {
    publishOrder: jest.fn(),
  };

  const configMock = {
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  };

  const ordersRepositoryMock = {
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilderMock),
  };

  const makeOrder = (
    overrides: Partial<Order> = {},
  ): Order =>
    ({
      id: 1,
      auctionId: 5,
      buyerId: BUYER.id,
      sellerId: SELLER.id,
      amount: 1050000,
      status: OrderStatus.PENDING_PAYMENT,
      paymentAttempts: 0,
      paymentReference: null,
      paidAt: null,
      deliveredAt: null,
      closedAt: null,
      notes: null,
      ...overrides,
    }) as Order;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule =
      await Test.createTestingModule({
        providers: [
          OrdersService,
          {
            provide: getRepositoryToken(Order),
            useValue: ordersRepositoryMock,
          },
          { provide: DataSource, useValue: dataSourceMock },
          { provide: RealtimeService, useValue: realtimeMock },
          { provide: ConfigService, useValue: configMock },
        ],
      }).compile();

    service = module.get(OrdersService);
  });

  describe('createForAuction', () => {
    const auction = {
      id: 5,
      sellerId: SELLER.id,
      winnerId: BUYER.id,
      currentPrice: '1050000.00',
      status: AuctionStatus.FINISHED,
    };

    it('crea la orden con el ganador, vendedor y precio final', async () => {
      manager.findOne.mockResolvedValue(auction);
      insertBuilder.execute.mockResolvedValue({
        raw: [{ id: 1 }],
      });
      manager.findOneOrFail.mockResolvedValue(makeOrder());

      const result = await service.createForAuction(5);

      expect(insertBuilder.values).toHaveBeenCalledWith({
        auctionId: 5,
        buyerId: BUYER.id,
        sellerId: SELLER.id,
        amount: 1050000,
        status: OrderStatus.PENDING_PAYMENT,
        paymentDueAt: null,
      });
      expect(insertBuilder.orIgnore).toHaveBeenCalled();
      expect(result.created).toBe(true);
    });

    it('es idempotente: si ya existe devuelve la misma orden con created=false', async () => {
      manager.findOne.mockResolvedValue(auction);
      insertBuilder.execute.mockResolvedValue({ raw: [] });
      const existing = makeOrder({ id: 7 });
      manager.findOneOrFail.mockResolvedValue(existing);

      const result = await service.createForAuction(5);

      expect(result).toEqual({
        order: existing,
        created: false,
      });
    });

    it('usa el manager del llamador cuando se le pasa', async () => {
      const external = {
        findOne: jest.fn().mockResolvedValue(auction),
        findOneOrFail: jest
          .fn()
          .mockResolvedValue(makeOrder()),
        createQueryBuilder: jest.fn(() => insertBuilder),
      };
      insertBuilder.execute.mockResolvedValue({
        raw: [{ id: 1 }],
      });

      await service.createForAuction(5, external as any);

      expect(external.findOne).toHaveBeenCalled();
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('lanza 404 si la subasta no existe', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.createForAuction(5),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza 400 si la subasta no está finalizada', async () => {
      manager.findOne.mockResolvedValue({
        ...auction,
        status: AuctionStatus.ACTIVE,
      });

      await expect(
        service.createForAuction(5),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(insertBuilder.execute).not.toHaveBeenCalled();
    });

    it('lanza 400 si la subasta finalizada no tiene ganador', async () => {
      manager.findOne.mockResolvedValue({
        ...auction,
        winnerId: null,
      });

      await expect(
        service.createForAuction(5),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('filtra por comprador/vendedor para un usuario normal', async () => {
      await service.findAll(BUYER);

      expect(queryBuilderMock.where).toHaveBeenCalledWith(
        expect.stringContaining('buyerId'),
        { userId: BUYER.id },
      );
    });

    it('el admin ve todas las órdenes y puede filtrar por estado', async () => {
      await service.findAll(ADMIN, OrderStatus.PAID);

      expect(queryBuilderMock.where).not.toHaveBeenCalled();
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'o.status = :status',
        { status: OrderStatus.PAID },
      );
    });
  });

  describe('findOne', () => {
    it('devuelve la orden al comprador, al vendedor y al admin', async () => {
      ordersRepositoryMock.findOne.mockResolvedValue(
        makeOrder(),
      );

      for (const actor of [BUYER, SELLER, ADMIN]) {
        await expect(
          service.findOne(1, actor),
        ).resolves.toBeDefined();
      }
    });

    it('lanza 403 a un usuario ajeno', async () => {
      ordersRepositoryMock.findOne.mockResolvedValue(
        makeOrder(),
      );

      await expect(
        service.findOne(1, STRANGER),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lanza 404 si no existe', async () => {
      ordersRepositoryMock.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(1, BUYER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('pay', () => {
    it('pago aprobado: pasa a PAID con referencia y fecha', async () => {
      manager.findOne.mockResolvedValue(makeOrder());

      const result = await service.pay(
        1,
        { result: PaymentResult.APPROVED },
        BUYER,
      );

      expect(result.status).toBe(OrderStatus.PAID);
      expect(result.paymentAttempts).toBe(1);
      expect(result.paidAt).toBeInstanceOf(Date);
      expect(result.paymentReference).toMatch(/^SIM-/);
    });

    it('pago rechazado: pasa a PAYMENT_REJECTED y permite reintentar', async () => {
      manager.findOne.mockResolvedValue(makeOrder());

      const rejected = await service.pay(
        1,
        { result: PaymentResult.REJECTED },
        BUYER,
      );

      expect(rejected.status).toBe(
        OrderStatus.PAYMENT_REJECTED,
      );
      expect(rejected.paidAt).toBeNull();

      manager.findOne.mockResolvedValue(rejected);

      const retried = await service.pay(
        1,
        { result: PaymentResult.APPROVED },
        BUYER,
      );

      expect(retried.status).toBe(OrderStatus.PAID);
      expect(retried.paymentAttempts).toBe(2);
    });

    it('solo el comprador puede pagar (vendedor, ajeno y admin reciben 403)', async () => {
      for (const actor of [SELLER, STRANGER, ADMIN]) {
        manager.findOne.mockResolvedValue(makeOrder());

        await expect(
          service.pay(
            1,
            { result: PaymentResult.APPROVED },
            actor,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it.each([
      OrderStatus.PAID,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.DEFAULTED,
    ])('no permite pagar una orden en estado %s', async (status) => {
      manager.findOne.mockResolvedValue(makeOrder({ status }));

      await expect(
        service.pay(
          1,
          { result: PaymentResult.APPROVED },
          BUYER,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('bloquea la fila de la orden (pessimistic_write)', async () => {
      manager.findOne.mockResolvedValue(makeOrder());

      await service.pay(
        1,
        { result: PaymentResult.APPROVED },
        BUYER,
      );

      expect(manager.findOne).toHaveBeenCalledWith(
        Order,
        expect.objectContaining({
          lock: { mode: 'pessimistic_write' },
        }),
      );
    });

    it('lanza 404 si la orden no existe', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.pay(
          1,
          { result: PaymentResult.APPROVED },
          BUYER,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateDelivery', () => {
    it('el vendedor marca DELIVERED una orden PAID', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      const result = await service.updateDelivery(
        1,
        { status: DeliveryAction.DELIVERED, notes: 'ok' },
        SELLER,
      );

      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(result.deliveredAt).toBeInstanceOf(Date);
      expect(result.closedAt).toBeInstanceOf(Date);
      expect(result.notes).toBe('ok');
    });

    it('no se puede entregar sin pago aprobado', async () => {
      for (const status of [
        OrderStatus.PENDING_PAYMENT,
        OrderStatus.PAYMENT_REJECTED,
      ]) {
        manager.findOne.mockResolvedValue(
          makeOrder({ status }),
        );

        await expect(
          service.updateDelivery(
            1,
            { status: DeliveryAction.DELIVERED },
            SELLER,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('el comprador no puede marcar la entrega', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      await expect(
        service.updateDelivery(
          1,
          { status: DeliveryAction.DELIVERED },
          BUYER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un usuario ajeno recibe 403', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      await expect(
        service.updateDelivery(
          1,
          { status: DeliveryAction.CANCELLED },
          STRANGER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('comprador o vendedor pueden cancelar antes del pago', async () => {
      for (const actor of [BUYER, SELLER]) {
        manager.findOne.mockResolvedValue(makeOrder());

        const result = await service.updateDelivery(
          1,
          { status: DeliveryAction.CANCELLED },
          actor,
        );

        expect(result.status).toBe(OrderStatus.CANCELLED);
      }
    });

    it('el comprador no puede cancelar una orden ya pagada', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      await expect(
        service.updateDelivery(
          1,
          { status: DeliveryAction.CANCELLED },
          BUYER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('el vendedor reporta incumplimiento de pago; el comprador no puede', async () => {
      manager.findOne.mockResolvedValue(makeOrder());

      await expect(
        service.updateDelivery(
          1,
          { status: DeliveryAction.DEFAULTED },
          BUYER,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      manager.findOne.mockResolvedValue(makeOrder());

      const result = await service.updateDelivery(
        1,
        { status: DeliveryAction.DEFAULTED },
        SELLER,
      );

      expect(result.status).toBe(OrderStatus.DEFAULTED);
    });

    it('el comprador reporta que el vendedor no entregó una orden PAID', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      const result = await service.updateDelivery(
        1,
        { status: DeliveryAction.DEFAULTED },
        BUYER,
      );

      expect(result.status).toBe(OrderStatus.DEFAULTED);
    });

    it('el admin puede registrar cualquier transición válida', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      const result = await service.updateDelivery(
        1,
        { status: DeliveryAction.DELIVERED },
        ADMIN,
      );

      expect(result.status).toBe(OrderStatus.DELIVERED);
    });

    it.each([
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.DEFAULTED,
    ])('una orden en estado terminal %s no admite más cambios', async (status) => {
      for (const action of Object.values(DeliveryAction)) {
        manager.findOne.mockResolvedValue(
          makeOrder({ status }),
        );

        await expect(
          service.updateDelivery(
            1,
            { status: action },
            ADMIN,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      }
    });

    it('lanza 404 si la orden no existe', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(
        service.updateDelivery(
          1,
          { status: DeliveryAction.DELIVERED },
          SELLER,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('plazo de pago', () => {
    const auction = {
      id: 5,
      sellerId: SELLER.id,
      winnerId: BUYER.id,
      currentPrice: '1050000.00',
      status: AuctionStatus.FINISHED,
    };

    afterEach(() => {
      configMock.get.mockImplementation(
        (_key: string, fallback?: unknown) => fallback,
      );
    });

    it('con ORDER_PAYMENT_DEADLINE_HOURS define paymentDueAt', async () => {
      configMock.get.mockImplementation(
        (key: string, fallback?: unknown) =>
          key === 'ORDER_PAYMENT_DEADLINE_HOURS' ? 48 : fallback,
      );
      manager.findOne.mockResolvedValue(auction);
      insertBuilder.execute.mockResolvedValue({ raw: [{ id: 1 }] });
      manager.findOneOrFail.mockResolvedValue(makeOrder());

      const before = Date.now();
      await service.createForAuction(5);

      const { paymentDueAt } = insertBuilder.values.mock.calls[0][0];

      expect(paymentDueAt.getTime()).toBeGreaterThanOrEqual(
        before + 48 * 3_600_000,
      );
      expect(paymentDueAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 48 * 3_600_000,
      );
    });

    it('no permite pagar una orden con el plazo vencido', async () => {
      manager.findOne.mockResolvedValue(
        makeOrder({ paymentDueAt: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.pay(1, { result: PaymentResult.APPROVED }, BUYER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('expireOverdueOrders pasa a DEFAULTED las órdenes vencidas y publica', async () => {
      ordersRepositoryMock.find.mockResolvedValue([{ id: 1 }]);
      manager.findOne.mockResolvedValue(
        makeOrder({ paymentDueAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.expireOverdueOrders()).resolves.toBe(1);

      expect(manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.DEFAULTED,
          notes: 'Vencido el plazo de pago',
        }),
      );
      expect(realtimeMock.publishOrder).toHaveBeenCalledWith(
        'updated',
        expect.objectContaining({ status: OrderStatus.DEFAULTED }),
      );
    });

    it('expireOverdueOrders respeta una orden pagada por otro proceso', async () => {
      ordersRepositoryMock.find.mockResolvedValue([{ id: 1 }]);
      manager.findOne.mockResolvedValue(
        makeOrder({
          status: OrderStatus.PAID,
          paymentDueAt: new Date(Date.now() - 1000),
        }),
      );

      await expect(service.expireOverdueOrders()).resolves.toBe(0);
      expect(manager.save).not.toHaveBeenCalled();
      expect(realtimeMock.publishOrder).not.toHaveBeenCalled();
    });
  });

  describe('eventos en tiempo real', () => {
    it('publica la orden actualizada tras pagar y tras registrar la entrega', async () => {
      manager.findOne.mockResolvedValue(makeOrder());

      await service.pay(1, { result: PaymentResult.APPROVED }, BUYER);

      expect(realtimeMock.publishOrder).toHaveBeenCalledWith(
        'updated',
        expect.objectContaining({ status: OrderStatus.PAID }),
      );

      realtimeMock.publishOrder.mockClear();
      manager.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.PAID }),
      );

      await service.updateDelivery(
        1,
        { status: DeliveryAction.DELIVERED },
        SELLER,
      );

      expect(realtimeMock.publishOrder).toHaveBeenCalledWith(
        'updated',
        expect.objectContaining({ status: OrderStatus.DELIVERED }),
      );
    });

    it('no publica si el pago se rechaza por permisos', async () => {
      manager.findOne.mockResolvedValue(makeOrder());

      await expect(
        service.pay(1, { result: PaymentResult.APPROVED }, SELLER),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(realtimeMock.publishOrder).not.toHaveBeenCalled();
    });

    it('createForAuction publica la orden creada solo cuando no recibe manager externo', async () => {
      const auction = {
        id: 5,
        sellerId: SELLER.id,
        winnerId: BUYER.id,
        currentPrice: '1050000.00',
        status: AuctionStatus.FINISHED,
      };

      manager.findOne.mockResolvedValue(auction);
      insertBuilder.execute.mockResolvedValue({ raw: [{ id: 1 }] });
      manager.findOneOrFail.mockResolvedValue(makeOrder());

      await service.createForAuction(5);

      expect(realtimeMock.publishOrder).toHaveBeenCalledWith(
        'created',
        expect.anything(),
      );

      realtimeMock.publishOrder.mockClear();

      await service.createForAuction(5, manager as any);

      expect(realtimeMock.publishOrder).not.toHaveBeenCalled();
    });
  });
});
