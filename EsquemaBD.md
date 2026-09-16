# Esquema BD — La Liga ACP

> **Documento de diseño.** Es la fuente de verdad del esquema. Manda [docs/business-rules.md](docs/business-rules.md): esta versión lo reescribe para modelar la polla deportiva (tarea T-01 de [docs/plan-polla.md](docs/plan-polla.md)). Hay una implementación local en MySQL con Docker (`compose.yaml` y `db/init/`), pero la app **todavía no se conecta**: sigue usando datos estáticos (ver `CLAUDE.md`). Si cambia este documento, `db/init/01-schema.sql` cambia en el mismo cambio.

## Módulos

| Módulo | Contenido | Depende de |
|---|---|---|
| **Acceso** | Usuarios, roles, estado de validación y de pago, sesiones. | — |
| **Informativo** | Deportes, competiciones, equipos, jugadores, partidos y goles. Es el backbone compartido: lo usa tanto la landing/fixture/posiciones como la polla. | Acceso (el admin carga resultados y goles) |
| **Polla** | Tickets, selecciones y las monedas que mueven. | Acceso, Informativo |
| **Auditoría** | Registro de operaciones administrativas relevantes (NFR-006). | Acceso (el admin que actúa); referencia libre, sin FK, a la fila afectada de cualquier módulo |

Regla: **Informativo nunca depende de Polla ni de Auditoría.** La parte informativa (deportes, fixture, tabla de posiciones) funciona sin la polla.

## Convenciones

- **Motor: MySQL 8** (≥ 8.0.16, para que los `CHECK` se apliquen), InnoDB, `utf8mb4`.
- Nombres en `snake_case`, en español: `estado_partido`, `equipo_id`, `es_visita`. En TypeScript se mapean a camelCase.
- `id`: `BIGINT UNSIGNED AUTO_INCREMENT` como clave primaria.
- Fechas: `DATETIME` **siempre en UTC**. MySQL no guarda la zona horaria; la conversión se hace en el backend. No se usa `DEFAULT CURRENT_TIMESTAMP`: el backend fija el valor explícitamente (mismo criterio que ya regía `partido.fecha_hora`).
- Booleanos: `BOOLEAN` (`TINYINT(1)`).
- **Vocabulario:** el torneo habla de **puntos** (3/1/0 en la tabla de posiciones, informativo). La polla habla de **monedas** (lo que un usuario gasta al apostar y gana al validarse) y de **puntos** también, pero son dos cosas distintas entre sí (BR-039): monedas = capacidad para apostar, puntos = rendimiento en la polla. Nunca se mezclan.
- Monedas y puntos de la polla: **enteros** (`SMALLINT UNSIGNED`/`SMALLINT`). Ya no hay `DECIMAL`: la anticipación y las bonificaciones fraccionarias del diseño anterior desaparecen.
- Los **catálogos** tienen un `codigo` único y estable. La lógica filtra por `codigo`, nunca por el número de `id`.
- Lo que se puede calcular **no se guarda**: tabla de posiciones, goleadores, resultado general del partido, ranking de la polla. La única excepción deliberada es `usuario.saldo_monedas` (ver Decisiones).
- Las **reglas de negocio críticas viven en el backend, nunca solo en el frontend** (regla general de la plataforma de apuestas).

## Decisiones

Decisiones que `business-rules.md` no fija y que se tomaron aquí. Las que dependen de que confirmes algo están marcadas **[preguntar]** y se repiten en el resumen de la tarea.

