# La Liga ACP — backend

API REST en **Express + TypeScript** sobre el MySQL de `../compose.yaml`, construida tarea por tarea según [../docs/plan-polla.md](../docs/plan-polla.md). Hoy tiene la base (T-02), el registro, login y roles (T-03) y la validación de participantes (T-04).

## Por qué un `package.json` propio, no workspaces de npm

`server/` es un proyecto Node de servidor (dependencias de runtime: Express, mysql2...) completamente separado del front, que es una SPA de Vite para el navegador. No comparten código ni dependencias hoy, y `server/` se despliega y se corre distinto (como servicio de `compose.yaml`, no como parte del build de Vite). Dos `package.json` independientes, cada uno con su propio `npm install` y su propio lockfile, mantienen esa separación explícita y evitan tocar el `package.json` de la raíz (que ya es el del front) para convertirlo en la raíz de un monorepo. El costo — dos instalaciones en vez de una — se paga una sola vez; `npm run server:install` desde la raíz lo hace por vos.

## Estructura por capas

```
src/
  config/      # env.ts: config tipada y validada con zod, falla al arrancar si falta algo
  db/          # pool.ts: pool de MySQL + chequeo de conexión; transaction.ts: withTransaction()
  lib/         # HttpError, sobre {data}/{error}, códigos de error, contraseñas, tokens, cookie de sesión
  middleware/  # seguridad, CSRF, requireAuth/requireRole/requireBettor, límites de auth, 404, errores
  schemas/     # esquemas zod de los bodies de cada recurso
  routes/      # solo arma URLs + verbos, delega en un controlador
  controllers/ # HTTP: lee la request, llama al service, arma la respuesta con lib/response
  services/    # lógica de negocio + acceso a datos (usa el pool directamente)
  cli/         # comandos que se corren en el servidor (create-admin.ts)
  types/       # extensión de tipos de Express (req.auth)
  app.ts       # createApp({ pool, env }): arma la app sin escuchar (para tests)
  index.ts     # el único archivo que crea el pool real y llama app.listen()
tests/
  helpers/     # createTestApp()/createUnreachableApp(), resetDatabase(), guardias de la base de pruebas
  global-setup.ts  # crea y migra la base de pruebas una vez, antes de toda la suite
  *.test.ts
```

**Nunca** se lee `process.env` fuera de `config/env.ts`: `index.ts` llama a `loadEnv()` una vez y pasa el `Env` resultante hacia abajo. **Nunca** se arma una respuesta de error a mano en una ruta o controlador: se `throw`s un `HttpError` (o se deja pasar un `ZodError` de una validación) y el manejador centralizado (`middleware/error-handler.ts`) hace el resto — Express 5 reenvía automáticamente una promesa rechazada dentro de un handler async al manejador de errores, así que no hace falta `try/catch` ni `next(err)` a mano en cada controlador.

Códigos de error del sobre (`lib/error-codes.ts`):

