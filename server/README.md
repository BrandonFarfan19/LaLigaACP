# La Liga ACP — backend

API REST en **Express + TypeScript** sobre el MySQL de `../compose.yaml`, construida tarea por tarea según [../docs/plan-polla.md](../docs/plan-polla.md). Hoy tiene la base (T-02), el registro, login y roles (T-03), la validación de participantes (T-04), el saldo y los movimientos de monedas (T-05), la administración del catálogo deportivo (T-06), la de partidos (T-07), la API pública informativa (T-08), las selecciones, los tickets y el historial de apuestas (T-09 a T-11), los resultados (T-12), los goles y la multimedia (T-13), la liquidación de apuestas con sus puntos (T-14), el ranking de la polla con sus estadísticas (T-15), la cancelación de partidos con sus devoluciones (T-16), la auditoría de las acciones del admin (T-17) y la consulta de apuestas del panel (T-21). Es la API completa de la polla: el front la consume entera (cuentas y apuestas desde T-18 a T-21, y las pantallas públicas desde T-22).

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
| `RATE_LIMITED` | 429 | Se superó un límite de peticiones. `details.limite` dice cuál: `general`, `publico`, `sesion` (`GET /auth/me`), `ingreso`, `registro` o `subidas` (corrección de T-18). Siempre con `Cache-Control: no-store` y `Retry-After` |
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
| `RESULT_NOT_ALLOWED_YET` | 409 | Cargar el resultado de un partido programado que todavía no empezó |
| `RESULT_INCOMPLETE` | 409 | Confirmar sin los goles de los dos equipos |
| `MATCH_NOT_ENDED` | 409 | Confirmar el resultado antes de los 60 minutos desde el inicio (T-13) |
| `MATCH_NOT_STARTED` | 409 | Agregar multimedia a un partido que todavía no empezó |
| `MATCH_HAS_MEDIA` | 409 | Borrar un partido con imágenes o videos |
| `GOAL_NOT_FOUND` | 404 | Gol inexistente o de otro partido |
| `TEAM_NOT_IN_MATCH` | 409 | Un gol para un equipo que no juega el partido |
| `PLAYER_NOT_IN_TEAM` | 409 | Un gol de un jugador que no está inscrito en ese equipo y competición |
| `GOALS_EXCEED_SCORE` | 409 | Más goles con autor que los del marcador de ese lado |
| `SCORE_BELOW_GOALS` | 409 | Corregir el marcador por debajo de los goles con autor |
| `MEDIA_NOT_FOUND` | 404 | Imagen o video inexistente (o un gol sin imagen o video que quitar) |
| `MEDIA_LIMIT_REACHED` | 409 | Más de 20 imágenes o 10 videos en un partido |
| `VIDEO_ALREADY_ADDED` | 409 | El mismo video dos veces en un partido |
| `MATCH_ALREADY_FINISHED` | 409 | Cancelar un partido con el resultado ya confirmado (T-16); `details.estado` |
| `MATCH_ALREADY_CANCELLED` | 409 | Cancelar un partido ya cancelado (T-16); `details.estado` |
| `IMAGE_INVALID` | 400 | El archivo no es una imagen aceptada, está dañado o supera el máximo de píxeles |
| `UPLOAD_INVALID` | 400 | El envío multipart no trae exactamente un archivo en el campo `imagen` |
| `FILE_NOT_FOUND` | 404 | Imagen inexistente, sin fila o todavía no pública |
| `GOALS_UNATTRIBUTED` | — | Solo como aviso en la vista previa del resultado |
| `RESULT_ALREADY_CONFIRMED` | 409 | Cargar o confirmar el resultado de un partido ya finalizado |
| `RESULT_CHANGED` | 409 | Confirmar un marcador distinto del cargado (se corrigió después de la vista previa); `details` trae el actual |
| `MATCH_HAS_RESULT` | 409 | Borrar un partido con un resultado cargado |
| `BETTING_CLOSED` | — | Solo por selección, en la vista previa del ticket: el partido está programado pero ya pasó su cierre (BR-014). Trae `cierre` (UTC) en un campo aparte; el mensaje no incluye la fecha |
| `DRAW_NOT_ALLOWED` | — / 409 | Por selección: empate (o marcador exacto empatado) en un deporte sin empate (BR-015). 409 al confirmar un resultado empatado en ese deporte (T-12) |
| `TICKET_REJECTED` | 409 | Confirmar un ticket con alguna selección inválida o sin saldo. `details` trae la evaluación completa, con la misma forma que la vista previa. No se escribe nada |
| `TICKET_NOT_FOUND` | 404 | Ticket inexistente o de otra persona (la misma respuesta en los dos casos) |
| `IDEMPOTENCY_KEY_INVALID` | 400 | Falta el header `Idempotency-Key` al confirmar, o no es un UUID |
| `IDEMPOTENCY_KEY_REUSED` | 409 | La misma `Idempotency-Key` ya creó un ticket con otras selecciones; `details.ticketId` |
| `CONCURRENT_UPDATE` | 409 | Otra transacción bloqueaba los mismos datos: un deadlock que siguió después de los reintentos, o una espera de bloqueo vencida (MySQL 1213 y 1205). Se puede reintentar |
| `DUPLICATE_ENTRY`, `RESOURCE_IN_USE`, `INVALID_REFERENCE` | 409 | Violación de un índice o FK de MySQL sin traducción específica (`lib/db-errors.ts`) |
| `ADMIN_CANNOT_BET` | 403 | Un administrador en una ruta de apuestas |
| `DATABASE_UNAVAILABLE` | 503 | La base no responde (`/health`) |
| `INTERNAL_ERROR` | 500 | Error inesperado; la causa real solo va al log |

Un error con `expose: true` y status 4xx (lo que lanza `express.json()` ante un body inválido, tenga o no `type`) es del cliente: conserva su status, no se loguea y nunca devuelve el mensaje original del parser. Un error 5xx o sin `expose` siempre es `INTERNAL_ERROR`.

El limitador corre **antes** de `express.json()` (un body inválido también cuenta) y no cuenta `GET /health`, con el mismo criterio que usa la ruta: sin distinguir mayúsculas y con o sin barra final (`/HEALTH`, `/health/`).

**Parámetros de query inesperados.** Ninguna ruta de `/auth` ni de `/admin` ignora en silencio un parámetro que no entiende: responde 400 `VALIDATION_ERROR`, sin efectos. Una ruta sin parámetros usa `rejectQueryParams` (`middleware/no-query.ts`). Va después de `requireAuth`, para que sin sesión siga saliendo 401, y **antes** de los límites de login y de registro: una petición rechazada por su query no cuenta como intento fallido ni gasta el cupo de registros (el límite general sí la cuenta, como a cualquier petición). Una ruta con parámetros los valida con un `z.strictObject`. Los `:params` de la URL también pasan por zod. `/health` queda afuera a propósito: los monitores suelen agregar parámetros para evitar cachés.

**Nota para el front (T-18).** El front llama a esta API en su mismo origen, bajo `/api`, y un proxy (el de Vite en desarrollo, uno inverso en producción) quita el prefijo (D-006, README de la raíz). Las rutas del backend no llevan `/api`. `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout` y las rutas de `/admin` sin parámetros no aceptan query string: responden 400. Un `?next=` (o cualquier otro parámetro) de la URL de la **página** del front se usa en el front y **no se reenvía** a la URL de la API.

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
| `GET /auth/me` | sesión, límite propio (D-009) | 200 `{ user, csrfToken }` |
| `POST /auth/logout` | sesión + CSRF | 200 `{ data: null }`, borra la sesión y la cookie |
| `GET /admin/sesion` | sesión + rol `admin` | 200. Solo confirma la protección. |

`user` es `{ id, nombre, email, rol, estadoValidacion, estadoPago, saldoMonedas, creadoEn }`. Nunca incluye el hash.

**Decisiones**

- **Se entra con el correo** (BR-003/BR-004, EsquemaBD D17). No hay nombre de usuario: el correo ya es único y el admin lo necesita para contactar al inscrito. Se guarda recortado y en minúsculas. `nombre` solo se muestra.
- **Registro:** siempre crea `apostador`, `pendiente`, pago `pendiente` y 0 monedas; las 10 llegan al validar (T-04). Cualquier campo extra del body (`rol`, `saldoMonedas`...) se ignora. **Contraseña de 6 a 20 caracteres y nada más** (BR-003, C-01): no se exigen mayúsculas, números ni símbolos, y los espacios, los acentos y los emoji se pueden usar. Se cuentan **caracteres** (puntos de código, no unidades UTF-16): un emoji simple cuenta uno, pero uno compuesto —una familia unida con ZWJ, una bandera— cuenta tantos como lo forman, igual que una letra con una tilde combinante aparte. Los dos mensajes son "La contraseña es muy corta…" y "La contraseña es muy larga…". `admin:create` usa exactamente la misma regla (`newPasswordSchema`). El nombre sigue las reglas de los nombres del catálogo (D-011, `displayName`): de 1 a 100 caracteres, al menos una letra o un número y sin caracteres de control ni invisibles; lo mismo vale para `ADMIN_NOMBRE`. Correo repetido: 409 `EMAIL_TAKEN` (revelar que existe es inevitable al registrarse; el login no lo revela).
- **Contraseñas con argon2id** (`lib/password.ts`), la primera opción de OWASP, con su perfil mínimo recomendado: 19 MiB, 2 iteraciones, 1 hilo (~25 ms por hash). Es resistente a GPU por el uso de memoria, a diferencia de bcrypt, que además corta la contraseña en 72 bytes. Los parámetros viajan dentro del hash, así que subirlos más adelante no rompe los hashes viejos.
- **Login sin fugas:** correo inexistente y contraseña incorrecta dan exactamente el mismo 401 `INVALID_CREDENTIALS`. Con un correo inexistente igual se verifica un hash de relleno, para que ambos casos tarden lo mismo.
- **El login no aplica la regla de 6 a 20** (D-024, C-01): una cuenta creada antes del cambio puede tener una contraseña más larga y tiene que poder entrar, y rechazar por longitud daría una pista sobre lo guardado. Solo hay un tope técnico alto, `PASSWORD_VERIFY_MAX_LENGTH` (128 en `lib/password.ts`), para no gastar CPU con entradas enormes: por encima de él no se verifica contra el hash guardado, pero igual se verifica el de relleno y la respuesta es el **mismo** 401 `INVALID_CREDENTIALS`, con el mismo mensaje y el mismo tiempo. Lo que puede llegar ya está acotado por el límite de 100 kb del cuerpo.
- **Límite de login** (`middleware/auth-rate-limits.ts`): 5 intentos **fallidos** cada 15 minutos por IP + correo; los exitosos no cuentan. Por IP + correo para que un ataque a una cuenta no deje sin acceso a toda una oficina detrás de la misma IP; probar muchos correos desde una IP lo frena el límite general.
- **Lectura de la sesión** (D-009, corrección de T-18): `GET /auth/me` no cuenta en el límite general y tiene uno propio, `SESSION_READ_RATE_LIMIT_MAX` por `SESSION_READ_RATE_LIMIT_WINDOW_MS` por IP (120 por minuto por defecto; `sessionReadRateLimit` en `middleware/security.ts`), con o sin sesión. El front la lee en cada página protegida: con el límite general (100 cada 15 minutos) unas pocas personas navegando detrás de una misma IP bloqueaban todo lo demás. Otros métodos sobre esa ruta siguen en el límite general.
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

**El comando no es el mismo en desarrollo que en producción**, porque las dos imágenes son distintas: la de desarrollo (`Dockerfile`) monta `src/` y tiene `tsx`; la de producción (`Dockerfile.prod`) lleva solo `dist/` compilado y **no tiene ni `tsx` ni `src/`**, así que ahí `npm run admin:create` falla.

```sh
# ---- PRODUCCIÓN (compose.prod.yaml, imagen Dockerfile.prod) ----
# Ojo al -f y a que se invoca el .js compilado, no el script de npm.
docker compose -f compose.prod.yaml exec -it \
  -e ADMIN_EMAIL=ana@liga.test -e ADMIN_NOMBRE=Ana \
  server node dist/cli/create-admin.js

# ---- DESARROLLO (compose.yaml, imagen Dockerfile) ----
# -it da la terminal donde se escribe la clave.
docker compose exec -it -e ADMIN_EMAIL=ana@liga.test -e ADMIN_NOMBRE=Ana server npm run admin:create

# ---- DESARROLLO, fuera de Docker, desde la raíz (bash) ----
ADMIN_EMAIL=ana@liga.test ADMIN_NOMBRE=Ana npm run server:admin:create

# ---- DESARROLLO, fuera de Docker, desde la raíz (PowerShell) ----
$env:ADMIN_EMAIL='ana@liga.test'; $env:ADMIN_NOMBRE='Ana'; npm run server:admin:create
```

Lo mismo vale para los otros dos comandos: en producción son `node dist/cli/coins-check.js` y `node dist/cli/seed-dev.js` (este último, de todos modos, se niega a correr fuera de desarrollo). Todo lo que sigue —reglas, auditoría, contraseña sin eco, fuentes sin terminal— es igual en los dos casos: solo cambia cómo se invoca.

- Correo y nombre sí pueden ir en la línea de comandos: no son secretos.
- **Queda en la auditoría** (D-005, corrección de T-17): crear un administrador deja un registro `creacion_administrador` y promoverlo, uno `promocion_administrador`. Se escriben en la misma transacción que el cambio, con la propia cuenta como autor y como registro afectado (el comando no tiene un admin detrás), y con el detalle `{ origen: "comando admin:create", operacion }`. Nunca guardan la contraseña. Si la cuenta ya era admin no cambia nada y no registra; si el registro falla, la cuenta no se crea ni se promueve.
- Si el correo ya tiene cuenta, basta `ADMIN_EMAIL`: la promueve a `admin` sin pedir contraseña y sin tocar la que tiene. Si igual se le pasó una contraseña, avisa que la ignoró.
- **Solo se promueve una cuenta que nunca participó en la polla**: `pendiente`, pago `pendiente`, 0 monedas, sin movimientos y sin tickets. Si no cumple, el comando sale con 1, lista los motivos y no cambia nada. Los administradores no participan, y promover una cuenta con saldo, pago o apuestas dejaría a un admin con apuestas vivas sobre los resultados que carga. En ese caso hay que usar otro correo para el administrador. La comprobación va en el mismo `UPDATE` que promueve, así que nada se cuela entre medio.
- Si el correo no existe, hacen falta el nombre y la contraseña, con las mismas reglas que el registro.
- Correrlo dos veces no hace nada nuevo. Sale con 0 si todo fue bien, con 1 y un mensaje claro si no, y con 130 si se cancela con Ctrl+C.
- **Dos corridas a la vez** (segunda corrección de T-17): la que pierde nunca muestra el texto de MySQL.
  - Dos promociones: gana una, y la otra encuentra la cuenta ya admin y responde `Ya era administrador` (sale con 0, sin registro).
  - Dos creaciones del mismo correo: gana una. La otra no escribe nada y, si la ganadora creó un admin, responde `Ya era administrador` (sale con 0) y avisa que la contraseña se ignoró.
  - Si mientras tanto el correo lo tomó un registro común, sale con 1 y lo explica: esa cuenta **no se promueve sola**, porque su contraseña no la eligió quien corre el comando. Si corresponde promoverla, se vuelve a correr.