| # | Decisión |
|---|---|
| D1 | Un equipo pertenece a **una sola competición** (y por tanto a un solo deporte, vía `competicion.deporte_id`). |
| D2 | Un jugador puede estar en varios equipos, **pero solo uno por competición**. |
| D3 | **No hay temporadas.** Cada competición es un único torneo, sin edición ni año. |
| D4 | Un jugador **no puede cambiar de equipo** dentro de la misma competición. |
| D5 | Local y visita se guardan en `partido_equipo`, una fila por equipo con `es_visita`. |
| D6 | Los **goles se escriben a mano** por el admin (BR-028), por equipo, en `partido_equipo.goles`. |
| D7 | El **"Resultado" de BR-011 no es una columna**: se deriva comparando `partido_equipo.goles` de las dos filas (BR-029), igual que ya hacía el resto del esquema con lo calculable. |
| D8 | La tabla de posiciones informativa sigue siendo **3 puntos por ganar, 1 por empatar, 0 por perder** (D9 del esquema anterior). `business-rules.md` no toca esta regla: es del módulo Informativo, no de la polla. |
| D9 | **"Fecha" y "Hora" de BR-011 son un solo `fecha_hora DATETIME` en UTC**, no dos columnas. Partirlo reabriría la ambigüedad de zona horaria que el esquema ya evita en todos lados; la UI ya separa fecha y hora de un mismo valor (`formatKickoff`). |
| D10 | El **"resultado inmutable" de BR-032 no es una columna aparte**: el propio paso de `estado_partido` a `finalizado` es el momento de bloqueo. Antes de eso el admin puede editar los goles libremente; después, ni goles ni estado pueden cambiar. Se aplica en el backend (T-12), no hay trigger de base de datos. |
| D11 | El **costo de 1 moneda por selección (BR-020) no se guarda como columna**: es una constante fija de negocio, aplicada por el backend al validar el saldo (BR-021) y al descontar (BR-022). Si algún día el costo variara por tipo de apuesta, ahí sí haría falta una columna. |
| D12 | **`usuario.saldo_monedas` se guarda como columna**, además de registrar cada movimiento en `movimiento_moneda`. Es la única excepción a "lo calculable no se guarda": el saldo nunca debe ser negativo (BR-009), y MySQL no permite un `CHECK` contra una suma de otra tabla. `movimiento_moneda` es la fuente auditable; mantener la columna sincronizada con cada movimiento, en la misma transacción, es responsabilidad del backend. |
| D13 | **Los puntos NO se guardan en `usuario`.** El ranking (BR-041 a BR-044) se calcula con `SUM(seleccion.puntos_obtenidos)` agrupado por usuario, igual que la tabla de posiciones informativa. `seleccion.puntos_obtenidos` sí se guarda por fila (ver `seleccion`) porque el resultado del partido es inmutable una vez confirmado (D10): no hay reliquidación que lo invalide. |
| D14 | **`ticket` no tiene columna de "monedas utilizadas"**: se deriva contando sus selecciones (`COUNT(*)`, cada una cuesta 1 moneda fija). Como una selección anulada no se borra (solo cambia de estado), este conteo es estable en el tiempo y no se descuadra con una cancelación posterior. |
| D15 | El rol `apostador` (código sin cambios respecto del esquema anterior) es el rol "Usuario" de BR-002. Se mantiene ese código para no chocar con el nombre de la tabla `usuario`; el nombre visible sí dice "Usuario". |
| D16 | **El admin no participa en la polla** (decisión del usuario en T-04, BR-001): no se valida, no recibe monedas y no tiene selecciones ni tickets. Lo garantiza el backend (`requireBettor`, las acciones de participantes y la promoción de `admin:create`), no el esquema: una FK no puede mirar el rol. Las consultas de la polla (participantes, conteos, ranking, estadísticas) filtran `rol = apostador`. |
| D17 | **Se entra con el correo; no hay nombre de usuario aparte** (T-03). BR-003/BR-004 piden "usuario **o** correo": el correo ya es único, lo necesita el administrador para contactar al inscrito y no suma otro identificador que validar, reservar y proteger contra enumeración. `nombre` es solo para mostrar y puede repetirse. `business-rules.md` quedó alineado. |
| D18 | **Sesiones en servidor, en la tabla `sesion`** (T-03, NFR-005), no JWT. El logout tiene que invalidar de verdad: con una fila por sesión basta borrarla, mientras que un JWT seguiría siendo válido hasta vencer (o exigiría una lista de revocados, que es otra tabla igual). Se guarda el SHA-256 del token, nunca el token. |
| D19 | **La asignación de +10 es única también en la base** (T-04, BR-008). El backend valida con un `UPDATE` condicionado a `pendiente` y pago `confirmado`, dentro de la misma transacción que el movimiento. Además, `movimiento_moneda` tiene una columna generada `sin_seleccion` con `UNIQUE(usuario_id, tipo_movimiento_id, sin_seleccion)`, así que un segundo movimiento `validacion` del mismo usuario falla en la base aunque alguien lo devolviera a `pendiente` a mano. Un `CHECK` o una columna generada no pueden leer el `codigo` del catálogo; por eso la barrera es "uno por usuario y tipo entre los que no tienen selección", que hoy solo es `validacion`. Si algún día hay otro tipo sin selección que pueda repetirse (un ajuste manual, por ejemplo), hay que revisar este índice. **Límites conocidos de D19** (observados en T-04, sin cambiar el esquema todavía): (1) un movimiento `validacion` con `seleccion_id` cargado a mano esquiva la barrera, porque ahí `sin_seleccion` es NULL; (2) dos movimientos del **mismo tipo** sin selección para el mismo usuario chocan con la UNIQUE aunque sean legítimos. Por eso los débitos (T-10) y las devoluciones (T-16) siempre llevan su `seleccion_id`, y `validacion` nunca. |

