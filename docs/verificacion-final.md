# Verificación final (T-23)

Repaso regla por regla de [business-rules.md](business-rules.md) sobre el sistema construido: las 57 BR y los 6 NFR. Para cada una: **dónde se cumple** (ruta, archivo o pantalla), **cómo se comprueba** (prueba automática o revisión manual) y su **estado**.

Estados:

- **Cumplida** — hace lo que pide la regla.
- **Cumplida (precisión)** — se cumple con una precisión que ya está escrita en `business-rules.md` o en `docs/decisiones.md`.
- **Pendiente** — falta algo; queda anotado en [pendientes.md](pendientes.md).

Las reglas críticas se validan **siempre en backend**; cuando una pantalla también las aplica, es solo para guiar al usuario. Los archivos del backend están bajo `server/src/` y los del front bajo `src/`.

## Roles

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-001** Rol administrador | `/admin/*` (sesión + `requireRole('admin')`, `routes/admin.route.ts`); panel `/admin` con participantes (desde C-08, también el restablecimiento de su contraseña), catálogo (desde C-05, con el perfil de estadísticas de cada deporte y las estadísticas de cada inscripción), partidos, resultado, goles, multimedia, apuestas, ranking, estadísticas y auditoría (`src/pages/admin/`). El admin **no participa**: `requireBettor` lo rechaza, las acciones de participante responden 404 `NOT_A_PARTICIPANT` y toda consulta de la polla filtra `rol = 'apostador'`. Los roles no se cambian desde la app (solo `npm run admin:create`). | `authorization.test.ts`, `participants-actions.test.ts`, `admin-bets.test.ts`, `ranking.test.ts`, `create-admin.test.ts`; front `panel.test.tsx`, `partidos.test.tsx` | Cumplida |
| **BR-002** Rol usuario | `/apuestas/*`, `/ranking` (`/monedas/*` se quitó en C-13) con `requireBettor`/`requireParticipant`; pantallas `/apuestas`, `/mis-apuestas`, `/ranking`, `/cuenta` | `authorization.test.ts`, `betting.test.ts`, `bet-history.test.ts`; front `Apuestas.test.tsx`, `MisApuestas.test.tsx`, `Ranking.test.tsx` | Cumplida |

## Registro, autenticación y validación

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-003** Registro | `POST /auth/register` (`services/auth.service.ts`): correo único, nombre a mostrar (`displayName`, D-011), contraseña argon2id, id, estado y rol. Nace `apostador` + `pendiente` + pago `pendiente` (sin monedas desde C-13; `saldo_monedas` queda en 0 por su valor por defecto). **Contraseña de 6 a 20 caracteres y nada más** (C-01): `newPasswordSchema`, con los números solo en `lib/password.ts`, usada también por `admin:create` | `auth-register.test.ts` (5, 6, 20 y 21 caracteres, y sin exigencias de composición), `create-admin.test.ts`, `catalog-names.test.ts`; front `auth-rules.test.ts`, `auth-pages.test.tsx` | Cumplida (precisión: se entra con el correo, D17) |
| **BR-004** Autenticación | `POST /auth/login`: argon2id, mismo 401 `INVALID_CREDENTIALS` para correo inexistente y contraseña incorrecta, con verificación de relleno. **El límite de 6 a 20 no se aplica al ingresar** (D-024): solo hay un tope técnico (`PASSWORD_VERIFY_MAX_LENGTH`, 128) que no cambia la respuesta ni el tiempo. **El admin restablece la contraseña de un participante** (C-08, D-037): `PUT /admin/participantes/:id/contrasena` (`resetParticipantPassword` en `services/participant-validation.service.ts`), con `newPasswordSchema` (6 a 20), argon2id y, en una transacción, el hash nuevo, el cierre de **todas** las sesiones del participante y la auditoría (`restablecimiento_contrasena`, sin la contraseña ni el hash); una cuenta admin es 404 `NOT_A_PARTICIPANT` | `auth-session.test.ts` (cuenta con contraseña larga previa, intento demasiado largo y su tiempo), `auth-rate-limits.test.ts`, `participant-password.test.ts`, `migration-c08.test.ts`; front `auth-rules.test.ts`, `participant-password.test.tsx` | Cumplida (precisiones D-024 y D-037) |
| **BR-005** Estados del usuario | `estado_usuario` (`pendiente`/`validado`); un pendiente entra y navega, `requireBettor` le da 403 `USER_NOT_VALIDATED`; `/apuestas` le muestra los partidos y le explica por qué no puede apostar | `authorization.test.ts`, `betting.test.ts`; front `Apuestas.test.tsx` | Cumplida |
| **BR-006** Validación para participar | `POST /admin/participantes/:id/pago/confirmar` y `/validar` (`services/participant-validation.service.ts`): primero el pago, después la validación; desde C-13 validar no asigna monedas (no escribe `movimiento_moneda` ni `saldo_monedas`) | `participants-actions.test.ts`; front `panel.test.tsx` | Cumplida |
| **BR-007** Administración de inscritos | `GET /admin/participantes` y `/conteos`: usuario, fecha de inscripción, estado de pago, estado de validación y puntos (sin saldo desde C-13); filtros, búsqueda y orden. Solo apostadores | `participants-list.test.ts`; front `panel.test.tsx` | Cumplida |