**Sin terminal (scripts, CI)**, usá una sola de estas fuentes:

| Fuente | Uso |
|---|---|
| `ADMIN_PASSWORD_FILE=/ruta` | Lee la primera línea del archivo. Sirve para secretos de Docker o de CI montados como archivo. Dentro del contenedor, la ruta tiene que existir en el contenedor. |
| `ADMIN_PASSWORD_STDIN=1` | Lee la primera línea de la entrada estándar, por ejemplo `docker compose exec -T -e ADMIN_EMAIL=... -e ADMIN_NOMBRE=... -e ADMIN_PASSWORD_STDIN=1 server npm run admin:create < clave.txt` (en producción, `docker compose -f compose.prod.yaml exec -T ... server node dist/cli/create-admin.js < clave.txt`). |
| `ADMIN_PASSWORD` | El valor directo. **Solo en CI**, cuando la variable la carga la plataforma desde su almacén de secretos y nadie la escribe. |

**Por qué no escribir la clave en el comando.** Escribir `ADMIN_PASSWORD=...` delante del comando deja la clave en el historial (bash y PowerShell con PSReadLine lo guardan). Con `docker compose exec -e ADMIN_PASSWORD=...` la clave además queda completa en la línea de comandos de `docker.exe` y `docker-compose.exe` mientras corren, y cualquier proceso del equipo puede leerla. `-e ADMIN_PASSWORD` sin valor copia la variable del entorno actual sin escribirla, pero antes hay que haberla cargado sin que quede en el historial. Por eso el camino normal es que el comando la pida.

## Datos de ejemplo para desarrollo (D-013, D-016, T-19)

`NODE_ENV=development npm run seed:dev -- --yes-dev-data` carga datos ficticios para revisar las pantallas, y `seed:dev:clean` (con lo mismo) los borra. Desde la raíz: `npm run server:seed:dev -- --yes-dev-data`; en Docker, `docker compose exec server npm run seed:dev -- --yes-dev-data`. Nada se carga solo: hace falta correr el comando a propósito. Código en `services/dev-seed.service.ts` y `cli/seed-dev.ts`.

- **Barrera** (D-016, `devSeedProblems`). Antes de conectarse exige las tres cosas y, si falta alguna, lista todas y sale con 1 sin cambiar nada:
  1. `NODE_ENV=development` en el entorno real del proceso (`loadEnv` lo lee antes de cargar `.env`; el valor por defecto no cuenta);
  2. la base configurada igual a `DEV_SEED_DATABASE` (comentada en `.env.example`: se activa a propósito, solo en desarrollo) y que no sea de pruebas (ni `MYSQL_DATABASE_TEST` ni un nombre con `test`); ya conectado, comprueba `SELECT DATABASE()`;
  3. la bandera `--yes-dev-data`.
- **Marcas** (D-016): la tabla `dato_demo (tabla, fila_id)`, que el comando crea con `CREATE TABLE IF NOT EXISTS` fuera de la transacción. No está en `db/init`: no es parte del esquema de la aplicación, y nada de la aplicación la lee ni la escribe. Registra cada deporte, competición, equipo, jugador, inscripción, partido, lado de partido y cuenta que crea.

- **Qué carga:** 3 deportes (Fútbol con empate, Vóley y Básquet sin empate), una competición por deporte, 8 equipos con 3 jugadores inscritos cada uno, 14 partidos en todos los estados de apuesta (disponibles, cerrados, en curso, finalizados con marcador y cancelados, con fechas relativas al momento en que se corre) y 12 cuentas: un admin, diez apostadores validados con sus 10 monedas (movimiento `validacion` real) y uno pendiente. Desde T-20, además, 7 tickets de Ana, Carla, Dani, Eva y Fede sobre esos partidos (desde T-21, uno de Fede sobre un partido que empezó hace 2 horas y espera su resultado, para el recorrido del panel): se debitan con `debitSelections` como una confirmación, y todos se confirman antes del cierre de apuestas de cada uno de sus partidos (BR-014; corrección de T-20, una prueba lo exige). Después, los partidos finalizados se liquidan con el liquidador real (`settleMatchSelections`, T-14), y la carga comprueba que cada selección quedó en el estado previsto. Las del partido cancelado se anulan con el mismo UPDATE de la cancelación y se devuelven con `refundSelections`; no se llama a `cancelMatch` (T-16) porque abre su propia transacción y escribe auditoría como un admin, y la carga es una sola transacción que se aplica entera o nada. Ana y Carla empatan arriba del ranking (6 puntos y 2 aciertos). El comando muestra el saldo real de cada cuenta. Las credenciales están en el README de la raíz y solo sirven en desarrollo.
- **Nombres:** deportes con slug `demo-...`, jugadores con ` (demo)` al final y cuentas `@demo.liga.test`, solo para reconocerlos a la vista: la limpieza no los usa. Si ya existe una fila real con uno de esos slugs o correos, la carga se niega. Los escudos apuntan a `favicon.png` del sitio.
- **Limpieza:** en una transacción, borra solo las filas marcadas, más lo que hicieron las cuentas de ejemplo: sus movimientos, selecciones, tickets, sesiones y registros de auditoría (D-015: la aplicación nunca borra auditoría; esta herramienta sí borra la de sus propias cuentas), y los goles y la multimedia de partidos de ejemplo que cargó el admin de ejemplo (según su registro `alta_gol` o `alta_multimedia`). Los archivos de imagen quedan en `UPLOADS_DIR`. Al final vacía `dato_demo`.
- **Se niega sin borrar nada** si hay datos reales colgados: apuestas de otras cuentas sobre partidos de ejemplo (con sus correos), competiciones, equipos, partidos o inscripciones reales que usan filas de ejemplo, goles o multimedia que no cargó el admin de ejemplo, o cualquier registro de auditoría de otro administrador sobre una fila de ejemplo (un resultado cargado, una edición, una validación). El mensaje lista cada motivo con su cantidad.
- **Repetible:** cargar otra vez limpia primero con la misma regla (y se niega en los mismos casos).
- **Pruebas** (`tests/dev-seed.test.ts`): la barrera, en la función y con el comando real (sin `NODE_ENV`, `production`, `test`, otra base, la de pruebas, sin bandera, también para la limpieza); la carga con cada estado de apuesta y sus 116 marcas; la repetición; la limpieza que conserva los parecidos reales (`Demo Ball`, `demo-rugby` con su competición, equipos y partido, `Juan (demo)` inscrito, una cuenta real `@demo.liga.test`); la limpieza de lo que hizo el admin de ejemplo; cada negativa (apuesta, inscripción, gol con resultado, resultado, video, equipo, partido, competición y edición reales); y la carga que choca con un correo o un slug real.

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
  - `refundSelections(conn, userId, seleccionIds)`: las devoluciones de un usuario.
  - `refundSelectionsBatch(conn, devolucionesPorUsuario)` (T-16): las devoluciones de muchos usuarios en pocas sentencias, con las mismas reglas: bloquea los usuarios por clave primaria (en orden de id), rechaza admins, comprueba dueño, débito y que no se hayan devuelto, inserta los movimientos en un INSERT de varias filas y fija los saldos con un UPDATE por lote. Con 300 usuarios y 2700 selecciones son unas 13 sentencias. `checkSelectionsOwned` y `checkRefundsWereDebited` ya trabajan con varios usuarios y los usa también `applyCoinMovements`.
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
- `npm run coins:check` (o `npm run server:coins:check` desde la raíz; en Docker de desarrollo, `docker compose exec server npm run coins:check`; **en producción**, `docker compose -f compose.prod.yaml exec server node dist/cli/coins-check.js`). Sale con 0 si todo cuadra, 1 si encontró descuadres (y los lista) y 2 si no pudo correr.

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
  - Como en los nombres (segunda corrección de T-17), se rechazan los surrogates UTF-16 sueltos y los caracteres de control, de formato (invisibles o de dirección de texto), los rellenos que se ven en blanco (U+115F, U+1160, U+2800, U+3164, U+FFA0; observaciones finales de T-17) y los separadores de línea. `new URL` los aceptaba (quita tabulaciones y saltos, y convierte una mitad suelta en U+FFFD), pero lo que se guarda es el texto tal como llegó.
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

Bajo `/admin/partidos`, con el mismo CRUD que el catálogo. Las lecturas públicas son de T-08, y el resultado, los goles y la multimedia, de T-12 y T-13.

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
- **Estados (BR-012, reglas nuevas de T-13):** no hay cambios de estado manuales. `POST /:id/estado` se quitó (ahora da 404): una ruta que solo podía fallar invitaba a usarla mal. Ver "Estado efectivo del partido".
  - `en_curso` llega solo, a la `fechaHora`.
  - `finalizado` llega con la confirmación del resultado (T-12).
  - `cancelado` llega con la cancelación de T-16, que tendrá su propia ruta.
- **Edición (BR-011):**
  - `finalizado` o `cancelado`: 409 `MATCH_LOCKED`.
  - La jornada y la sede cambian siempre.
  - La competición, los equipos y la fecha solo con el partido `programado`, es decir, antes de su hora de inicio (409 `MATCH_NOT_PROGRAMMED`). Un partido que ya empezó no se posterga.
  - **Con apuestas:** los equipos y la competición no cambian (409 `MATCH_HAS_BETS`), y la fecha **solo se posterga**.
    - Adelantarla correría el cierre por delante de apuestas hechas con el cierre anterior: 409.
    - Postergarla mueve el cierre más tarde: las apuestas existentes siguen vigentes y se puede volver a apostar hasta el nuevo cierre. Queda precisado en BR-014.
  - Sin apuestas, la fecha se mueve en cualquier sentido, siempre hacia el futuro.
  - Cambiar la competición exige mandar equipos de esa competición. Las dos filas de `partido_equipo` se borran y se recrean, porque su FK compuesta apunta a `(partido.id, competicion_id)`. También se rechaza si hay goles.
  - Los goles no se escriben aquí: `goles` o `estado` en el body dan 400.
- **Borrado:** solo antes de su hora de inicio o si está cancelado.
  - Un partido `finalizado` da 409 `MATCH_LOCKED`, y uno en curso, 409 `MATCH_NOT_PROGRAMMED`.
  - Tampoco se borra con apuestas (409 `MATCH_HAS_BETS`), goles (409 `MATCH_HAS_GOALS`), un resultado cargado (409 `MATCH_HAS_RESULT`) o multimedia (409 `MATCH_HAS_MEDIA`, por la clave foránea).
  - Sus dos filas se borran en la misma transacción. Un `cancelado` sin apuestas se puede borrar.
- **Concurrencia:** toda escritura bloquea la fila del partido (`FOR UPDATE`), así que dos ediciones simultáneas se aplican una después de la otra. T-09 y T-10 tienen que bloquearla también al crear apuestas (nota en el plan).
- **Sin acoplar módulos:** las apuestas de un partido se cuentan con `MatchBetsProbe`, un punto de extensión que `services/matches.service.ts` declara y el módulo Polla implementa en `services/bets-match-probe.service.ts`. `routes/index.ts` los conecta, igual que `DrawRuleGuard` en T-06.
- **Auditoría (T-17):** `crear_partido`, `editar_partido` y `borrar_partido` pasan por `runAdminAction` con `before` y `after`. NFR-006 exige auditar la modificación de partidos.

### Estado efectivo del partido (T-13)

Decisión del usuario (BR-012):

- Un partido empieza solo, a su `fecha_hora`, y dura `DURACION_PARTIDO_MINUTOS` (60).
- Pasado ese tiempo sigue `en_curso` hasta que se confirma su resultado.

`lib/match-state.ts` es el único lugar de la regla:

- `effectiveState(guardado, fechaHora, ahora)`: un `programado` cuya hora llegó es `en_curso`. El instante exacto de inicio ya cuenta como empezado.
- `hasEnded(fechaHora, ahora)`: pasaron los 60 minutos; el instante exacto del final ya cuenta. `matchEndTime` da ese momento.
- `effectiveStateCondition(estado, ahora)`: la misma regla como condición SQL sobre `p.fecha_hora` y `ep.codigo`. `ahora` se trunca al segundo, igual que las fechas guardadas, así que el borde coincide exactamente.

**Se calcula al leer, no con un proceso programado** (EsquemaBD D21). La columna puede seguir diciendo `programado`; todas las respuestas, filtros y reglas usan el estado efectivo:

- la API pública y su filtro `estado`;
- el listado y la vista de `/admin/partidos`, y su filtro;
- el listado de apuestas y `estadoApuesta` (entre el cierre y el inicio es `cerrada`, desde el inicio `en_curso`);
- la evaluación de tickets;
- el comprobante y el historial;
- la regla de `permite_empate` (un partido que empezó ya "salió de programado");
- las reglas de T-07 (postergar, cambiar equipos, borrar) y de T-12 y T-13.

Cargar el resultado escribe `en_curso` si la columna todavía decía `programado`; confirmar escribe `finalizado`. El orden por proximidad (BR-013) no cambia: compara fechas.

**Pruebas** (`tests/match-state.test.ts`), con `ahora` inyectado en inicio − 1 ms, inicio, fin − 1 ms y fin:

- la regla en TypeScript y en SQL, para cada estado guardado;
- el fixture, el listado de admin y el de apuestas;
- postergar y borrar;
- cargar y confirmar el resultado;
- `permite_empate`;
- lo mismo por HTTP con un partido guardado como `programado` cuya hora pasó.

## Resultados (T-12)

Módulo Informativo (`services/results.service.ts`). El admin carga el resultado oficial, lo revisa y lo confirma una sola vez (BR-028 a BR-032). La liquidación de las apuestas es de Polla (T-14) y llega inyectada, así que este archivo no importa nada de Polla; una prueba lo revisa.

