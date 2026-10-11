# ColSubastas — Backend

[![CI](https://github.com/Computacion-3/colsubastas-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/Computacion-3/colsubastas-backend/actions/workflows/ci.yml)

API REST de una plataforma de subastas en línea. Proyecto del curso
**Computación en Internet III — Universidad Icesi** (Taller NestJS).

Flujo principal: registro → publicación → validación con IA → aprobación →
subasta → pujas → cierre automático con ganador → orden de pago simulada →
pago → entrega.

## Tecnologías

| Área | Herramienta |
|---|---|
| Framework | NestJS 12 + TypeScript |
| Base de datos | PostgreSQL (Supabase) |
| ORM | TypeORM |
| Autenticación | JWT + Passport |
| Autorización | Roles (`USER`, `ADMIN`) con guards |
| IA | Google Gemini (validación de publicaciones) |
| Documentación | Swagger / OpenAPI en `/docs` |
| Tiempo real | Socket.IO (`@nestjs/websockets`) |
| Seguridad | helmet, CORS configurable y rate limiting (`@nestjs/throttler`) |
| Pruebas | Jest (unitarias) y supertest (integración/e2e) |
| CI | GitHub Actions |

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `auth` | Registro, login y logout con JWT |
| `users` | Perfil, administración de usuarios, roles y suspensión |
| `listings` | Publicaciones, validación con IA, revisión y suspensión administrativa |
| `auctions` | Subastas, activación, cierre automático y cancelación (vendedor o administrador) |
| `bids` | Pujas transaccionales (sin condiciones de carrera) |
| `orders` | Orden de pago simulada, pago, entrega y vencimiento opcional |
| `realtime` | Gateway Socket.IO: eventos de pujas, subastas y órdenes |
| `seed` | Carga inicial de datos |

## Requisitos

- Node.js 24 (o 22 LTS) y npm
- Una base de datos PostgreSQL: Supabase (recomendado) o una local

## Instalación y ejecución

```bash
npm install
cp .env.example .env     # en PowerShell: Copy-Item .env.example .env
```

Completa el `.env` (ver la siguiente sección) y arranca:

```bash
npm run start:dev        # desarrollo con recarga
npm run build            # compilar
npm run start:prod       # producción (requiere build)
```

La API queda en `http://localhost:3000` y Swagger en
`http://localhost:3000/docs`.

### Variables de entorno

Obligatorias (la app no arranca si falta alguna):

| Variable | Descripción |
|---|---|
| `DB_HOST` | Host de PostgreSQL |
| `POSTGRES_USER` | Usuario |
| `POSTGRES_PASSWORD` | Contraseña |
| `POSTGRES_DB` | Nombre de la base de datos |
| `JWT_SECRET` | Secreto para firmar los JWT (no vacío) |

Opcionales:

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `POSTGRES_PORT` | `5432` | Puerto de PostgreSQL |
| `DB_SSL` | `true` | `false` para PostgreSQL local o de CI |
| `DB_SYNCHRONIZE` | `true` (`false` si `NODE_ENV=production`) | Crea/actualiza tablas. Poner `false` en el despliegue |
| `DB_POOL_MAX` | `10` | Conexiones máximas del pool |
| `GEMINI_API_KEY` | — | Sin clave, toda publicación queda en `REVIEW` |
| `GEMINI_MODEL` | ver `.env.example` | Modelo de Gemini |
| `GEMINI_TIMEOUT_MS` | `10000` | Timeout de la llamada a Gemini |
| `AUCTION_SWEEP_INTERVAL_MS` | `5000` | Periodo del cierre/activación de subastas. `0` lo desactiva |
| `ORDER_PAYMENT_DEADLINE_HOURS` | `0` | Horas para pagar una orden; al vencer pasa a `DEFAULTED`. `0` = sin vencimiento |
| `ORDER_SWEEP_INTERVAL_MS` | `60000` | Periodo de la revisión de órdenes vencidas |
| `CORS_ORIGINS` | cualquiera (desarrollo) / ninguno (producción) | Orígenes permitidos, separados por comas, o `*` |
| `TRUST_PROXY` | — | Nº de proxies de confianza (`1` detrás de un balanceador) para obtener la IP real |
| `THROTTLE_LIMIT` / `THROTTLE_TTL_MS` | `300` / `60000` | Peticiones máximas por IP y ventana |
| `AUTH_THROTTLE_LIMIT` | `30` | Peticiones por minuto y por IP a `/auth/login` y `/auth/register` |
| `SWAGGER_ENABLED` | `true` | `false` oculta `/docs` |
| `SWAGGER_USER` / `SWAGGER_PASSWORD` | — | Si se definen, `/docs` exige autenticación básica |
| `SEED_ADMIN_*` | ver abajo | Administrador inicial |
| `SEED_DEMO_DATA` | `true` | Carga datos de demostración |
| `SEED_DEMO_PASSWORD` | `Demo12345` | Contraseña de los usuarios demo |
| `TZ` | `UTC` | La app fuerza UTC; defínela también en el despliegue |

### Conexión a Supabase

En el dashboard: **Connect → Session pooler** (no uses la conexión directa:
es solo IPv6). El usuario del pooler es `postgres.<ref-del-proyecto>`.

```env
DB_HOST=aws-0-<region>.pooler.supabase.com
POSTGRES_PORT=5432
POSTGRES_USER=postgres.<ref-del-proyecto>
POSTGRES_PASSWORD=<tu-contraseña>
POSTGRES_DB=postgres
```

La primera vez, con `DB_SYNCHRONIZE=true`, TypeORM crea las tablas. Después
puedes ejecutar `scripts/supabase-rls.sql` una vez en el SQL Editor de
Supabase para activar RLS (evita acceso por la API pública de Supabase).

### PostgreSQL local con Docker (alternativa)

```bash
docker compose up -d db
```

Define antes `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB` en el `.env`
(Postgres no arranca con la contraseña vacía), usa `DB_HOST=localhost` y
`DB_SSL=false`. El puerto publicado es `POSTGRES_PORT` (5433 si no se define).

## Datos iniciales (seed)

Se ejecuta automáticamente al arrancar la aplicación y es idempotente:

1. **Administrador**: `SEED_ADMIN_EMAIL` (por defecto
   `admin@colsubastas.com`) con la contraseña `SEED_ADMIN_PASSWORD`
   (por defecto `Admin12345`).
2. **Datos de demostración** (si `SEED_DEMO_DATA` no es `false`): usuarios,
   publicaciones, subastas, ofertas y órdenes en distintos estados.

Usuarios demo (contraseña `Demo12345`, o `SEED_DEMO_PASSWORD`):

| Correo | Nota |
|---|---|
| `laura.gomez@colsubastas.com` | usuario |
| `carlos.ramirez@colsubastas.com` | usuario |
| `ana.torres@colsubastas.com` | usuario |
| `juan.perez@colsubastas.com` | usuario |
| `sofia.castro@colsubastas.com` | usuario |
| `inactivo@colsubastas.com` | suspendido (no puede iniciar sesión) |

Para no cargar datos de ejemplo (por ejemplo en producción real), usa
`SEED_DEMO_DATA=false`.

## Probar la API

### Swagger
Abre `http://localhost:3000/docs`, ejecuta `POST /auth/login`, copia el
`access_token` y pulsa **Authorize** (esquema `JWT-auth`).

### Postman
Importa [`pruebas-postman.json`](pruebas-postman.json). La colección trae las
variables `baseUrl`, `adminEmail`, `adminPassword`, `demoPassword`, etc.
Ejecútala con **Run collection** de arriba abajo; las peticiones guardan
los tokens e ids que necesitan las siguientes.

### Flujo manual sugerido
1. `POST /auth/login` con un usuario demo (o `POST /auth/register`).
2. `POST /listings` — crea una publicación. La IA la aprueba, rechaza o la
   envía a revisión (`PENDING_REVIEW`).
3. Si quedó en revisión: el admin la aprueba en
   `PATCH /admin/listings/:id/approve`.
4. `POST /auctions` — crea la subasta de una publicación aprobada.
5. Con otro usuario: `POST /auctions/:id/bids`.
6. Al llegar `endsAt`, el cierre automático define el ganador y crea la orden.
7. El ganador: `POST /orders/:id/payment` con `{ "result": "APPROVED" }`.
8. El vendedor: `PATCH /orders/:id/delivery` con `{ "status": "DELIVERED" }`.

## Endpoints

Todos requieren `Authorization: Bearer <token>` salvo los marcados como
públicos. La descripción completa (parámetros, cuerpos y respuestas) está en
Swagger.

**Auth**

| Método y ruta | Acceso |
|---|---|
| `POST /auth/register` | público |
| `POST /auth/login` | público |
| `POST /auth/logout` | autenticado (invalida los tokens emitidos) |

**Usuarios**

| Método y ruta | Acceso |
|---|---|
| `GET /users/me`, `PATCH /users/me` | autenticado |
| `GET /users` | admin |
| `PATCH /users/:id/role` | admin |
| `PATCH /users/:id/status` | admin (suspender/activar) |
| `DELETE /users/:id` | admin |

**Publicaciones**

| Método y ruta | Acceso |
|---|---|
| `GET /listings`, `GET /listings/:id` | público |
| `POST /listings`, `GET /listings/mine`, `PATCH /listings/:id`, `DELETE /listings/:id` | autenticado (dueño) |
| `GET /admin/reviews` | admin |
| `PATCH /admin/listings/:id/approve`, `PATCH /admin/listings/:id/reject` | admin (publicaciones en revisión) |
| `PATCH /admin/listings/:id/suspend`, `PATCH /admin/listings/:id/unsuspend` | admin |

**Subastas y pujas**

| Método y ruta | Acceso |
|---|---|
| `GET /auctions`, `GET /auctions/active`, `GET /auctions/:id` | público |
| `GET /auctions/:id/bids` | público |
| `POST /auctions`, `GET /auctions/mine`, `PATCH /auctions/:id/cancel` | autenticado (vendedor) |
| `POST /auctions/:id/bids`, `GET /auctions/my-bids` | autenticado |
| `PATCH /admin/auctions/:id/cancel` | admin (puede cancelar con ofertas) |

**Órdenes**

| Método y ruta | Acceso |
|---|---|
| `GET /orders` (filtro `?status=`) | comprador/vendedor; el admin ve todas |
| `GET /orders/:id` | comprador, vendedor o admin |
| `POST /orders/:id/payment` | solo el comprador (pago simulado) |
| `PATCH /orders/:id/delivery` | según la transición (ver abajo) |

## Reglas de negocio destacadas

- Duración de una subasta entre 1 y 24 horas; precio inicial e incremento > 0.
- El vendedor no puede pujar en su propia subasta; una puja debe superar el
  precio vigente más el incremento mínimo. Las pujas se registran en una
  transacción con bloqueo de fila, por lo que dos pujas simultáneas no se
  aceptan sobre el mismo precio.
- Una subasta se cierra una sola vez: el cierre es idempotente y genera como
  máximo una orden (restricción única por subasta).
- Si Gemini no responde, devuelve algo inválido o no hay clave, la publicación
  pasa a revisión administrativa; nunca se aprueba automáticamente.

### Moderación del administrador

- **Cancelar una subasta** (`PATCH /admin/auctions/:id/cancel`, motivo opcional):
  a diferencia del vendedor, el administrador puede cancelarla aunque tenga
  ofertas. Las ofertas quedan `CANCELLED`, no hay ganador ni orden y la
  publicación pasa a `CANCELLED`. No aplica a subastas finalizadas.
- **Suspender una publicación** (`PATCH /admin/listings/:id/suspend`): deja de
  ser pública y el vendedor no puede editarla. Si tiene una subasta
  programada o activa, se cancela del mismo modo. No aplica a publicaciones
  finalizadas, rechazadas o canceladas.
- **Levantar la suspensión** (`.../unsuspend`): la publicación vuelve a
  `PENDING_REVIEW`. No es posible si ya tuvo una subasta (cada publicación
  admite una sola).

### Órdenes: estados y transiciones

`PENDING_PAYMENT` → `PAID` | `PAYMENT_REJECTED` (reintentable) → `DELIVERED`,
`CANCELLED` o `DEFAULTED` (estados finales). El pago es simulado: no hay
pasarela real.

| Acción | Desde | Quién |
|---|---|---|
| `DELIVERED` | `PAID` | vendedor (o admin) |
| `CANCELLED` | `PENDING_PAYMENT`, `PAYMENT_REJECTED` | comprador, vendedor o admin |
| `CANCELLED` | `PAID` | vendedor o admin |
| `DEFAULTED` | `PENDING_PAYMENT`, `PAYMENT_REJECTED` | vendedor o admin (el comprador no pagó) |
| `DEFAULTED` | `PAID` | comprador o admin (el vendedor no entregó) |

## Tiempo real (Socket.IO)

El servidor Socket.IO comparte puerto y CORS con la API (`http://localhost:3000`).
Swagger no documenta WebSockets, por eso el protocolo se describe aquí.

**Conexión.** Sin token la conexión es anónima: puede seguir subastas (solo
lectura). Con un JWT (`auth: { token }` o cabecera `Authorization: Bearer ...`)
además recibe sus eventos privados. Un token inválido, vencido o invalidado
(logout, suspensión, cambio de rol) se desconecta con el evento `auth:error`.

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { auth: { token: accessToken } });

socket.emit('auction:join', { auctionId: 5 }, (ack) => console.log(ack)); // { ok: true }
socket.on('bid:new', ({ auctionId, bid, currentPrice }) => { /* ... */ });
```

**Mensajes del cliente** (responden con un ack `{ ok }`):

| Mensaje | Cuerpo | Efecto |
|---|---|---|
| `auction:join` / `auction:leave` | `{ auctionId }` | Entra o sale de la sala de una subasta |
| `auctions:watch` / `auctions:unwatch` | — | Sigue los cambios de estado de todas las subastas |

**Eventos del servidor.** Siempre se emiten después de confirmar la
transacción: nunca se anuncia algo que no quedó guardado.

| Evento | Quién lo recibe | Contenido |
|---|---|---|
| `bid:new` | sala de la subasta | `auctionId`, `bid` (`id`, `bidderId`, `amount`, `createdAt`), `currentPrice`, `endsAt` |
| `auction:status` | sala de la subasta y `auctions:watch` | `auctionId`, `status`, `currentPrice`, `winnerId`, `cancelReason`, fechas. Se emite al crear, activar, cerrar o cancelar |
| `auction:result` | solo el vendedor y el ganador | `auctionId`, `winnerId`, `finalPrice`, `orderId` (o `null` si no hubo ofertas) |
| `order:created` | comprador, vendedor y administradores | `orderId`, `auctionId`, `status`, `amount`, `paymentDueAt` |
| `order:updated` | comprador, vendedor y administradores | igual; tras pago, entrega, cancelación o vencimiento |
| `auth:error` | el cliente que se conecta | `{ message }`; luego se cierra la conexión |

## Seguridad

- **helmet**: cabeceras de seguridad HTTP.
- **CORS**: `CORS_ORIGINS` (API y Socket.IO). En producción, sin configurarlo,
  no se permite ningún origen.
- **Rate limiting**: `THROTTLE_LIMIT` por IP y, más estricto, `AUTH_THROTTLE_LIMIT`
  en `/auth/login` y `/auth/register` (fuerza bruta). Responde `429` con
  `Retry-After`. Detrás de un proxy define `TRUST_PROXY=1`. Se desactiva en
  `NODE_ENV=test`.
- **Swagger**: se puede ocultar (`SWAGGER_ENABLED=false`) o proteger con
  autenticación básica (`SWAGGER_USER` y `SWAGGER_PASSWORD`).
- **Esquema**: `DB_SYNCHRONIZE` es `false` por defecto en producción.

## Pruebas

```bash
npm test            # unitarias (Jest), no necesitan base de datos
npm run test:cov    # con cobertura
npm run test:e2e    # integración (supertest), requieren PostgreSQL
npm run test:all    # ambas
npm run lint        # oxlint
```

Las pruebas e2e usan la base de datos configurada en el `.env` y **escriben
datos de prueba**. No las apuntes a una base con datos que quieras conservar:
usa una base aparte (por ejemplo un Postgres local con `DB_SSL=false`).

## Integración continua

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) se ejecuta en cada pull
request y en cada push a `main`:

1. **unit**: instala dependencias, lint, build y pruebas unitarias (incluidas las
   de Socket.IO y seguridad HTTP, que no necesitan base de datos).
2. **e2e**: levanta un servicio PostgreSQL y ejecuta las pruebas e2e.

## Despliegue

Antes de desplegar:

1. `NODE_ENV=production` y `DB_SYNCHRONIZE=false` (después de haber creado las
   tablas con `DB_SYNCHRONIZE=true` la primera vez). Si la base ya existía de
   una versión anterior, ejecuta una vez
   [`scripts/schema-changes.sql`](scripts/schema-changes.sql) (estado
   `SUSPENDED`, motivo de cancelación y plazo de pago). El proyecto no usa
   migraciones de TypeORM: ese script cumple su papel.
2. `TZ=UTC`, un `JWT_SECRET` propio y `SEED_ADMIN_PASSWORD` seguro; considera
   `SEED_DEMO_DATA=false`.
3. `CORS_ORIGINS` con el origen del frontend, `TRUST_PROXY=1` si hay balanceador
   o proxy, y `SWAGGER_USER`/`SWAGGER_PASSWORD` (o `SWAGGER_ENABLED=false`).
4. Con Socket.IO detrás de un proxy (nginx) habilita el *upgrade* de WebSocket.
5. Compilar con `npm run build` y arrancar con `npm run start:prod`.

### Despliegue en Render (guía rápida)

El repositorio incluye un [`Dockerfile`](Dockerfile) y un blueprint
[`render.yaml`](render.yaml). La base de datos sigue siendo Supabase; Render
solo aloja la API (plan gratuito, sin tarjeta).

1. Sube los cambios a la rama `main` (el blueprint despliega `main`).
2. Aplica los cambios de esquema en Supabase **una vez** (SQL Editor →
   pegar [`scripts/schema-changes.sql`](scripts/schema-changes.sql)). Si no,
   la app en producción (`DB_SYNCHRONIZE=false`) fallaría por columnas
   faltantes.
3. En [render.com](https://render.com): **New → Blueprint** → elige este
   repositorio. Render lee `render.yaml` y te pide las variables secretas:
   `DB_HOST`, `POSTGRES_USER`, `POSTGRES_PASSWORD` (los del *Session pooler*
   de Supabase), `SEED_ADMIN_PASSWORD`, y opcionalmente `GEMINI_API_KEY`,
   `SWAGGER_USER` y `SWAGGER_PASSWORD`.
4. Cuando termine el despliegue, la API queda en
   `https://colsubastas-api.onrender.com` (o el nombre que asigne Render):
   Swagger en `/docs` y Socket.IO en la misma URL.
5. Para Postman cambia la variable `baseUrl` a esa URL.

Notas del plan gratuito: el servicio se duerme tras ~15 minutos sin
tráfico y la primera petición tarda ~1 minuto en despertarlo. Mientras
duerme no corre el cierre automático de subastas, así que **despiértalo
(abre `/docs`) antes de grabar el video** y no lo dejes dormir durante la
demostración. Cuando termines, **suspende o elimina el servicio** desde el
panel de Render para cerrar el despliegue.

El mismo `Dockerfile` sirve en cualquier otro servicio (Railway, Fly.io, AWS
EC2 con `docker run`): define las mismas variables de entorno y expón el
puerto `PORT`.