## Monedas

Desde C-13 (D-042) no hay monedas: estas reglas quedan derogadas y se conservan para que la numeración siga teniendo sentido.

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-008** Asignación inicial | Derogada por C-13 (D-042): validar no asigna monedas. `grantValidationCoins` y `lib/coins.ts` se eliminaron | `participants-actions.test.ts` (validar deja saldo 0 y ningún movimiento; los datos anteriores no se tocan) | Derogada |
| **BR-009** Saldo | Derogada por C-13 (D-042): nada escribe `saldo_monedas` ni `movimiento_moneda` (`services/coins.service.ts` se eliminó; las tablas quedan sin uso) | `tickets.test.ts`, `cancellation.test.ts`, `settlement.test.ts`, `concurrency-stress.test.ts` (ningún movimiento, saldos intactos) | Derogada |
| **BR-010** Visualización del saldo | Derogada por C-13 (D-042): el navbar no muestra monedas (`CoinIcon` se eliminó) | front `SessionBar.test.tsx` (sin contador para el apostador) | Derogada |

## Partidos

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-011** Administración de partidos | `/admin/partidos` (`services/matches.service.ts`): alta con deporte (vía competición), competición, local, visita, fecha y hora, estado; edición según estado y apuestas; borrado acotado | `matches.test.ts`; front `partidos.test.tsx` | Cumplida (precisión: el resultado y los goles llegan por T-12/T-13) |
| **BR-012** Estados del partido | `estado_partido` con los cuatro códigos; `en_curso` se calcula (`lib/match-state.ts`, D21), `finalizado` solo al confirmar el resultado y `cancelado` solo en la cancelación; sin cambios manuales | `match-state.test.ts`, `matches.test.ts`, `results.test.ts`, `cancellation.test.ts` | Cumplida |
| **BR-013** Orden de partidos | `lib/match-order.ts` (`proximityOrderBy`), usado por `/public/partidos`, `/admin/partidos` y `/apuestas/partidos`; la portada respeta ese orden | `matches.test.ts`, `public-api.test.ts`, `betting.test.ts`; front `league-pages.test.tsx` | Cumplida |