| Ruta (bajo `/admin`) | Qué hace |
|---|---|
| `GET /partidos/:id/resultado` | Vista previa (BR-030), sin efectos ni bloqueos. |
| `PUT /partidos/:id/resultado` | `{ golesLocal, golesVisitante }`: carga o corrige el marcador (BR-028). Devuelve el partido. |
| `POST /partidos/:id/resultado/confirmar` | `{ confirmar: true, golesLocal, golesVisitante }`: confirmación definitiva (BR-031, BR-032). Devuelve `{ partido, resultado }`. |

Las tres rutas piden sesión de admin, y las dos escrituras llevan CSRF. Ninguna acepta query string.

**Cargar y corregir**

- **Cuándo** (`loadingProblem`): desde la hora de inicio, es decir, con el estado efectivo `en_curso`, durante y después del juego. Si la columna todavía decía `programado`, se escribe `en_curso`.
  - La hora de inicio se comprueba siempre, diga lo que diga la columna (corrección de T-13): un partido guardado `en_curso` con fecha futura (solo posible con datos de la ruta de estado quitada) también da 409 `RESULT_NOT_ALLOWED_YET`. Lo mismo vale para los goles, y para la multimedia (409 `MATCH_NOT_STARTED`).
- **Estados rechazados:**
  - Antes de la hora de inicio: 409 `RESULT_NOT_ALLOWED_YET`.
  - `finalizado`: 409 `RESULT_ALREADY_CONFIRMED`.
  - `cancelado`: 409 `MATCH_LOCKED`.
- **Sin plazo** (decisión del usuario): un partido registrado antes de jugarse recibe su resultado aunque su fecha haya pasado hace mucho.
- **Valores**: los dos lados juntos, enteros de 0 a `MAX_GOLES` (999, el mismo límite del marcador exacto de T-09, en `lib/match-result.ts`). Corregir es volver a hacer el PUT.
- **Resultado privado hasta confirmar**: la API pública sigue mostrando `goles: null` y `resultado: null`, y la tabla no lo cuenta (`officialResult`).
- **Nunca por debajo de los goles con autor** (T-13): si un lado ya tiene más goles atribuidos que el marcador nuevo, la respuesta es 409 `SCORE_BELOW_GOALS`, con `details.golesAtribuidos`.
- **Borrado**: un partido con un resultado cargado no se borra (409 `MATCH_HAS_RESULT`; en la práctica ya empezó, y eso también lo impide).
- **Empate en un deporte sin empate**: se puede cargar, porque el marcador puede estar cambiando (un desempate, por ejemplo), pero no confirmar: 409 `DRAW_NOT_ALLOWED`. La vista previa lo marca como problema.

**Resultado derivado (BR-029).** `lib/match-result.ts` es el único lugar:

- `resultOfScore(local, visita)` devuelve `local_gana`, `empate` o `visitante_gana`.
- `officialResult(estado, local, visita)` da `{ golesLocal, golesVisitante, resultado }` solo con el partido `finalizado` y los dos lados cargados; si no, `null`.
- Lo usan la vista previa, la API pública (desde T-12, cada partido público trae también `resultado`), el comprobante y el historial (`resultadoReal`), la validación del marcador exacto (T-09) y el liquidador (T-14).
- Nunca se guarda.

**Vista previa** (`ResultPreview`)

- `partido` (la forma de `/admin/partidos`), `competicion` y `deporte` (con `permiteEmpate`).
- `marcador`, `resultado` y `ganador` (`{ equipoId, nombre }`, o `null` si es empate o falta un lado).
- `goles` ya registrados con su autor, por minuto (T-13 los carga).
- `seleccionesPendientes`: cuántas selecciones se liquidarían. Lo cuenta `countPendingSelections`, de Polla, inyectado.
- `puedeConfirmar` y `problemas` (`RESULT_NOT_ALLOWED_YET`, `MATCH_NOT_ENDED`, `RESULT_INCOMPLETE`, `RESULT_ALREADY_CONFIRMED`, `MATCH_LOCKED` o `DRAW_NOT_ALLOWED`), y `advertencia` (BR-031: confirmar es definitivo).
- `confirmableDesde` (T-13): inicio + 60 minutos.
- `avisos` (T-13): cosas que no bloquean. Hoy solo `GOALS_UNATTRIBUTED`, cuando hay goles del marcador sin autor. Atribuir todos los goles no es obligatorio.

**Confirmar**

- **No puede ser accidental**: el cuerpo exige `confirmar: true` (otro valor, o que falte, es 400) y el marcador que el admin vio. Si alguien lo corrigió en el medio, la respuesta es 409 `RESULT_CHANGED`, con el marcador actual en `details`.
- **Bloqueos, en el orden global**: partido `FOR UPDATE`, luego competición y deporte `FOR SHARE`, cada uno por clave primaria. Estos dos se leen con bloqueo, así que `permite_empate` está al día.
- **Condiciones**: los mismos problemas de la vista previa.
  - Antes de los 60 minutos desde el inicio: 409 `MATCH_NOT_ENDED` (T-13).
  - Con uno o ningún lado cargado: 409 `RESULT_INCOMPLETE`.
- **Efecto**: el partido pasa a `finalizado`. Luego corre el liquidador (`MatchSettler`), una vez y dentro de la misma transacción. Por último, el gancho de auditoría.
- **Si algo falla, se deshace todo.** El partido sigue `en_curso` y se puede volver a confirmar.
- **Bloqueo definitivo (BR-032)**: con el partido `finalizado`, todas las rutas que lo tocan lo rechazan con 409.
  - Cargar de nuevo o confirmar otra vez: `RESULT_ALREADY_CONFIRMED`.
  - Editar jornada, sede, fecha o equipos, o borrarlo: `MATCH_LOCKED`.
  - Registrar, editar o borrar goles (T-13): `RESULT_ALREADY_CONFIRMED`. La multimedia sí se puede agregar o quitar (ver T-13).
- **Concurrencia**: varias confirmaciones a la vez se ordenan en el bloqueo del partido. Gana una; las demás ven `finalizado` y reciben 409 `RESULT_ALREADY_CONFIRMED`, y el liquidador corre una sola vez.
- **Con los tickets (T-10)**: la confirmación tiene el partido en `FOR UPDATE` y el ticket lo pide en `FOR SHARE`. Uno espera al otro; un ticket que llega después ve el partido finalizado y se rechaza.

**Punto de extensión para T-14** (`MatchSettler`, en `results.service.ts`)

- Firma: `(conn: TransactionConnection, match: { id, competicionId, golesLocal, golesVisitante, resultado }) => Promise<void>`.
- La implementación de Polla es `settleMatchBets` (`services/bets-settlement.service.ts`), conectada en `routes/index.ts`. Ver "Liquidación de apuestas (T-14)".
- Corre con el partido ya `finalizado` y bloqueado. Debe escribir solo en la base, porque un reintento por deadlock la repite. Si lanza un error, la confirmación se deshace.

**Auditoría (T-17)**: las dos escrituras pasan por `runAdminAction` como `registrar_resultado_partido` y `confirmar_resultado_partido`, con el partido antes y después (NFR-006: "Registro de resultado" y "Confirmación definitiva de resultado").

**Pruebas** (`tests/results.test.ts`, 43):

- Acceso: 401, 403 y CSRF.
- Carga y corrección en los estados permitidos, y rechazo en los demás, sin cambios. Valores inválidos.
- Resultado privado hasta confirmar. Los bloqueos nuevos de T-07.
- Los tres resultados derivados. El empate en vóley.
- Vista previa completa y sin efectos, con goles y selecciones pendientes (las anuladas no cuentan), y cada problema.
- Confirmación: 400 sin `confirmar: true`; 409 con el marcador cambiado, incompleto o en un estado inválido.
- Confirmación correcta: el resultado se ve en la API pública y cuenta en la tabla.
- Todas las rutas rechazadas después de confirmar, sin cambios en la fila.
- 6 confirmaciones en paralelo por HTTP y 6 por el servicio, con el liquidador llamado una sola vez.
- Partido con fecha de hace 40 días.
- El liquidador corre en la transacción y ve el partido ya finalizado, mientras otra conexión todavía lo ve `en_curso`. Si falla, deshace todo, incluido lo que escribió.
- Nombres de las acciones de auditoría.
- `tests/concurrency-stress.test.ts` carga y confirma un resultado por ronda, en paralelo con los tickets que incluyen ese partido.

## Goles y multimedia (T-13)

Módulo Informativo (`services/goals.service.ts`, `match-media.service.ts`, `media-storage.ts`, `lib/images.ts`, `lib/video-links.ts`). El admin registra quién hizo cada gol (BR-033) y adjunta imágenes y videos a cada gol y al partido (BR-001). Todo bajo `/admin/partidos/:id`, con sesión de admin y CSRF en las escrituras.

| Ruta | Qué hace |
|---|---|
| `GET /goles` | Goles del partido, por minuto. |
| `POST /goles` | `{ jugadorId, equipoId, minuto }` → 201. |
| `PATCH /goles/:golId` | `{ jugadorId?, equipoId?, minuto? }`. |
| `DELETE /goles/:golId` | Borra el gol, y después del commit su archivo de imagen. |
| `PUT /goles/:golId/imagen` | Sube o reemplaza la imagen del gol (`multipart/form-data`, campo `imagen`). |
| `DELETE /goles/:golId/imagen` | Quita la imagen (404 `MEDIA_NOT_FOUND` si no tenía). |
| `PUT /goles/:golId/video` | `{ url }`: pone o reemplaza el video del gol. |
| `DELETE /goles/:golId/video` | Quita el video. |
| `GET /multimedia` | `{ imagenes: [{ id, tipo, url, creadoEn }], videos: [{ id, tipo, video, creadoEn }] }`. |
| `POST /multimedia/imagenes` | Sube una imagen del partido → 201. |
| `POST /multimedia/videos` | `{ url }` → 201. |
| `DELETE /multimedia/:mediaId` | Quita una imagen o un video del partido. |
| `GET /admin/archivos/:nombre` | Una imagen de cualquier partido, para el panel. |
| `GET /public/archivos/:nombre` | Una imagen de un partido con resultado oficial (sin sesión). |

Un gol (`GoalView`) tiene esta forma: `{ id, partidoId, minuto, equipoId, lado, plantelId, jugador: { id, nombre }, imagen, video }`. `imagen` es la ruta `/admin/archivos/...`, y `video` es `{ plataforma, id, url, embedUrl }`.

**Goles**

- **El autor**: el jugador tiene que estar inscrito en ese equipo en la competición del partido.
  - Si no lo está: 409 `PLAYER_NOT_IN_TEAM`.
  - Si el equipo no juega el partido: 409 `TEAM_NOT_IN_MATCH`.
  - Las FKs compuestas de `gol` lo garantizan también en la base.
  - No hay goles en contra.
- **Minuto**: entero de `MINUTO_MINIMO` a `MINUTO_MAXIMO` (1 a 120; `CHECK` en la base). El partido dura 60 minutos; el margen cubre descuentos y tiempos extra.
- **Cuándo**: con la regla del marcador (`loadingProblem`), desde la hora de inicio y hasta la confirmación.
  - Antes: 409 `RESULT_NOT_ALLOWED_YET`.
  - Confirmado: 409 `RESULT_ALREADY_CONFIRMED` (BR-032).
  - Cancelado: 409 `MATCH_LOCKED`.
- **Coherencia con el marcador**: los goles con autor de un lado nunca superan los de `partido_equipo.goles`. Sin marcador cargado, no se atribuye ninguno.
  - Pasarse: 409 `GOALS_EXCEED_SCORE`, con `golesMarcador` y `golesAtribuidos`.
  - Corregir el marcador por debajo: 409 `SCORE_BELOW_GOALS` (T-12).
  - Confirmar con goles sin autor está permitido; la vista previa lo avisa (`avisos`).
- **Concurrencia**: toda escritura bloquea la fila del partido (`FOR UPDATE`), y después el plantel por clave primaria. El conteo y el alta no se cruzan: 8 altas en paralelo sobre un marcador de 3 dejan exactamente 3.

**Imágenes** (`lib/images.ts`)

- **Subida**: `multipart/form-data`, un solo archivo en el campo `imagen` y nada más (`middleware/upload.ts`, multer en memoria).
  - Otro campo, dos archivos o un cuerpo roto: 400 `UPLOAD_INVALID`.
  - Otro Content-Type: 415.
  - Más de `UPLOAD_MAX_BYTES` (5 MiB): 413 `PAYLOAD_TOO_LARGE`.
  - Tiene su propio límite de tasa (`UPLOAD_RATE_LIMIT_*`), además del general. El límite JSON de 100 KB no aplica: es otro parser.
- **Validación por contenido**: el tipo sale de los magic bytes (JPEG, PNG, WebP o GIF), nunca del nombre ni del Content-Type.
  - SVG, HTML, BMP, TIFF, texto, un archivo vacío o cortado, o un contenido que no coincide con su cabecera: 400 `IMAGE_INVALID`.
  - El SVG se rechaza antes de llegar a sharp, que sabría renderizarlo.
- **Bombas de descompresión**: sharp corre con `limitInputPixels = UPLOAD_MAX_PIXELS` (24 MP), `failOn: 'error'` y un tiempo máximo de 15 s. Una imagen chica en bytes pero enorme en píxeles da 400.
- **Memoria** (corrección de T-13): decodificar una imagen ocupa unos 4 bytes por píxel, así que una de 24 MP usa cerca de 100 MB (con 40 MP, el límite anterior, unos 160 MB).
  - `sharp.cache(false)` y `sharp.concurrency(1)`: sin caché de imágenes decodificadas y un solo hilo de libvips por imagen.
  - `inImageQueue` (`lib/images.ts`): una cola en orden de llegada que deja procesar **una imagen a la vez** por proceso (`MAX_IMAGENES_EN_PROCESO`). `sharp.concurrency` solo limita los hilos de cada imagen: sin la cola, dos subidas grandes simultáneas se decodificarían juntas. Las demás esperan su turno; una que falla libera el lugar.
  - Se eligió 24 MP porque cubre las fotos de un celular actual (12 a 20 MP, y 24 MP en muchas cámaras), y lo que se guarda tiene como máximo 1600 px por lado. Una foto más grande se puede achicar antes de subirla.
- **Reproceso**: siempre se guarda un WebP nuevo.
  - Se aplica la orientación EXIF, se achica a 1600 px por lado como máximo y se toma solo el primer cuadro de una animación.
  - No queda **ningún metadato** (EXIF, GPS, XMP, ICC).
  - Un "políglota" (una imagen válida con HTML pegado) se guarda limpio.
