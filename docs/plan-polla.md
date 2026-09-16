# Plan de la polla deportiva

Desglose de [business-rules.md](business-rules.md) en tareas que se hacen **una por una**, en este orden. Cada tarea la implementa `ejecutor_liga` y la verifica `tester_liga`; al aprobarse se marca `[x]` y se registra en [historial.md](../historial.md).

## Decisiones tomadas (2026-09-15)

- **Backend:** Node + Express + TypeScript sobre el MySQL que ya corre en Docker. API REST consumida por la SPA de React.
- **Fuente de verdad:** manda `business-rules.md`. `EsquemaBD.md` y `db/init/` se reescriben para seguirlo. No hay datos reales, así que la base se recrea desde cero.
- **Alcance:** las 55 reglas BR y los 6 requisitos NFR.
- **Reglas de trabajo** (de `CLAUDE.md`): una tarea a la vez; no se avanza con la actual en error; toda regla crítica se valida en backend; toda funcionalidad nueva lleva pruebas; cambiar una regla obliga a actualizar `business-rules.md`.

## Conflictos con el esquema actual, y cómo se resuelven

| Tema | Esquema actual | `business-rules.md` | Queda |
|---|---|---|---|
| Apuestas por partido | `UNIQUE(usuario_id, mercado_id)`: una | Varias, incluso contradictorias (BR-017, BR-018) | Varias |
| Agrupación | Apuesta suelta | Ticket con selecciones (BR-019) | Ticket + selección |
| Tipos | Ganador de partido, campeón de disciplina | Resultado general y marcador exacto (BR-015, BR-016) | Resultado general y marcador exacto; el campeón se elimina |
| Puntos | 3.5/3/1.5/1 según anticipación, `DECIMAL(5,1)` | Fijos: ganador +3, empate +1, exacto +3 (tabla 27) | Fijos, enteros |
| Monedas | No existen | 10 al validar, 1 por selección, devolución al cancelar (tabla 28) | Saldo + movimientos |
| Estados de partido | `programado`, `en_vivo`, `finalizado`, `suspendido` | `PROGRAMADO`, `EN_CURSO`, `FINALIZADO`, `CANCELADO` (BR-012) | Los de las reglas |
| Usuarios | Rol, sin estado | Estado `PENDIENTE`/`VALIDADO` y pago (BR-005, BR-006) | Con estado y pago |
| Faltantes | — | Goles con autor y multimedia, auditoría, resultado inmutable | Tablas nuevas |

---

## Fase 1 — Cimientos

- [x] **T-01 · Esquema nuevo.** Reescribir `EsquemaBD.md` y `db/init/` según las reglas: usuario con estado y pago, deporte, competición, equipo, jugador, partido, gol, ticket, selección, movimiento de monedas y auditoría. Recrear la base y documentar los conflictos resueltos. *(BR-003, BR-005, BR-011, BR-012, BR-019, BR-025, BR-027, BR-033, NFR-006)*
- [x] **T-02 · Esqueleto del backend.** Proyecto Express + TypeScript, conexión a MySQL, configuración por entorno, manejo de errores, formato de respuestas, `healthcheck`, servicio en `compose.yaml` y Vitest + Supertest con base de pruebas. *(NFR-005)*
- [x] **T-03 · Registro, login y roles.** Alta de cuenta, hash de contraseña, inicio de sesión, sesión o token, autorización por rol y protección de rutas. *(BR-003, BR-004, BR-005, NFR-005)*

## Fase 2 — Participantes y monedas

- [x] **T-04 · Validación de participantes.** Tabla de inscritos para el administrador, validación manual con confirmación de pago y asignación única de 10 monedas. Resolver aquí la barrera de BR-008: hoy nada impide dos asignaciones de +10 al mismo usuario. *(BR-006, BR-007, BR-008)*
- [x] **T-05 · Saldo y movimientos.** Saldo por usuario que nunca queda negativo, registro de cada movimiento y consulta del saldo propio. `usuario.saldo_monedas` puede desincronizarse de `SUM(movimiento_moneda)`: definir cómo se mantienen juntos y una comprobación de consistencia. *(BR-009, tabla 28)*