**Resueltas el 2026-09-15 (respuesta del usuario, ya reflejada en `business-rules.md`):**

- **"Empate" en `resultado_general` sí está condicionado por `deporte.permite_empate`.** BR-015 ahora lo dice explícitamente: el empate solo se ofrece en deportes que lo admiten (ni se ofrece ni se acepta en Vóley o Básquet). `deporte.permite_empate` queda confirmado en el esquema; la restricción en sí (no ofrecer/aceptar la opción cuando `permite_empate = false`) se aplica en el backend, cuando corresponda (T-09), no en el esquema de T-01.
- **BR-007 ya no pide un "Estado" suelto.** Se eliminó de `business-rules.md`: la tabla de inscritos muestra solo "Estado de pago" y "Estado de validación", exactamente los dos catálogos que ya existían (`estado_pago`, `estado_usuario`). No hace falta ninguna columna nueva.

**Abiertas (no bloquean T-01, pero conviene resolverlas antes de las tareas que las tocan):**

- **Duplicados exactos en `seleccion`:** nada en el esquema impide que un usuario repita la misma selección exacta (mismo partido, mismo tipo, mismo pronóstico), ni dentro de un ticket ni entre tickets. `business-rules.md` no lo prohíbe (BR-017/BR-018 solo muestran pronósticos *distintos* como ejemplo) y no le puse una `UNIQUE` para no bloquear un caso que nadie pidió prohibir. Si se quiere prohibir, es una regla de backend, no de esquema.
- **Idempotencia del ticket (BR-054):** no agregué una columna de clave de idempotencia a `ticket`. El mecanismo concreto (token del cliente, deduplicación por ventana de tiempo, etc.) es una decisión de API que le corresponde a T-10; agregar una columna ahora arriesga atarla a un diseño que todavía no existe.

---

## Módulo Acceso

### rol — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `apostador` (rol "Usuario" de BR-002, D15), `admin` |
| nombre | VARCHAR | Etiqueta visible. |

Un rol por usuario. Los roles no se incluyen entre sí: el `admin` administra y **no apuesta** (D16).

### estado_usuario — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `pendiente`, `validado` (BR-005) |
| nombre | VARCHAR | Etiqueta visible. |

### estado_pago — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `pendiente`, `confirmado` (BR-006) |
| nombre | VARCHAR | Etiqueta visible. |

### usuario
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | Identificador único (BR-003). |
| rol_id | FK → rol | |
| estado_usuario_id | FK → estado_usuario | BR-005. |
| estado_pago_id | FK → estado_pago | BR-006/BR-007. |
| nombre | VARCHAR | Nombre a mostrar (no lo pide BR-003, pero hace falta para "Participante" en el ranking, BR-042, y "Usuario" en la tabla de inscritos, BR-007). |
| email | VARCHAR, único | Es el "usuario o correo electrónico" de BR-003: se usa solo el correo, sin una columna de nombre de usuario aparte (D17). El backend lo guarda recortado y en minúsculas; la collation `_ci` hace que la unicidad tampoco distinga mayúsculas. |
| password_hash | VARCHAR(255) | Nunca texto plano (BR-004). argon2id en formato PHC (`$argon2id$v=19$m=...`), calculado por el backend (T-03). |
| saldo_monedas | SMALLINT UNSIGNED | Ver decisión D12. `DEFAULT 0`. Sin `CHECK` aparte: `UNSIGNED` ya impide un valor negativo por el tipo (a diferencia del viejo `coins_obtenidos`, un `DECIMAL` con signo, que sí necesitaba uno). |
| creado_en | DATETIME (UTC) | Fecha de inscripción (BR-007). |