- **Almacenamiento** (`services/media-storage.ts`):
  - Una carpeta fuera del código, `UPLOADS_DIR` (en Docker, el volumen `uploads-data` en `/data/uploads`).
  - El nombre lo inventa el servidor: 32 hex + `.webp`, con `CHECK` y `UNIQUE` en la base. Nunca se usa el nombre del cliente, y no hay forma de escribir fuera de la carpeta.
  - Se escribe con `wx`, así que nunca se pisa un archivo.
- **Límites por partido**: 20 imágenes y 10 videos (`MAX_IMAGENES_PARTIDO`, `MAX_VIDEOS_PARTIDO`); pasarse da 409 `MEDIA_LIMIT_REACHED`. Un gol tiene una imagen y un video como máximo, porque son columnas de `gol`.

**Archivos y transacciones (sin huérfanos)**

1. La imagen se procesa y se **guarda antes** de la transacción, nunca dentro de ella ni en el gancho de auditoría. Así un reintento por deadlock no la escribe dos veces; una prueba lo verifica.
2. Si la transacción falla por cualquier motivo (gol inexistente, partido cancelado, límite, auditoría que falla), el archivo nuevo **se borra**.
3. Un archivo reemplazado o de una fila borrada se borra **después del commit**.
4. Un fallo al borrar se registra como aviso y deja un huérfano. Un corte del proceso entre 1 y 2 también puede dejarlo (anotado en `docs/pendientes.md`).

**Servir las imágenes** (`serveImage` en `controllers/media.controller.ts`)

- Solo nombres con la forma exacta, y solo si alguna fila de `gol` o `multimedia_partido` apunta a ellos. Cualquier otra cosa (`../`, mayúsculas, otra extensión, un archivo sin fila o perdido) da 404 `FILE_NOT_FOUND`, o 400 si la ruta está mal codificada.
- En `/public/archivos`, además, el partido tiene que tener su resultado oficial (finalizado y completo, BR-049). En `/admin/archivos`, cualquier partido.
- Cabeceras:
  - `Content-Type: image/webp` fijo y `X-Content-Type-Options: nosniff`.
  - `Content-Security-Policy: default-src 'none'; sandbox` y `Content-Disposition: inline`.
  - `Cross-Origin-Resource-Policy: cross-origin`, para que el front la use en un `<img>`.
  - `Cache-Control`: `public, max-age=3600` en la ruta pública (`PUBLIC_IMAGE_MAX_AGE_SECONDS`) y `private, no-store` en la del admin.
  - **Por qué una hora** (corrección de T-13; antes eran 24 h): un archivo guardado nunca cambia (nombre al azar, escrito una vez), así que cachearlo es seguro. El único efecto es que una imagen que el admin quitó puede seguir viéndose, en un navegador o un proxy que ya la tenía, hasta que venza su caché. Con 24 h eso duraba un día; con una hora queda acotado, y una página de partido igual evita volver a descargar sus imágenes mientras se navega. El servidor deja de entregarla en el acto (404).
- Solo lectura, sin listado de carpetas (`res.sendFile` con un nombre ya validado, `dotfiles: deny`). La ruta pública usa el límite de `/public`.
- El archivo se envía por su nombre, con `root` en la carpeta (corrección de T-21): con la ruta absoluta, `dotfiles: deny` revisaba también las carpetas de arriba, y la carpeta local por defecto (`.data/uploads`) respondía 403 a toda imagen. En Docker (`/data/uploads`) no pasaba. Las pruebas usan ahora una carpeta temporal bajo `.data/uploads`.

**Videos** (`lib/video-links.ts`)

- Solo enlaces `https` a YouTube (`youtube.com`, `www.`, `m.`, `youtu.be`) o Vimeo (`vimeo.com`, `www.`, `player.vimeo.com`). La lista está en `VIDEO_HOSTS`, un solo lugar.
- Se rechazan credenciales, puertos, otros esquemas, hosts parecidos, listas de reproducción, canales y enlaces sin id: 400, con la lista de plataformas en el mensaje.
- Se normalizan y se guardan en forma canónica (`https://www.youtube.com/watch?v=ID`, `https://vimeo.com/ID`). Por eso el mismo video en otra forma cuenta como repetido: 409 `VIDEO_ALREADY_ADDED`.
- La API devuelve `{ plataforma, id, url, embedUrl }`. `embedUrl` (`youtube-nocookie.com/embed/ID` o `player.vimeo.com/video/ID`) es la **única** URL que el front puede poner en un reproductor (nota en T-18 y T-22).
- El servidor nunca descarga ni consulta estos enlaces.

**Multimedia y BR-032**: las imágenes y los videos no cambian el resultado, el ganador ni los puntos. Por eso se agregan y quitan **también después de confirmar**, como pidió el usuario para partidos pasados. Los goles con su autor, en cambio, quedan bloqueados. Antes del inicio no hay multimedia (409 `MATCH_NOT_STARTED`), y en un partido cancelado tampoco (409 `MATCH_LOCKED`).

**API pública**: `GET /public/partidos/:id` trae `goles[].imagen` (ruta `/public/archivos/...`), `goles[].video` y `multimedia: { imagenes, videos }`, solo con el resultado oficial. Mientras tanto `goles` y `multimedia` son `null`, y la imagen tampoco se puede abrir por su ruta.

**Auditoría (T-17)**:

- `crear_gol`, `editar_gol` (también poner o quitar su imagen o video) y `borrar_gol`.
- `crear_multimedia` y `borrar_multimedia`.
- Todas con `runAdminAction`. Los archivos nunca se tocan dentro del gancho (ver arriba).

**Pruebas**:

- `tests/media-lib.test.ts`: detección de formatos, reproceso sin metadatos, rechazos, bomba de píxeles, políglota y normalización y rechazo de enlaces.
- `tests/goals-media.test.ts` (63 pruebas):
  - goles: altas, límites del marcador, autor, minuto, edición, borrado, bloqueo al confirmar y concurrencia;
  - imágenes: cuatro formatos, EXIF y GPS eliminados, rechazos sin archivo escrito, 413, límite de píxeles, multipart roto, 415, y limpieza al reemplazar, quitar y borrar;
  - que no queden huérfanos ante un rechazo, un fallo de la transacción o un reintento;
  - cabeceras y control de acceso de `/admin/archivos` y `/public/archivos`, y nombres peligrosos;
  - videos, multimedia antes y después de confirmar, y la API pública;
  - 401, 403, CSRF y el límite de subidas.

## Liquidación de apuestas (T-14)

Módulo Polla (`services/bets-settlement.service.ts`, `lib/points.ts`). Al confirmar un resultado (T-12), `settleMatchBets` evalúa cada selección pendiente del partido y le pone su estado y sus puntos (BR-034 a BR-040). No hay ruta propia: corre dentro de `POST /admin/partidos/:id/resultado/confirmar`.

**La regla** (tabla 27). Los puntos están solo en `lib/points.ts`: `PUNTOS_GANADOR` (3), `PUNTOS_EMPATE` (1), `PUNTOS_MARCADOR_EXACTO` (3) y `PUNTOS_FALLO` (0).

| Selección | Condición | Estado | Puntos |
|---|---|---|---|
| `resultado_general` | El pronóstico es el resultado (`local_gana` o `visitante_gana`) | `acertada` | 3 |
| `resultado_general` | El pronóstico es `empate` y el partido empató | `acertada` | 1 |
| `marcador_exacto` | Los goles de los dos lados coinciden (también 0-0) | `acertada` | 3 |
| Cualquiera | Otro caso | `no_acertada` | 0 |

- **Cada selección por separado** (BR-038). Un ganador y un marcador exacto acertados en el mismo ticket suman 3 + 3. Una apuesta solo al ganador suma 3, aunque el marcador también coincidiera con algo que el usuario no apostó. Las selecciones repetidas o contradictorias se liquidan una por una.
- **El resultado** es el de la confirmación: el marcador de `partido_equipo` y `resultOfScore` (`lib/match-result.ts`). Los goles con autor (T-13) no cuentan.
- `settleSelection(pronostico, resultado)` es la regla en TypeScript. El liquidador la aplica en SQL, con un `CASE`, y una prueba verifica que den lo mismo para cada combinación.

**Qué toca**

- Solo las selecciones `pendiente` de ese partido. Las `anulada` o ya liquidadas quedan igual, y también las del mismo ticket en otros partidos (su ticket sigue `pendiente` mientras les falte resultado).
- **Nunca mueve monedas** (BR-039): no escribe `movimiento_moneda` ni `saldo_monedas`.
- El comprobante, "Mis apuestas" y su resumen muestran los estados y los puntos en la petición siguiente, porque se calculan al leer (T-10, T-11). El ticket pasa a `finalizado` cuando no le quedan selecciones pendientes. El ranking es T-15.

**Transacción y reintentos**

- Corre una sola vez por confirmación, dentro de su transacción, con el partido ya `finalizado` y su fila en `FOR UPDATE`.
- Si algo falla (el liquidador, la auditoría o el commit), se deshace todo: el partido sigue `en_curso` y las selecciones, `pendiente`. Se puede volver a confirmar.
- **Reintento por deadlock**: `withTransaction` repite la confirmación entera. El intento deshecho no dejó cambios, así que el segundo liquida las mismas selecciones una sola vez.
- **Idempotente**: correrlo otra vez en la misma transacción no encuentra pendientes y no cambia nada.
- Si un `UPDATE` cambia menos filas de las esperadas (algo tocó una selección de un partido bloqueado), lanza un error y se deshace la confirmación. No debería pasar nunca.

**Pocas sentencias** (`settleMatchSelections`, que también devuelve `{ liquidadas, acertadas, puntos }` para las pruebas):

1. Los ids de los catálogos (estados, tipos y resultados), en una lectura.
2. Los ids pendientes del partido (`PENDING_IDS_SQL`), por el índice nuevo `idx_seleccion_partido_estado (partido_id, estado_seleccion_id)`. El conteo de la vista previa (`countPendingSelections`) usa el mismo índice.
   - **Pista, no `FORCE INDEX`** (corrección de T-14): con las estadísticas viejas, justo después de una carga grande de apuestas, MySQL elegía `fk_seleccion_estado`, que recorre las pendientes de todos los partidos. Las dos consultas llevan la pista de optimizador `/*+ INDEX(alias idx_seleccion_partido_estado) */` (`pendingIndexHint`), que fija el plan igual que `FORCE INDEX`.
   - La diferencia está en qué pasa si el índice se renombra o se borra. Con `FORCE INDEX`, MySQL da el error 1176 y cada confirmación y cada vista previa responden 500. Con la pista, solo hay un aviso (3128), MySQL elige el plan por su cuenta y la respuesta sigue siendo correcta, solo más lenta.
   - Se descartó quitar la pista y confiar en las estadísticas: con estadísticas frescas MySQL elige el índice solo, pero con las viejas no (se vio en la prueba de volumen). La prueba revisa el plan con `EXPLAIN` y ejecuta la consulta con un índice inexistente.
3. Un `UPDATE` por lote de `LOTE_LIQUIDACION` (1000) ids, por clave primaria.
4. Los aciertos y puntos del partido.

Con 5000 selecciones pendientes son 8 sentencias. En la máquina de prueba, esa prueba entera (con la carga de las 5000 selecciones) tarda alrededor de 1,5 s.

**Bloqueos** (ver "Orden de bloqueo y concurrencia")

- El partido ya está en `FOR UPDATE`. Un ticket nuevo lo pide en `FOR SHARE` antes de insertar sus selecciones, así que ninguna selección de este partido puede aparecer mientras tanto. Además, el partido ya no admite apuestas desde 24 h antes de su inicio.
- Los ids se leen **sin bloqueo**. Todas las selecciones del partido se confirmaron antes de que se concediera el bloqueo del partido, y la foto de la transacción se toma después (su primera lectura común es la del partido, tras el `FOR UPDATE`).
- El `UPDATE` va por clave primaria y vuelve a exigir `pendiente`. Solo bloquea esas filas, sin rangos de índices secundarios ni huecos. Una prueba lo revisa en `performance_schema.data_locks`, y mientras tanto otra transacción agrega una selección al mismo ticket, en otro partido, sin esperar.
- Actualizar `estado_seleccion_id` toma un bloqueo compartido sobre la fila del catálogo (`acertada`, `no_acertada`), por la clave foránea. Los tickets toman el mismo tipo de bloqueo sobre `pendiente`, así que no chocan.

**Pruebas** (`tests/settlement.test.ts`, 34):

- La regla, caso por caso: ganador local y visitante, empate (incluido 0-0), marcadores exactos acertados (2-1, 0-0, 3-3) y fallados (ganador correcto con marcador incorrecto, lados invertidos, empate con otro marcador, un solo lado).
- Cinco marcadores contra once pronósticos, confirmados de verdad: el SQL da lo mismo que `settleSelection`.
- BR-038 (ganador y marcador suman por separado), selecciones repetidas y contradictorias.
- Anuladas, ya liquidadas y otros partidos del mismo ticket no cambian. Un partido sin apuestas.
- Ninguna moneda se mueve.
- Un fallo después de liquidar deshace todo, y después se puede confirmar. Un reintento por deadlock liquida una sola vez. Idempotencia y rechazo fuera de una transacción. Bloqueos en `data_locks`.
- 5000 selecciones: plan con el índice nuevo, la misma respuesta con un índice inexistente (solo el aviso 3128), 8 sentencias y cifras exactas.
- 6 confirmaciones en paralelo (una gana y liquida una vez) junto con tickets de otros partidos, y dos partidos que comparten tickets confirmados a la vez, sin deadlocks.
- Por HTTP: ticket de dos partidos, confirmación de uno (ticket `pendiente` con 6 puntos) y del otro (`finalizado`, 7 puntos), "Mis apuestas", el resumen y el saldo sin cambios.

## Ranking de la polla (T-15)

Módulo Polla (`services/ranking.service.ts`, `lib/ranking.ts`, `routes/ranking.route.ts`). El ranking (BR-041 a BR-044) se calcula en cada consulta a partir de las selecciones liquidadas y nunca se guarda. Por eso se actualiza solo (BR-044): una confirmación de resultado (T-14) o una anulación (T-16) se ve desde la petición siguiente.

| Ruta | Guardia | Respuesta |
|---|---|---|
| `GET /ranking` | sesión, sin query | `{ top, topSinMostrar, propia, participantes, posicionesTop, maxFilasTop }` |
| `GET /admin/polla/ranking` | admin, `page` y `pageSize` | El ranking completo, paginado: `{ items: [{ posicion, participante: { id, nombre }, puntos, aciertos }], page, pageSize, total, totalPages }` |
| `GET /admin/polla/estadisticas` | admin, sin query | `{ participantes: { inscritos, validados, pendientes }, tickets: { total, pendiente, finalizado, anulado }, selecciones: { total, pendiente, acertada, no_acertada, anulada }, monedasUtilizadas, monedasDevueltas, monedasDisponibles, puntos, aciertos }` |

