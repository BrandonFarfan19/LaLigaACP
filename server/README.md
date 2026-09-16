# La Liga ACP — backend

API REST en **Express + TypeScript** sobre el MySQL de `../compose.yaml`, construida tarea por tarea según [../docs/plan-polla.md](../docs/plan-polla.md). Hoy tiene la base (T-02), el registro, login y roles (T-03), la validación de participantes (T-04), el saldo y los movimientos de monedas (T-05) la administración del catálogo deportivo (T-06), la de partidos (T-07) y la API pública informativa (T-08).

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
  cli/         # comandos que se corren en el servidor (create-admin.ts, coins-check.ts)
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
| `INVALID_URL_ENCODING` | 400 | Un parámetro de la ruta (`:id`) no es codificación `%` válida (`%zz`, un `%` solo, UTF-8 cortado). No se registra en el log |
| `BAD_REQUEST` | 4xx | Cualquier otro error del cliente (`expose: true` y status 4xx), por ejemplo un body gzip o brotli corrupto |
| `RATE_LIMITED` | 429 | Se superó el límite de peticiones (general, de login, de registro o de `/public`). Siempre con `Cache-Control: no-store` |
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
| `NOT_A_PARTICIPANT` | 404 / 403 | 404: acción de participantes sobre una cuenta de administrador (incluida la propia). 403: un admin pide `/monedas/*`, o el servicio de monedas recibe una cuenta admin |
| `INSUFFICIENT_BALANCE` | 409 | Un débito dejaría el saldo negativo; `details: { saldo, requerido }` |
| `MOVEMENT_ALREADY_APPLIED` | 409 | Ese movimiento de esa selección (o esa validación) ya se había aplicado, incluida una devolución repetida; `details.selecciones` cuando es una devolución |
| `SELECTION_NOT_DEBITED` | 409 | Se intentó devolver una selección que nunca se descontó; `details.selecciones` |
| `SPORT_NOT_FOUND`, `COMPETITION_NOT_FOUND`, `TEAM_NOT_FOUND`, `PLAYER_NOT_FOUND`, `ENROLLMENT_NOT_FOUND` | 404 | El registro no existe, ya sea el `:id` de la URL o un id del body |
| `SLUG_TAKEN` | 409 | Slug repetido (global en deportes, por deporte en competiciones) |
| `PLAYER_ALREADY_ENROLLED` | 409 | El jugador ya está en un equipo de esa competición; `details.equipoId` |
| `SHIRT_NUMBER_TAKEN` | 409 | Número de camiseta ya usado en el equipo; `details.jugadorId` |
| `COMPETITION_MISMATCH` | 409 | La competición enviada (o la de la FK compuesta) no es la del equipo |
| `TRANSFER_NOT_ALLOWED` | 409 | Cambiar el equipo o el jugador de una inscripción (D4) |
| `SPORT_IN_USE`, `COMPETITION_IN_USE`, `TEAM_IN_USE`, `PLAYER_IN_USE`, `ENROLLMENT_IN_USE` | 409 | No se puede borrar (o mover) porque algo lo usa; `details` con las cantidades |
| `DRAW_RULE_LOCKED` | 409 | Cambio de `permiteEmpate` bloqueado; `details.motivos` |
| `MATCH_NOT_FOUND` | 404 | No existe ese partido |
| `SAME_TEAM` | 400 | Local y visitante son el mismo equipo |
| `MATCH_DATE_IN_PAST` | 400 | La fecha del partido no es futura |
| `MATCH_LOCKED` | 409 | El partido está finalizado o cancelado; `details.estado` |
| `MATCH_NOT_PROGRAMMED` | 409 | Cambiar competición, equipos o fecha de un partido que no está programado |
| `MATCH_HAS_BETS` | 409 | Cambiar equipos o competición, adelantar la fecha o borrar un partido con apuestas; `details.apuestas` |
| `MATCH_HAS_GOALS` | 409 | Cambiar equipos o borrar un partido con goles; `details.goles` |
| `INVALID_STATE_TRANSITION` | 409 | Transición de estado no permitida; `details.desde`, `details.hacia` |
| `BETTING_CLOSED` | — | Solo por selección, en la vista previa del ticket: el partido está programado pero ya pasó su cierre (BR-014). Trae `cierre` (UTC) en un campo aparte; el mensaje no incluye la fecha |
| `DRAW_NOT_ALLOWED` | — | Solo por selección: empate (o marcador exacto empatado) en un deporte sin empate (BR-015) |
| `CONCURRENT_UPDATE` | 409 | Otra transacción bloqueaba los mismos datos: un deadlock que siguió después de los reintentos, o una espera de bloqueo vencida (MySQL 1213 y 1205). Se puede reintentar |
| `DUPLICATE_ENTRY`, `RESOURCE_IN_USE`, `INVALID_REFERENCE` | 409 | Violación de un índice o FK de MySQL sin traducción específica (`lib/db-errors.ts`) |
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

## Monedas (T-05)

**Un solo punto mueve monedas: `services/coins.service.ts`.** Nada más en el código escribe `usuario.saldo_monedas` ni `movimiento_moneda`.