No es un jugador: son entidades distintas.

El registro por la API siempre crea `apostador`, `pendiente`, pago `pendiente` y saldo 0 (las 10 monedas llegan al validar, BR-008). Un `admin` solo se crea o promueve con el comando del backend (ver `server/README.md`), y solo se promueve una cuenta que nunca participó (pendiente, sin pago, sin monedas, sin movimientos ni tickets).

### sesion
Una sesión iniciada (NFR-005, D18).

| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → usuario | `ON DELETE CASCADE`: una sesión no tiene sentido sin su usuario. |
| token_hash | CHAR(64) ASCII, único | SHA-256 en hex del token aleatorio de la cookie. El token nunca se guarda: una copia de la base no permite entrar. |
| creado_en | DATETIME (UTC) | |
| expira_en | DATETIME (UTC), índice | Vencimiento absoluto (`SESSION_TTL_HOURS`). `CHECK (expira_en > creado_en)`. Índice `idx_sesion_expira_en` para la purga. |

- **Backend:** una sesión vale solo si `expira_en > ahora`. Logout borra la fila. Cada inicio de sesión purga las sesiones vencidas de **todos** los usuarios (hasta 500 por vez, usando el índice) y borra la que traía la cookie, si había una.

---

## Módulo Informativo

### deporte
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| nombre | VARCHAR | Fútbol, Vóley… (BR-001, BR-048). |
| slug | VARCHAR, único | Para filtrar/enrutar por deporte. |
| permite_empate | BOOLEAN | Condiciona si `resultado_general` ofrece "Empate" para partidos de este deporte (BR-015). **Backend (T-06):** solo cambia si ningún partido del deporte salió de `programado` y no hay selecciones sobre sus partidos. |

### competicion — "Competición o torneo" de BR-011
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| deporte_id | FK → deporte | |
| nombre | VARCHAR | |
| slug | VARCHAR | Único por deporte, no global (dos deportes pueden compartir slug). |

`UNIQUE(id, deporte_id)`: para FKs compuestas si algún día hiciera falta bajar `deporte_id` a otra tabla (hoy no hace falta: `equipo`/`partido` se enganchan por `competicion_id`, que ya fija el deporte).

### equipo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| competicion_id | FK → competicion | D1. |
| nombre | VARCHAR | |
| nombre_corto | VARCHAR | No lo pide ninguna BR; se mantiene por continuidad con la landing informativa. |
| escudo | VARCHAR | Ruta o URL del asset. Ídem. **Backend (T-06):** una URL `https://` o una ruta relativa a una imagen (`escudos/boca.webp`), hasta 255 caracteres; sin subida de archivos hasta T-13. |
| color_acento | VARCHAR | Ídem. **Backend (T-06):** `#rrggbb`, guardado en minúsculas. |

`UNIQUE(id, competicion_id)`: permite FKs compuestas que garantizan la competición en otras tablas.

### jugador — la persona
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| nombre | VARCHAR | |
| foto | VARCHAR, opcional | **Backend (T-06):** mismo formato que `equipo.escudo`. |

### plantel — la persona inscrita en un equipo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| jugador_id | FK → jugador | |
| equipo_id | FK → equipo | |
| competicion_id | FK → competicion | Copia de la del equipo, para aplicar D2. |
| numero_camiseta | SMALLINT UNSIGNED | No lo pide ninguna BR; se mantiene por continuidad con la plantilla informativa. **Backend (T-06):** de 1 a 99. |