## Fase 3 — Datos deportivos

- [x] **T-06 · Deportes, competiciones y equipos.** Administración de los catálogos deportivos y sus jugadores. *(BR-001)*
- [x] **T-07 · Partidos.** Alta y edición mientras no haya resultado confirmado, estados, fecha y hora, filtros por deporte y fecha, y orden por proximidad en todas las vistas. Falta un índice sobre `partido.fecha_hora`, que es el orden de BR-013. *(BR-011, BR-012, BR-013)*
- [x] **T-08 · API pública.** Fixture, tabla de posiciones y filtro por deporte para la parte informativa. *(BR-048, BR-049, BR-050)*
  - Nota de T-06 (resuelta en T-08 por decisión del usuario): `equipo` no tiene slug; las páginas públicas identifican al equipo por su id numérico (ver nota de T-22). Las lecturas públicas están en `/public` (ver `server/README.md`).
  - Nota de T-07: todo listado público de partidos (landing, fixture) usa el orden por proximidad de `server/src/lib/match-order.ts` (`proximityOrderBy`), el mismo de `/admin/partidos`. Está definido en BR-013 de business-rules.md.

## Fase 4 — Apuestas

- [ ] **T-09 · Selecciones y cierre.** Tipos de apuesta (resultado general y marcador exacto), varias por partido, costo de 1 moneda por selección, validación de saldo y cierre 24 h antes, todo verificado en backend. *(BR-014 a BR-018, BR-020, BR-021)*
  - Nota de T-06 (BR-015): al crear selecciones, leer `deporte.permite_empate` con `FOR SHARE` en la misma transacción. Así un admin no puede cambiarlo entre la comprobación y la apuesta: `updateSport` bloquea esa fila con `FOR UPDATE` y su guard de Polla cuenta las selecciones.
  - Nota de T-04: toda ruta de apuestas va con `requireAuth, requireBettor` (`server/src/middleware/auth.ts`): solo pasa un apostador validado; un admin recibe 403 `ADMIN_CANNOT_BET` aunque figure validado. Vale también para T-10 y cualquier ruta que gaste monedas.
  - Nota de T-07: al crear selecciones, bloquear la fila del partido con `SELECT ... FOR SHARE` en la misma transacción y comprobar ahí `estado = programado` y `ahora < fecha_hora - 24 h` (`lib/betting.ts`). `updateMatch` y `changeMatchState` bloquean esa fila con `FOR UPDATE`, así que una reprogramación o un inicio no se cruzan con una apuesta. Usar `bettingCloseTime()`, nunca recalcular las 24 h a mano.
- [ ] **T-10 · Confirmación del ticket.** Resumen previo, confirmación explícita, descuento de monedas y creación del ticket en una sola transacción, con protección contra envíos duplicados. *(BR-019, BR-022 a BR-025, BR-053, BR-054)*
  - Nota de T-04 (barrera D19 de `movimiento_moneda`, ver EsquemaBD.md): cada `seleccion_confirmada` **debe** llevar su `seleccion_id`. Un débito sin selección (por ejemplo uno solo por ticket) chocaría con `uq_movimiento_sin_seleccion` desde el segundo ticket del usuario. Además, el backend nunca debe poner `seleccion_id` en un movimiento `validacion`: eso esquivaría la barrera de BR-008.
  - Nota de T-05: los débitos se hacen con `debitSelections(conn, usuario, selecciones)` de `server/src/services/coins.service.ts`, dentro del mismo `withTransaction` que crea el ticket. La conexión tiene que ser la de `withTransaction` (el tipo `TransactionConnection` lo exige y en ejecución se verifica). Crear primero el ticket y las selecciones, y después debitar: el servicio verifica que las selecciones sean de ese usuario.
  - Nota de T-09: validar el ticket con `evaluateTicketInTransaction(conn, usuario, selecciones)` de `server/src/services/betting.service.ts`, dentro del mismo `withTransaction`, y confirmar solo si devuelve `valido: true`. Llamarla primero: ya bloquea al usuario (`FOR UPDATE`) y cada partido, competición y deporte (`FOR SHARE`), con sentencias por clave primaria y en el orden de bloqueo documentado en `server/README.md`, así que cubre la nota de T-08 y la de T-06. Si agrega bloqueos, respetar ese orden; la prueba `tests/concurrency-stress.test.ts` debe seguir sin deadlocks. La confirmación va en el router `/apuestas` (`routes/betting.route.ts`), con el mismo body que `POST /apuestas/vista-previa`.
  - Nota de T-08 (observación del tester en T-07): al confirmar el ticket, bloquear con `FOR UPDATE` (o `FOR SHARE`) **la fila de cada partido** de sus selecciones, en la misma transacción que comprueba estado y cierre y que debita. Así una reprogramación (`updateMatch`, que bloquea esa fila) no se cruza con la confirmación.