- `applyCoinMovements(conn, userId, movimientos)` corre **dentro de una transacción del llamador**, junto con lo demás que cambie esa operación (el ticket en T-10, las selecciones anuladas en T-16, el estado validado en T-04). **Esto se exige**: `conn` tiene que ser la `TransactionConnection` que entrega `withTransaction` (`db/transaction.ts`). Con una conexión común no compila, y en ejecución (por ejemplo, con un cast o con la conexión usada después de terminar la transacción) se rechaza antes de escribir nada. En un solo paso:
  1. Bloquea solo la fila del usuario (`SELECT ... FOR UPDATE OF u`). Las operaciones concurrentes sobre ese usuario se esperan entre sí; las de otros usuarios no se bloquean.
  2. Suma los movimientos y, si el saldo quedaría negativo, responde 409 `INSUFFICIENT_BALANCE` sin escribir nada (BR-009, BR-021).
  3. **Las devoluciones solo devuelven monedas gastadas** (BR-046, BR-055). Cada selección a devolver tiene que tener su `seleccion_confirmada` de ese usuario y ninguna devolución todavía. Si no la tiene, responde 409 `SELECTION_NOT_DEBITED`; si ya se devolvió (antes o dos veces en el mismo lote), 409 `MOVEMENT_ALREADY_APPLIED`. En ambos casos se rechaza el lote entero sin efectos. Como la fila del usuario ya está bloqueada, ningún débito o devolución concurrente puede colarse entre la comprobación y la inserción.
  4. Inserta un `movimiento_moneda` por movimiento y fija el saldo nuevo. El saldo es siempre la suma de los movimientos.
- **El llamador elige el tipo, nunca el monto.** Montos y signos están en `lib/coins.ts`: `validacion` +10, `seleccion_confirmada` −1, `devolucion_cancelacion` +1. El tipo se busca solo entre esos tres códigos (`movementRule`, con `Object.hasOwn`): `toString`, `constructor`, `__proto__` o cualquier otro nombre es "tipo desconocido".
- **D19 se verifica antes de tocar nada:**
  - `validacion` nunca lleva `seleccionId`.
  - Los débitos y las devoluciones siempre lo llevan.
  - La selección tiene que ser de un ticket de ese usuario.
  - Un error de este tipo es un bug del llamador (`CoinMovementError`, 500) y se deshace todo.
- **Un movimiento ya aplicado** (misma selección y tipo, o una segunda validación) responde 409 `MOVEMENT_ALREADY_APPLIED` y deshace el lote completo.
- **Una cuenta admin** responde 403 `NOT_A_PARTICIPANT`: los administradores no tienen monedas (BR-001).
- **Atajos:**
  - `grantValidationCoins(conn, userId)`: el +10 de T-04. `validateParticipant` ya lo usa, sin cambiar su comportamiento.
  - `debitSelections(conn, userId, seleccionIds)`: T-10. Descuenta N selecciones en una operación atómica, con un solo bloqueo.
  - `refundSelections(conn, userId, seleccionIds)`: T-16. Hay que agrupar las selecciones anuladas por usuario.
  - `applyCoinMovementsInTransaction(pool, ...)`: para una operación que solo mueve monedas.
- **Concurrencia (probada):** 25 débitos de 1 moneda en paralelo sobre 10 monedas dejan pasar exactamente 10, y el saldo termina en 0 sin descuadre. Con lotes de 3 en paralelo, solo pasan los que alcanzan. Débitos y devoluciones mezclados nunca dejan el saldo negativo ni descuadrado.

**Consultas del participante** (`requireAuth` + `requireParticipant`):

| Ruta | Respuesta |
|---|---|
| `GET /monedas/saldo` | `{ saldoMonedas }`, la misma columna que `/auth/me`. No acepta query. |
| `GET /monedas/movimientos` | Paginado (`page`, `pageSize`; nada más), del más reciente al más antiguo: `{ items: [{ id, tipo: { codigo, nombre }, cantidad, creadoEn, seleccion: { id, ticketId, partidoId } \| null }], page, pageSize, total, totalPages }`. |

- Un participante `pendiente` también puede leerlas: saldo 0 e historial vacío.
- **Un admin recibe 403 `NOT_A_PARTICIPANT`**, no una respuesta vacía. Los administradores no tienen monedas (BR-001), y un "0" haría que el front les mostrara el contador del navbar (BR-010).

**Comprobación de consistencia** (solo lectura, nunca corrige). Compara el `saldo_monedas` de cada apostador con `SUM(movimiento_moneda.cantidad)`, y además lista a los admins que tengan saldo o movimientos, que no deberían tener ninguno.

- `GET /admin/monedas/consistencia` → `{ ok, revisados, descuadres: [{ usuarioId, nombre, email, saldo, sumaMovimientos, diferencia }], adminsConMonedas: [...] }`. Siempre responde 200: es un informe.
- `npm run coins:check` (o `npm run server:coins:check` desde la raíz; en Docker, `docker compose exec server npm run coins:check`). Sale con 0 si todo cuadra, 1 si encontró descuadres (y los lista) y 2 si no pudo correr.

## Catálogo deportivo (T-06)

Administración de `deporte`, `competicion`, `equipo`, `jugador` y `plantel`, todo bajo `/admin` (sesión + rol `admin`; las escrituras llevan `X-CSRF-Token`). Las lecturas públicas son de T-08.

| Recurso | Campos | Filtros del listado (además de `page`, `pageSize`) | Orden |
|---|---|---|---|
| `/admin/deportes` | `nombre`, `slug?`, `permiteEmpate` | `q` (nombre o slug), `permiteEmpate=true\|false` | nombre |
| `/admin/competiciones` | `deporteId`, `nombre`, `slug?` | `q`, `deporteId` | nombre |
| `/admin/equipos` | `competicionId`, `nombre`, `nombreCorto`, `escudo`, `colorAcento` | `q` (nombre o nombre corto), `competicionId`, `deporteId` | nombre |
| `/admin/jugadores` | `nombre`, `foto?` (`null` la quita) | `q`, `equipoId`, `competicionId` (los inscritos ahí) | nombre |
| `/admin/planteles` | `jugadorId`, `equipoId`, `numeroCamiseta`, `competicionId?` | `equipoId`, `competicionId`, `jugadorId` | equipo, camiseta |

Cada recurso tiene `GET /` (paginado), `GET /:id`, `POST /` (201), `PATCH /:id` (solo los campos enviados; un body vacío da 400) y `DELETE /:id` (`{ id }`). Body y query son estrictos: un campo desconocido da 400. Los ids del body son números JSON, no textos.

**Decisiones**