- `FK(equipo_id, competicion_id) → equipo(id, competicion_id)`: la copia no puede contradecir al equipo.
- `UNIQUE(jugador_id, competicion_id)`: un equipo por competición (D2) y sin cambios de equipo (D4).
- `UNIQUE(equipo_id, numero_camiseta)`.
- `UNIQUE(id, equipo_id)`: para la FK compuesta de `gol`.
- **Backend (T-06):** `competicion_id` sale siempre del equipo; el cliente no lo elige, y si lo manda debe coincidir. Una inscripción solo cambia su número de camiseta (D4: sin transferencias).

**Borrado (T-06).** No hay borrado en cascada ni borrado lógico: el catálogo solo se corrige mientras nada lo usa. El backend rechaza borrar (409, con las cantidades) un deporte con competiciones; una competición con equipos, partidos o jugadores inscritos; un equipo con partidos, jugadores inscritos o goles; un jugador inscrito; o una inscripción con goles. Mover un equipo de competición o una competición de deporte sigue la misma idea: solo mientras nada los ata al lugar actual.

### estado_partido — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `programado`, `en_curso`, `finalizado`, `cancelado` (BR-012) |
| nombre | VARCHAR | Etiqueta visible. |

### partido — el encuentro
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| competicion_id | FK → competicion | BR-011 ("Deporte" se obtiene por `JOIN` a través de `competicion`, sin duplicar la columna). |
| estado_partido_id | FK → estado_partido | |
| jornada | SMALLINT UNSIGNED | No lo pide ninguna BR; se mantiene por continuidad con el fixture agrupado por jornada. |
| fecha_hora | DATETIME (UTC) | D9. Base del cierre de apuestas (BR-014). |
| sede | VARCHAR | No lo pide ninguna BR; se mantiene por continuidad. |

`UNIQUE(id, competicion_id)`: para la FK compuesta de `partido_equipo`.

Índice `idx_partido_fecha_hora (fecha_hora)` (T-07): los filtros por rango de fechas y el orden por proximidad (BR-013) de todas las vistas de partidos.

Índice `idx_partido_jornada (jornada)` (T-08): el fixture público filtrado solo por jornada (`GET /public/partidos?jornada=`). Sin él, MySQL recorría todos los partidos; con 20 competiciones y 3800 partidos lee unos 100. El filtro por deporte no necesita índice propio: pasa por `uq_competicion_deporte_slug` y `fk_partido_competicion` (un `deporte_id` en `partido` duplicaría el dato, ver la regla de arriba).

**Backend (T-07):**

- Alta siempre en `programado`, con sus dos `partido_equipo` en la misma transacción.
- Transiciones: `programado` ↔ `en_curso` desde la API de partidos; `finalizado` solo en T-12 y `cancelado` solo en T-16.
- `finalizado` y `cancelado` bloquean la fila.
- Cambiar la competición o los equipos borra y recrea las dos filas de `partido_equipo`, porque su FK compuesta apunta a `(partido.id, competicion_id)`. Solo se permite sin apuestas ni goles.

### partido_equipo — local y visita, con sus goles
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| partido_id | FK → partido | |
| equipo_id | FK → equipo | |
| competicion_id | FK → competicion | Copia, para las FKs compuestas. |
| es_visita | BOOLEAN | `false` = local, `true` = visita. |
| goles | SMALLINT UNSIGNED, opcional | Lo escribe el admin (D6, BR-028). Vacío hasta que se registra el resultado. |

- `FK(partido_id, competicion_id) → partido(id, competicion_id)` y `FK(equipo_id, competicion_id) → equipo(id, competicion_id)`: el equipo es de la competición del partido.
- `UNIQUE(partido_id, es_visita)`: un solo local y una sola visita.
- `UNIQUE(partido_id, equipo_id)`: un equipo no juega contra sí mismo.
- `UNIQUE(id, equipo_id)`: para la FK compuesta de `gol`.
- **Backend:** cada partido debe tener exactamente 2 filas. Una vez `partido.estado_partido = finalizado`, `goles` queda bloqueado (D10).

