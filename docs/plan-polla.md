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
- [ ] **T-02 · Esqueleto del backend.** Proyecto Express + TypeScript, conexión a MySQL, configuración por entorno, manejo de errores, formato de respuestas, `healthcheck`, servicio en `compose.yaml` y Vitest + Supertest con base de pruebas. *(NFR-005)*
- [ ] **T-03 · Registro, login y roles.** Alta de cuenta, hash de contraseña, inicio de sesión, sesión o token, autorización por rol y protección de rutas. *(BR-003, BR-004, BR-005, NFR-005)*

## Fase 2 — Participantes y monedas

- [ ] **T-04 · Validación de participantes.** Tabla de inscritos para el administrador, validación manual con confirmación de pago y asignación única de 10 monedas. Resolver aquí la barrera de BR-008: hoy nada impide dos asignaciones de +10 al mismo usuario. *(BR-006, BR-007, BR-008)*
- [ ] **T-05 · Saldo y movimientos.** Saldo por usuario que nunca queda negativo, registro de cada movimiento y consulta del saldo propio. `usuario.saldo_monedas` puede desincronizarse de `SUM(movimiento_moneda)`: definir cómo se mantienen juntos y una comprobación de consistencia. *(BR-009, tabla 28)*

## Fase 3 — Datos deportivos

- [ ] **T-06 · Deportes, competiciones y equipos.** Administración de los catálogos deportivos y sus jugadores. *(BR-001)*
- [ ] **T-07 · Partidos.** Alta y edición mientras no haya resultado confirmado, estados, fecha y hora, filtros por deporte y fecha, y orden por proximidad en todas las vistas. Falta un índice sobre `partido.fecha_hora`, que es el orden de BR-013. *(BR-011, BR-012, BR-013)*
- [ ] **T-08 · API pública.** Fixture, tabla de posiciones y filtro por deporte para la parte informativa. *(BR-048, BR-049, BR-050)*

## Fase 4 — Apuestas

- [ ] **T-09 · Selecciones y cierre.** Tipos de apuesta (resultado general y marcador exacto), varias por partido, costo de 1 moneda por selección, validación de saldo y cierre 24 h antes, todo verificado en backend. *(BR-014 a BR-018, BR-020, BR-021)*
- [ ] **T-10 · Confirmación del ticket.** Resumen previo, confirmación explícita, descuento de monedas y creación del ticket en una sola transacción, con protección contra envíos duplicados. *(BR-019, BR-022 a BR-025, BR-053, BR-054)*
- [ ] **T-11 · Mis apuestas.** Historial del usuario con el detalle de cada selección y sus estados. *(BR-026, BR-027)*

## Fase 5 — Resultados y puntos

- [ ] **T-12 · Registro de resultados.** Carga de goles, resultado general derivado, vista previa, confirmación explícita y bloqueo definitivo aplicado en backend. *(BR-028 a BR-032)*
- [ ] **T-13 · Autores de goles.** Jugador, equipo, minuto e imagen o video opcionales. `gol.minuto` no tiene tope y los goles registrados no cuadran automáticamente con el marcador de `partido_equipo`: definir qué se exige. *(BR-033, BR-001)*
- [ ] **T-14 · Cálculo de puntos.** Procesamiento automático al confirmar: cada selección se evalúa por separado, con +3, +1, +3 o 0, y los puntos no generan monedas. *(BR-034 a BR-040, tabla 27)*
- [ ] **T-15 · Ranking.** Orden por puntos y luego por aciertos, top 10 con posición, participante, puntos y aciertos, y actualización automática. *(BR-041 a BR-044)*
- [ ] **T-16 · Cancelación.** Anulación de las selecciones del partido cancelado y devolución de sus monedas, sin tocar las demás selecciones del ticket. *(BR-045 a BR-047, BR-055)*
- [ ] **T-17 · Auditoría.** Registro de las operaciones administrativas relevantes con administrador, acción, fecha y registro afectado. La base no exige que el autor sea administrador ni que `entidad_id` exista: lo garantiza el backend. *(NFR-006)*

## Fase 6 — Interfaz

- [ ] **T-18 · Entrar y monedas.** Pantallas de registro e inicio de sesión, rutas protegidas por rol y contador de monedas siempre visible en el navbar, con icono pixel art. *(BR-010, NFR-004, NFR-005)*
- [ ] **T-19 · Interfaz de apuestas.** Listado con filtros por deporte y fecha, estado visual de cada partido, armado del ticket, resumen y confirmación. *(BR-051, BR-052, BR-023, BR-024)*
- [ ] **T-20 · Mis apuestas y ranking.** Pantallas del historial propio y del ranking. *(BR-026, BR-042)*
- [ ] **T-21 · Panel de administración.** Participantes, partidos, resultados, goles y consulta de apuestas y estadísticas. *(BR-001, BR-007, BR-028 a BR-033)*
- [ ] **T-22 · Landing con datos reales.** La parte informativa deja los datos estáticos y consume la API, sin cambiar la interfaz ni salirse de `src/lib`. *(BR-048 a BR-050)*

## Fase 7 — Cierre

- [ ] **T-23 · Repaso final.** Revisión de mobile first, responsive, pixel art y seguridad sobre todo lo construido, y documentación actualizada. *(NFR-001, NFR-002, NFR-003, NFR-005)*

---

Cada tarea se da por terminada cuando: lo pedido funciona, tiene pruebas automáticas, `npm run build` pasa sin errores, `tester_liga` la aprueba y queda registrada en `historial.md`.