| Código | Status | Cuándo |
|---|---|---|
| `NOT_FOUND` | 404 | Ruta o recurso inexistente |
| `VALIDATION_ERROR` | 400 | Validación de datos (zod o `HttpError.badRequest`) |
| `INVALID_JSON` | 400 | El body no es JSON válido |
| `PAYLOAD_TOO_LARGE` | 413 | El body supera los 100 KB |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Charset distinto de UTF-8 o `Content-Encoding` no soportado |
| `BAD_REQUEST` | 4xx | Cualquier otro error del cliente (`expose: true` y status 4xx), por ejemplo un body gzip o brotli corrupto |
| `RATE_LIMITED` | 429 | Se superó el límite de peticiones (general o de login) |
| `UNAUTHENTICATED` | 401 | No hay sesión válida (sin cookie, vencida o cerrada) |
| `INVALID_CREDENTIALS` | 401 | Login fallido: la misma respuesta si el correo no existe o si la contraseña es incorrecta |
| `FORBIDDEN` | 403 | Hay sesión pero el rol no alcanza |
| `USER_NOT_VALIDATED` | 403 | Hay sesión pero el usuario sigue `pendiente` (BR-005) |
| `CSRF_FAILED` | 403 | `Origin` ajeno o `X-CSRF-Token` ausente o incorrecto |
| `EMAIL_TAKEN` | 409 | Registro con un correo que ya existe |
| `USER_NOT_FOUND` | 404 | Acción de admin sobre un usuario que no existe |
| `PAYMENT_ALREADY_CONFIRMED` | 409 | Confirmar un pago ya confirmado |
| `PAYMENT_NOT_CONFIRMED` | 409 | Validar sin pago confirmado, o revertir un pago que no está confirmado |
| `USER_ALREADY_VALIDATED` | 409 | Validar a alguien ya validado (o que ya recibió sus monedas), o revertir el pago de un validado |
| `NOT_A_PARTICIPANT` | 404 | Acción de participantes sobre una cuenta de administrador (incluida la propia) |
| `ADMIN_CANNOT_BET` | 403 | Un administrador en una ruta de apuestas |
| `DATABASE_UNAVAILABLE` | 503 | La base no responde (`/health`) |
| `INTERNAL_ERROR` | 500 | Error inesperado; la causa real solo va al log |

Un error con `expose: true` y status 4xx (lo que lanza `express.json()` ante un body inválido, tenga o no `type`) es del cliente: conserva su status, no se loguea y nunca devuelve el mensaje original del parser. Un error 5xx o sin `expose` siempre es `INTERNAL_ERROR`.

El limitador corre **antes** de `express.json()` (un body inválido también cuenta) y no cuenta `GET /health`, con el mismo criterio que usa la ruta: sin distinguir mayúsculas y con o sin barra final (`/HEALTH`, `/health/`).

**Parámetros de query inesperados.** Ninguna ruta de `/auth` ni de `/admin` ignora en silencio un parámetro que no entiende: responde 400 `VALIDATION_ERROR`, sin efectos. Una ruta sin parámetros usa `rejectQueryParams` (`middleware/no-query.ts`). Va después de `requireAuth`, para que sin sesión siga saliendo 401, y **antes** de los límites de login y de registro: una petición rechazada por su query no cuenta como intento fallido ni gasta el cupo de registros (el límite general sí la cuenta, como a cualquier petición). Una ruta con parámetros los valida con un `z.strictObject`. Los `:params` de la URL también pasan por zod. `/health` queda afuera a propósito: los monitores suelen agregar parámetros para evitar cachés.

**Nota para el front (T-18).** `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout` y las rutas de `/admin` sin parámetros no aceptan query string: responden 400. Un `?next=` (o cualquier otro parámetro) de la URL de la **página** del front se usa en el front y **no se reenvía** a la URL de la API.

### Agregar un recurso nuevo

1. `schemas/<recurso>.schema.ts`: los esquemas zod de sus bodies, de su query (`z.strictObject`) y de sus `:params`. El controlador hace `schema.parse(...)`; si falla, sale un 400 `VALIDATION_ERROR` solo. Si la ruta no lleva query, `rejectQueryParams`.
2. `services/<recurso>.service.ts`: la lógica, recibe el `pool` como parámetro.
3. `controllers/<recurso>.controller.ts`: `export function create<Recurso>Controller(pool, env) { ... }`.
4. `routes/<recurso>.route.ts`: `export function create<Recurso>Router(...) { ... }`, con la protección que corresponda (ver abajo).
5. Montarlo en `routes/index.ts`. Lo que sea solo de administración va dentro del router de `/admin`, que ya exige sesión y rol `admin`.

El `pool` (y cualquier otra dependencia) se pasa como parámetro desde `app.ts` hacia abajo — nunca un singleton importado a mitad de un módulo — para que los tests puedan inyectar el suyo (por ejemplo, uno apuntando a una base inalcanzable, como hace `tests/health.test.ts` para probar el camino de error).

