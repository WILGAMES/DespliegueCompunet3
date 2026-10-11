import { AuctionStatus } from '../auctions/enums/auction-status.enum';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { OrderStatus } from '../orders/enums/order-status.enum';

/**
 * Datos de demostración. Se describen de forma declarativa y el
 * SeedService los inserta respetando las relaciones (usuarios ->
 * publicaciones -> subastas -> ofertas -> órdenes).
 *
 * Los tiempos son relativos al momento de ejecutar el seed
 * (horas, positivas = futuro, negativas = pasado).
 */

export type DemoUserKey =
  | 'laura'
  | 'carlos'
  | 'ana'
  | 'juan'
  | 'sofia'
  | 'inactivo';

export const DEMO_USERS: {
  key: DemoUserKey;
  name: string;
  email: string;
  isActive: boolean;
}[] = [
  { key: 'laura', name: 'Laura Gómez', email: 'laura.gomez@colsubastas.com', isActive: true },
  { key: 'carlos', name: 'Carlos Ramírez', email: 'carlos.ramirez@colsubastas.com', isActive: true },
  { key: 'ana', name: 'Ana Torres', email: 'ana.torres@colsubastas.com', isActive: true },
  { key: 'juan', name: 'Juan Pérez', email: 'juan.perez@colsubastas.com', isActive: true },
  { key: 'sofia', name: 'Sofía Castro', email: 'sofia.castro@colsubastas.com', isActive: true },
  { key: 'inactivo', name: 'Usuario Inactivo', email: 'inactivo@colsubastas.com', isActive: false },
];

export interface DemoOrder {
  status: OrderStatus;
  paymentAttempts: number;
  notes?: string;
}

export interface DemoAuction {
  status: AuctionStatus;
  startsInHours: number;
  endsInHours: number;
  /** Ofertas en orden: [postor, monto] */
  bids: [DemoUserKey, number][];
  order?: DemoOrder;
}

export interface DemoListing {
  seller: DemoUserKey;
  title: string;
  description: string;
  category: string;
  initialPrice: number;
  minimumIncrement: number;
  durationHours: number;
  status: ListingStatus;
  ai: {
    decision: 'APPROVE' | 'REJECT' | 'REVIEW';
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    reason: string;
    confidence: number;
  };
  /** Decisión administrativa (publicaciones aprobadas/rechazadas a mano) */
  review?: { reason: string };
  auction?: DemoAuction;
}

const aiOk = {
  decision: 'APPROVE' as const,
  risk: 'LOW' as const,
  reason: 'No se identificaron riesgos relevantes.',
  confidence: 0.95,
};