## Cierre de apuestas y tipos

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-014** Fecha límite (1 h desde C-12) | `lib/betting.ts` (`HORAS_CIERRE_APUESTAS`, `bettingCloseTime`, `isBeforeBettingClose`), comprobado en la vista previa y en la confirmación con el partido bloqueado | `betting.test.ts` (bordes de 1 h, 1 h y 1 s, 59 min y 23 h), `tickets.test.ts`, `matches.test.ts` (nace cerrado), `match-state.test.ts` | Cumplida |
| **BR-015** Resultado general | `resultado_general` (`local_gana`, `empate`, `visitante_gana`); el empate solo con `deporte.permite_empate`, leído con bloqueo en la misma transacción | `betting.test.ts`, `catalog-sports.test.ts` | Cumplida |
| **BR-016** Marcador exacto | `tipo_apuesta = marcador_exacto`, goles enteros de 0 a 999 (`MAX_GOLES_PRONOSTICO`) | `betting.test.ts` | Cumplida |
| **BR-017** Varias apuestas por partido | Reescrita por C-13: como máximo una de resultado general y una de marcador exacto por participante y partido, contando las ya hechas (sin las anuladas) y las del mismo ticket. `services/betting.service.ts` (`placedSelections`, error por selección `BET_LIMIT_REACHED`, `repiteA` en el error), serializado por el bloqueo del usuario que ya toma el ticket | `betting.test.ts`, `tickets.test.ts` (mismo ticket, tickets distintos, anuladas, 12 tickets a la vez: entra uno), `concurrency-stress.test.ts`; front `Apuestas.test.tsx` | Cumplida (C-13) |
| **BR-018** Combinación de tipos | Cada selección es independiente, con su tipo y su pronóstico; una de cada tipo por partido (C-13) | `betting.test.ts`, `tickets.test.ts`, `settlement.test.ts` | Cumplida |

## Tickets y costo

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-019** Ticket múltiple | `ticket` + `seleccion`, de 1 a 50 selecciones (`MAX_SELECCIONES_POR_TICKET`) | `tickets.test.ts` | Cumplida |
| **BR-020** Costo por selección | Derogada por C-13 (D-042): apostar no cuesta nada; la vista previa y el ticket no llevan costo | `betting.test.ts`, `tickets.test.ts` | Derogada |
| **BR-021** Validación de saldo | Derogada por C-13 (D-042): no hay saldo que validar; un participante con 0 monedas apuesta. La reemplaza el límite de BR-017 | `betting.test.ts`, `tickets.test.ts` | Derogada |
| **BR-022** Descuento al confirmar | Derogada por C-13 (D-042): confirmar no descuenta nada. La vista previa sigue sin escribir nada | `betting.test.ts`, `tickets.test.ts` | Derogada |
| **BR-023** Resumen previo | `POST /apuestas/vista-previa`: partidos, tipo, pronóstico y cantidad, con el motivo de cada selección inválida (también `BET_LIMIT_REACHED`, C-13); sin costo ni saldo desde C-13; `TicketPanel.tsx` lo muestra | `betting.test.ts`; front `TicketPanel.test.tsx`, `Apuestas.test.tsx` | Cumplida |
| **BR-024** Confirmación explícita | Confirmar, modificar y vaciar viven en la pantalla; solo la confirmación crea el ticket. El borrador se guarda en la pestaña (D-012) | front `Apuestas.test.tsx`, `ticket-draft.test.ts`; backend `tickets.test.ts` | Cumplida |
| **BR-025** Ticket | `GET /apuestas/tickets/:id` (solo el dueño): id, usuario, fecha, selecciones, partidos, pronósticos, tipos, estado y puntos, todo calculado al leer (sin monedas desde C-13) | `tickets.test.ts`; front `Apuestas.test.tsx` (comprobante) | Cumplida |

## Historial y resultados

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-026** Mis apuestas | `GET /apuestas/mis-apuestas` y `/resumen`; pantalla `/mis-apuestas` con filtros, agrupado por ticket y enlace al comprobante | `bet-history.test.ts`; front `MisApuestas.test.tsx` | Cumplida |
| **BR-027** Estados de apuesta | `estado_seleccion`: `pendiente`, `acertada`, `no_acertada`, `anulada` | `settlement.test.ts`, `cancellation.test.ts` | Cumplida |
| **BR-028** Registro del resultado | `PUT /admin/partidos/:id/resultado` (0 a 999, desde la hora de inicio, nunca por debajo de los goles con autor) | `results.test.ts` | Cumplida |
| **BR-029** Resultado derivado | `lib/match-result.ts` (`resultOfScore`, `officialResult`), nunca guardado | `results.test.ts`, `public-api.test.ts`, `settlement.test.ts` | Cumplida |
| **BR-030** Vista previa del resultado | `GET /admin/partidos/:id/resultado`: partido, equipos, marcador, ganador o empate, goles con autor, competición, deporte, jornada, fecha, sede, apuestas a liquidar, `avisos` y `problemas` | `results.test.ts`; front `partidos.test.tsx` | Cumplida |
| **BR-031** Confirmación del administrador | `POST .../resultado/confirmar { confirmar: true, golesLocal, golesVisitante }`: marcador visto (409 `RESULT_CHANGED`), ambos lados, 60 minutos cumplidos, sin empate en deporte sin empate; la pantalla advierte que es definitivo | `results.test.ts`; front `partidos.test.tsx` | Cumplida |
| **BR-032** Resultado inmutable | El paso a `finalizado` es el bloqueo (D10): goles, estado, fecha, equipos, jornada, sede y borrado quedan rechazados con 409; la multimedia sí se puede seguir agregando | `results.test.ts`, `goals-media.test.ts`, `matches.test.ts` | Cumplida |
| **BR-033** Autores de goles | `/admin/partidos/:id/goles`: jugador inscrito en ese equipo y competición, minuto 1–120, imagen subida y video por enlace; límites por gol y por partido | `goals-media.test.ts`, `media-lib.test.ts`; front `partidos.test.tsx` | Cumplida |