## Autenticación y roles (T-03)

| Ruta | Protección | Respuesta |
|---|---|---|
| `POST /auth/register` | pública | 201 `{ user }`. No inicia sesión. |
| `POST /auth/login` | pública, límite de intentos | 200 `{ user, csrfToken, expiraEn }` + cookie de sesión |
| `GET /auth/me` | sesión | 200 `{ user, csrfToken }` |
| `POST /auth/logout` | sesión + CSRF | 200 `{ data: null }`, borra la sesión y la cookie |
| `GET /admin/sesion` | sesión + rol `admin` | 200. Solo confirma la protección. |

`user` es `{ id, nombre, email, rol, estadoValidacion, estadoPago, saldoMonedas, creadoEn }`. Nunca incluye el hash.

**Decisiones**

- **Se entra con el correo** (BR-003/BR-004, EsquemaBD D17). No hay nombre de usuario: el correo ya es único y el admin lo necesita para contactar al inscrito. Se guarda recortado y en minúsculas. `nombre` solo se muestra.
- **Registro:** siempre crea `apostador`, `pendiente`, pago `pendiente` y 0 monedas; las 10 llegan al validar (T-04). Cualquier campo extra del body (`rol`, `saldoMonedas`...) se ignora. Contraseña de 10 a 128 caracteres. Correo repetido: 409 `EMAIL_TAKEN` (revelar que existe es inevitable al registrarse; el login no lo revela).
- **Contraseñas con argon2id** (`lib/password.ts`), la primera opción de OWASP, con su perfil mínimo recomendado: 19 MiB, 2 iteraciones, 1 hilo (~25 ms por hash). Es resistente a GPU por el uso de memoria, a diferencia de bcrypt, que además corta la contraseña en 72 bytes. Los parámetros viajan dentro del hash, así que subirlos más adelante no rompe los hashes viejos.
- **Login sin fugas:** correo inexistente y contraseña incorrecta dan exactamente el mismo 401 `INVALID_CREDENTIALS`. Con un correo inexistente igual se verifica un hash de relleno, para que ambos casos tarden lo mismo.
- **Límite de login** (`middleware/auth-rate-limits.ts`): 5 intentos **fallidos** cada 15 minutos por IP + correo; los exitosos no cuentan. Por IP + correo para que un ataque a una cuenta no deje sin acceso a toda una oficina detrás de la misma IP; probar muchos correos desde una IP lo frena el límite general.
- **Límite de registro** (mismo archivo): 10 registros por hora por IP, exitosos o no. Frena la creación masiva de cuentas y el sondeo de qué correos existen a través del 409 `EMAIL_TAKEN`, que se mantiene por decisión del usuario.
- **IP del cliente y `TRUST_PROXY`:** por defecto la IP es la de la conexión, y un `X-Forwarded-For` enviado por el cliente se ignora. Detrás de un proxy (nginx, un balanceador) hay que poner `TRUST_PROXY` con la cantidad de proxies (`1`) o sus IPs/rangos (`loopback`, `10.0.0.0/8`); si no, todos los clientes comparten la IP del proxy y el límite los bloquea juntos. `true` se rechaza: dejaría que cualquiera eligiera su IP y evadiera los límites.
- **Sesión en servidor, no JWT** (EsquemaBD D18). La cookie lleva un token aleatorio de 256 bits; la tabla `sesion` guarda solo su SHA-256. El logout borra la fila, así que una copia de la cookie deja de servir en el acto; cada inicio de sesión purga además las sesiones vencidas de todos (con el índice `idx_sesion_expira_en`, hasta 500 por vez); con JWT habría que esperar a que venza o mantener una lista de revocados. Además, un cambio de rol o de estado se aplica en la petición siguiente, porque el usuario se lee de la base en cada una.
- **Cookie:** `HttpOnly`, `SameSite=Strict`, `Path=/`, con vencimiento absoluto de `SESSION_TTL_HOURS` (12 h). En producción, además `Secure` y el prefijo `__Host-`. `Strict` alcanza porque el front (`localhost:5173`) y la API (`localhost:3001`) son el mismo *site*. Si en producción quedan en dominios distintos, hará falta `SameSite=None`, y el token CSRF de abajo pasa a ser la única defensa.
- **CSRF** (`middleware/csrf.ts`), en todo `POST`/`PUT`/`PATCH`/`DELETE`:
  1. Si el navegador manda un `Origin` distinto de `CORS_ORIGIN`: 403. Esto cubre también el *login CSRF*.
  2. Si la petición trae la cookie de sesión, el header `X-CSRF-Token` tiene que ser el `csrfToken` que devolvieron el login y `/auth/me`: un HMAC del token de sesión con `SESSION_SECRET`. Login y registro no lo piden, porque todavía no hay sesión.