### gol — autor de un gol (BR-033)
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| partido_equipo_id | FK → partido_equipo | El lado del partido que anotó. |
| plantel_id | FK → plantel | Quién anotó. |
| equipo_id | FK → equipo | Copia, para las FKs compuestas. |
| minuto | SMALLINT UNSIGNED | Sin tope superior (hay deportes con tiempos extra largos) ni `CHECK` de piso: `UNSIGNED` ya excluye los negativos. |
| imagen | VARCHAR, opcional | BR-033. |
| video | VARCHAR, opcional | BR-033. |

- `FK(partido_equipo_id, equipo_id) → partido_equipo(id, equipo_id)` y `FK(plantel_id, equipo_id) → plantel(id, equipo_id)`: el jugador solo puede anotar para su propio equipo y en un partido donde ese equipo participa.
- Reemplaza a las viejas `partido_jugador`, `estadistica_tipo` y `partido_jugador_estadistica`: ninguna BR pide un sistema genérico de estadísticas por disciplina, y las estadísticas del radar de jugador del frontend (`PlayerStats`) son datos aleatorios de `src/data/`, sin relación con estas tablas (ver `CLAUDE.md`).

### Calculado, no guardado
- **Tabla de posiciones:** a partir de `partido_equipo.goles` en partidos `finalizado`, con 3/1/0 (D8). **Backend (T-08):** `GET /public/competiciones/:id/posiciones`; orden y columnas en BR-050. Usa `fk_equipo_competicion`, el índice por equipo de `partido_equipo` y `uq_partido_equipo_lado` (revisado con `EXPLAIN`).
- **Goleadores:** `COUNT(*)` de `gol` por jugador.
- **Resultado general de un partido:** comparando los `goles` de sus dos filas de `partido_equipo` (D7, BR-029).

---

## Módulo Polla

### tipo_apuesta — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `resultado_general` (BR-015), `marcador_exacto` (BR-016) |
| nombre | VARCHAR | Etiqueta visible. |

### resultado_general — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `local_gana`, `empate`, `visitante_gana` (BR-029) |
| nombre | VARCHAR | Etiqueta visible. |

Se usa dos veces: como pronóstico de una `seleccion` de tipo `resultado_general`, y como resultado derivado de un partido (nunca guardado, D7).

### estado_seleccion — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `pendiente`, `acertada`, `no_acertada`, `anulada` (BR-027) |
| nombre | VARCHAR | Etiqueta visible. |

### ticket
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | Identificador único (BR-025). |
| usuario_id | FK → usuario | |
| creado_en | DATETIME (UTC) | Fecha y hora del ticket (BR-025). |

- Sus selecciones, partidos, pronósticos y tipos de apuesta se leen por `JOIN` a `seleccion`. Monedas usadas y puntos obtenidos son calculados (D14, D13); el ticket no tiene un catálogo de estados propio (`business-rules.md` solo define estados para `seleccion`, BR-027), así que su "estado" se muestra derivado de sus selecciones.

### seleccion — una apuesta individual dentro de un ticket
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| ticket_id | FK → ticket | |
| partido_id | FK → partido | |
| tipo_apuesta_id | FK → tipo_apuesta | |
| pronostico_resultado_id | FK → resultado_general, opcional | Se usa si `tipo_apuesta = resultado_general`. |
| pronostico_goles_local | SMALLINT UNSIGNED, opcional | Se usa si `tipo_apuesta = marcador_exacto`. |
| pronostico_goles_visitante | SMALLINT UNSIGNED, opcional | Ídem. |
| estado_seleccion_id | FK → estado_seleccion | BR-027. |
| puntos_obtenidos | SMALLINT UNSIGNED, opcional | Vacío hasta liquidar. Ver D13. |

- `CHECK`: exactamente una de las dos formas de pronóstico tiene valor (igual patrón que la vieja `ck_mercado_objetivo`, sin depender de otra tabla).
- **Backend:** que la forma usada corresponda al `tipo_apuesta` (por `codigo`), que el partido esté `programado` y dentro del plazo (BR-014, `fecha_hora − 24h`), y que el costo de 1 moneda (D11) no supere el saldo (BR-021).
- `CHECK (puntos_obtenidos IN (0, 1, 3))`: son los únicos valores que produce la tabla de puntuación (BR-035 a BR-038).
- Varias selecciones por partido y por ticket, incluso contradictorias entre sí, están permitidas (BR-017, BR-018): no hay `UNIQUE` que las junte por `usuario_id`/`partido_id` como en el diseño anterior.

