# La Liga ACP — backend

API REST en **Express + TypeScript** sobre el MySQL de `../compose.yaml`. Todavía sin lógica de negocio: esta es la base (T-02 de [../docs/plan-polla.md](../docs/plan-polla.md)) sobre la que se construyen T-03 en adelante.

## Por qué un `package.json` propio, no workspaces de npm

`server/` es un proyecto Node de servidor (dependencias de runtime: Express, mysql2...) completamente separado del front, que es una SPA de Vite para el navegador. No comparten código ni dependencias hoy, y `server/` se despliega y se corre distinto (como servicio de `compose.yaml`, no como parte del build de Vite). Dos `package.json` independientes, cada uno con su propio `npm install` y su propio lockfile, mantienen esa separación explícita y evitan tocar el `package.json` de la raíz (que ya es el del front) para convertirlo en la raíz de un monorepo. El costo — dos instalaciones en vez de una — se paga una sola vez; `npm run server:install` desde la raíz lo hace por vos.

## Estructura por capas

```
src/
  config/      # env.ts: config tipada y validada con zod, falla al arrancar si falta algo
  db/          # pool.ts: fábrica del pool de MySQL (mysql2/promise) + chequeo de conexión
  lib/         # HttpError, el sobre {data}/{error} de las respuestas, códigos de error
  middleware/  # seguridad (helmet/cors/rate-limit/límite de body), 404, manejador de errores
  routes/      # solo arma URLs + verbos, delega en un controlador
  controllers/ # HTTP: lee la request, llama al service, arma la respuesta con lib/response
  services/    # lógica de negocio + acceso a datos (usa el pool directamente)
  app.ts       # createApp({ pool, env }): arma la app sin escuchar (para tests)
  index.ts     # el único archivo que crea el pool real y llama app.listen()
tests/
  helpers/     # createTestApp()/createUnreachableApp(), resetDatabase()
  global-setup.ts  # crea y migra la base de pruebas una vez, antes de toda la suite
  *.test.ts
```

**Nunca** se lee `process.env` fuera de `config/env.ts`: todo lo demás importa `env` desde ahí. **Nunca** se arma una respuesta de error a mano en una ruta o controlador: se `throw`s un `HttpError` (o se deja pasar un `ZodError` de una validación) y el manejador centralizado (`middleware/error-handler.ts`) hace el resto — Express 5 reenvía automáticamente una promesa rechazada dentro de un handler async al manejador de errores, así que no hace falta `try/catch` ni `next(err)` a mano en cada controlador.

### Agregar un recurso nuevo (a partir de T-03)

1. `services/<recurso>.service.ts`: la lógica, recibe el `pool` como parámetro.
2. `controllers/<recurso>.controller.ts`: `export function create<Recurso>Controller(pool) { return async (req, res) => {...} }`.
3. `routes/<recurso>.route.ts`: `export function create<Recurso>Router(pool) { ... }`.
4. Montarlo en `routes/index.ts`.

El `pool` (y cualquier otra dependencia) se pasa como parámetro desde `app.ts` hacia abajo — nunca un singleton importado a mitad de un módulo — para que los tests puedan inyectar el suyo (por ejemplo, uno apuntando a una base inalcanzable, como hace `tests/health.test.ts` para probar el camino de error).

## Variables de entorno

Se leen del `.env` de la raíz del repo (mismo archivo que ya usa `compose.yaml` para MySQL) — ver [`../.env.example`](../.env.example). `config/env.ts` valida todo con `zod` al arrancar: si falta una variable o tiene el tipo equivocado, el proceso no levanta y el mensaje dice exactamente cuál.

Nuevas, además de las que ya existían para el servicio `db` (`MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`):

| Variable | Para qué |
|---|---|
| `PORT` | Puerto del backend (mismo valor adentro y publicado al host). |
| `CORS_ORIGIN` | Origen exacto permitido por CORS (el del front). |
| `DB_HOST` / `DB_PORT` | A dónde conectarse para hablar con MySQL. En local (backend fuera de Docker) es `127.0.0.1` + el puerto publicado por `db` (`MYSQL_PORT`). El servicio `server` de `compose.yaml` los pisa con `db`/`3306` (la red interna) — nunca los toma de `.env` ahí. |
| `MYSQL_DATABASE_TEST` | Base separada para Vitest (ver abajo). Nunca lleva datos reales. |

## Desarrollo

Con Docker (recomendado — MySQL y el backend en la misma red, recarga automática):

```sh
cd ..                    # raíz del repo
docker compose up -d     # levanta db y server
docker compose logs -f server
```

Sin Docker (backend en el host, MySQL igual en Docker):

```sh
docker compose up -d db  # desde la raíz, solo la base
npm run server:install   # una vez, desde la raíz (o "npm install" acá adentro)
npm run server:dev       # desde la raíz — o "npm run dev" parado en server/
```

`GET /health` devuelve el estado (`{"data":{"status":"ok","database":"up","version":"..."}}`, 200) o un error claro si la base no responde (`{"error":{"code":"DATABASE_UNAVAILABLE",...}}`, 503) — sin filtrar el error real de MySQL. El proceso arranca igual con la base caída: es un chequeo en vivo, no una condición de arranque.

### Sobre la recarga en caliente dentro de Docker

`compose.yaml` monta `./server` sobre `/app` para que los cambios del host se vean sin reconstruir la imagen. En Windows, ese bind mount no entrega los eventos de sistema de archivos nativos que `tsx watch` necesita — los cambios simplemente no se notaban. Por eso la imagen corre `dev:docker` (`nodemon --legacy-watch`, que revisa por *polling*) en vez de `dev` (`tsx watch`, más rápido, usado en desarrollo local fuera de Docker donde sí hay un filesystem real).

Si alguna vez el contenedor arranca con `nodemon: not found` después de agregar una dependencia nueva: es el volumen anónimo de `node_modules` con el contenido viejo (Docker no lo renueva solo al reconstruir la imagen). `docker compose up -d --force-recreate -V server` lo fuerza a tomar el `node_modules` de la imagen nueva.

## Pruebas

```sh
npm test        # vitest run — necesita MySQL levantado (docker compose up -d db)
npm run typecheck
```

Corren contra `MYSQL_DATABASE_TEST` (por defecto `la_liga_acp_test`), **nunca** contra la base de datos real. `tests/global-setup.ts` la recrea y migra desde `../db/init/` una sola vez, al principio de toda la corrida (conectándose como `root`, porque el usuario normal de la app solo tiene permisos sobre `MYSQL_DATABASE`) — así nunca puede quedar desactualizada respecto del esquema real. `tests/helpers/db.ts` expone `resetDatabase()` para vaciar todas las tablas entre pruebas; ya se usa en `tests/db-reset.test.ts` y queda lista para que T-03 en adelante la llame en un `beforeEach`.

Todos los archivos de test corren en serie (`fileParallelism: false`), porque comparten la misma base: correrlos en paralelo produciría carreras contra `resetDatabase()`.