- [ ] **T-11 · Mis apuestas.** Historial del usuario con el detalle de cada selección y sus estados. *(BR-026, BR-027)*

## Fase 5 — Resultados y puntos

- [ ] **T-12 · Registro de resultados.** Carga de goles, resultado general derivado, vista previa, confirmación explícita y bloqueo definitivo aplicado en backend. *(BR-028 a BR-032)*
  - Nota de T-07: `finalizado` **solo** llega por la confirmación del resultado; la API de T-07 lo rechaza (409 `INVALID_STATE_TRANSITION`). `partido_equipo.goles` tampoco se escribe en T-07. Confirmar parte de `en_curso`, en la misma transacción que escribe los goles y con la fila del partido bloqueada.
  - Decisión del usuario (T-08): un partido registrado antes de jugarse **puede recibir después su resultado y sus goles aunque su fecha ya pasó**. La lógica de T-12 no debe exigir una fecha futura ni un plazo máximo desde la fecha del partido. Lo que no se permite es crear un partido nuevo con fecha pasada (T-07).
- [ ] **T-13 · Autores de goles.** Jugador, equipo, minuto e imagen o video opcionales. `gol.minuto` no tiene tope y los goles registrados no cuadran automáticamente con el marcador de `partido_equipo`: definir qué se exige. *(BR-033, BR-001)*
  - Nota de T-06: hoy `equipo.escudo` y `jugador.foto` aceptan solo una URL `https://` o una ruta relativa a una imagen, de hasta 255 caracteres (`schemas/catalog.schema.ts`). Cuando llegue la subida de archivos, revisar ese formato junto con `gol.imagen` y `gol.video`.
  - Nota de T-07 (observación del tester en T-06): **no descargar ni procesar desde el servidor** las URLs de `escudo` o `foto` sin una lista de hosts permitidos. Hoy se acepta cualquier host `https`, incluidos `localhost` y `169.254.169.254`, URLs sin extensión y SVG. Si alguna vez el servidor las busca (miniaturas, verificación), eso sería un SSRF.
  - Decisión del usuario (T-08): los goles, sus autores, imágenes y videos se cargan también **después** de la fecha del partido (ver la nota de T-12). No exigir fecha futura.
- [ ] **T-14 · Cálculo de puntos.** Procesamiento automático al confirmar: cada selección se evalúa por separado, con +3, +1, +3 o 0, y los puntos no generan monedas. *(BR-034 a BR-040, tabla 27)*
- [ ] **T-15 · Ranking.** Orden por puntos y luego por aciertos, top 10 con posición, participante, puntos y aciertos, y actualización automática. *(BR-041 a BR-044)*
  - Decisión del usuario (T-04): **el ranking excluye a los administradores** (`rol = 'apostador'` en la consulta), aunque tuvieran selecciones en la base. Los administradores no participan (BR-001).