Una fila de `GET /ranking` es `{ posicion, participante: { nombre }, puntos, aciertos, esPropia }`. `propia` es la fila del usuario que consulta, con `enTop` (su posición está en el top) y `enLista` (su fila está en `top`), o `null` si no es participante.

**Decisiones**

- **Quiénes participan**: solo los `apostador` **validados**.
  - Los administradores nunca figuran (BR-001), aunque la base diga `validado` o tengan selecciones cargadas a mano.
  - Un `pendiente` tampoco: todavía no puede apostar (BR-005), así que no compite. Solo tendría selecciones con datos cargados a mano, y tampoco se cuentan.
  - Un validado sin apuestas, o sin nada liquidado, figura con 0 puntos y 0 aciertos. Ya pagó y está en la polla, y así el ranking muestra a todos los participantes.
- **Definiciones** (las de T-11): puntos es `SUM(seleccion.puntos_obtenidos)`, y aciertos, las selecciones en estado `acertada` de cualquier tipo. Las pendientes y anuladas tienen `puntos_obtenidos` NULL y no suman. `/apuestas/mis-apuestas/resumen` da las mismas cifras para cada usuario, y una prueba las compara.
- **Orden** (BR-041, BR-043): puntos DESC y después aciertos DESC. `RANK()` da la posición:
  - Un empate total comparte la posición, y el siguiente salta (1, 1, 3). La posición dice cuántos están por delante, más uno.
  - Dentro de un empate, la lista va por nombre y después por id. Es solo el orden de presentación: no cambia la posición.
  - **El nombre se ordena con `utf8mb4_es_0900_ai_ci`** (`NOMBRE_ORDEN`, corrección de T-15): el orden alfabético del español, con la ñ como letra aparte después de la n, sin distinguir mayúsculas ni acentos. Es el mismo orden que `Intl.Collator('es', { sensitivity: 'base' })` de `lib/ranking.ts`. La collation propia de la columna (`utf8mb4_unicode_ci`) trata la ñ como n, y las dos versiones daban órdenes distintos entre empatados. Se eligió la regla española y no la de la columna porque los nombres son en español y así lo espera quien los lee. Una prueba compara las dos con nombres con ñ, acentos y mayúsculas.
  - `rankParticipants` (`lib/ranking.ts`) es la misma regla en TypeScript. La prueba de volumen compara las dos con datos al azar.
- **Top** (BR-042): todos los que están entre las posiciones 1 y `POSICIONES_TOP` (10), con un máximo de `MAX_FILAS_TOP` (50) filas.
  - **Tope** (corrección de T-15): con la polla recién abierta todos empatan en 0 y estaban todos en el top (3001 filas y 285 KB con 3000 participantes). Ahora van las primeras 50 en el orden de presentación, y `topSinMostrar` dice cuántos empatados del top quedaron fuera. La fila propia sigue viniendo aparte (`enLista: false`). La consulta numera las filas con `ROW_NUMBER()` y filtra `fila <= 50`.
  - Si hay empate en el puesto 10, entran todos los empatados, y la lista tiene más de 10 filas. Cortar en 10 dejaría afuera, sin criterio, a alguien con los mismos puntos y aciertos que uno que sí aparece.
  - Si 12 empatan en el primer puesto, aparecen los 12.
- **Fila propia**: si el usuario es participante, `propia` trae su posición, puntos y aciertos, esté o no en el top (`enTop`). En el top, además, su fila lleva `esPropia: true`.
- **Quién lo ve** (BR-002): cualquier sesión.
  - Un `pendiente` lo ve para conocer la polla antes de que lo validen, con `propia: null`.
  - Un admin también lo ve, con `propia: null`, y además tiene las rutas de `/admin/polla`.
- **Sin versión pública**: `/public/ranking` no existe (404). El ranking relaciona el nombre de una persona con sus resultados de apuestas, y eso queda dentro de la polla: la landing (BR-048 a BR-050) no lo pide, y quien se registró no aceptó mostrar su nombre en una página abierta. Si algún día se quiere, habría que agregarlo con consentimiento o con nombres anónimos.
- **Privacidad**: la respuesta de `/ranking` solo tiene el nombre a mostrar, los puntos, los aciertos y la posición. Nunca el correo, el saldo, el estado ni el id de otro usuario (un id permitiría relacionar filas con otras respuestas). Una prueba revisa todas las claves. El admin sí recibe el id, para enlazar con la tabla de participantes.
- **Estadísticas** (BR-001, "consultar resultados y estadísticas de la polla"): cuentan a todos los `apostador` (inscritos, como la tabla de participantes de T-04) y nunca a los administradores. Los tickets y las selecciones usan las reglas de "Mis apuestas": el estado del ticket con `ticketStateCondition`, y las monedas utilizadas y devueltas con `ticketTotals`. `monedasDisponibles` es la suma de los saldos.
- **Caché**: todas las respuestas son `no-store`, como el resto de la API privada.

**Consulta y rendimiento**

- `GET /ranking` es **una sola sentencia** (`RANKING_TOP_SQL`): un CTE suma puntos y aciertos por participante, otro aplica `RANK()` y `COUNT(*) OVER ()`, y se leen el top y la fila propia. Como es una sola sentencia, todas las cifras describen el mismo momento.
- `/admin/polla/ranking` es **una sola sentencia** (corrección de T-15): la página sale de un `LEFT JOIN` desde una tabla de una fila, con el total en una columna (`(SELECT COUNT(*) FROM ranked)`; MySQL materializa el CTE una vez). Una página más allá del final devuelve una fila vacía con el total, sin una segunda consulta.
- `/admin/polla/estadisticas` también es una sola sentencia.
- Índices (revisado con `EXPLAIN` en la prueba de volumen): `seleccion` por `idx_seleccion_ticket_estado` y `ticket` por un índice que empieza con `usuario_id`, los dos **solo con el índice** ("Using index"): estado y puntos están en el índice de la selección.
- Medido con 300 participantes, 3000 tickets y 30 000 selecciones: la mediana de `getRanking` es de unos 25 ms. Crece con las selecciones de toda la polla, porque el ranking las suma todas en cada consulta. Si algún día pesara, se puede cachear unos segundos en memoria o guardar un resumen por usuario al liquidar. Hoy no hace falta.

**Pruebas** (`tests/ranking.test.ts`, 16):

- La regla en TypeScript (1, 1, 3 y el orden de presentación).
- 62 participantes en 0: 50 filas, `topSinMostrar` 12, la fila propia aparte y una respuesta chica.
- Nombres con ñ, acentos y mayúsculas empatados: el mismo orden en SQL y en TypeScript.
- Orden por puntos y después por aciertos, empates parciales y totales, y un participante con apuestas en dos tickets.
- Top con empate en el puesto 10 (12 filas; el 13.º queda afuera con su fila propia) y 12 empatados en el primer puesto.
- Validados con 0.
- Admins (incluso uno `validado`) y pendientes excluidos, aunque tengan selecciones acertadas cargadas a mano.
- Fila propia en el top y fuera de él.
- Actualización inmediata tras confirmar un resultado por HTTP, y tras una anulación cargada a mano. Las cifras propias son las del resumen de "Mis apuestas".
- Privacidad: todas las claves de la respuesta.
- 401, 400 por query, `no-store`, `/public/ranking` inexistente, y las rutas de admin (401, 403 y validación de la paginación).
- Ranking completo paginado (incluida una página vacía y la base vacía) y estadísticas con cifras exactas.
- Volumen: plan con índices de cobertura, tiempo, y posiciones iguales a las de `rankParticipants`.

## Consulta de apuestas del admin (T-21)

Módulo Polla (`services/admin-bets.service.ts`, en el router de `/admin/polla`). Es la "consulta de apuestas realizadas" de BR-001 que usa el panel. Solo lectura: no hay ninguna ruta de escritura (`POST` o `DELETE` dan 404).

| Ruta | Respuesta |
|---|---|
| `GET /admin/polla/apuestas` | Paginado. Una fila por selección, con la misma forma que "Mis apuestas" (`MyBet`: la selección, su partido, `resultadoReal` y los totales de su ticket) más `usuario: { id, nombre }`. Filtros: los de "Mis apuestas" (`estado`, `estadoTicket`, `ticketId`, `partidoId`, `deporteId`, `competicionId`, `desde`, `hasta`) y `usuarioId`. |

- **Solo apostadores** (BR-001, decisión del usuario en T-04): los tickets de una cuenta admin (solo posibles con datos cargados a mano) nunca aparecen, tampoco filtrando por su id.
- **Mismas cifras que el participante**: las filas y los totales salen de las mismas piezas del historial (`HISTORY_COLUMNS`, `ticketAggregatesFor`, `myBetFrom` de `bet-history.service.ts`), así que la fila de un participante es la de su "Mis apuestas" más `usuario`. Una prueba lo compara.
- **Orden**: del ticket más reciente al más antiguo y, dentro del ticket, en el orden en que se armó (como el historial, no BR-013).
- **Privacidad**: del participante, solo el id (para enlazar con la tabla de participantes y el ranking del admin) y el nombre. Nunca el correo, el saldo, la clave de idempotencia ni la huella; una prueba revisa todas las claves.
- **Consulta**: en dos pasos y en una foto de solo lectura (`withReadSnapshot`), como el historial. El filtro por estado del ticket agrega los tickets de todos los participantes; los demás filtros van por subconsultas.
- **Query estricta**: un parámetro desconocido, repetido o inválido da 400. Respuesta `no-store`.
- **Pruebas** (`tests/admin-bets.test.ts`): acceso (401, 403), filas y orden, el admin excluido, igualdad con "Mis apuestas", cada filtro, paginación, privacidad, 400 por query y ausencia de rutas de escritura.

## Lo que el panel necesita de las listas (corrección de la T-21)

El panel elige competiciones, equipos y jugadores con un buscador (D-019) en lugar de una lista desplegable con tope. Para que eso funcione sin pedir el catálogo entero, las listas del catálogo dan dos cosas más:

- **Nombre buscado en todas**: `GET /admin/planteles` acepta `q`, como el resto, y busca por el nombre del jugador o el del equipo (con `%` y `_` literales, hasta 100 caracteres). Antes era la única lista sin búsqueda, así que el panel tenía que traerse todas las inscripciones para ofrecerlas.
- **Nombres ya unidos en cada fila**, para que una fila se lea sola: `competicion` trae `deporteNombre`; `equipo`, `competicionNombre` y `deporteNombre`; `plantel`, `equipoNombre`, `competicionNombre` y `deporteNombre`; `partido`, `competicionNombre` y `deporteNombre`. Son columnas unidas, no guardadas: `soloGuardados` (`services/audit.service.ts`) las quita del detalle de auditoría, igual que hacía con `jugadorNombre`, y una prueba lo comprueba.
- **`page` y `pageSize` enteros en cifras decimales** (`pageNumber` en `schemas/common.schema.ts`): `z.coerce` aceptaba `1e2`, `0x10`, ` 2` y `2.0`. Ahora cada uno de esos da 400 con el campo y el motivo, en todas las listas (`tests/pagination-numbers.test.ts` recorre las del admin, las del apostador y las públicas).
- **Orden estable y páginas por desplazamiento**: cada lista ordena por su nombre con el `id` como desempate (`d.nombre, d.id`; los planteles, por `equipo_id, numero_camiseta, id`), así que dos páginas seguidas nunca dependen de un orden arbitrario. Aun así, las páginas se cortan con `LIMIT`/`OFFSET`: si alguien **crea o borra** una fila que quede antes del corte mientras se recorren las páginas, la siguiente puede repetir o saltear una opción. En el buscador del panel (D-019) eso es inofensivo —se escribe otra vez y la opción aparece— y no se cambió a paginación por cursor, que exigiría llevar la última clave leída en cada lista.
- **Ranking del admin**: cada fila trae `empatados`, la cantidad que comparte esa posición en todo el ranking (`COUNT(*) OVER (PARTITION BY puntos, aciertos)`). Una página suelta no puede saberlo: con 20 filas por página, un empate partido entre dos páginas parecía una posición única.

## Cancelación de partidos (T-16)

Módulo Polla (`services/match-cancellation.service.ts`, `routes/match-cancellation.route.ts`). Cancelar un partido lo deja `cancelado` para siempre, anula sus apuestas pendientes y devuelve sus monedas, todo en una transacción (BR-045 a BR-047, BR-055). Abarca los dos módulos: el cambio de estado es de Informativo (`markCancelled` en `matches.service.ts`) y lo llama Polla. Polla puede importar Informativo; al revés, nunca.

| Ruta (bajo `/admin`) | Qué hace |
|---|---|
| `GET /partidos/:id/cancelacion` | Vista previa, sin efectos ni bloqueos: `{ partido, selecciones, monedasDevueltas, seleccionesSinDevolucion: { total, sinDebito, cuentaAdministrador }, usuarios, tickets, ticketsAnulados, puedeCancelar, problemas, advertencia }`. |
| `POST /partidos/:id/cancelacion/confirmar` | `{ confirmar: true }` (otro cuerpo da 400): cancela. Devuelve `{ partido, selecciones, monedasDevueltas, seleccionesSinDevolucion: { total, sinDebito, cuentaAdministrador }, usuarios, tickets, ticketsAnulados }`. |

Sesión de admin, CSRF en el POST y sin query string. `POST /partidos/:id/estado` sigue sin existir (404).

**Decisiones**

- **Qué se puede cancelar**: un partido `programado` o en curso (estado efectivo), también con marcador, goles o multimedia cargados, y también con las apuestas todavía abiertas.
  - `finalizado`: 409 `MATCH_ALREADY_FINISHED`.
  - Ya `cancelado`: 409 `MATCH_ALREADY_CANCELLED`.
  - La vista previa muestra el mismo motivo en `problemas`, con las cifras en 0.
