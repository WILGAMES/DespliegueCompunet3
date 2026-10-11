-- Ejecutar UNA vez en Supabase (SQL Editor) después de que TypeORM haya
-- creado las tablas.
--
-- Supabase expone el esquema "public" mediante una API REST accesible con
-- la llave pública (anon). Las tablas creadas por TypeORM no tienen RLS, así
-- que sin esto cualquiera con esa llave podría leer/escribir los datos
-- (incluidos los hashes de contraseña de "users").
-- Sin políticas, solo el rol "postgres" (el que usa el backend) accede.
ALTER TABLE users    ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders   ENABLE ROW LEVEL SECURITY;