- **Autorización** (`middleware/auth.ts`), siempre en este orden:
  - `requireAuth`: 401 si no hay sesión.
  - `requireRole(rol)`: 403 si el rol no es exactamente ese. Los roles no se incluyen entre sí: un admin no es apostador.
  - `requireBettor`: para **toda ruta de apuestas** (T-09 en adelante). Solo pasa un apostador validado. Un admin recibe 403 `ADMIN_CANNOT_BET` aunque en la base figure validado: los administradores no participan en la polla (BR-001). Un apostador `pendiente` recibe 403 `USER_NOT_VALIDATED`; puede entrar y navegar, pero no apostar (BR-005).

### Primer administrador

No hay registro de administradores por la API, y el panel tampoco cambia roles (BR-001). Un administrador solo se crea, o una cuenta existente se promueve, con este comando en el servidor. **La contraseña se escribe cuando el comando la pide**: no se muestra, se pide dos veces y no queda en el historial de la terminal ni en la línea de comandos de ningún proceso.

```sh
# Dentro de Docker (recomendado). -it da la terminal donde se escribe la clave.
docker compose exec -it -e ADMIN_EMAIL=ana@liga.test -e ADMIN_NOMBRE=Ana server npm run admin:create

# Fuera de Docker, desde la raíz (bash):
ADMIN_EMAIL=ana@liga.test ADMIN_NOMBRE=Ana npm run server:admin:create

# Fuera de Docker, desde la raíz (PowerShell):
$env:ADMIN_EMAIL='ana@liga.test'; $env:ADMIN_NOMBRE='Ana'; npm run server:admin:create
```

- Correo y nombre sí pueden ir en la línea de comandos: no son secretos.
- Si el correo ya tiene cuenta, basta `ADMIN_EMAIL`: la promueve a `admin` sin pedir contraseña y sin tocar la que tiene. Si igual se le pasó una contraseña, avisa que la ignoró.
- **Solo se promueve una cuenta que nunca participó en la polla**: `pendiente`, pago `pendiente`, 0 monedas, sin movimientos y sin tickets. Si no cumple, el comando sale con 1, lista los motivos y no cambia nada. Los administradores no participan, y promover una cuenta con saldo, pago o apuestas dejaría a un admin con apuestas vivas sobre los resultados que carga. En ese caso hay que usar otro correo para el administrador. La comprobación va en el mismo `UPDATE` que promueve, así que nada se cuela entre medio.
- Si el correo no existe, hacen falta el nombre y la contraseña, con las mismas reglas que el registro.
- Correrlo dos veces no hace nada nuevo. Sale con 0 si todo fue bien, con 1 y un mensaje claro si no, y con 130 si se cancela con Ctrl+C.

**Sin terminal (scripts, CI)**, usá una sola de estas fuentes:

| Fuente | Uso |
|---|---|
| `ADMIN_PASSWORD_FILE=/ruta` | Lee la primera línea del archivo. Sirve para secretos de Docker o de CI montados como archivo. Dentro del contenedor, la ruta tiene que existir en el contenedor. |
| `ADMIN_PASSWORD_STDIN=1` | Lee la primera línea de la entrada estándar, por ejemplo `docker compose exec -T -e ADMIN_EMAIL=... -e ADMIN_NOMBRE=... -e ADMIN_PASSWORD_STDIN=1 server npm run admin:create < clave.txt`. |
| `ADMIN_PASSWORD` | El valor directo. **Solo en CI**, cuando la variable la carga la plataforma desde su almacén de secretos y nadie la escribe. |

**Por qué no escribir la clave en el comando.** Escribir `ADMIN_PASSWORD=...` delante del comando deja la clave en el historial (bash y PowerShell con PSReadLine lo guardan). Con `docker compose exec -e ADMIN_PASSWORD=...` la clave además queda completa en la línea de comandos de `docker.exe` y `docker-compose.exe` mientras corren, y cualquier proceso del equipo puede leerla. `-e ADMIN_PASSWORD` sin valor copia la variable del entorno actual sin escribirla, pero antes hay que haberla cargado sin que quede en el historial. Por eso el camino normal es que el comando la pida.

## Participantes (T-04)

Todo bajo `/admin/participantes`, que ya exige sesión y rol `admin`. Los `POST` llevan `X-CSRF-Token`.

| Ruta | Qué hace |
|---|---|
| `GET /admin/participantes` | Tabla de BR-007, paginada, **solo apostadores**: `{ items, page, pageSize, total, totalPages }` |
| `GET /admin/participantes/conteos` | `{ inscritos, validados, pendientes, pagosConfirmados, pagosPendientes }` (BR-001), solo apostadores |
| `POST /admin/participantes/:id/pago/confirmar` | Pago `pendiente` → `confirmado` |
| `POST /admin/participantes/:id/pago/revertir` | Pago `confirmado` → `pendiente`, solo si el usuario sigue `pendiente` |
| `POST /admin/participantes/:id/validar` | `pendiente` → `validado` + 10 monedas + movimiento `validacion` |

Cada fila (`items[]`, y `participante` en las respuestas de las acciones) tiene la misma forma que el usuario de `/auth/me`, más `puntos`.

**Parámetros del listado** (validados con zod; un valor inválido o repetido, o un parámetro desconocido, da 400). `/conteos` no acepta ninguno: cualquier parámetro, incluido el viejo `rol`, da 400.

| Parámetro | Valores |
|---|---|
| `page` | De 1 a 100000. Por defecto 1. |
| `pageSize` | De 1 a 100. Por defecto 20. |
| `estadoPago` | `pendiente` o `confirmado`. |
| `estadoValidacion` | `pendiente` o `validado`. |
| `q` | Busca en nombre o correo, sin distinguir mayúsculas ni acentos. `%` y `_` se buscan literalmente. |
| `orden` | Por fecha de inscripción: `asc` (por defecto, primero quien espera hace más) o `desc`. |

**Decisiones**