## Cálculo de apuestas y puntos

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-034** Procesamiento | `settleMatchBets` dentro de la confirmación: cada selección pendiente del partido, una por una | `settlement.test.ts` | Cumplida |
| **BR-035** Ganador (+3) | `lib/points.ts` (`PUNTOS_GANADOR`) y `settleSelection` | `settlement.test.ts` (regla en TS y en SQL comparadas) | Cumplida |
| **BR-036** Empate (+1) | `PUNTOS_EMPATE` | `settlement.test.ts` | Cumplida |
| **BR-037** Marcador exacto (+3) | `PUNTOS_MARCADOR_EXACTO` | `settlement.test.ts` | Cumplida |
| **BR-038** Evaluación independiente | Una fila por selección, evaluadas por separado (también repetidas y contradictorias) | `settlement.test.ts` | Cumplida |
| **BR-039** Monedas y puntos separados | Desde C-13 la polla es solo por puntos: la liquidación asigna puntos y nada más (`settleMatchSelections` no bloquea usuarios ni escribe movimientos) | `settlement.test.ts` (la confirmación no mueve monedas ni las menciona) | Cumplida (precisión C-13) |
| **BR-040** Cálculo automático | Ocurre en la misma transacción que la confirmación (sin premios desde C-13); si algo falla, no queda confirmada | `settlement.test.ts`, `results.test.ts` | Cumplida |
| **BR-057** Premio en monedas por acierto (C-09) | Derogada por C-13 (D-042): la confirmación del resultado no paga premios; `lockPrizeWinners`, `SettlementRestart` y `payPrizesBatch` se eliminaron, y la respuesta y la auditoría ya no llevan `premios`. Los premios pagados antes quedan en la base, sin mostrarse | `settlement.test.ts`, `audit.test.ts`, `concurrency-stress.test.ts`; front `partidos.test.tsx` | Derogada |

## Ranking

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-041** Orden por puntos | `services/ranking.service.ts` (una sentencia con `RANK()`), calculado al leer | `ranking.test.ts` | Cumplida |
| **BR-042** Top 10 | Todas las posiciones de 1 a 10 (tope de 50 filas y `topSinMostrar`), con posición, participante, puntos y aciertos; solo el nombre a mostrar | `ranking.test.ts`; front `Ranking.test.tsx` | Cumplida (precisión T-15: tope de 50 filas) |
| **BR-043** Desempate | `puntos DESC, aciertos DESC`; empate total comparte posición (1, 1, 3) y el orden de presentación es por nombre en español y después por id | `ranking.test.ts` (SQL contra `lib/ranking.ts`) | Cumplida |
| **BR-044** Actualización | Se calcula en cada consulta, así que un resultado confirmado o una anulación se ven en la siguiente | `ranking.test.ts` | Cumplida |