- **Nombres** (`displayName`): sin caracteres de control (tabulaciones, saltos de línea, NUL, secuencias de escape), sin caracteres invisibles o de dirección de texto (U+202E, U+200B, U+2060, U+FEFF, guion blando, etc.; ZWJ y ZWNJ se permiten porque los usan los emoji compuestos y algunos idiomas) y sin surrogates UTF-16 sueltos. Los espacios de los extremos se recortan; los acentos y los emoji se aceptan.
  - Desde la corrección de T-08 se rechaza **toda** la categoría Unicode Cf (formato) salvo ZWJ y ZWNJ (incluye los caracteres de etiqueta U+E0000 a U+E007F), los separadores de línea y de párrafo (U+2028, U+2029) y los rellenos que se ven en blanco (U+115F, U+1160, U+2800, U+3164, U+FFA0).
  - Además, el nombre tiene que tener **al menos una letra o un número** (Unicode L o N). Así no pasan nombres que se ven vacíos o sin texto: solo un ZWJ, solo un acento combinable, solo U+FE0F, solo emoji o solo signos. `Club 🦅`, `1860` o `Ⅻ Legión` sí pasan.
- **Slugs** (`lib/slug.ts`): sin acentos, en minúsculas y con guiones ("Fútbol 5 – Salón" → `futbol-5-salon`). Las letras que Unicode no descompone se transliteran: ß → ss, æ → ae, œ → oe, ø → o, ł → l, đ/ð → d, þ → th, ı → i.
  - Si no se envía, sale del nombre; si se envía, se normaliza igual. Un nombre o slug sin letras ni números da 400.
  - Renombrar no cambia el slug, para que los enlaces sigan funcionando; para cambiarlo hay que enviarlo.
  - El slug es único global en deportes y por deporte en competiciones: repetido da 409 `SLUG_TAKEN`.
  - Si el slug generado ya existe, no se le agrega un sufijo automático: responde 409 y el admin elige otro.
  - `equipo` y `jugador` no tienen slug en el esquema (ver la nota de T-08 en el plan).
- **`escudo` y `foto`**, hasta que haya subida de archivos (T-13): una URL `https://` (sin usuario ni contraseña) o una ruta relativa a una imagen, como `escudos/boca.webp`.
  - La ruta no puede tener `..`, `//` ni empezar con `/`, y tiene que terminar en png, jpg, jpeg, webp, avif, svg o gif.
  - Máximo 255 caracteres (la columna). `http://`, `javascript:` y cualquier otra cosa dan 400.
  - **Seguridad (hasta T-13):** se acepta cualquier host `https`, incluso `localhost`, IPs internas o `169.254.169.254`, URLs sin extensión y SVG. Por eso el servidor **nunca** debe descargar ni procesar estas URLs sin una lista de hosts permitidos, y el front las muestra **solo** con `<img>`/`<PixelImage>`, nunca como SVG incrustado ni en otro contexto (notas en T-13, T-18 y T-22 del plan).
- **`colorAcento`:** `#rrggbb`, guardado en minúsculas; lo mismo que usa la landing.
- **`numeroCamiseta`:** de 1 a 99. La base ya lo exige único por equipo (`UNIQUE(equipo_id, numero_camiseta)`): repetido da 409 `SHIRT_NUMBER_TAKEN`. En otro equipo se puede repetir.
- **Plantel:**
  - `competicionId` sale siempre del equipo. Si el body lo manda, tiene que coincidir; si no, 409 `COMPETITION_MISMATCH`. La FK compuesta lo exige igual.
  - Un jugador va en un solo equipo por competición: 409 `PLAYER_ALREADY_ENROLLED`.
  - Editar una inscripción solo cambia el número de camiseta. Otro equipo u otro jugador es una transferencia, que D4 prohíbe dentro de una competición: 409 `TRANSFER_NOT_ALLOWED`.
- **Borrado:** solo lo que nada usa. No hay borrado en cascada ni lógico: el catálogo se corrige mientras está libre, y después los partidos, goles y apuestas necesitan que siga existiendo. Si algo lo usa, responde 409 con el motivo y las cantidades:

  | Se rechaza borrar | Si tiene | Código |
  |---|---|---|
  | Deporte | Competiciones | `SPORT_IN_USE` |
  | Competición | Equipos, partidos o jugadores inscritos | `COMPETITION_IN_USE` |
  | Equipo | Partidos, jugadores inscritos o goles | `TEAM_IN_USE` |
  | Jugador | Inscripciones (y sus goles) | `PLAYER_IN_USE` |
  | Inscripción | Goles | `ENROLLMENT_IN_USE` |
- **Mover:**
  - Una competición cambia de deporte solo si no tiene partidos, porque sus partidos siguen la regla de empate del deporte.
  - Un equipo cambia de competición solo si no tiene partidos, inscripciones ni goles.
- **`permiteEmpate` (BR-015):** cambiarlo con la fila del deporte bloqueada solo se permite si:
  1. Ningún partido del deporte salió de `programado`: esos ya se apostaron, o se jugaron, con la regla anterior.
  2. Ninguna comprobación externa se opone. La de Polla rechaza el cambio si hay alguna selección sobre los partidos del deporte.

  Si no, responde 409 `DRAW_RULE_LOCKED` con `details.motivos`, y no se aplica nada del PATCH. Mandar el mismo valor que ya tiene no es un cambio.
  - **Sin acoplar módulos:** Informativo no puede mirar apuestas (CLAUDE.md). Por eso `services/sports.service.ts` declara el tipo `DrawRuleGuard` (un punto de extensión), el módulo Polla lo implementa en `services/bets-sport-guard.service.ts`, y `routes/index.ts`, que arma la app, se lo pasa a las rutas de deportes. Informativo nunca importa código de Polla.
