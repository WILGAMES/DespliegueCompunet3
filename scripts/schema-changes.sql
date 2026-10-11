-- Cambios de esquema de la versión con tiempo real, moderación y plazo de pago.
--
-- Con DB_SYNCHRONIZE=true (desarrollo) TypeORM los aplica solo. Cuando el
-- despliegue use DB_SYNCHRONIZE=false (recomendado en producción, y es el valor
-- por defecto si NODE_ENV=production), ejecuta este script UNA vez en la base
-- de datos (en Supabase: SQL Editor). Es idempotente: se puede repetir.

-- Estado SUSPENDED de las publicaciones (suspensión por un administrador)
ALTER TYPE listings_status_enum ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- Cancelación de subastas por un administrador
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS "cancelReason" text;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS "cancelledById" integer;

-- Plazo de pago de las órdenes (null = sin vencimiento)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS "paymentDueAt" timestamptz;