- [ ] **T-16 · Cancelación.** Anulación de las selecciones del partido cancelado y devolución de sus monedas, sin tocar las demás selecciones del ticket. *(BR-045 a BR-047, BR-055)*
  - Nota de T-04 (barrera D19): cada `devolucion_cancelacion` **debe** llevar el `seleccion_id` que devuelve. Así la protege `UNIQUE(seleccion_id, tipo_movimiento_id)` contra devoluciones dobles. Una devolución agrupada sin selección chocaría con `uq_movimiento_sin_seleccion` en la segunda cancelación que afecte al mismo usuario.
  - Nota de T-05: las devoluciones se hacen con `refundSelections(conn, usuario, selecciones)`, agrupando las selecciones anuladas por usuario, dentro del mismo `withTransaction` que las marca `anulada` (BR-055). El servicio solo devuelve selecciones que tengan su débito y ninguna devolución previa: si alguna no cumple (409 `SELECTION_NOT_DEBITED` o `MOVEMENT_ALREADY_APPLIED`), no se devuelve nada. T-16 tiene que devolver solo las selecciones confirmadas (con débito) del partido cancelado.
  - Nota de T-07: `cancelado` **solo** llega por esta cancelación con devoluciones; la API de T-07 lo rechaza (409 `INVALID_STATE_TRANSITION`). Hay que bloquear la fila del partido con `FOR UPDATE`, igual que T-07.
- [ ] **T-17 · Auditoría.** Registro de las operaciones administrativas relevantes con administrador, acción, fecha y registro afectado. La base no exige que el autor sea administrador ni que `entidad_id` exista: lo garantiza el backend. *(NFR-006)*
  - Nota de T-04: debe cubrir **confirmar pago** y **validar usuario** (y **revertir pago**). Las tres acciones viven en `server/src/services/participant-validation.service.ts` y aceptan `hooks.inTransaction(conn, outcome)`, que corre dentro de la misma transacción antes del commit: la fila de `auditoria` se inserta ahí, con `outcome.actorId`, `outcome.action` y `outcome.participant.id`. Hoy `accion_auditoria` solo tiene `validacion_usuario`; confirmar y revertir el pago necesitan códigos nuevos en el catálogo.
  - Nota de T-06: las escrituras del catálogo deportivo (crear, editar y borrar deporte, competición, equipo, jugador y plantel) aceptan el mismo tipo de gancho: `AdminActionContext.hooks.inTransaction(conn, outcome)` en `server/src/services/admin-action.ts`. El `outcome` trae `action` (`crear_deporte`, `editar_equipo`, `borrar_plantel`...), `entity`, `actorId`, `id`, `before` y `after`. NFR-006 no exige ninguna de estas. Se recomienda auditar **todos los borrados y ediciones**, en especial el cambio de `permite_empate` de un deporte y el cambio de competición de un equipo o de deporte de una competición; las altas son opcionales. Cada una necesita su código en `accion_auditoria` (`entidad`: la tabla correspondiente). Hoy el gancho se inyecta en `createCatalogRouter(pool, { hooks })`.
  - Nota de T-07: **"Modificación de partido" (NFR-006) es obligatoria**. Hay que auditar `crear_partido`, `editar_partido`, `cambiar_estado_partido` y `borrar_partido` con el código `modificacion_partido` (o uno por acción, si se prefiere). Todas pasan por `runAdminAction` con `before` y `after`.

## Fase 6 — Interfaz

- [ ] **T-18 · Entrar y monedas.** Pantallas de registro e inicio de sesión, rutas protegidas por rol y contador de monedas siempre visible en el navbar, con icono pixel art. *(BR-010, NFR-004, NFR-005)*
  - Nota de T-04: la API no acepta query string en `/auth/register`, `/auth/login`, `/auth/me` ni `/auth/logout` (responde 400). Un `?next=` u otro parámetro de la página del front se resuelve en el front y **no se reenvía** a la URL de la API. Ver `server/README.md`.
  - Nota de T-07 (observación del tester en T-06): mostrar `escudo` y `foto` **solo con `<img>`** (o `<PixelImage>`). Nunca incrustar un SVG en el DOM, ni usar esas URLs como `background`, `href` o `iframe`. Pueden ser de cualquier host `https` y ser SVG.