- **Errores de MySQL en un solo lugar** (`lib/db-errors.ts`, usado por el manejador de errores):
  - 1062 (índice único), 1451 (fila referenciada) y 1452 (referencia inexistente) se traducen según el nombre del índice o de la FK a un código propio. Si no hay traducción específica, usan `DUPLICATE_ENTRY`, `RESOURCE_IN_USE` o `INVALID_REFERENCE`.
  - 1406, 1264 y 1366 (valor demasiado largo, fuera de rango o de otro tipo) dan 400.
  - Nunca un 500, nunca el texto del driver. Los servicios igual comprueban antes los casos comunes para devolver `details`; la traducción es la red por si hay una carrera. **Al agregar un UNIQUE o una FK, agregar su traducción ahí.**
- **Auditoría (T-17):** toda escritura pasa por `runAdminAction` (`services/admin-action.ts`). Su `hooks.inTransaction(conn, outcome)` recibe `action`, `entity`, `actorId`, `id`, `before` y `after`, dentro de la misma transacción; si falla, se deshace la acción. Se inyecta con `createCatalogRouter(pool, { hooks })`.

## Partidos (T-07)

Bajo `/admin/partidos`, con el mismo CRUD que el catálogo, más `POST /admin/partidos/:id/estado { estado }`. Las lecturas públicas son de T-08.

| Campo | Formato |
|---|---|
| `competicionId`, `localId`, `visitaId` | Ids numéricos. Los equipos tienen que ser distintos y de esa competición. |
| `jornada` | Entero de 1 a 999. |
| `fechaHora` | ISO 8601 con segundos y zona: `2026-10-01T18:00:00Z` o `2026-10-01T13:00:00-05:00`. Sin zona o con una fecha imposible da 400. Se guarda en UTC, al segundo, y tiene que ser futura. |
| `sede` | Texto de hasta 150 caracteres, con las mismas reglas que los nombres. |

La respuesta trae `{ id, competicionId, deporteId, estado, jornada, fechaHora, cierreApuestas, sede, local: { equipoId, nombre, goles }, visita: {...} }`. `cierreApuestas` es `fechaHora − 24 h` (BR-014, `lib/betting.ts`).

**Listado** (`GET /admin/partidos`):

- Filtros: `deporteId`, `competicionId`, `equipoId` (local o visita), `estado`, `desde` y `hasta` (ISO con zona, inclusivos; `desde > hasta` da 400), además de la paginación. Cualquier otro parámetro da 400.
- **Orden por proximidad (BR-013), definido una sola vez en `lib/match-order.ts`:**
  1. Primero los partidos con `fecha_hora >= ahora`, del más cercano al más lejano.
  2. Después los pasados, del más reciente al más antiguo.
  3. A igual fecha, el id menor primero.

  T-08, T-19 y T-21 usan el mismo `proximityOrderBy`. El índice `idx_partido_fecha_hora` sirve para los rangos.

**Decisiones**

- **Alta:** siempre en `programado`, con las dos filas de `partido_equipo` (goles `NULL`) en la misma transacción.
  - Equipo repetido: 400 `SAME_TEAM`.
  - Equipo de otra competición: 409 `COMPETITION_MISMATCH`, con `details.lado`.
  - Equipo o competición inexistente: 404.
  - **No se crean partidos en el pasado** (400 `MATCH_DATE_IN_PAST`): nunca podrían recibir apuestas (BR-014), quedarían `programado` atrás del calendario, y cargar resultados históricos no es parte de las reglas. Si hace falta, se agrega una importación aparte.
- **Estados (BR-012)**, solo con `POST /:id/estado`:
  - `programado` → `en_curso`: solo cuando ya cerraron las apuestas (`ahora >= fechaHora − 24 h`). Antes, la ventana de apuestas terminaría antes de lo que dice BR-014; en ese caso primero hay que cambiar la fecha.
  - `en_curso` → `programado`: para deshacer un inicio por error o un partido suspendido, mientras no tenga goles. Las apuestas siguen cerradas, salvo que después se postergue la fecha más de 24 h.
  - `finalizado` solo llega por T-12 y `cancelado` solo por T-16. Cualquier otra transición, incluida la que no cambia nada, da 409 `INVALID_STATE_TRANSITION`.
- **Edición (BR-011):**
  - `finalizado` o `cancelado`: 409 `MATCH_LOCKED`.
  - La jornada y la sede cambian siempre.
  - La competición, los equipos y la fecha solo con el partido `programado` (409 `MATCH_NOT_PROGRAMMED`).
  - **Con apuestas:** los equipos y la competición no cambian (409 `MATCH_HAS_BETS`), y la fecha **solo se posterga**.
    - Adelantarla correría el cierre por delante de apuestas hechas con el cierre anterior: 409.
    - Postergarla mueve el cierre más tarde: las apuestas existentes siguen vigentes y se puede volver a apostar hasta el nuevo cierre. Queda precisado en BR-014.
  - Sin apuestas, la fecha se mueve en cualquier sentido, siempre hacia el futuro.
  - Cambiar la competición exige mandar equipos de esa competición. Las dos filas de `partido_equipo` se borran y se recrean, porque su FK compuesta apunta a `(partido.id, competicion_id)`. También se rechaza si hay goles.
  - Los goles no se escriben aquí: `goles` o `estado` en el body dan 400.
- **Borrado:** solo si no está `finalizado` (409 `MATCH_LOCKED`) y no tiene apuestas (409 `MATCH_HAS_BETS`) ni goles (409 `MATCH_HAS_GOALS`). Sus dos filas se borran en la misma transacción. Un `cancelado` sin apuestas se puede borrar.
- **Concurrencia:** toda escritura bloquea la fila del partido (`FOR UPDATE`), así que dos ediciones simultáneas se aplican una después de la otra. T-09 y T-10 tienen que bloquearla también al crear apuestas (nota en el plan).
- **Sin acoplar módulos:** las apuestas de un partido se cuentan con `MatchBetsProbe`, un punto de extensión que `services/matches.service.ts` declara y el módulo Polla implementa en `services/bets-match-probe.service.ts`. `routes/index.ts` los conecta, igual que `DrawRuleGuard` en T-06.
- **Auditoría (T-17):** `crear_partido`, `editar_partido`, `cambiar_estado_partido` y `borrar_partido` pasan por `runAdminAction` con `before` y `after`. NFR-006 exige auditar la modificación de partidos.