## Cancelación

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-045** Partido cancelado | `POST /admin/partidos/:id/cancelacion/confirmar` (`services/match-cancellation.service.ts`): anula las pendientes; vista previa sin efectos y advertencia de que es definitiva. Desde C-13 sin devolución: bloquea solo el partido (ningún usuario) y no vuelve a empezar | `cancellation.test.ts`; front `partidos.test.tsx` | Cumplida |
| **BR-046** Devolución de monedas | Derogada por C-13 (D-042): cancelar no devuelve nada (`refundSelectionsBatch` se eliminó) | `cancellation.test.ts` (ningún movimiento ni saldo después de cancelar) | Derogada |
| **BR-047** Tickets con varios partidos | Solo se tocan las selecciones de ese partido; el estado del ticket se deriva (la parte de las monedas, derogada por C-13) | `cancellation.test.ts`, `tickets.test.ts` | Cumplida |

## Landing y apuestas

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-048** Filtro por deporte | `CompetitionPicker` en `/` y `/posiciones` (`?deporteId=`, `?competicionId=`, D-021); `GET /public/partidos?deporteId=` | front `league-pages.test.tsx`; backend `public-api.test.ts` | Cumplida |
| **BR-049** Fixture | `GET /public/partidos` y la portada: orden por proximidad, cancelados visibles con su estado, marcador y goles solo con el resultado oficial completo | `public-api.test.ts`, `goals-media.test.ts`; front `league-pages.test.tsx` | Cumplida |
| **BR-050** Tabla de posiciones | `GET /public/competiciones/:id/posiciones` (3/1/0, orden total) y `/posiciones` con las diez columnas (D-023) | `public-api.test.ts`; front `league-pages.test.tsx` | Cumplida |
| **BR-051** Filtros de la interfaz de apuestas | `/apuestas`: deporte, competición, fechas y estado de apuesta, en la URL de la página | `betting.test.ts`; front `Apuestas.test.tsx` | Cumplida |
| **BR-052** Estado visual | `apuesta.estado` (`disponible`, `cerrada`, `en_curso`, `finalizado`, `cancelado`) con icono + palabra (`BetMatchCard`, `PixelIcon`), nunca solo color | `betting.test.ts`; front `Apuestas.test.tsx` | Cumplida |

## Integridad transaccional

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-053** Transacción atómica | `POST /apuestas/tickets` en un solo `withTransaction`: evaluar e insertar (sin débito desde C-13) | `tickets.test.ts`, `concurrency-stress.test.ts` | Cumplida |
| **BR-054** Idempotencia | `Idempotency-Key` (UUID) en `ticket.clave_idempotencia` con `UNIQUE(usuario_id, clave)` y `huella_solicitud` (D20) | `tickets.test.ts`; front `Apuestas.test.tsx` | Cumplida |
| **BR-055** Devolución atómica | Derogada por C-13 (D-042) en la devolución: la anulación y el estado del partido siguen en una transacción; si algo falla, no se aplica nada | `cancellation.test.ts` | Derogada (en la devolución) |

## Apuestas de todos (C-07)

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-056** Apuestas de todos, después del resultado | `GET /apuestas/participantes` (`requireBettor`, `services/participant-bets.service.ts`): solo partidos con el resultado oficial (finalizado con los dos lados), solo tickets de apostadores, sin anuladas; cada fila con el nombre del participante, el partido y el pronóstico, nunca ids de usuario, correo, saldo, ticket, estado ni puntos; filtros por deporte y por nombre; pantalla `/apuestas-de-todos` | `participant-bets.test.ts` (acceso, partido sin confirmar, cancelado, un solo lado, admin, anuladas, filtros, orden, páginas, campos privados, volumen); front `ApuestasDeTodos.test.tsx` | Cumplida |