### tipo_movimiento — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `validacion` (BR-008, +10), `seleccion_confirmada` (BR-020, −1), `devolucion_cancelacion` (BR-046, +1) |
| nombre | VARCHAR | Etiqueta visible. |

Solo los tres eventos de la tabla 28 que efectivamente mueven monedas; "apuesta incorrecta" y "apuesta acertada" no generan movimiento (la tabla lo dice explícitamente: "sin devolución").

### movimiento_moneda
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → usuario | |
| tipo_movimiento_id | FK → tipo_movimiento | |
| seleccion_id | FK → seleccion, opcional | Vacío en `validacion`; presente en `seleccion_confirmada` y `devolucion_cancelacion`. |
| cantidad | SMALLINT | Con signo: positivo para créditos, negativo para débitos. |
| creado_en | DATETIME (UTC) | |
| sin_seleccion | TINYINT, generada (`STORED`) | `1` si `seleccion_id` es NULL, NULL si no. Nadie la escribe; existe solo para el índice de abajo (D19). |

- `UNIQUE(seleccion_id, tipo_movimiento_id)`: una selección no puede procesarse dos veces con el mismo tipo de movimiento (protege contra reintentos duplicados, en el espíritu de BR-054). No aplica a `validacion` (MySQL no cruza varios `NULL` en un índice único).
- `UNIQUE(usuario_id, tipo_movimiento_id, sin_seleccion)`: como mucho **un** movimiento sin selección por usuario y tipo. Es la barrera de base de datos de BR-008: un usuario no puede recibir dos veces el `validacion` de +10 aunque el backend fallara (D19). A los tipos que siempre llevan selección no los afecta, porque ahí `sin_seleccion` es NULL y MySQL no compara NULL en un índice único.
  - **Límites conocidos de D19** (observados en T-04, sin cambiar el esquema todavía): (1) un movimiento `validacion` con `seleccion_id` cargado a mano esquiva la barrera, porque ahí `sin_seleccion` es NULL; (2) dos movimientos del **mismo tipo** sin selección para el mismo usuario chocan con la UNIQUE aunque sean legítimos. La regla del backend: `seleccion_confirmada` y `devolucion_cancelacion` siempre llevan `seleccion_id`, y `validacion` nunca (ver notas de T-10 y T-16 en `docs/plan-polla.md`).
- `CHECK (cantidad <> 0)`.
- Índice `idx_movimiento_usuario_fecha (usuario_id, creado_en, id)` (T-05): el historial propio, del más reciente al más antiguo, y la suma por usuario de la comprobación de consistencia.
- **Backend:** mantener `usuario.saldo_monedas` sincronizado con la suma de sus movimientos, en la misma transacción que cada inserción (D12, BR-053, BR-055). Desde T-05 hay un único punto que escribe ambos: `server/src/services/coins.service.ts`. Bloquea la fila del usuario, no deja el saldo negativo, inserta los movimientos y fija el saldo nuevo. `npm run coins:check` compara cada saldo con `SUM(cantidad)` y lista los descuadres sin corregirlos.

---

## Módulo Auditoría

### accion_auditoria — catálogo
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| codigo | VARCHAR, único | `validacion_usuario`, `modificacion_partido`, `registro_resultado`, `confirmacion_resultado`, `cancelacion_partido` (NFR-006) |
| nombre | VARCHAR | Etiqueta visible. |
| entidad | VARCHAR | Qué tabla afecta esta acción (`usuario` o `partido`), siempre la misma por código. |

### auditoria
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → usuario | El administrador que actuó. |
| accion_id | FK → accion_auditoria | |
| entidad_id | BIGINT UNSIGNED | El id de la fila afectada. **Sin FK**: apunta a tablas distintas según `accion_id`, y MySQL no admite una FK condicional. Integridad a cargo del backend. |
| creado_en | DATETIME (UTC) | Fecha y hora de la acción. |

