# Verificación final (T-23)

Repaso regla por regla de [business-rules.md](business-rules.md) sobre el sistema construido: las 55 BR y los 6 NFR. Para cada una: **dónde se cumple** (ruta, archivo o pantalla), **cómo se comprueba** (prueba automática o revisión manual) y su **estado**.

Estados:

- **Cumplida** — hace lo que pide la regla.
- **Cumplida (precisión)** — se cumple con una precisión que ya está escrita en `business-rules.md` o en `docs/decisiones.md`.
- **Pendiente** — falta algo; queda anotado en [pendientes.md](pendientes.md).

Las reglas críticas se validan **siempre en backend**; cuando una pantalla también las aplica, es solo para guiar al usuario. Los archivos del backend están bajo `server/src/` y los del front bajo `src/`.

## Roles

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-001** Rol administrador | `/admin/*` (sesión + `requireRole('admin')`, `routes/admin.route.ts`); panel `/admin` con participantes, catálogo, partidos, resultado, goles, multimedia, apuestas, ranking, estadísticas y auditoría (`src/pages/admin/`). El admin **no participa**: `requireBettor` lo rechaza, las acciones de participante responden 404 `NOT_A_PARTICIPANT` y toda consulta de la polla filtra `rol = 'apostador'`. Los roles no se cambian desde la app (solo `npm run admin:create`). | `authorization.test.ts`, `participants-actions.test.ts`, `admin-bets.test.ts`, `ranking.test.ts`, `create-admin.test.ts`; front `panel.test.tsx`, `partidos.test.tsx` | Cumplida |
| **BR-002** Rol usuario | `/apuestas/*`, `/monedas/*`, `/ranking` con `requireBettor`/`requireParticipant`; pantallas `/apuestas`, `/mis-apuestas`, `/ranking`, `/cuenta` | `authorization.test.ts`, `betting.test.ts`, `bet-history.test.ts`; front `Apuestas.test.tsx`, `MisApuestas.test.tsx`, `Ranking.test.tsx` | Cumplida |

## Registro, autenticación y validación

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-003** Registro | `POST /auth/register` (`services/auth.service.ts`): correo único, nombre a mostrar (`displayName`, D-011), contraseña argon2id, id, estado y rol. Nace `apostador` + `pendiente` + pago `pendiente` + 0 monedas. **Contraseña de 6 a 20 caracteres y nada más** (C-01): `newPasswordSchema`, con los números solo en `lib/password.ts`, usada también por `admin:create` | `auth-register.test.ts` (5, 6, 20 y 21 caracteres, y sin exigencias de composición), `create-admin.test.ts`, `catalog-names.test.ts`; front `auth-rules.test.ts`, `auth-pages.test.tsx` | Cumplida (precisión: se entra con el correo, D17) |
| **BR-004** Autenticación | `POST /auth/login`: argon2id, mismo 401 `INVALID_CREDENTIALS` para correo inexistente y contraseña incorrecta, con verificación de relleno. **El límite de 6 a 20 no se aplica al ingresar** (D-024): solo hay un tope técnico (`PASSWORD_VERIFY_MAX_LENGTH`, 128) que no cambia la respuesta ni el tiempo | `auth-session.test.ts` (cuenta con contraseña larga previa, intento demasiado largo y su tiempo), `auth-rate-limits.test.ts`; front `auth-rules.test.ts` | Cumplida (precisión D-024) |
| **BR-005** Estados del usuario | `estado_usuario` (`pendiente`/`validado`); un pendiente entra y navega, `requireBettor` le da 403 `USER_NOT_VALIDATED`; `/apuestas` le muestra los partidos y le explica por qué no puede apostar | `authorization.test.ts`, `betting.test.ts`; front `Apuestas.test.tsx` | Cumplida |
| **BR-006** Validación para participar | `POST /admin/participantes/:id/pago/confirmar` y `/validar` (`services/participant-validation.service.ts`): primero el pago, después la validación; +10 monedas en la misma transacción | `participants-actions.test.ts`; front `panel.test.tsx` | Cumplida |
| **BR-007** Administración de inscritos | `GET /admin/participantes` y `/conteos`: usuario, fecha de inscripción, estado de pago, estado de validación, saldo y puntos; filtros, búsqueda y orden. Solo apostadores | `participants-list.test.ts`; front `panel.test.tsx` | Cumplida |