## API pública (T-08)

Solo lectura y **sin sesión**, bajo `/public` (se eligió `/public` porque el resto de la API tampoco lleva prefijo `/api`). Es 100 % Módulo Informativo (`services/public.service.ts`, `routes/public.route.ts`): lee deporte, competición, equipo, jugador, plantel, partido, partido_equipo, estado_partido y gol, y nada de usuarios, sesiones, monedas, apuestas ni auditoría. Una prueba revisa sus imports y otra, las claves de cada respuesta.

| Ruta | Respuesta |
|---|---|
| `GET /public/deportes` | `[{ id, nombre, slug, permiteEmpate }]`, por nombre (lista corta, sin paginar). |
| `GET /public/competiciones?deporteId=` | Paginado: `{ id, nombre, slug, deporte }`, por deporte y nombre. |
| `GET /public/competiciones/:id` | Una competición con su deporte. |
| `GET /public/competiciones/:id/equipos` | `[equipo]` de esa competición, por nombre (sin paginar: la competición la acota). |
| `GET /public/competiciones/:id/posiciones` | `{ competicion, filas: [{ posicion, equipo, jugados, ganados, empatados, perdidos, golesAFavor, golesEnContra, diferencia, puntos }] }` (BR-050). |
| `GET /public/partidos` | Fixture paginado (BR-049), en orden de proximidad (BR-013, `lib/match-order.ts`). Filtros: `deporteId`, `competicionId`, `equipoId`, `estado`, `jornada`, `desde`, `hasta`. |
| `GET /public/partidos/:id` | Un partido y `goles: [{ id, minuto, equipoId, jugador: { id, nombre, foto }, imagen, video }]`, por minuto. `null` si no está finalizado. |
| `GET /public/equipos/:id` | Un equipo con `competicion`, `deporte` y `plantel: [{ jugadorId, nombre, foto, numeroCamiseta }]`, por número. |

Formas comunes:

- **`equipo`:** `{ id, competicionId, nombre, nombreCorto, escudo, colorAcento }`.
- **`partido`:** `{ id, competicion: { id, nombre, slug }, deporte, jornada, fechaHora, estado, sede, local: { equipo, goles }, visita: { equipo, goles } }`.
- Las fechas van en ISO 8601 UTC (`...Z`).

**Decisiones**

- **Goles y marcador**: solo si el partido está `finalizado`; antes, `goles` es `null` en los dos lados y en el detalle. T-12 puede cargar goles antes de confirmar y no deben verse.
  - **Marcador entero o nada**: si un partido `finalizado` tiene cargado un solo lado, los dos `goles` son `null` (en el fixture, el detalle y el filtro por equipo) y el detalle trae `goles: null`. La tabla tampoco lo cuenta (BR-049 y BR-050).
- **Partidos cancelados**: se muestran, con `estado: "cancelado"`. Ocultarlos haría desaparecer un partido anunciado sin explicación; la UI decide cómo marcarlos. Tampoco tienen marcador.
- **Tabla de posiciones** (BR-050, precisada en business-rules.md):
  - Se calcula en cada pedido y no se guarda. Solo cuentan partidos `finalizado` con los dos goles cargados; 3/1/0 (`lib/standings.ts`).
  - Están todos los equipos de la competición, con ceros si no jugaron.
  - **Orden total:** puntos, diferencia, goles a favor, nombre (la collation: sin mayúsculas ni acentos), id. Por eso las posiciones son siempre 1..n, sin compartir.
  - Los goles son `UNSIGNED` en la base: se convierten a `SIGNED` antes de restar.
- **Paginación**: el fixture y las competiciones van paginados (crecen con el tiempo). Deportes, equipos de una competición, tabla y plantel no, porque están acotados.
- **Rate limit propio**: 120 pedidos por minuto por IP por defecto (`PUBLIC_RATE_LIMIT_*`), y el límite general no cuenta estas rutas. Una visita a la landing hace varios pedidos (fixture, tabla, equipo), todo es de lectura, barato y cacheable, y un visitante que navega no debe gastar el cupo de 100 cada 15 minutos pensado para cuentas y admin. Sigue acotado por IP.
- **Caché**:
  - Las respuestas exitosas de `/public` llevan `Cache-Control: public, max-age=30`: son iguales para todos y no tienen nada privado, y 30 s es corto porque los resultados cambian en día de partido.
  - Todo el resto de la API responde `no-store`, y cualquier error, incluso en `/public`, también (`error-handler.ts`). El `no-store` por defecto es el **primer** middleware de `app.ts`, antes de helmet, los rate limits y el CSRF, así que también cubre sus respuestas (un 429 del límite general nunca se cachea).
  - Con o sin sesión, la respuesta pública es idéntica y no envía cookies.
