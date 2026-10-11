/** Eventos que el servidor emite a los clientes Socket.IO. */
export const ServerEvents = {
  /** Nueva puja aceptada. Sala: auction:{id} */
  BID_NEW: 'bid:new',
  /** Cambio de estado de una subasta. Salas: auction:{id} y auctions */
  AUCTION_STATUS: 'auction:status',
  /** Resultado del cierre para vendedor y ganador. Sala: user:{id} */
  AUCTION_RESULT: 'auction:result',
  /** Orden creada por el cierre. Salas: user:{comprador}, user:{vendedor}, admins */
  ORDER_CREATED: 'order:created',
  /** Orden actualizada (pago, entrega, vencimiento). Mismas salas */
  ORDER_UPDATED: 'order:updated',
  /** Error de autenticación en la conexión */
  AUTH_ERROR: 'auth:error',
} as const;

/** Mensajes que los clientes pueden enviar al servidor. */
export const ClientEvents = {
  AUCTION_JOIN: 'auction:join',
  AUCTION_LEAVE: 'auction:leave',
  AUCTIONS_WATCH: 'auctions:watch',
  AUCTIONS_UNWATCH: 'auctions:unwatch',
} as const;

export const Rooms = {
  auction: (id: number) => `auction:${id}`,
  user: (id: number) => `user:${id}`,
  /** Todas las novedades de subastas (listado). */
  AUCTIONS: 'auctions',
  ADMINS: 'admins',
} as const;