## Monedas

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-008** Asignación inicial | `grantValidationCoins` (+10, `lib/coins.ts`), una sola vez: `UPDATE` condicionado al estado y barrera D19 en la base (`uq_movimiento_sin_seleccion`) | `participants-actions.test.ts`, `coins-service.test.ts` | Cumplida |
| **BR-009** Saldo | `services/coins.service.ts` es el único que escribe `saldo_monedas` y `movimiento_moneda`; bloquea la fila, rechaza saldo negativo (409 `INSUFFICIENT_BALANCE`) y escribe todo en una transacción | `coins-service.test.ts` (incluida concurrencia), `coins-routes.test.ts`, `npm run coins:check` | Cumplida |
| **BR-010** Visualización del saldo | `SessionBar.tsx` + `CoinIcon.tsx`: contador siempre visible para el apostador (pendiente incluido, con su marca); el admin no lo ve | front `SessionBar.test.tsx`, `Base.test.tsx` | Cumplida |

## Partidos

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-011** Administración de partidos | `/admin/partidos` (`services/matches.service.ts`): alta con deporte (vía competición), competición, local, visita, fecha y hora, estado; edición según estado y apuestas; borrado acotado | `matches.test.ts`; front `partidos.test.tsx` | Cumplida (precisión: el resultado y los goles llegan por T-12/T-13) |
| **BR-012** Estados del partido | `estado_partido` con los cuatro códigos; `en_curso` se calcula (`lib/match-state.ts`, D21), `finalizado` solo al confirmar el resultado y `cancelado` solo en la cancelación; sin cambios manuales | `match-state.test.ts`, `matches.test.ts`, `results.test.ts`, `cancellation.test.ts` | Cumplida |
| **BR-013** Orden de partidos | `lib/match-order.ts` (`proximityOrderBy`), usado por `/public/partidos`, `/admin/partidos` y `/apuestas/partidos`; la portada respeta ese orden | `matches.test.ts`, `public-api.test.ts`, `betting.test.ts`; front `league-pages.test.tsx` | Cumplida |

## Cierre de apuestas y tipos

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-014** Fecha límite (24 h) | `lib/betting.ts` (`bettingCloseTime`, `isBeforeBettingClose`), comprobado en la vista previa y en la confirmación con el partido bloqueado | `betting.test.ts`, `tickets.test.ts`, `match-state.test.ts` | Cumplida |
| **BR-015** Resultado general | `resultado_general` (`local_gana`, `empate`, `visitante_gana`); el empate solo con `deporte.permite_empate`, leído con bloqueo en la misma transacción | `betting.test.ts`, `catalog-sports.test.ts` | Cumplida |
| **BR-016** Marcador exacto | `tipo_apuesta = marcador_exacto`, goles enteros de 0 a 999 (`MAX_GOLES_PRONOSTICO`) | `betting.test.ts` | Cumplida |
| **BR-017** Varias apuestas por partido | Sin `UNIQUE` que las agrupe; repetidas permitidas y marcadas con `repiteA` | `betting.test.ts`, `tickets.test.ts` | Cumplida |
| **BR-018** Combinación de tipos | Cada selección es independiente, con su tipo y su pronóstico | `betting.test.ts`, `settlement.test.ts` | Cumplida |

## Tickets y costo

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **BR-019** Ticket múltiple | `ticket` + `seleccion`, de 1 a 50 selecciones (`MAX_SELECCIONES_POR_TICKET`) | `tickets.test.ts` | Cumplida |
| **BR-020** Costo por selección | `COSTO_POR_SELECCION` = 1 por selección (`lib/coins.ts`, el único lugar con los montos), nunca por partido | `betting.test.ts`, `tickets.test.ts` | Cumplida |
| **BR-021** Validación de saldo | `evaluateTicketInTransaction` + `debitSelections`: saldo insuficiente rechaza el ticket entero | `tickets.test.ts`, `coins-service.test.ts` | Cumplida |
| **BR-022** Descuento al confirmar | La vista previa no escribe nada; el débito ocurre solo en `POST /apuestas/tickets` | `betting.test.ts`, `tickets.test.ts` | Cumplida |
| **BR-023** Resumen previo | `POST /apuestas/vista-previa`: partidos, tipo, pronóstico, costo por selección, cantidad, total, saldo actual y posterior, con el motivo de cada selección inválida; `TicketPanel.tsx` lo muestra | `betting.test.ts`; front `TicketPanel.test.tsx`, `Apuestas.test.tsx` | Cumplida |
| **BR-024** Confirmación explícita | Confirmar, modificar y vaciar viven en la pantalla; solo la confirmación crea el ticket. El borrador se guarda en la pestaña (D-012) | front `Apuestas.test.tsx`, `ticket-draft.test.ts`; backend `tickets.test.ts` | Cumplida |
| **BR-025** Ticket | `GET /apuestas/tickets/:id` (solo el dueño): id, usuario, fecha, selecciones, partidos, pronósticos, tipos, monedas utilizadas, estado y puntos, todo calculado al leer | `tickets.test.ts`; front `Apuestas.test.tsx` (comprobante) | Cumplida |

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
| **BR-039** Monedas y puntos separados | La liquidación nunca escribe `movimiento_moneda` ni `saldo_monedas` | `settlement.test.ts` | Cumplida |
| **BR-040** Cálculo automático | Ocurre en la misma transacción que la confirmación; si falla, no queda confirmada | `settlement.test.ts`, `results.test.ts` | Cumplida |

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
| **BR-045** Partido cancelado | `POST /admin/partidos/:id/cancelacion/confirmar` (`services/match-cancellation.service.ts`): anula las pendientes; vista previa sin efectos y advertencia de que es definitiva | `cancellation.test.ts`; front `partidos.test.tsx` | Cumplida |
| **BR-046** Devolución de monedas | `refundSelectionsBatch`: 1 moneda por selección anulada con débito de una cuenta apostador, con su `seleccion_id` (D19) | `cancellation.test.ts`, `coins-service.test.ts` | Cumplida (precisión D-002: una cuenta admin se anula sin devolución) |
| **BR-047** Tickets con varios partidos | Solo se tocan las selecciones de ese partido; el estado del ticket se deriva | `cancellation.test.ts`, `tickets.test.ts` | Cumplida |

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
| **BR-053** Transacción atómica | `POST /apuestas/tickets` en un solo `withTransaction`: evaluar, insertar y debitar | `tickets.test.ts`, `concurrency-stress.test.ts` | Cumplida |
| **BR-054** Idempotencia | `Idempotency-Key` (UUID) en `ticket.clave_idempotencia` con `UNIQUE(usuario_id, clave)` y `huella_solicitud` (D20) | `tickets.test.ts`; front `Apuestas.test.tsx` | Cumplida |
| **BR-055** Devolución atómica | Anulación, devoluciones, saldos y estado del partido en una transacción; si algo falla, no se aplica nada | `cancellation.test.ts` | Cumplida |