- **Definitiva**: `cancelado` bloquea el partido igual que `finalizado` (T-07, T-12, T-13): no se edita, no se reprograma, no recibe resultado, goles ni multimedia nueva, y ningún ticket lo acepta. Así quedó en BR-012 y BR-045. El marcador, los goles y la multimedia que tuviera se conservan (el admin los sigue viendo) y nunca son públicos: la API pública muestra `estado: "cancelado"`, `resultado`, `goles` y `multimedia` en `null` (BR-049).
- **Qué se anula**: solo las selecciones `pendiente` del partido, que pasan a `anulada` con `puntos_obtenidos` NULL. Una anulada no suma puntos ni cuenta como acierto (T-11, T-15).
  - Un partido no finalizado no puede tener selecciones liquidadas. Si hubiera alguna (o una ya anulada) por datos cargados a mano, no se toca y no se devuelve nada por ella.
  - Una pendiente **sin débito** (también solo posible a mano) se anula sin devolución, porque nunca costó una moneda (`seleccionesSinDevolucion.sinDebito`). Llamar a `refundSelections` con ella habría rechazado la cancelación entera (409 `SELECTION_NOT_DEBITED`).
  - Una pendiente de una cuenta que **hoy es admin** (solo posible a mano) se anula sin devolución (`seleccionesSinDevolucion.cuentaAdministrador`, decisión D-002 de `docs/decisiones.md`): un admin no tiene monedas (BR-001), y la cancelación no puede fallar por eso (antes daba 403 `NOT_A_PARTICIPANT` y no se anulaba nada). Esas cuentas tampoco se bloquean en el paso 2: su saldo no cambia.
- **Borrar un partido cancelado** (D-001): se puede si no tiene apuestas, goles, resultado ni multimedia; si no, 409 `MATCH_HAS_BETS`, `MATCH_HAS_GOALS`, `MATCH_HAS_RESULT` o `MATCH_HAS_MEDIA` (`deleteMatch`, T-07). Una prueba cubre los cinco casos.
- **Qué se devuelve** (BR-046): 1 moneda por cada selección anulada con débito de una cuenta `apostador`, a su dueño, con un movimiento `devolucion_cancelacion` que lleva su `seleccion_id` (D19), mediante `refundSelectionsBatch`. El saldo de cada usuario sube exactamente en sus selecciones anuladas.
- **BR-047**: las selecciones del mismo ticket en otros partidos no cambian. El estado del ticket sigue la regla de T-10: `anulado` si todas quedaron anuladas, y si no `pendiente` o `finalizado`. `ticketsAnulados` cuenta los que quedan anulados por completo.
- **Sin confirmación de cifras**: a diferencia de T-12, el cuerpo no repite las cifras de la vista previa. Si el partido todavía acepta apuestas, pueden cambiar entre la vista previa y la confirmación, y rechazar la cancelación por eso obligaría a reintentar sin fin. La respuesta trae las cifras reales.

**Transacción y orden de bloqueo**

Una sola transacción de `runAdminAction` en `READ COMMITTED`. El orden global empieza por el usuario, y un ticket bloquea su usuario (X) y después el partido (S). Si la cancelación bloqueara el partido y después los usuarios, formaría un ciclo con un ticket en curso. Por eso:

1. Lee, **sin bloqueo**, los usuarios `apostador` con selecciones pendientes en el partido (por `idx_seleccion_partido_estado`).
2. Bloquea esos usuarios (`FOR UPDATE`, por clave primaria, en orden de id, en lotes de 1000).
3. Bloquea el partido (`FOR UPDATE`) y comprueba su estado efectivo.
4. Vuelve a leer las selecciones pendientes. En `READ COMMITTED` ve todos los tickets que se confirmaron antes de obtener el bloqueo del partido, y ninguno nuevo puede entrar mientras lo tiene.
   - Si aparece un apostador que el paso 2 no bloqueó (apostó mientras la cancelación esperaba el partido), se deshace todo y la cancelación **empieza de nuevo**, ya con ese usuario (`cancellationStats.restarts`).
   - Tras `MAX_INTENTOS_CANCELACION` (3) intentos, 409 `CONCURRENT_UPDATE`. Solo puede pasar si siguen entrando apuestas de usuarios nuevos, es decir, con un partido que todavía acepta apuestas.
5. Anula por clave primaria, en lotes de 1000, exigiendo otra vez `pendiente`. Después devuelve (`refundSelectionsBatch`, que vuelve a bloquear los mismos usuarios, ya suyos), marca el partido `cancelado` y corre el gancho de auditoría.

Con los demás:

- **Tickets** (T-10): los dos van usuario → partido. Un ticket sobre el partido que espera la cancelación la encuentra cancelada y se rechaza. Un ticket del mismo usuario sobre otro partido espera al usuario y sigue.
- **Confirmar el resultado** (T-12, T-14): los dos piden el partido en `FOR UPDATE`. Gana uno: si gana la cancelación, la confirmación responde 409 `MATCH_LOCKED`; si gana la confirmación, la cancelación responde 409 `MATCH_ALREADY_FINISHED`. Nunca se liquida y se devuelve la misma selección.
- **Liquidación de otro partido que comparte tickets** (T-14): toma bloqueos compartidos sobre los tickets y exclusivos sobre sus propias selecciones. La cancelación puede tomar también bloqueos compartidos sobre los tickets (compatibles con los de la liquidación) y exclusivos solo sobre las selecciones de su partido. No chocan: la prueba de tickets compartidos lo ejercita sin deadlocks.
- **T-07 y T-13**: bloquean solo el partido (y después plantel, equipo...), nunca usuarios.
- **Reintento por deadlock**: `withTransaction` repite todo. El intento deshecho no dejó devoluciones, así que no se devuelve dos veces. Además, `UNIQUE(seleccion_id, tipo_movimiento_id)` lo impediría en la base.
- **Cualquier error** (una devolución rechazada, la auditoría, el commit) deshace todo: el partido, las selecciones, los movimientos y los saldos.

**Pocas sentencias**: con 300 usuarios y 2700 selecciones pendientes, la cancelación completa hace 26 sentencias (más las 3 de la auditoría) y tarda unos 230 a 340 ms en la máquina de prueba.

**Las cifras en una sentencia** (corrección de T-16): un CTE con las selecciones pendientes (usuario, si es apostador y si tiene débito) y otro con las selecciones que siguen vivas **por ticket**. Antes, `ticketsAnulados` usaba un `NOT EXISTS` por selección, que crece con el cuadrado de las selecciones por ticket. Con 10 000 selecciones pendientes, la vista previa bajó de 44 a 55 ms a 22 a 25 ms, tanto en 200 tickets de 50 como en 10 de 1000. Las devoluciones se agrupan por usuario con `push`, sin copiar el arreglo en cada selección.

**Auditoría (T-17)**: `cancelar_partido` (catálogo: `cancelacion_partido`), por `runAdminAction`, con el estado anterior y las cifras de la cancelación en el detalle. NFR-006 la exige.

**Pruebas** (`tests/cancellation.test.ts`, 13):

- Vista previa exacta y sin efectos. Cancelar con dos usuarios y tickets mixtos: devoluciones exactas por usuario y por selección, el otro partido intacto, comprobantes (`anulado` y `pendiente`), "Mis apuestas", su resumen, el saldo, el ranking y la API pública.
- Un partido en curso con marcador, goles y multimedia; después, el partido queda bloqueado para todo.
- Un partido sin apuestas, y uno con las apuestas ya cerradas.
- `finalizado` y `cancelado` rechazados, sin cambios. Un ticket sobre el partido cancelado se rechaza.
- Selecciones cargadas a mano: liquidadas y anuladas no cambian; una pendiente sin débito se anula sin devolución.
- Un fallo a mitad (después de las devoluciones) y un fallo de la auditoría deshacen todo. El nombre de la acción de auditoría.
- Un reintento por deadlock devuelve una sola vez.
- 6 cancelaciones a la vez: una gana y las monedas vuelven una vez.
- Cancelar y confirmar el mismo partido a la vez, 4 rondas: gana exactamente uno, con sus efectos y ningún otro.
- Cancelar mientras se liquida otro partido que comparte los tickets y los mismos usuarios confirman tickets nuevos, 3 rondas: sin deadlocks.
- Un usuario nuevo que apuesta mientras la cancelación espera el partido: empieza de nuevo y también le devuelve.
- Volumen: 300 usuarios y 2700 selecciones, con la cantidad de sentencias.
- 401, 403, CSRF, cuerpo y query estrictos y 404.
- Después de cada prueba, `checkCoinConsistency` (lo mismo que `coins:check`) no encuentra descuadres.
- `tests/concurrency-stress.test.ts` cancela, cada dos rondas, un partido con apuestas del usuario que está confirmando otro ticket, y sigue sin deadlocks.

## Auditoría (T-17)

Módulo Auditoría (`services/audit.service.ts`, `lib/audit.ts`, `routes/audit.route.ts`). Cada escritura del admin deja **una** fila en `auditoria` (NFR-006): el administrador, la acción, la fecha y hora en UTC, el registro afectado (`entidad_id`) y un detalle breve en JSON.

**Qué se audita** (`ACCIONES_AUDITADAS`, el único mapa de acción de la aplicación → código de `accion_auditoria`):

| Acciones de la aplicación | Códigos | Entidad |
|---|---|---|
| `validar`, `confirmar_pago`, `revertir_pago` (T-04) | `validacion_usuario`, `confirmacion_pago`, `reversion_pago` | `usuario` |
| `crear_partido`, `editar_partido`, `borrar_partido` (T-07) | `alta_partido`, `modificacion_partido`, `borrado_partido` | `partido` |
| `registrar_resultado_partido`, `confirmar_resultado_partido` (T-12) | `registro_resultado`, `confirmacion_resultado` | `partido` |
| `cancelar_partido` (T-16) | `cancelacion_partido` | `partido` |
| `crear_*`, `editar_*`, `borrar_*` de deporte, competición, equipo, jugador y plantel (T-06) | `alta_*`, `modificacion_*`, `borrado_*` | la de cada uno |
| `crear_gol`, `editar_gol` (también poner o quitar su imagen o video), `borrar_gol` (T-13) | `alta_gol`, `modificacion_gol`, `borrado_gol` | `gol` |
| `crear_multimedia`, `borrar_multimedia` (T-13; imágenes y videos del partido) | `alta_multimedia`, `borrado_multimedia` | `multimedia_partido` |
| `crear_administrador`, `promover_administrador` (comando `admin:create`, D-005) | `creacion_administrador`, `promocion_administrador` | `usuario` |

Las cinco de NFR-006 están incluidas. Una prueba verifica que `02-catalogos.sql` y el mapa coincidan, código por código y con su entidad, y que cada código se use.

**Detalle** (`detailOf` y `participantDetail`):

- Modificaciones: `{ cambios: { campo: { antes, despues, recortado? } } }`, solo los campos que cambiaron.
- Altas: `{ nuevo: fila }`; borrados: `{ anterior: fila }`.
- Registro de resultado: `{ marcador, anterior }`; confirmación: `{ marcador }`; cancelación: `{ estadoAnterior, selecciones, monedasDevueltas, seleccionesSinDevolucion, usuarios, tickets, ticketsAnulados }`.
- Participantes: el estado de pago o de validación antes y después, y en la validación, las monedas asignadas y el id del movimiento. Nada personal: el participante es `entidad_id`.
- **Solo campos guardados** (`soloGuardados`, segunda corrección de T-17): las filas del detalle llevan lo que la tabla guarda, nunca valores calculados ni traídos por JOIN.
  - Partido: `id`, `competicionId`, `estado`, `jornada`, `fechaHora`, `sede` y `local`/`visita` con `equipoId` y `goles`. Sin `cierreApuestas` (es `fechaHora − 24 h`), `deporteId` ni nombres de equipos: postergar un partido deja solo `fechaHora` en `cambios`. `estado` es el efectivo (BR-012); en las filas que se registran (alta, edición, borrado) no se distingue del guardado.
  - Gol: `id`, `partidoId`, `equipoId`, `plantelId`, `minuto`, `imagen` (la ruta de la API, nunca el nombre interno `archivo`) y `video` (el enlace guardado). Sin `lado`, sin el nombre del jugador y sin `embedUrl` ni `plataforma`.
  - Multimedia: `id`, `imagen` o `video` (el enlace guardado) y `creadoEn`. Plantel: sin `jugadorNombre`.
  - La confirmación ya no guarda `resultado`: se deriva del marcador (BR-029) y nunca se guarda.
- **Sin cambios, no hay registro** (D-004): un PATCH que no cambia ningún campo responde igual, pero no deja registro (`detailOf` devuelve `null`). Vale para toda acción `editar_*`, también poner el mismo video en un gol, y para volver a registrar exactamente el mismo marcador (ampliación de D-004).
- **Qué es un cambio** (segunda corrección de T-17): `cambios` compara los valores **reales**, sin recortar, y recorta solo lo que muestra. Antes comparaba los textos ya cortados a 200 caracteres, y una foto o un escudo que cambiaba después del carácter 200 se guardaba sin registro. Si el valor mostrado de un lado quedó recortado, el campo lleva `recortado: true`; así se ve que cambió aunque `antes` y `despues` parezcan iguales.
- **Nunca secretos ni datos innecesarios** (`claveProhibida`, rehecha en la segunda corrección de T-17): se quitan, a cualquier profundidad, las claves que tienen una **palabra completa** prohibida. La clave se parte en palabras sin acentos ni mayúsculas (camelCase, `_`, `-`, `.`, dígitos), y una palabra pegada se separa si se forma entera con palabras conocidas (`userpassword`, `accesstoken`, `passwordhash`). Dos palabras vecinas también cuentan juntas (`api` + `key`, `e` + `mail`). Además se revisa la clave entera pegada y en minúsculas, así que las mayúsculas mezcladas (`SeSiOn`, `PaSsWoRd`) y las pegadas (`emailaddress`, `correoelectronico`, `pinnumber`, `privatekey`) también caen (observaciones finales de T-17).
  - Palabras prohibidas: `pass`, `passwd`, `password`, `passphrase`, `pwd`, `contrasena`, `hash`, `hashed`, `token`, `secret`, `secreto`, `clave`, `huella`, `idempotencia`, `idempotency`, `cookie`, `sesion`, `session`, `email`, `mail`, `correo`, `saldo`, `csrf`, `xsrf`, `apikey`, `privatekey`, `authorization`, `credencial`, `credential` y `pin` (con sus plurales).
  - Límite conocido (`docs/pendientes.md`): otras banderas legítimas con valor booleano, como `tokenActivo`, `tieneEmail` o `hasPassword`, se quitan igual. Caen `apiKey`, `API_KEY`, `X-CSRF-Token`, `refresh_token`, `Contraseña`, `userPin` o `claveIdempotencia`.
  - Antes se buscaban subcadenas, y se perdían claves legítimas: `hashtag`, `passport`, `compass`, `secretaria`, `mailing`, `clavel`, `bypass`, `spinner` ahora se conservan.
  - Una clave que es un dato **sobre** el secreto (`emailVerificado`, `passwordRequired`: lleva `verificado`, `confirmado`, `habilitado`, `requerido`, `valido` o sus formas en inglés) se conserva solo si su valor es booleano o `null`. Con un texto (`emailVerificado: "ana@..."`) se quita.