## Requisitos no funcionales

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **NFR-001** Mobile first | Cada hoja parte del ancho de teléfono y crece con `min-width`; recorrido de T-23 a 320, 390, 768, 1024 y 1280 px sin desbordes de página y con objetivos táctiles de 44 px | **Revisión manual en el navegador** (T-23): ninguna prueba automática mide anchos ni tamaños; las del front corren en jsdom, que no hace layout | Cumplida |
| **NFR-002** Responsive | Mismo recorrido en los cinco anchos, en las 18 pantallas (públicas, apostador y panel) | **Revisión manual en el navegador** (T-23), por la misma razón | Cumplida |
| **NFR-003** Pixel art | `src/styles/global.css` (tokens, `pixel-box`, `pixel-bevel`, `pixel-shadow`); sin `border-radius`, sin desenfoques, sin `backdrop-filter`, gradientes en bandas, `steps()` en todo movimiento y todo apagado con `prefers-reduced-motion` | Auditoría automática del CSS (T-23, sobre los archivos) + revisión visual en el navegador | Cumplida |
| **NFR-004** Indicador de monedas | Derogada por C-13 (D-042): la interfaz no muestra monedas | front `SessionBar.test.tsx` | Derogada |
| **NFR-005** Seguridad | argon2id, sesiones en servidor con cookie `HttpOnly`/`SameSite=Strict`, CSRF en toda escritura, `requireAuth`/`requireRole`/`requireBettor`/`requireParticipant`, zod en body, params y query, límites por IP, subida de imágenes validada por contenido, `helmet`, CORS cerrado y errores sin datos internos | `authorization.test.ts`, `csrf.test.ts`, `auth-rate-limits.test.ts`, `rate-limit.test.ts`, `query-params.test.ts`, `body-errors.test.ts`, `media-lib.test.ts`, `env.test.ts`, `read-secret.test.ts` | Cumplida |
| **NFR-006** Auditoría | `services/audit.service.ts` + `lib/audit.ts`: una fila por escritura del admin (desde C-05, también las estadísticas de una inscripción; desde C-08, el restablecimiento de la contraseña de un participante, con cuántas sesiones se cerraron y nunca la contraseña ni su hash), en su misma transacción, con administrador, acción, fecha, registro afectado y detalle acotado; consulta en `GET /admin/auditoria` | `audit.test.ts`, `enrollment-stats.test.ts`, `participant-password.test.ts`; front `panel.test.tsx` | Cumplida |

## Resumen

- **63 reglas revisadas** (57 BR + 6 NFR): desde C-13, **10 derogadas** (BR-008, BR-009, BR-010, BR-020, BR-021, BR-022, BR-046, BR-055 en la devolución, BR-057 y NFR-004) y el resto **cumplidas**, varias con una precisión ya documentada en `business-rules.md` o en `docs/decisiones.md` (BR-003, BR-004, BR-011, BR-017, BR-039, BR-042).

> Revisado el 2026-09-18 tras el cambio **C-01** (contraseña de 6 a 20 caracteres, D-024): solo cambian BR-003 y BR-004; el resto de la tabla sigue igual.
>
> Revisado el 2026-09-27 tras el cambio **C-05** (estadísticas reales de los jugadores, D-034): ninguna BR las define; se movió dónde se cumplen BR-001 (el catálogo del panel) y NFR-006 (dos acciones auditadas más, también en `business-rules.md`). El resto sigue igual.
>
> Revisado el 2026-09-27 tras el cambio **C-07** (apuestas de todos, D-036): se agrega **BR-056** y se precisa BR-026 (solo las propias; las de los demás, por BR-056). El resto sigue igual.
>
> Revisado el 2026-09-27 tras el cambio **C-08** (el admin restablece la contraseña de un participante, D-037): se precisa BR-004 (también en BR-001 de `business-rules.md`) y se movió dónde se cumplen BR-001 y NFR-006 (una acción auditada más). El resto sigue igual.
>
> Revisado el 2026-09-28 tras el cambio **C-09** (los aciertos también pagan monedas, D-038): se agrega **BR-057**, se precisa BR-039 (el premio sale del acierto, no de los puntos) y se movió dónde se cumple BR-040 (la confirmación también paga). El resto sigue igual.
>
> Revisado el 2026-09-30 tras el cambio **C-13** (se quitan las monedas: la polla es solo por puntos, D-042): se derogan BR-008 a BR-010, BR-020 a BR-022, BR-046, la devolución de BR-055, BR-057 y NFR-004; se reescriben BR-017 y BR-018 (una apuesta de cada tipo por partido) y se precisan BR-039, BR-045 y BR-047. Las tablas y columnas de monedas quedan en la base, sin uso.
- Ninguna regla quedó pendiente. Lo que sigue abierto son mejoras y deudas técnicas, no incumplimientos: están en [pendientes.md](pendientes.md).