## Requisitos no funcionales

| Regla | Dónde se cumple | Cómo se comprueba | Estado |
|---|---|---|---|
| **NFR-001** Mobile first | Cada hoja parte del ancho de teléfono y crece con `min-width`; recorrido de T-23 a 320, 390, 768, 1024 y 1280 px sin desbordes de página y con objetivos táctiles de 44 px | **Revisión manual en el navegador** (T-23): ninguna prueba automática mide anchos ni tamaños; las del front corren en jsdom, que no hace layout | Cumplida |
| **NFR-002** Responsive | Mismo recorrido en los cinco anchos, en las 18 pantallas (públicas, apostador y panel) | **Revisión manual en el navegador** (T-23), por la misma razón | Cumplida |
| **NFR-003** Pixel art | `src/styles/global.css` (tokens, `pixel-box`, `pixel-bevel`, `pixel-shadow`); sin `border-radius`, sin desenfoques, sin `backdrop-filter`, gradientes en bandas, `steps()` en todo movimiento y todo apagado con `prefers-reduced-motion` | Auditoría automática del CSS (T-23, sobre los archivos) + revisión visual en el navegador | Cumplida |
| **NFR-004** Indicador de monedas | `SessionBar` + `CoinIcon` (sprite 8×8 con `box-shadow`), siempre visible para el apostador | front `SessionBar.test.tsx` | Cumplida |
| **NFR-005** Seguridad | argon2id, sesiones en servidor con cookie `HttpOnly`/`SameSite=Strict`, CSRF en toda escritura, `requireAuth`/`requireRole`/`requireBettor`/`requireParticipant`, zod en body, params y query, límites por IP, subida de imágenes validada por contenido, `helmet`, CORS cerrado y errores sin datos internos | `authorization.test.ts`, `csrf.test.ts`, `auth-rate-limits.test.ts`, `rate-limit.test.ts`, `query-params.test.ts`, `body-errors.test.ts`, `media-lib.test.ts`, `env.test.ts`, `read-secret.test.ts` | Cumplida |
| **NFR-006** Auditoría | `services/audit.service.ts` + `lib/audit.ts`: una fila por escritura del admin, en su misma transacción, con administrador, acción, fecha, registro afectado y detalle acotado; consulta en `GET /admin/auditoria` | `audit.test.ts`; front `panel.test.tsx` | Cumplida |

## Resumen

- **61 reglas revisadas** (55 BR + 6 NFR): todas **cumplidas**, cinco de ellas con una precisión ya documentada en `business-rules.md` o en `docs/decisiones.md` (BR-003, BR-004, BR-011, BR-042 y BR-046).

> Revisado el 2026-09-18 tras el cambio **C-01** (contraseña de 6 a 20 caracteres, D-024): solo cambian BR-003 y BR-004; el resto de la tabla sigue igual.
- Ninguna regla quedó pendiente. Lo que sigue abierto son mejoras y deudas técnicas, no incumplimientos: están en [pendientes.md](pendientes.md).