- **Textos** (corrección de T-17): se cortan a 200 **puntos de código**, nunca en medio de un carácter. Antes se cortaba por unidades UTF-16, y un emoji partido dejaba media pareja suelta: MySQL rechaza eso en un JSON (3141), la acción se deshacía y respondía 500 (por ejemplo, un jugador con una foto de 205 caracteres con un emoji en el lugar del corte). Además, `bienFormado` cambia cualquier mitad suelta que venga en los datos por U+FFFD, también en las claves.
- **Tamaño y profundidad** (corrección de T-17): listas de 20 elementos, objetos de 50 claves y 8 niveles como máximo (más hondo queda `…`); MySQL no acepta más de 100 niveles (3157). `detalleAcotado` exige a la vez 3000 bytes de texto y 3800 bytes de formato binario según `tamanoBinario`, una cota superior de `JSON_STORAGE_SIZE` (cuenta todo en el formato grande de MySQL; una prueba la compara con MySQL en estructuras al azar). Hacían falta las dos: listas anidadas de menos de 3000 bytes de texto pasaban los 4 KB binarios del `CHECK` (`ck_auditoria_detalle`). Si no entra, guarda solo los nombres de los campos, con `recortado: true`; si ni eso entra, solo la marca.

**En la misma transacción**

- La fila se inserta desde el gancho `hooks.inTransaction` de cada acción: `runAdminAction` (catálogo, partidos, resultados, goles, multimedia y cancelación) y las acciones de participantes. `routes/index.ts` inyecta `auditHooks` y `participantAuditHooks`, así que Informativo sigue sin importar Auditoría.
- Una acción rechazada (400, 404, 409, CSRF) o que falla no deja fila. Si la inserción falla, la acción se deshace y la respuesta es 500 `INTERNAL_ERROR`, sin el texto del error.
- Un reintento por deadlock vuelve a correr el gancho, pero el intento deshecho se llevó su fila: queda una sola.
- Solo escribe en la base: nada de logs, archivos ni llamadas externas.

**Integridad** (`entidad_id` no tiene FK): antes de insertar, `recordAudit` comprueba:

1. que el autor sea admin hoy;
2. que el código exista en el catálogo con la entidad esperada;
3. que la fila afectada exista, salvo en los borrados.

Si algo falla lanza `AuditError` (500) y la acción se deshace. Borrar la fila afectada no borra sus registros.

**Inmutable**: ninguna ruta crea, cambia ni borra registros. `POST`, `PUT`, `PATCH` y `DELETE` sobre `/admin/auditoria` y `/admin/auditoria/:id` dan 404, y tampoco hay `GET /admin/auditoria/:id`.

**Bloqueos**: dos lecturas sin bloqueo y un `INSERT`. Las claves foráneas del `INSERT` toman un bloqueo compartido sobre la fila del admin en `usuario` y sobre la del catálogo.

- Nadie bloquea en exclusivo la fila de un admin: la cancelación bloquea solo cuentas `apostador` (D-002), las acciones de participantes rechazan admins y las monedas nunca son de un admin.
- Nadie bloquea el catálogo.
- No toca tickets (nota de T-14 del plan).

Así, no puede cerrar un ciclo con el orden global.

**Consulta** (`GET /admin/auditoria`, solo admin, `no-store`):

- Paginada, de la más reciente a la más antigua (`creado_en DESC, id DESC`), con el total y la página en una misma foto (`withReadSnapshot`).
- **En dos pasos** (corrección de T-17): primero los ids de la página, solo desde `auditoria` (`auditPageSql`), y después esas filas con su acción y su administrador, por clave primaria. Con los JOIN en la misma consulta, MySQL recorría la tabla y ordenaba en memoria (91 a 190 ms con 60 000 registros). Sin filtro o solo con fechas, la pista `INDEX(au idx_auditoria_fecha)` la mantiene en ese índice leído hacia atrás, sin ordenar, también con un OFFSET grande (sin la pista MySQL elegía otro índice y ordenaba). Con filtro por acción, entidad o administrador, MySQL elige el índice que corresponde. Con 60 000 registros, la consulta completa (con el total) tarda de 6 a 13 ms en el servicio y de 14 a 22 ms por HTTP; una prueba revisa el plan con `EXPLAIN`.
- Filtros, con query estricta (400 ante cualquier otra cosa):
  - `accion`: un código;
  - `entidad`: la tabla;
  - `entidadId`: exige `entidad`, porque un id solo no dice de qué tabla es;
  - `usuarioId`: el administrador;
  - `desde` y `hasta`: ISO con zona, inclusivos.
- Fila: `{ id, fecha, accion: { codigo, nombre }, entidad, entidadId, administrador: { id, nombre }, detalle }`. **Sin el correo del administrador**: el id y el nombre alcanzan para saber quién fue.
- Índices nuevos: `idx_auditoria_fecha (creado_en, id)`, `idx_auditoria_accion_entidad (accion_id, entidad_id, creado_en)` e `idx_auditoria_usuario_fecha (usuario_id, creado_en)`. Los dos últimos también sirven a las claves foráneas.

**Esquema**: `auditoria.detalle JSON` y los 26 códigos nuevos de `accion_auditoria` (24 en T-17 y 2 en su corrección, D-005). En la base de desarrollo se aplicaron con `ALTER TABLE` e `INSERT`, sin recrearla. La base de pruebas se recrea sola, y las dos quedaron iguales.

**Pruebas** (`tests/audit.test.ts`, 33):

- El catálogo y el mapa coinciden.
- Un recorrido por HTTP de cada acción (catálogo, partido, resultado, goles, video de gol, multimedia, confirmación, cancelación, borrados), comprobando en cada paso que queda exactamente un registro, con código, entidad, `entidad_id`, autor, fecha y detalle correctos. Los registros de las filas borradas se conservan.
- Pago confirmado, revertido y validación.
- Acciones rechazadas sin registro, incluida una sin CSRF, y lecturas sin registro.
- Un autor que no es admin y un código ausente del catálogo deshacen la acción (500 sin detalles).
- Un reintento por deadlock deja una sola fila.
- Lectura con orden, paginación y cada filtro, 400 por query, 401, 403 y sin rutas de escritura.
- Privacidad: ni la contraseña, ni el hash, ni los tokens CSRF, ni la clave de idempotencia, ni la cookie, ni los correos aparecen en los detalles ni en la respuesta.
- `sanitize`, `cambios` y el tope de tamaño.
- Corrección: el caso del emoji por HTTP (jugador y equipo, alta y edición) y emojis y mitades sueltas en cada posición del corte, validados por MySQL; una edición sin cambios en cada entidad no registra nada (D-004); `admin:create` registra la creación y la promoción, no registra si no hace nada ni si falla, y deshace la creación si el registro falla (D-005); variantes de claves prohibidas; la cota binaria contra MySQL; listas anchas y 150 niveles recortados antes de la base; el plan con 60 000 registros; y que el cambio de imagen de un gol no lleve `archivo`.
- Segunda corrección: la foto de un jugador y el escudo de un equipo que cambian después del carácter 200 (el caso del tester y cambios en las posiciones 200, 201, 204 y en el final) registran el cambio con `recortado`, y reenviar el mismo valor largo no registra; el mismo marcador registrado de nuevo no registra; postergar un partido registra solo `fechaHora`, y las altas de plantel, partido, gol y multimedia y la confirmación no llevan campos calculados; las dos listas de claves (las que se quitan y las legítimas, con la regla de las banderas); `admin:create` perdiendo una creación contra otra corrida y contra un registro, y una promoción contra otra (`tests/create-admin.test.ts` además corre dos procesos reales a la vez). `tests/catalog-names.test.ts`: surrogates sueltos y caracteres de control o invisibles en `escudo` y `foto`.

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

Sin sesión, las dos rutas dan 401. La vista previa usa `requireAuth, requireBettor`: un `pendiente` recibe 403 `USER_NOT_VALIDATED`, y un admin 403 `ADMIN_CANNOT_BET` aunque figure validado. El listado de partidos usa `requireParticipant` desde T-19: no apuesta ni gasta monedas, así que un `pendiente` ve los mismos partidos que podrá apostar (la pantalla le explica por qué todavía no puede), y un admin recibe 403 `NOT_A_PARTICIPANT`. Las respuestas son `no-store`.

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

## Confirmación del ticket (T-10)

Módulo Polla (`services/tickets.service.ts`). Confirma un ticket entero o nada (BR-053) y devuelve el comprobante (BR-025).

| Ruta | Guardia | Respuesta |
|---|---|---|
| `POST /apuestas/tickets` | `requireBettor`, CSRF, header `Idempotency-Key` | 201 con el ticket y `Location: /apuestas/tickets/:id`. Si la clave se repite con el mismo cuerpo, 200 con el mismo ticket y `Idempotent-Replayed: true`. |
| `GET /apuestas/tickets/:id` | sesión | 200 con el comprobante si es del usuario; 404 `TICKET_NOT_FOUND` en cualquier otro caso. |

El cuerpo es el mismo de la vista previa (`{ selecciones: [...] }`, hasta 50). Las dos rutas rechazan cualquier query string.

**Flujo de BR-023 y BR-024.** El resumen es `POST /apuestas/vista-previa` (T-09), que no guarda nada. Confirmar es `POST /apuestas/tickets`. Modificar y cancelar pasan solo en la interfaz (T-19), antes de confirmar: todavía no hay ticket, así que el backend no tiene nada que hacer. Un ticket confirmado no se edita ni se cancela.

**Qué hace la confirmación**, en una sola transacción de `withTransaction` con `READ COMMITTED`:

1. Bloquea al usuario (`FOR UPDATE`). Dos confirmaciones del mismo usuario corren una después de la otra.
2. Busca la clave (BR-054). Si ya existe con la misma huella, devuelve ese ticket sin evaluar ni escribir. Si existe con otra huella, responde 409 `IDEMPOTENCY_KEY_REUSED`.
3. Evalúa con `evaluateTicketInTransaction` (T-09), con los partidos, competiciones y deportes bloqueados. Si `valido` es `false`, responde 409 `TICKET_REJECTED` con la evaluación completa en `details` (`selecciones[].errores`, `errores` del saldo, costo y saldos) y no escribe nada.
4. Inserta el ticket (`creado_en` en UTC, al segundo), y cada selección con estado `pendiente` y `puntos_obtenidos` en NULL, en el orden recibido.
5. Debita con `debitSelections`: un movimiento `seleccion_confirmada` de −1 por selección, cada uno con su `seleccion_id` (D19). El saldo se vuelve a comprobar con el usuario bloqueado.
6. Relee el ticket y lo devuelve.

Cualquier error deshace todo: nunca queda un ticket sin débito, ni un débito sin ticket.

**Idempotencia (BR-054, EsquemaBD D20)**

- El cliente genera un UUID por confirmación y lo repite en los reintentos (doble clic, reintento del navegador, corte de conexión). Se acepta en mayúsculas o minúsculas y se guarda en minúsculas. Falta, vacío, el UUID nulo, con llaves o dos claves juntas: 400 `IDEMPOTENCY_KEY_INVALID`, antes de mirar el cuerpo.
- `ticket.huella_solicitud` es el SHA-256 de las selecciones normalizadas, en orden (`requestFingerprint`). La misma clave con las mismas selecciones en otro orden cuenta como otra solicitud: 409.
- **Duración**: la clave queda en el ticket para siempre, porque los tickets no se borran. Así tampoco duplica un reintento tardío.
- Una confirmación rechazada no guarda nada, así que su clave queda libre para reintentar con otras selecciones.
- La unicidad es por usuario: otro usuario con la misma clave crea su propio ticket.
- **Concurrencia**: dos pedidos con la misma clave esperan uno al otro en el bloqueo del usuario, y el segundo encuentra el ticket del primero. Si igual chocaran en la base (`uq_ticket_usuario_clave`, 1062), la respuesta es 409 `IDEMPOTENCY_KEY_REUSED`, nunca un segundo ticket.
- **Reintento por deadlock**: `withTransaction` repite todo, incluida la búsqueda de la clave. El intento deshecho no dejó nada, así que no crea un segundo ticket. Hay una prueba que provoca un deadlock real contra la confirmación.
- CORS expone `Location` e `Idempotent-Replayed` para que el frontend pueda leerlos. `Idempotency-Key` se acepta como header del pedido.

**Comprobante (BR-025, `TicketView`)**

```json
{ "id": 7, "usuario": { "id": 3, "nombre": "Ana" }, "creadoEn": "2026-09-16T18:00:00.000Z",
  "estado": "pendiente", "cantidadSelecciones": 2, "monedasUtilizadas": 2, "monedasDevueltas": 0, "puntosObtenidos": 0,
  "selecciones": [
    { "id": 21, "partido": { "...": "como en /public/partidos" }, "tipo": "resultado_general",
      "pronostico": "local_gana", "golesLocal": null, "golesVisitante": null,
      "estado": "pendiente", "costo": 1, "puntosObtenidos": null } ] }
```

Todo se calcula al leer; el ticket no guarda ninguno de estos valores (D13, D14):

- **`estado`** (`ticketState`, BR-025 precisado): `pendiente` si alguna selección está pendiente; si no, `anulado` si todas se anularon, y `finalizado` en otro caso.
- **`monedasUtilizadas`**: selecciones × `COSTO_POR_SELECCION`. **`monedasDevueltas`**: la suma de los movimientos `devolucion_cancelacion` de sus selecciones (D-003 de `docs/decisiones.md`, T-17). Antes contaba las selecciones anuladas; una anulada sin débito, o de una cuenta admin (D-002), no devolvió nada.
- **`resultadoReal`** de cada selección (desde T-11): `{ golesLocal, golesVisitante, resultado }` solo con el partido finalizado y completo, si no `null`.
- **`puntosObtenidos`**: la suma de los puntos ya liquidados.
- El partido muestra el marcador con la regla pública (solo finalizado y completo).

**Por qué 404 y no 403 para un ticket ajeno.** Un 403 confirmaría que ese id existe y permitiría recorrer los ids para contar tickets de otros. Con 404, un ticket ajeno y uno inexistente dan exactamente la misma respuesta.
- Un admin no tiene tickets (D16), así que también recibe 404. Las vistas de administración de apuestas son de T-21.
- La ruta pide solo sesión, sin `requireBettor`: un usuario sin tickets recibe 404, igual que cualquiera.

**Pruebas**