- **`puntos`** es `SUM(seleccion.puntos_obtenidos)` de todos los tickets del usuario, calculado en la consulta y nunca guardado (BR-039). Las selecciones sin liquidar cuentan 0. Hoy da 0 para todos, pero la consulta es la real y está probada con selecciones cargadas a mano.
- **Solo apostadores** (decisión del usuario): los administradores no participan en la polla (BR-001), así que no figuran en la tabla ni en los conteos, y ya no hay filtro por rol. Las tres acciones solo operan sobre apostadores: el `UPDATE` exige ese rol, y sobre una cuenta admin responden **404 `NOT_A_PARTICIPANT`**. Es 404 y no 409 porque `/admin/participantes/:id` nombra a un participante, un admin no lo es, y ningún cambio de estado haría válida la acción.
- **Primero el pago, después la validación** (§23). Validar sin pago confirmado da 409 `PAYMENT_NOT_CONFIRMED`. Repetir una acción ya hecha da 409 sin efectos.
- **Revertir un pago** está permitido solo mientras el usuario sigue `pendiente`, para corregir un error antes de que tenga consecuencias. Nunca después de validar: la validación y sus 10 monedas se apoyan en ese pago (BR-006), y la validación no se deshace.
- **Ya no hay regla de "no actuar sobre uno mismo"**: quien actúa siempre es admin y el destino siempre tiene que ser apostador, así que ese caso queda cubierto por `NOT_A_PARTICIPANT`.
- **Las 10 monedas se asignan una sola vez** (BR-008), con dos barreras:
  1. En la aplicación, todo pasa en una transacción. Un `UPDATE` pasa a `validado` y suma `MONEDAS_POR_VALIDACION` (`lib/coins.ts`, el único lugar donde está el 10), pero solo si el usuario está `pendiente` con pago `confirmado`; si no cambió una fila, se responde 409. En la misma transacción se inserta el movimiento `validacion` de +10.
  2. En la base, `movimiento_moneda` no admite un segundo movimiento sin selección del mismo tipo para el mismo usuario (EsquemaBD D19). Si alguien devolviera un usuario a `pendiente` a mano, el segundo +10 falla y se deshace toda la transacción, estado incluido.
- **Concurrencia:** dos validaciones simultáneas del mismo usuario compiten por la misma fila. InnoDB hace esperar a la segunda, que después ya no encuentra un `pendiente` y responde 409. Hay una prueba con 8 peticiones en paralelo, en 3 rondas. Estas transacciones usan `READ COMMITTED` para que el motivo del 409 refleje lo que la otra acaba de confirmar; con `REPEATABLE READ` se leía una foto vieja y el motivo salía mal.
- **Efecto inmediato:** la sesión relee al usuario en cada petición, así que su `/auth/me` muestra `validado` y 10 monedas en la petición siguiente, y `requireBettor` deja de rechazarlo.
- **Auditoría (T-17):** las tres acciones están en `services/participant-validation.service.ts` y aceptan `hooks.inTransaction(conn, outcome)`, que corre dentro de la transacción antes del commit. Si el hook falla, se deshace todo.

## Variables de entorno

Se leen del `.env` de la raíz del repo (mismo archivo que ya usa `compose.yaml` para MySQL) — ver [`../.env.example`](../.env.example). `config/env.ts` valida todo con `zod` al arrancar: si falta una variable o tiene el tipo equivocado, el proceso imprime cuáles son y termina con código 1, sin stack.

Nuevas, además de las que ya existían para el servicio `db` (`MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`):

| Variable | Para qué |
|---|---|
| `PORT` | Puerto del backend (mismo valor adentro y publicado al host). |
| `CORS_ORIGIN` | Origen exacto permitido por CORS (el del front). |
| `DB_HOST` / `DB_PORT` | A dónde conectarse para hablar con MySQL. En local (backend fuera de Docker) es `127.0.0.1` + el puerto publicado por `db` (`MYSQL_PORT`). El servicio `server` de `compose.yaml` los pisa con `db`/`3306` (la red interna) — nunca los toma de `.env` ahí. |
| `SESSION_SECRET` | Firma los tokens CSRF. Obligatorio, mínimo 32 caracteres, distinto por entorno. Se rechazan los valores de ejemplo (el de `.env.example`, o uno que contenga `cambiar`, `changeme`, `secret`, `ejemplo`...) y los de muy poca variedad, para que una copia sin editar no arranque. Cambiarlo invalida los tokens CSRF en uso (el front los vuelve a pedir con `/auth/me`), no las sesiones. |
| `MYSQL_DATABASE_TEST` | Base separada para Vitest (ver abajo). Nunca lleva datos reales. Tiene que ser distinta de `MYSQL_DATABASE` y solo letras, números y `_`; si no, el backend no arranca. |