---

## Reglas del backend

**Cierre de apuestas a un partido (BR-014).** Se aceptan selecciones nuevas mientras `ahora < partido.fecha_hora − 24h` y `partido.estado_partido = programado` (BR-012).

**Puntos de una selección (BR-035 a BR-038), evaluados por separado al confirmar el resultado:**

| Tipo de apuesta | Condición | Puntos |
|---|---|---|
| `resultado_general` | Acierta el ganador | +3 |
| `resultado_general` | Acierta el empate | +1 |
| `marcador_exacto` | Acierta ambos goles | +3 |
| Cualquiera | No acierta | 0 |

**Liquidar un partido.** Se dispara cuando el admin confirma el resultado y el partido pasa a `finalizado` (D10):
1. Se compara `goles` de las dos filas de `partido_equipo`: gana local, gana visita o empate (D7).
2. Cada `seleccion` de ese `partido_id` se evalúa según la tabla de arriba y pasa a `acertada` o `no_acertada`.
3. Los goles y el estado del partido quedan bloqueados; nada de esto se puede deshacer desde la aplicación (BR-031, BR-032).

**Partido cancelado (BR-045 a BR-047).** El `estado_partido` pasa a `cancelado`:
1. Cada `seleccion` de ese `partido_id` pasa a `anulada` (sin importar el ticket al que pertenezca).
2. Por cada una, se crea un `movimiento_moneda` de tipo `devolucion_cancelacion` con `cantidad = +1`, y se actualiza `usuario.saldo_monedas` en la misma transacción (BR-055).
3. Las demás selecciones del mismo ticket, de otros partidos, no se tocan (BR-047).

**Validar un usuario (BR-006 a BR-008).** El admin pone `estado_usuario = validado`:
1. Se crea un `movimiento_moneda` de tipo `validacion` con `cantidad = +10`, y se actualiza `usuario.saldo_monedas`.
2. Solo debe ocurrir una vez por usuario: el backend lo garantiza validando que el usuario esté hoy en `pendiente` antes de aplicar el cambio (no hay forma de expresar "una sola vez" con una restricción de la tabla, porque no depende del contenido de la fila sino de su transición).

**Ranking de la polla (BR-041 a BR-044).** `SUM(seleccion.puntos_obtenidos)` por usuario, orden `puntos DESC, aciertos DESC` (aciertos = `COUNT(seleccion.estado_seleccion = acertada)`). Empate total: comparten posición (BR-043 lo deja abierto).

**Auditoría (NFR-006).** Cada una de las 5 acciones de `accion_auditoria` inserta una fila en `auditoria` con el admin, la acción y el id de la fila afectada, como parte de la misma operación.

---

## Diagrama

```mermaid
erDiagram
  rol ||--o{ usuario : asigna
  estado_usuario ||--o{ usuario : clasifica
  estado_pago ||--o{ usuario : clasifica
  usuario ||--o{ sesion : inicia

  deporte ||--o{ competicion : agrupa
  competicion ||--o{ equipo : tiene
  competicion ||--o{ partido : agrupa
  estado_partido ||--o{ partido : clasifica
  jugador ||--o{ plantel : "juega en"
  equipo ||--o{ plantel : inscribe
  partido ||--|{ partido_equipo : "local / visita"
  equipo ||--o{ partido_equipo : juega
  partido_equipo ||--o{ gol : anota
  plantel ||--o{ gol : marca

  usuario ||--o{ ticket : arma
  ticket ||--|{ seleccion : agrupa
  partido ||--o{ seleccion : recibe
  tipo_apuesta ||--o{ seleccion : clasifica
  resultado_general ||--o{ seleccion : pronostica
  estado_seleccion ||--o{ seleccion : clasifica

  usuario ||--o{ movimiento_moneda : afecta
  tipo_movimiento ||--o{ movimiento_moneda : clasifica
  seleccion |o--o{ movimiento_moneda : origina

  usuario ||--o{ auditoria : realiza
  accion_auditoria ||--o{ auditoria : clasifica
```