- **CORS**: el mismo de toda la API. Solo `GET`: cualquier otro método en `/public` es 404.
- **Validación**: query estricta en todas las rutas (un parámetro desconocido da 400) e ids solo numéricos.
- **`%` mal codificado en `:id`**: el router de Express lanza un `URIError` con `status: 400` y el mensaje `Failed to decode param '...'` antes de llegar al handler. `error-handler.ts` reconoce exactamente ese caso (las tres condiciones) y responde 400 `INVALID_URL_ENCODING` sin loguear, en todas las rutas con parámetros, públicas y de admin. Cualquier otro `URIError` sigue siendo un 500 logueado. En admin, sin sesión, el 401 sale primero.
- **Índices (revisado con `EXPLAIN` sobre 20 competiciones, 400 equipos y 3800 partidos)**:
  - Por competición, el fixture usa `fk_partido_competicion`; por rango de fechas, `idx_partido_fecha_hora`.
  - Por deporte, se filtra con `p.competicion_id IN (SELECT id FROM competicion WHERE deporte_id = ?)`, que usa `uq_competicion_deporte_slug` y después `fk_partido_competicion`. Con pocos deportes, cada uno abarca una parte grande de los partidos (con 4, cerca del 25 %), y MySQL puede preferir recorrer la tabla por costo, como en el fixture sin filtros (con 20 deportes usa los índices). Un índice propio necesitaría `deporte_id` en `partido`, que el esquema no duplica. Se aplicó también en `/admin/partidos`.
  - Por jornada sola, usa `idx_partido_jornada` (nuevo en la corrección de T-08; antes recorría los 3800 partidos, ahora lee unos 100).
  - Por equipo, se filtra con `p.id IN (SELECT partido_id FROM partido_equipo WHERE equipo_id = ?)`, que usa el índice por equipo de `partido_equipo`. La versión anterior (`l.equipo_id = ? OR v.equipo_id = ?`) recorría la tabla; se corrigió también en `/admin/partidos`.
  - La tabla de posiciones usa `fk_equipo_competicion`, ese mismo índice por equipo y `uq_partido_equipo_lado`.
  - El fixture **sin filtros** recorre los partidos y los ordena en memoria: el orden por proximidad es una expresión y no puede salir de un índice. Con el volumen previsto no pesa; si algún día hiciera falta, se partiría en dos consultas (próximos y pasados), cada una por `idx_partido_fecha_hora`.
  - `/admin/partidos` sin filtros también recorre la tabla, por el mismo motivo.

### Contrato para T-22 (mapeo a `src/types`)

`src/lib` puede mapear estas respuestas sin cambiar la UI. Diferencias a resolver en el mapeo:

| Tipo del front | De la API | Diferencias |
|---|---|---|
| `Team` | `equipo` | `id` es numérico: convertir con `String(id)` (las rutas usan el id numérico, decisión del usuario). `name` es `nombre`, `shortName` es `nombreCorto` y `accent` es `colorAcento`. **`country` no existe** en el esquema. **`crest`** es un `PixelImageSet` generado al compilar, y la API da `escudo` (una URL o ruta): `<PixelImage>` necesita aceptar una imagen remota o un `PixelImageSet` armado con esa URL (mostrarla solo con `<img>`). |
| `Match` / `ResolvedMatch` | `partido` | `id` pasa a texto. `matchday` es `jornada`, `kickoff` es `fechaHora` (ISO en UTC, con `Z` en vez de `-05:00`) y `venue` es `sede`. `homeTeamId`/`homeTeam` salen de `local.equipo`, y `awayTeam` de `visita.equipo` (ya vienen resueltos). **`status`**: `programado` → `scheduled`, `en_curso` → `live`, `finalizado` → `finished`; **`cancelado` no existe en el front** (agregar un estado o mostrarlo aparte). **`score`** es `{ home: local.goles, away: visita.goles }` solo si los dos no son `null`: la API solo los da en `finalizado`, no mientras está en curso. La API trae además `competicion` y `deporte` (filtro de BR-048). |
| `Matchday` | agrupar `partido` por `jornada` | Igual que hoy. `?jornada=` sirve para pedir una sola. El orden de la API es por proximidad, no por jornada. |
| `Standing` / `ResolvedStanding` | `filas[]` | `played` es `jugados`, `won` es `ganados`, `drawn` es `empatados`, `lost` es `perdidos`, `goalsFor` es `golesAFavor`, `goalsAgainst` es `golesEnContra` y `points` es `puntos`. `position` ya viene como `posicion`, y `team` como `equipo`. `src/lib/standings.ts` deja de calcular; la API también da `diferencia`. |
| `Player` | `plantel[]` de `/public/equipos/:id` | `id` sale de `jugadorId` (a texto), `teamId` del equipo pedido y `name` de `nombre`. La API trae además `foto`. |
| `SquadPlacement` | `plantel[].numeroCamiseta` | `shirtNumber` es `numeroCamiseta`. **`x`, `y` no existen** (la ubicación en la cancha es de muestra): el front las sigue generando o guardando aparte. **No hay "posición"** del jugador en el esquema. |
| `PlayerStats` | — | Siguen siendo datos aleatorios del front (CLAUDE.md); la API no los tiene. |

## Selecciones y cierre (T-09)

Módulo Polla (`services/betting.service.ts`, `routes/betting.route.ts`, `schemas/betting.schema.ts`). Valida selecciones y muestra lo que el apostador necesita para armar su ticket. **No crea tickets ni descuenta monedas**: eso es T-10. Lee partidos y deportes de Informativo (reutiliza `MATCH_COLUMNS`, `MATCH_FROM` y `matchFrom` de `public.service.ts`). Ningún archivo de Informativo importa Polla; hay una prueba que lo revisa.

Las dos rutas usan `requireAuth, requireBettor`: sin sesión, 401. Un `pendiente` recibe 403 `USER_NOT_VALIDATED`, y un admin 403 `ADMIN_CANNOT_BET` aunque figure validado. Las respuestas son `no-store`.

| Ruta | Respuesta |
|---|---|
| `GET /apuestas/partidos` | Paginado, en orden de proximidad (BR-013). Cada partido tiene la forma de `/public/partidos`, más `apuesta: { estado, cierre, pronosticosAdmitidos }`. Filtros: `deporteId`, `competicionId`, `desde`, `hasta` (BR-051) y `estadoApuesta`. |
| `POST /apuestas/vista-previa` | Body `{ selecciones: [...] }`. Devuelve la evaluación del ticket (BR-023), sin escribir nada. Lleva CSRF como todo POST y no acepta query. |