Opcionales, con su valor por defecto: `NODE_ENV` (`development`), `DB_POOL_SIZE` (10), `RATE_LIMIT_WINDOW_MS` (900000), `RATE_LIMIT_MAX` (100), `SESSION_TTL_HOURS` (12), `LOGIN_RATE_LIMIT_WINDOW_MS` (900000), `LOGIN_RATE_LIMIT_MAX` (5), `REGISTER_RATE_LIMIT_WINDOW_MS` (3600000), `REGISTER_RATE_LIMIT_MAX` (10) y `TRUST_PROXY` (`false`).

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

Con la base caída, el 503 tarda unos 8 a 9 s dentro de Docker: cada intento puede esperar hasta `connectTimeout` (5 s, en `db/pool.ts`), y hay un reintento a los 300 ms. Si hace falta que responda más rápido (por ejemplo, para un monitor con timeout corto), la propuesta es bajar `connectTimeout` a 2 s, lo que deja el peor caso en unos 4,5 s. No está cambiado.

### Sobre la recarga en caliente dentro de Docker

`compose.yaml` monta `./server` sobre `/app` para que los cambios del host se vean sin reconstruir la imagen. En Windows, ese bind mount no entrega los eventos de sistema de archivos nativos que `tsx watch` necesita — los cambios simplemente no se notaban. Por eso la imagen corre `dev:docker` (`nodemon --legacy-watch`, que revisa por *polling*) en vez de `dev` (`tsx watch`, más rápido, usado en desarrollo local fuera de Docker donde sí hay un filesystem real).

Si alguna vez el contenedor arranca con `nodemon: not found` (o `Cannot find package 'argon2'`) después de agregar una dependencia nueva: es el volumen anónimo de `node_modules` con el contenido viejo (Docker no lo renueva solo al reconstruir la imagen). `docker compose up -d --force-recreate -V server` lo fuerza a tomar el `node_modules` de la imagen nueva.

## Pruebas

```sh
npm test        # vitest run — necesita MySQL levantado (docker compose up -d db)
npm run typecheck
```

Corren contra `MYSQL_DATABASE_TEST` (por defecto `la_liga_acp_test`), **nunca** contra la base de datos real. `tests/global-setup.ts` la recrea y migra desde `../db/init/` una sola vez, al principio de toda la corrida (conectándose como `root`, porque el usuario normal de la app solo tiene permisos sobre `MYSQL_DATABASE`) — así nunca puede quedar desactualizada respecto del esquema real. `tests/helpers/db.ts` expone `resetDatabase()` para vaciar las tablas entre pruebas. Conserva los catálogos (las tablas que llena `02-catalogos.sql`: roles, estados, tipos de movimiento...) y vacía todo lo demás con `DELETE` (con `TRUNCATE` cada reset tardaba ~1 s). Por eso los `AUTO_INCREMENT` no vuelven a 1: ninguna prueba debe depender de un id fijo. Se llama en el `beforeEach` de cada archivo que escribe datos. `tests/helpers/auth.ts` tiene los atajos para registrar, iniciar sesión y cambiar rol o estado directo en la base.

Todos los archivos de test corren en serie (`fileParallelism: false`), porque comparten la misma base: correrlos en paralelo produciría carreras contra `resetDatabase()`.

**Guardias para no tocar la base real:**

- `vitest.config.ts` fija `NODE_ENV=test`, aunque la terminal tenga exportado otro valor.
- `config/env.ts` rechaza `MYSQL_DATABASE_TEST` igual a `MYSQL_DATABASE`.
- `global-setup.ts` (antes del `DROP DATABASE`) y `resetDatabase()` (antes del primer `DELETE`) verifican con `tests/helpers/test-database.ts` que la base destino sea exactamente la de pruebas; si no, abortan.

`tests/test-database-guard.test.ts` prueba las tres sin conectarse nunca a la base principal.