export const DEMO_LISTINGS: DemoListing[] = [
  {
    seller: 'laura',
    title: 'iPhone 14 Pro 128GB',
    description:
      'iPhone 14 Pro de 128GB en color morado, batería al 91%, con caja y cargador originales. Sin rayones.',
    category: 'Tecnología',
    initialPrice: 3200000,
    minimumIncrement: 100000,
    durationHours: 12,
    status: ListingStatus.ACTIVE,
    ai: aiOk,
    auction: {
      status: AuctionStatus.ACTIVE,
      startsInHours: -2,
      endsInHours: 6,
      bids: [
        ['ana', 3300000],
        ['juan', 3400000],
      ],
    },
  },
  {
    seller: 'laura',
    title: 'Bicicleta de ruta Trek Domane (termina en minutos)',
    description:
      'Bicicleta de ruta Trek Domane talla 54, grupo Shimano 105, ideal para largas distancias. Subasta a punto de cerrar: sirve para ver el cierre automático y la orden del ganador.',
    category: 'Deportes',
    initialPrice: 2500000,
    minimumIncrement: 50000,
    durationHours: 1,
    status: ListingStatus.ACTIVE,
    ai: aiOk,
    auction: {
      status: AuctionStatus.ACTIVE,
      startsInHours: -0.95,
      endsInHours: 0.05,
      bids: [
        ['ana', 2550000],
        ['sofia', 2650000],
      ],
    },
  },
  {
    seller: 'laura',
    title: 'Cámara Canon EOS R6',
    description:
      'Cámara mirrorless Canon EOS R6 con lente 24-105mm, 12.000 disparos, incluye dos baterías y morral.',
    category: 'Fotografía',
    initialPrice: 6800000,
    minimumIncrement: 200000,
    durationHours: 6,
    status: ListingStatus.SCHEDULED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.SCHEDULED,
      startsInHours: 2,
      endsInHours: 8,
      bids: [],
    },
  },
  {
    seller: 'laura',
    title: 'Guitarra eléctrica Fender Stratocaster',
    description:
      'Fender Stratocaster mexicana, cuerpo en alder, tres pastillas single coil, incluye estuche rígido.',
    category: 'Música',
    initialPrice: 3000000,
    minimumIncrement: 100000,
    durationHours: 24,
    status: ListingStatus.FINISHED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.FINISHED,
      startsInHours: -50,
      endsInHours: -26,
      bids: [
        ['ana', 3100000],
        ['juan', 3300000],
      ],
      order: { status: OrderStatus.PENDING_PAYMENT, paymentAttempts: 0 },
    },
  },
  {
    seller: 'laura',
    title: 'Reloj Casio vintage 1985',
    description:
      'Reloj Casio digital de 1985 en buen estado de funcionamiento, correa original, pieza de colección.',
    category: 'Relojes',
    initialPrice: 450000,
    minimumIncrement: 20000,
    durationHours: 8,
    status: ListingStatus.APPROVED,
    ai: {
      decision: 'REVIEW',
      risk: 'MEDIUM',
      reason: 'No se puede verificar la antigüedad del artículo.',
      confidence: 0.6,
    },
    review: { reason: 'Verificado por el administrador: pieza legítima.' },
  },
  {
    seller: 'carlos',
    title: 'MacBook Air M2 2022',
    description:
      'MacBook Air M2 de 13 pulgadas, 8GB de RAM y 256GB de SSD, color medianoche, ciclos de batería: 120.',
    category: 'Tecnología',
    initialPrice: 4500000,
    minimumIncrement: 100000,
    durationHours: 24,
    status: ListingStatus.FINISHED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.FINISHED,
      startsInHours: -76,
      endsInHours: -52,
      bids: [
        ['juan', 4600000],
        ['ana', 4700000],
      ],
      order: { status: OrderStatus.PAID, paymentAttempts: 1 },
    },
  },
  {
    seller: 'carlos',
    title: 'PlayStation 5 con 2 controles',
    description:
      'PlayStation 5 edición con lector de discos, dos controles DualSense y tres juegos físicos incluidos.',
    category: 'Videojuegos',
    initialPrice: 2100000,
    minimumIncrement: 50000,
    durationHours: 12,
    status: ListingStatus.FINISHED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.FINISHED,
      startsInHours: -100,
      endsInHours: -88,
      bids: [
        ['sofia', 2150000],
        ['ana', 2200000],
        ['sofia', 2250000],
      ],
      order: { status: OrderStatus.DELIVERED, paymentAttempts: 1, notes: 'Entregado en persona.' },
    },
  },
  {
    seller: 'carlos',
    title: 'Smart TV LG 55 pulgadas',
    description:
      'Smart TV LG UHD 4K de 55 pulgadas con control por voz, un año de uso, sin marcas en la pantalla.',
    category: 'Electrodomésticos',
    initialPrice: 1700000,
    minimumIncrement: 50000,
    durationHours: 10,
    status: ListingStatus.FINISHED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.FINISHED,
      startsInHours: -30,
      endsInHours: -20,
      bids: [['ana', 1800000]],
      order: { status: OrderStatus.PAYMENT_REJECTED, paymentAttempts: 1 },
    },
  },
  {
    seller: 'carlos',
    title: 'Tablet Samsung Galaxy Tab S8',
    description:
      'Tablet Samsung Galaxy Tab S8 de 128GB con lápiz S Pen y funda teclado, usada pocas veces.',
    category: 'Tecnología',
    initialPrice: 1900000,
    minimumIncrement: 50000,
    durationHours: 6,
    status: ListingStatus.FINISHED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.FINISHED,
      startsInHours: -40,
      endsInHours: -34,
      bids: [],
    },
  },
  {
    seller: 'carlos',
    title: 'Silla gamer ergonómica',
    description:
      'Silla gamer reclinable con soporte lumbar y reposabrazos 4D, color negro y rojo, poco uso.',
    category: 'Muebles',
    initialPrice: 800000,
    minimumIncrement: 30000,
    durationHours: 24,
    status: ListingStatus.ACTIVE,
    ai: aiOk,
    auction: {
      status: AuctionStatus.ACTIVE,
      startsInHours: -1,
      endsInHours: 22,
      bids: [],
    },
  },
  {
    seller: 'carlos',
    title: 'Drone DJI Mini 3',
    description:
      'Drone DJI Mini 3 con control remoto, tres baterías y bolso de transporte, menos de 10 horas de vuelo.',
    category: 'Tecnología',
    initialPrice: 2800000,
    minimumIncrement: 100000,
    durationHours: 12,
    status: ListingStatus.CANCELLED,
    ai: aiOk,
    auction: {
      status: AuctionStatus.CANCELLED,
      startsInHours: -5,
      endsInHours: 7,
      bids: [],
    },
  },
  {
    seller: 'carlos',
    title: 'Colección de monedas antiguas',
    description:
      'Lote de monedas antiguas de varios países, sin certificado de autenticidad ni detalle de cada pieza.',
    category: 'Coleccionables',
    initialPrice: 1200000,
    minimumIncrement: 50000,
    durationHours: 12,
    status: ListingStatus.PENDING_REVIEW,
    ai: {
      decision: 'REVIEW',
      risk: 'MEDIUM',
      reason:
        'Información insuficiente para verificar la autenticidad de las piezas.',
      confidence: 0.55,
    },
  },
  {
    seller: 'carlos',
    title: 'Rifle de aire comprimido',
    description:
      'Rifle de aire comprimido calibre 5.5 con mira telescópica, usado en prácticas de tiro deportivo.',
    category: 'Armas',
    initialPrice: 600000,
    minimumIncrement: 50000,
    durationHours: 6,
    status: ListingStatus.REJECTED,
    ai: {
      decision: 'REJECT',
      risk: 'HIGH',
      reason: 'Regla automática: la categoría "Armas" no está permitida.',
      confidence: 1,
    },
  },
];