- [ ] **T-19 · Interfaz de apuestas.** Listado con filtros por deporte y fecha, estado visual de cada partido, armado del ticket, resumen y confirmación. *(BR-051, BR-052, BR-023, BR-024)*
  - Nota de T-07: el listado de partidos para apostar usa el orden por proximidad de BR-013 (`lib/match-order.ts`) y muestra `cierreApuestas`, que ya calcula el backend.
- [ ] **T-20 · Mis apuestas y ranking.** Pantallas del historial propio y del ranking. *(BR-026, BR-042)*
- [ ] **T-21 · Panel de administración.** Participantes, partidos, resultados, goles y consulta de apuestas y estadísticas. *(BR-001, BR-007, BR-028 a BR-033)*
  - Decisión del usuario (T-04): **los administradores no participan**. La tabla de participantes, los conteos, las estadísticas de la polla y la consulta de apuestas muestran solo apostadores. Las acciones de pago y validación sobre una cuenta admin responden 404 `NOT_A_PARTICIPANT`.
  - Decisión del usuario (T-03): el panel **no cambia roles**. "Administrar usuarios" es validar, confirmar pago y consultar. Un administrador solo se crea o promueve con `npm run admin:create` desde el servidor (ver `server/README.md`). No agregar al panel ni a la API una acción de cambio de rol.
  - Nota de T-07: la administración de partidos ya existe en `/admin/partidos` (con `POST /:id/estado`). El panel solo ofrece las transiciones de T-07 (`programado` ↔ `en_curso`); finalizar va por T-12 y cancelar por T-16. Mismo orden por proximidad.
- [ ] **T-22 · Landing con datos reales.** La parte informativa deja los datos estáticos y consume la API, sin cambiar la interfaz ni salirse de `src/lib`. *(BR-048 a BR-050)*
  - Nota de T-07 (observación del tester en T-06): mostrar `escudo` y `foto` **solo con `<img>`/`<PixelImage>`**, nunca SVG incrustado ni en otro contexto. Las listas de partidos siguen BR-013 (`lib/match-order.ts`).
  - Decisión del usuario (T-08): los partidos y equipos de la landing actual son **de muestra** (para presentar el concepto). En T-22 se reemplazan por datos de la API, **sin importar** esos datos de ejemplo a la base.
  - Decisión del usuario (T-08): las páginas públicas identifican al equipo por su **id numérico** (`/plantilla/42`). No se agrega slug a `equipo`. Hay que ajustar la ruta `/plantilla/:id`, `SPA_ROUTES` y `vercel.json` si cambia su forma.
  - Nota de T-08: el mapeo de la API pública (`/public`) a los tipos de `src/types` y sus diferencias están en `server/README.md` ("Contrato para T-22").
  - Pendiente de T-08 (a decidir en T-22): `getTeams()` y `getStandings()` no reciben competición, y la API sí la exige (`/public/competiciones/:id/equipos` y `/posiciones`). Hay que decidir qué competición muestra la landing (una fija o la primera de la lista) o agregar un selector de deporte y competición (BR-048).
  - Pendiente de T-08: el fixture viene paginado (máximo 100 por página). `getFixturesByMatchday` debe filtrar por competición (`?competicionId=`) o recorrer todas las páginas (`totalPages`). Si pide solo la primera, pierde partidos.
  - Pendiente de T-08: `getTeamById` con un id que no es número recibe **400** (`VALIDATION_ERROR`, o `INVALID_URL_ENCODING` si trae un `%` mal codificado), no 404. Siempre armar la URL con `encodeURIComponent(id)`. `src/lib` debe tratar 400 y 404 como "no existe", para que la ruta `/plantilla/:id` muestre `NotFound` en los dos casos.

## Fase 7 — Cierre

- [ ] **T-23 · Repaso final.** Revisión de mobile first, responsive, pixel art y seguridad sobre todo lo construido, y documentación actualizada. *(NFR-001, NFR-002, NFR-003, NFR-005)*

---

Cada tarea se da por terminada cuando: lo pedido funciona, tiene pruebas automáticas, `npm run build` pasa sin errores, `tester_liga` la aprueba y queda registrada en `historial.md`.