**Estado de apuesta (BR-052, `lib/betting.ts` `bettingState`)**: `disponible` (programado y antes del cierre), `cerrada` (programado y con el cierre ya pasado), `en_curso`, `finalizado` o `cancelado`. Solo `disponible` acepta selecciones.

**Cierre (BR-014)**: `cierre = fechaHora - HORAS_CIERRE_APUESTAS`. `isBeforeBettingClose(fechaHora, ahora)` (`ahora < cierre`) es la única comparación, y la usan T-07 (para pasar a `en_curso`) y T-09. El instante exacto del cierre ya está cerrado. En SQL, el filtro `estadoApuesta` usa `fecha_hora > openKickoffsAfter(ahora)`, que trunca al segundo para dar exactamente el mismo resultado (las fechas se guardan en segundos enteros).

**`pronosticosAdmitidos`** (según el deporte, aunque el partido ya no esté disponible):

```json
{ "resultadoGeneral": ["local_gana", "empate", "visitante_gana"],
  "marcadorExacto": { "golesMinimos": 0, "golesMaximos": 999, "admiteEmpate": true } }
```

En un deporte sin empate, `resultadoGeneral` no trae `empate` y `admiteEmpate` es `false`.

**Selección** (la forma se valida con zod estricto; un error es 400 `VALIDATION_ERROR`):

```json
{ "partidoId": 12, "tipo": "resultado_general", "pronostico": "local_gana" }
{ "partidoId": 12, "tipo": "marcador_exacto", "golesLocal": 2, "golesVisitante": 1 }
```

- `tipo` y `pronostico` usan los `codigo` de `tipo_apuesta` y `resultado_general`. Cada tipo tiene sus campos y ningún otro: un marcador con `pronostico`, o al revés, da 400.
- Los goles son enteros de 0 a `MAX_GOLES_PRONOSTICO` (999). Nada de texto ni decimales.
- La lista va de 1 a `MAX_SELECCIONES_POR_TICKET` (50) selecciones.

**Respuesta de la vista previa** (`TicketEvaluation`):

```json
{ "valido": false,
  "selecciones": [
    { "indice": 0, "partidoId": 12, "tipo": "resultado_general", "pronostico": "empate",
      "golesLocal": null, "golesVisitante": null, "costo": 1, "valida": false,
      "errores": [{ "code": "DRAW_NOT_ALLOWED", "message": "..." }],
      "repiteA": null, "partido": { "...": "igual que en /apuestas/partidos" } } ],
  "cantidadSelecciones": 1, "costoPorSeleccion": 1, "costoTotal": 1,
  "saldoActual": 0, "saldoPosterior": -1, "saldoSuficiente": false,
  "errores": [{ "code": "INSUFFICIENT_BALANCE", "message": "..." }] }
```

**Decisiones**

- **Errores por selección**: los problemas que dependen de la base no son un 4xx, sino que van en `errores` de cada selección (todos a la vez), con `valida: false`. Así la UI marca cuál corregir sin perder el resto. Códigos: `MATCH_NOT_FOUND`, `BETTING_CLOSED`, `MATCH_NOT_PROGRAMMED` (en curso, finalizado o cancelado; `partido.apuesta.estado` dice cuál) y `DRAW_NOT_ALLOWED`. El saldo insuficiente es un error del ticket (`errores` de arriba, `INSUFFICIENT_BALANCE`). `valido` es `true` solo si todo está bien: es lo que T-10 exigirá para confirmar. La forma inválida sí es 400.
- **Empate (BR-015)**: en un deporte sin empate se rechaza `pronostico: "empate"` y también un marcador exacto empatado (es el mismo pronóstico). No se ofrece en `pronosticosAdmitidos`.
- **Repetir la misma selección**: se permite, y cada repetición cuesta su moneda. Ninguna BR lo prohíbe y BR-017 permite varias apuestas por partido. `repiteA` indica el `indice` de la primera selección idéntica, para que la UI pida confirmación.
- **Máximo de goles**: 999 por lado. Alcanza para básquet y queda lejos del `SMALLINT UNSIGNED` de la columna.
- **Máximo de selecciones por ticket**: 50 (BR-019 precisado). Con 10 monedas iniciales alcanza de sobra, y acota el trabajo de una sola petición.
- **Costo (BR-020)**: `costoTotal = cantidadSelecciones × COSTO_POR_SELECCION` (`lib/coins.ts`), también con selecciones inválidas: es el costo del ticket tal como se envió. `saldoPosterior = saldoActual - costoTotal`, y puede ser negativo si no alcanza (BR-021).
- **Sin escritura**: la vista previa no escribe ni bloquea nada. Su resultado puede quedar viejo al instante; T-10 vuelve a validar.

**Para T-10**: `evaluateTicketInTransaction(conn, usuarioId, selecciones)` hace las mismas comprobaciones dentro del `withTransaction` de la confirmación. Con una conexión que no es de una transacción, rechaza la promesa (igual que las funciones de monedas).

- Llamarla primero en la transacción. Sigue el orden de bloqueo de la aplicación (ver "Orden de bloqueo y concurrencia"): usuario `FOR UPDATE`, y después partidos, competiciones y deportes `FOR SHARE`, cada tabla con su propia sentencia por clave primaria.
- El usuario va `FOR UPDATE` desde el principio porque el débito posterior (`debitSelections`) usa ese mismo bloqueo. Así no se pasa de un bloqueo compartido a uno exclusivo, que haría chocar dos tickets.
- `updateMatch` y `changeMatchState` (`FOR UPDATE` del partido), `updateCompetition` y `updateSport` (`FOR UPDATE` de su fila) esperan hasta el commit. Dos tickets sobre el mismo partido no se bloquean entre sí.
- Estado, fecha y `permite_empate` salen de lecturas con bloqueo, que siempre ven lo último confirmado. Una lectura común podría ver la foto vieja de la transacción y no ver un cambio que se confirmó mientras esperaba el bloqueo.
- T-10 confirma solo si `valido` es `true`.