- `tests/tickets.test.ts`:
  - Tickets de una y de varias selecciones, de varios partidos, contradictorias y de los dos tipos, con un débito por selección.
  - Rechazo total por cada causa, sin escribir nada. Saldo exacto, insuficiente y excedido. Cierre justo en el borde.
  - Idempotencia: claves inválidas, repetición en cualquier combinación de mayúsculas, cuerpo distinto, clave libre tras un rechazo, claves por usuario, 12 pedidos en paralelo con la misma clave, y un reintento por deadlock real.
  - 15 pedidos en paralelo con saldo para 10: pasan exactamente 10 y el saldo nunca queda negativo.
  - Comprobante: dueño, ajeno, admin, pendiente e inexistente. Acceso: 401, 403 y CSRF.
  - Al final, `checkCoinConsistency` (lo mismo que `npm run coins:check`) no encuentra descuadres.
- `tests/concurrency-stress.test.ts` ahora confirma tickets reales por HTTP: la misma clave tres veces en paralelo por ronda (un solo ticket), más un ticket rechazado y una evaluación, contra las acciones del admin.

## Mis apuestas (T-11)

Módulo Polla (`services/bet-history.service.ts`). Muestra el historial propio (BR-026) y un resumen para la pantalla de T-20. Todo se calcula al leer, con las mismas funciones del comprobante de T-10: `selectionFrom`, `realResult` y `ticketTotals`. No se guarda nada.

| Ruta | Respuesta |
|---|---|
| `GET /apuestas/mis-apuestas` | Paginado. Una fila por selección (`MyBet`): los campos de la selección del comprobante más `ticket: { id, creadoEn, estado, cantidadSelecciones, monedasUtilizadas, monedasDevueltas, puntosObtenidos }`. Filtros: `estado` (de la selección), `estadoTicket`, `ticketId`, `partidoId`, `deporteId`, `competicionId`, `desde` y `hasta` (sobre la fecha del ticket). |
| `GET /apuestas/mis-apuestas/resumen` | `{ tickets: { total, pendiente, finalizado, anulado }, selecciones: { total, pendiente, acertada, no_acertada, anulada }, monedasUtilizadas, monedasDevueltas, puntos, aciertos }`. Sin query. |

**Decisiones**

- **Acceso**: `requireParticipant`, como `/monedas`. Un `pendiente` recibe la lista vacía y el resumen en cero, sin error, porque la pantalla puede mostrarse igual. Un admin recibe 403 `NOT_A_PARTICIPANT`: no participa (BR-001), y un 403 claro evita que el frontend le muestre una sección de apuestas vacía. Todas las consultas filtran por `ticket.usuario_id` del usuario de la sesión, y la query no acepta `usuarioId`.
- **Una fila por selección, no un ticket con sus selecciones.**
  - BR-026 enumera columnas de una apuesta: partido, tipo, pronóstico, resultado real, estado y puntos.
  - Los filtros también son por selección (estado, partido, deporte): con tickets agrupados, habría que decidir si un ticket con una sola selección que coincide muestra las demás.
  - La paginación por fila es simple y estable.
  - Para mostrar tarjetas, T-20 agrupa las filas seguidas con el mismo `ticket.id`, porque vienen ordenadas por ticket. Una página puede cortar un ticket (hasta 50 selecciones); el detalle completo es `GET /apuestas/tickets/:id`.
- **Orden**: `ticket.creado_en DESC, ticket.id DESC, seleccion.id ASC`. Es decir, del ticket más reciente al más antiguo y, dentro del ticket, en el orden en que se armó. El orden por proximidad de BR-013 no aplica: es un registro de lo que el usuario hizo y cuándo, no una lista de partidos, y las selecciones de un mismo ticket pueden ser de partidos muy separados en el tiempo.
- **Resultado real** (`resultadoReal: { golesLocal, golesVisitante, resultado }`): solo con el partido `finalizado` y los dos goles cargados, la misma regla que BR-049 (`realResult`). `resultado` es el resultado general de BR-029 (`resultOfScore`). En cualquier otro caso es `null`, y el partido tampoco muestra goles.
- **Estado del ticket**: la regla de `ticketStateFromCounts` (`lib/betting.ts`). El filtro `estadoTicket` y el resumen usan su versión SQL, `ticketStateCondition`, y una prueba compara las dos para todas las combinaciones.
- **Aciertos y puntos** (BR-042 precisado): aciertos son las selecciones en estado `acertada` de cualquier tipo, y puntos, la suma de `puntos_obtenidos`. T-15 debe usar las mismas definiciones.
- **Monedas**: utilizadas = selecciones × 1; devueltas = la suma de las devoluciones registradas (D-003), con un `LEFT JOIN` a `movimiento_moneda` por `uq_movimiento_seleccion_tipo` (a lo sumo una por selección, así que no duplica filas). Lo mismo en el comprobante, el resumen y las estadísticas del admin.
- **Privacidad**: nunca aparecen la clave de idempotencia, la huella, el email, el saldo ni datos de otro usuario. Una prueba revisa todas las claves de la respuesta.

**Rendimiento** (medido con 20 usuarios, 1000 tickets y 3000 selecciones cada uno):

- La lista va en dos pasos.
  1. La página de ids sale solo de `ticket` y `seleccion`. Los filtros de partido, deporte y competición son subconsultas, y los totales por ticket se calculan solo si se filtra por su estado.
  2. Después se leen, con su partido, solo las filas de esa página, y los totales solo de esos tickets.
  - Antes, cada página armaba y ordenaba las 3000 filas del usuario: unos 190 ms. Con los dos pasos, 28 ms.
  - **Consistencia (corrección en T-12)**: los tres pasos (total, ids y filas) corren en un mismo snapshot de solo lectura (`withReadSnapshot` en `db/transaction.ts`: `START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`). Así el total, la página y los totales de cada ticket describen el mismo momento. El resumen es **una sola sentencia**, porque con dos, un cambio en el medio dejaba cifras que no cuadraban entre sí (la revisión lo vio en 12 de 104 lecturas). Una prueba lee el resumen y la lista mientras otra conexión crea tickets y cambia estados, y verifica que las cifras cuadren. Sin el snapshot, la prueba de la lista falla.
- Índices nuevos (en `01-schema.sql` y `EsquemaBD.md`):
  - `idx_ticket_usuario_fecha (usuario_id, creado_en, id)`.
  - `idx_seleccion_ticket_estado (ticket_id, estado_seleccion_id, puntos_obtenidos)`, que cubre el cálculo de los totales por ticket y reemplaza al índice de la FK.
  - Con ellos, la página tarda unos 16 ms y el resumen unos 12 ms (antes, 21 ms).
- Sigue habiendo un ordenamiento en memoria de los tickets del usuario, porque el orden mezcla dos tablas; se hace sobre índices y crece con los tickets de ese usuario, no con los de toda la base.

**Pruebas** (`tests/bet-history.test.ts`):

- Acceso: anónimo, admin y pendiente.
- Una fila completa comparada campo por campo, y los totales de cada ticket iguales a los de su comprobante.
- Resultado real con el marcador completo, a medias y sin jugar.
- Cada filtro y combinaciones de filtros, paginación y orden.
- Resumen con cifras exactas.
- Privacidad, con dos usuarios.
- Query estricta, y la regla SQL del estado del ticket frente a la de TypeScript.

## Orden de bloqueo y concurrencia (corrección de T-09)

**Problema que se corrigió.** La evaluación del ticket bloqueaba con una sola consulta con JOIN (`... WHERE p.id IN (?) ORDER BY p.id FOR SHARE OF p, d`). Esa consulta no tiene un plan fijo: según las estadísticas, MySQL entraba por `estado_partido` y tomaba next-key locks sobre el índice `fk_partido_estado` (todos los partidos de ese estado, más el supremum). El `UPDATE partido SET estado_partido_id` de `changeMatchState` necesita modificar ese índice, y se formaba un ciclo: el tester vio 6 deadlocks en 8 rondas. `ORDER BY p.id` no fija el orden en que se toman los bloqueos.

**Reglas para toda transacción que bloquee:**

1. **Una sentencia por tabla, por clave primaria, solo sobre ids que existen**: `SELECT id FROM <tabla> FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR UPDATE` (o `FOR SHARE`). Nunca bloquear con un JOIN ni por un índice secundario: su plan puede cambiar y bloquear otras filas, rangos o índices.
   - Bajo `REPEATABLE READ` (el nivel por defecto), bloquear un id que no existe toma un **bloqueo de hueco**: el hueco entre ids vecinos, o hasta el supremum si el id es mayor que el último. Ese bloqueo frena los INSERT en ese hueco (por ejemplo `createMatch`) hasta el commit. Por eso `lockAndReadMatches` primero lee sin bloquear qué partidos existen y bloquea solo esos.
   - Si un partido se borra entre esa lectura y el bloqueo, puede quedar un bloqueo de hueco. Es un caso raro: `deleteMatch` rechaza partidos con apuestas, y el hueco se libera al terminar la transacción.
   - La confirmación de T-10 corre en `READ COMMITTED`, donde las búsquedas no toman bloqueos de hueco. Solo los toman los chequeos de unicidad y de claves foráneas al insertar.
2. **Orden fijo entre tablas**: usuario → partido → plantel → equipo → jugador → competición → deporte. Dentro de una tabla, por id ascendente. Una transacción puede saltarse tablas, pero nunca volver a una anterior.
3. **Datos después de bloquear**: lo que decide una regla se lee con una lectura con bloqueo (o de la fila que devolvió el bloqueo), no con una lectura común tomada antes.
4. Las comprobaciones que solo cuentan (apuestas o goles de un partido, partidos de un deporte) son lecturas sin bloqueo: no entran en el ciclo.

Cómo lo cumple cada escritura:

| Acción | Bloqueos, en orden |
|---|---|
| Confirmar un ticket (T-10) | usuario X → (búsqueda de la clave) → partidos S → competiciones S → deportes S (`lockAndReadMatches`) → inserta el ticket y las selecciones (la FK a `partido` usa el bloqueo que ya tiene) → débito, con el usuario ya bloqueado |
| Evaluar un ticket (T-09) | usuario X → partidos S → competiciones S → deportes S (`lockAndReadMatches`) |
| Monedas (T-05) | usuario X (`applyCoinMovements`, sentencia simple; el rol se lee después) |
| Participantes (T-04) | usuario X (UPDATE condicional por id) |
| `updateMatch`, `deleteMatch` (T-07) | partido X → (si cambian los equipos) equipos S → competición S (`checkTeams`) |
| `createMatch` | equipos S → competición S |
| `setResult` (T-12) | partido X → escribe `partido_equipo` |
| Goles (T-13) | partido X → plantel S (por clave primaria) → escribe `gol` |
| Multimedia (T-13) | partido X → escribe `multimedia_partido` o `gol` (los archivos, fuera de la transacción) |
| `confirmResult` (T-12) | partido X → competición S → deporte S → liquidador (T-14): lee sin bloqueo los ids pendientes del partido y los actualiza por clave primaria (seleccion X, solo esas filas) |
| `cancelMatch` (T-16, `READ COMMITTED`) | (lectura sin bloqueo de los apostadores afectados) → apostadores X, en orden de id → partido X → (relectura; si apareció un usuario nuevo, empieza de nuevo) → seleccion X por clave primaria → devoluciones (los mismos usuarios, ya bloqueados) → partido `cancelado` |
| Auditoría (T-17), al final de cualquiera de estas | lecturas sin bloqueo → `INSERT` en `auditoria` (por las FK, S sobre el admin en `usuario` y sobre `accion_auditoria`; nadie toma X sobre esas filas) |
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
  - Otra prueba evalúa un ticket con un `partidoId` inexistente: no debe quedar ningún bloqueo de hueco (tampoco sobre el supremum de `partido.PRIMARY`), y otra transacción puede crear un partido mientras tanto.
- `tests/concurrency-stress.test.ts` (unos 15 s): 25 rondas sobre unos 50 partidos.
  - En cada ronda corren en paralelo 3 tickets (uno apuesta de verdad como hará T-10, otro es rechazado y otro solo evalúa) y las acciones del admin: postergar, adelantar, editar partidos con las apuestas cerradas (desde T-13 no hay cambios de estado manuales), cambiar `permite_empate` y cargar y confirmar un resultado. Los tickets incluyen los partidos que el admin toca en esa ronda.
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

Opcionales de la corrección de T-18 (D-009): `SESSION_READ_RATE_LIMIT_WINDOW_MS` (60000) y `SESSION_READ_RATE_LIMIT_MAX` (120), el límite propio de `GET /auth/me`. Están también en `compose.yaml`; al cambiarlas hay que reiniciar el servicio `server`.

Opcionales de T-13 (imágenes subidas):

| Variable | Por defecto | Para qué |
|---|---|---|
| `UPLOADS_DIR` | `.data/uploads` | Carpeta de las imágenes, fuera del código. Si es relativa, se resuelve desde donde corre el backend (`server/` en local; `server/.data/` está en `.gitignore`). En Docker, `compose.yaml` la fija en `/data/uploads`, el volumen `uploads-data`. |
| `UPLOAD_MAX_BYTES` | 5242880 (5 MiB) | Tamaño máximo de una subida; como mucho 20 MiB. |
| `UPLOAD_MAX_PIXELS` | 24000000 | Máximo de píxeles (ancho × alto) de una imagen de entrada; como mucho 100 millones. Cada imagen en proceso ocupa unos 4 bytes por píxel (ver "Memoria" en T-13). |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` / `UPLOAD_RATE_LIMIT_MAX` | 900000 / 60 | Subidas por IP, además del límite general. |

Las pruebas nunca escriben en `UPLOADS_DIR`: usan una carpeta temporal por proceso (`tests/helpers/app.ts`) y la borran al terminar.

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

### Usuario del contenedor

El servicio `server` corre como `node` (uid 1000), no como root (corrección de T-13): `USER node` en el `Dockerfile` y `user: node` en `compose.yaml`. Solo escribe las imágenes subidas, en `/data/uploads`, que la imagen crea con dueño `node`.

- Docker copia ese dueño al volumen `uploads-data` cuando lo monta vacío. Se verificó con el volumen existente (vacío): quedó de `node`, y una subida real se guardó con uid 1000.
- Si el volumen ya tuviera archivos de root (por ejemplo, subidas hechas antes de este cambio), el backend no podría escribir y las subidas darían 500. Se corrige una vez con `docker compose run --rm --user root server chown -R node:node /data/uploads`.
- `docker compose exec server ...` (por ejemplo `admin:create` o `coins:check`) también corre como `node`, y no necesita más.

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
