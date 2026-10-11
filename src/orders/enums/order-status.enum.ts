export enum OrderStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  PAYMENT_REJECTED = 'PAYMENT_REJECTED',
  PAID = 'PAID',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  DEFAULTED = 'DEFAULTED',
}

export enum PaymentResult {
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/** Estados que el comprador/vendedor puede registrar en el proceso de entrega. */
export enum DeliveryAction {
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  DEFAULTED = 'DEFAULTED',
}