## Orden de bloqueo y concurrencia (corrección de T-09)

**Problema que se corrigió.** La evaluación del ticket bloqueaba con una sola consulta con JOIN (`... WHERE p.id IN (?) ORDER BY p.id FOR SHARE OF p, d`). Esa consulta no tiene un plan fijo: según las estadísticas, MySQL entraba por `estado_partido` y tomaba next-key locks sobre el índice `fk_partido_estado` (todos los partidos de ese estado, más el supremum). El `UPDATE partido SET estado_partido_id` de `changeMatchState` necesita modificar ese índice, y se formaba un ciclo: el tester vio 6 deadlocks en 8 rondas. `ORDER BY p.id` no fija el orden en que se toman los bloqueos.

**Reglas para toda transacción que bloquee:**

1. **Una sentencia por tabla, por clave primaria**: `SELECT id FROM <tabla> FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR UPDATE` (o `FOR SHARE`). Nunca bloquear con un JOIN ni por un índice secundario: su plan puede cambiar y bloquear otras filas, rangos o índices.
2. **Orden fijo entre tablas**: usuario → partido → plantel → equipo → jugador → competición → deporte. Dentro de una tabla, por id ascendente. Una transacción puede saltarse tablas, pero nunca volver a una anterior.
3. **Datos después de bloquear**: lo que decide una regla se lee con una lectura con bloqueo (o de la fila que devolvió el bloqueo), no con una lectura común tomada antes.
4. Las comprobaciones que solo cuentan (apuestas o goles de un partido, partidos de un deporte) son lecturas sin bloqueo: no entran en el ciclo.

Cómo lo cumple cada escritura:

| Acción | Bloqueos, en orden |
|---|---|
| Ticket (T-09, y T-10 después) | usuario X → partidos S → competiciones S → deportes S (`lockAndReadMatches`) |
| Monedas (T-05) | usuario X (`applyCoinMovements`, sentencia simple; el rol se lee después) |
| Participantes (T-04) | usuario X (UPDATE condicional por id) |
| `updateMatch`, `changeMatchState`, `deleteMatch` (T-07) | partido X → (si cambian los equipos) equipos S → competición S (`checkTeams`) |
| `createMatch` | equipos S → competición S |
| Plantel (T-06) | plantel X, o equipo S al crear |
| `updateTeam`, `updateCompetition`, `updateSport`, jugador (T-06) | su propia fila X |

Las claves foráneas también toman bloqueos compartidos sobre la fila padre al insertar o actualizar (por ejemplo, `competicion` → `deporte`). Esos bloqueos van siempre hacia una tabla posterior en el orden, así que no forman ciclos.

**Reintento (`db/transaction.ts`).**

- Si MySQL elige una transacción como víctima de un deadlock (1213), `withTransaction` la deshace y la vuelve a correr entera, hasta `MAX_TRANSACTION_ATTEMPTS` (3) veces, con una espera corta al azar entre intentos. Por eso el trabajo de una transacción solo debe tocar la base: nada de correos ni archivos.
- Si el deadlock persiste, se registra un aviso y la respuesta es 409 `CONCURRENT_UPDATE` (`lib/db-errors.ts`), nunca un 500.
- Una espera de bloqueo vencida (1205) no se reintenta, porque ya esperó `innodb_lock_wait_timeout`: responde 409 `CONCURRENT_UPDATE` directamente.
- `transactionStats` cuenta los reintentos y los deadlocks que no se pudieron resolver.

**Pruebas:**

- `tests/transaction-retry.test.ts`: el reintento con un deadlock simulado y con uno real entre dos transacciones, el límite de intentos, que 1205 y otros errores no se reintentan, y que la respuesta es 409, sin 500 y sin log de error.
- `tests/betting.test.ts`: lee `performance_schema.data_locks` (como root) y exige que el ticket tome **solo** bloqueos de registro en PRIMARY: usuario X, y sus partidos, competiciones y deportes S. No debe haber bloqueos en índices secundarios ni de hueco, sea cual sea el plan. La versión anterior falla esta prueba.
- `tests/concurrency-stress.test.ts` (unos 15 s): 25 rondas sobre unos 50 partidos.
  - En cada ronda corren en paralelo 3 tickets (uno apuesta de verdad como hará T-10, otro es rechazado y otro solo evalúa) y las acciones del admin: postergar, adelantar, pasar a `en_curso` y volver, y cambiar `permite_empate`. Los tickets incluyen los partidos que el admin toca en esa ronda.
  - Exige cero deadlocks (ni siquiera uno absorbido por el reintento), ningún 500, ningún `CONCURRENT_UPDATE` y saldos coherentes. Con root, revisa además que el último deadlock de `SHOW ENGINE INNODB STATUS` no sea de la base de pruebas.
  - Con el plan del tester forzado en la consulta vieja, esta prueba detectó entre 10 y 19 deadlocks por corrida (todos resueltos por el reintento, sin 500).
  - Para correrla sola varias veces: `npx vitest run tests/concurrency-stress.test.ts`.

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

Opcionales de T-08: `PUBLIC_RATE_LIMIT_WINDOW_MS` (60000) y `PUBLIC_RATE_LIMIT_MAX` (120), el límite propio de `/public`.

Máximos (corrección de T-08): toda `*_WINDOW_MS` es como mucho 2147483647 ms (unos 24 días). Un valor mayor desborda el temporizador de Node, que se dispara enseguida y apaga el límite. Toda `*_RATE_LIMIT_MAX` es como mucho 1000000. `PORT` y `DB_PORT` van de 1 a 65535, `DB_POOL_SIZE` hasta 1000 y `SESSION_TTL_HOURS` hasta 720. Fuera de rango, el proceso no arranca.

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
