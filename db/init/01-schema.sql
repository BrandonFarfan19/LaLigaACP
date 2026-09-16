-- La Liga ACP — esquema completo según EsquemaBD.md y docs/business-rules.md (T-01).
-- Lo ejecuta el entrypoint de MySQL una sola vez, sobre MYSQL_DATABASE, con el volumen vacío.
-- Motor InnoDB, utf8mb4 / utf8mb4_unicode_ci. Todas las DATETIME se guardan en UTC.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET time_zone = '+00:00';

-- ---------------------------------------------------------------------------
-- Módulo Acceso
-- ---------------------------------------------------------------------------

CREATE TABLE rol (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_rol_codigo UNIQUE (codigo),
  CONSTRAINT ck_rol_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-005: pendiente no puede apostar, validado sí.
CREATE TABLE estado_usuario (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estado_usuario_codigo UNIQUE (codigo),
  CONSTRAINT ck_estado_usuario_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-006/BR-007: confirmación de pago, previa e independiente de la validación.
CREATE TABLE estado_pago (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estado_pago_codigo UNIQUE (codigo),
  CONSTRAINT ck_estado_pago_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-003/BR-004: identificador único (id), correo (email, único; es el dato
-- para entrar), contraseña (password_hash, argon2id, nunca texto plano),
-- estado y rol. BR-009: saldo nunca negativo;
-- se guarda como columna (ver "Decisiones" en EsquemaBD.md) además del historial
-- en movimiento_moneda. Sin CHECK aparte: SMALLINT UNSIGNED ya impide un valor
-- negativo por el tipo (a diferencia del viejo coins_obtenidos, un DECIMAL con
-- signo, que sí necesitaba uno).
CREATE TABLE usuario (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  rol_id            BIGINT UNSIGNED   NOT NULL,
  estado_usuario_id BIGINT UNSIGNED   NOT NULL,
  estado_pago_id    BIGINT UNSIGNED   NOT NULL,
  nombre            VARCHAR(100)      NOT NULL,
  email             VARCHAR(254)      NOT NULL,
  password_hash     VARCHAR(255)      NOT NULL,
  saldo_monedas     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  creado_en         DATETIME          NOT NULL COMMENT 'UTC',
  PRIMARY KEY (id),
  CONSTRAINT uq_usuario_email UNIQUE (email),
  CONSTRAINT fk_usuario_rol FOREIGN KEY (rol_id) REFERENCES rol (id),
  CONSTRAINT fk_usuario_estado_usuario FOREIGN KEY (estado_usuario_id) REFERENCES estado_usuario (id),
  CONSTRAINT fk_usuario_estado_pago FOREIGN KEY (estado_pago_id) REFERENCES estado_pago (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- NFR-005 (T-03): sesiones del lado del servidor. La cookie lleva un token
-- aleatorio; aquí solo se guarda su SHA-256 (una copia de la base no sirve para
-- entrar). Logout borra la fila, así que la sesión queda invalidada de verdad.
-- ON DELETE CASCADE: una sesión no tiene sentido sin su usuario.
-- idx_sesion_expira_en: cada login purga las sesiones vencidas de todos.
CREATE TABLE sesion (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 hex del token de la cookie',
  creado_en  DATETIME        NOT NULL COMMENT 'UTC',
  expira_en  DATETIME        NOT NULL COMMENT 'UTC',
  PRIMARY KEY (id),
  CONSTRAINT uq_sesion_token_hash UNIQUE (token_hash),
  INDEX idx_sesion_expira_en (expira_en),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE,
  CONSTRAINT ck_sesion_expiracion CHECK (expira_en > creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Módulo Informativo (backbone compartido: landing/fixture/posiciones y polla)
-- ---------------------------------------------------------------------------

-- BR-001/BR-048: "Fútbol", "Vóley"... permite_empate sigue controlando si el
-- resultado general de esa disciplina admite empate (ver EsquemaBD.md, abierto).
CREATE TABLE deporte (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre         VARCHAR(100)    NOT NULL,
  slug           VARCHAR(100)    NOT NULL,
  permite_empate BOOLEAN         NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_deporte_slug UNIQUE (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-011: "Competición o torneo", distinta del deporte. Sin temporadas: cada
-- competición es un único torneo (ver decisión, análoga a la vieja D3).
CREATE TABLE competicion (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deporte_id BIGINT UNSIGNED NOT NULL,
  nombre     VARCHAR(100)    NOT NULL,
  slug       VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_competicion_id_deporte UNIQUE (id, deporte_id),
  CONSTRAINT uq_competicion_deporte_slug UNIQUE (deporte_id, slug),
  CONSTRAINT fk_competicion_deporte FOREIGN KEY (deporte_id) REFERENCES deporte (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un equipo pertenece a una sola competición (y por tanto a un solo deporte,
-- vía competicion.deporte_id).
CREATE TABLE equipo (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  competicion_id BIGINT UNSIGNED NOT NULL,
  nombre         VARCHAR(100)    NOT NULL,
  nombre_corto   VARCHAR(50)     NOT NULL,
  escudo         VARCHAR(255)    NOT NULL,
  color_acento   VARCHAR(32)     NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_equipo_id_competicion UNIQUE (id, competicion_id),
  CONSTRAINT fk_equipo_competicion FOREIGN KEY (competicion_id) REFERENCES competicion (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jugador (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100)    NOT NULL,
  foto   VARCHAR(255)    NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La persona inscrita en un equipo de una competición: un equipo por
-- competición, sin cambios durante el torneo (igual que las viejas D2/D4).
CREATE TABLE plantel (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  jugador_id      BIGINT UNSIGNED   NOT NULL,
  equipo_id       BIGINT UNSIGNED   NOT NULL,
  competicion_id  BIGINT UNSIGNED   NOT NULL,
  numero_camiseta SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_plantel_jugador_competicion UNIQUE (jugador_id, competicion_id),
  CONSTRAINT uq_plantel_equipo_camiseta UNIQUE (equipo_id, numero_camiseta),
  CONSTRAINT uq_plantel_id_equipo UNIQUE (id, equipo_id),
  CONSTRAINT fk_plantel_jugador FOREIGN KEY (jugador_id) REFERENCES jugador (id),
  CONSTRAINT fk_plantel_competicion FOREIGN KEY (competicion_id) REFERENCES competicion (id),
  CONSTRAINT fk_plantel_equipo_competicion FOREIGN KEY (equipo_id, competicion_id)
    REFERENCES equipo (id, competicion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-012: estados mínimos del partido.
CREATE TABLE estado_partido (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estado_partido_codigo UNIQUE (codigo),
  CONSTRAINT ck_estado_partido_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-011: competición, equipos, fecha, hora (fecha_hora combinada, ver
-- EsquemaBD.md), estado. "Resultado" y los goles por equipo se resuelven en
-- partido_equipo, nunca aquí (ver decisión).
-- idx_partido_fecha_hora (T-07): rangos de fechas y orden por proximidad (BR-013).
-- idx_partido_jornada (T-08): el fixture filtrado solo por jornada (sin él, recorre la tabla).
CREATE TABLE partido (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  competicion_id    BIGINT UNSIGNED   NOT NULL,
  estado_partido_id BIGINT UNSIGNED   NOT NULL,
  jornada           SMALLINT UNSIGNED NOT NULL,
  fecha_hora        DATETIME          NOT NULL COMMENT 'UTC',
  sede              VARCHAR(150)      NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_partido_id_competicion UNIQUE (id, competicion_id),
  INDEX idx_partido_fecha_hora (fecha_hora),
  INDEX idx_partido_jornada (jornada),
  CONSTRAINT fk_partido_competicion FOREIGN KEY (competicion_id) REFERENCES competicion (id),
  CONSTRAINT fk_partido_estado FOREIGN KEY (estado_partido_id) REFERENCES estado_partido (id),
  CONSTRAINT ck_partido_jornada CHECK (jornada >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D5/D6 (heredadas): una fila por lado del partido, con sus goles escritos a
-- mano por el admin (BR-028). "Goles del equipo local/visitante" (BR-011) es
-- esta misma tabla leída dos veces (es_visita = false / true).
-- Backend: cada partido debe tener exactamente 2 filas.
CREATE TABLE partido_equipo (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  partido_id     BIGINT UNSIGNED   NOT NULL,
  equipo_id      BIGINT UNSIGNED   NOT NULL,
  competicion_id BIGINT UNSIGNED   NOT NULL,
  es_visita      BOOLEAN           NOT NULL,
  goles          SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_partido_equipo_lado UNIQUE (partido_id, es_visita),
  CONSTRAINT uq_partido_equipo_equipo UNIQUE (partido_id, equipo_id),
  CONSTRAINT uq_partido_equipo_id_equipo UNIQUE (id, equipo_id),
  CONSTRAINT fk_partido_equipo_competicion FOREIGN KEY (competicion_id) REFERENCES competicion (id),
  CONSTRAINT fk_partido_equipo_partido_competicion FOREIGN KEY (partido_id, competicion_id)
    REFERENCES partido (id, competicion_id),
  CONSTRAINT fk_partido_equipo_equipo_competicion FOREIGN KEY (equipo_id, competicion_id)
    REFERENCES equipo (id, competicion_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-033: autor de un gol. Referencia el lado del partido que anotó
-- (partido_equipo_id), nunca partido_id directo (se llega por ahí), igual que
-- la vieja partido_jugador. El jugador solo puede anotar para su propio
-- equipo y en un partido donde ese equipo participa.
-- T-13: imagen es el nombre de un archivo subido y reprocesado por el backend
-- (32 hex + .webp, en la carpeta UPLOADS_DIR); video, un enlace https
-- normalizado a una plataforma permitida (server/src/lib/video-links.ts).
-- minuto va de 1 a 120: el partido dura 60 y queda margen para descuentos.
CREATE TABLE gol (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  partido_equipo_id BIGINT UNSIGNED   NOT NULL,
  plantel_id        BIGINT UNSIGNED   NOT NULL,
  equipo_id         BIGINT UNSIGNED   NOT NULL,
  minuto            SMALLINT UNSIGNED NOT NULL,
  imagen            CHAR(37)          CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'archivo subido (T-13)',
  video             VARCHAR(255)      NULL COMMENT 'enlace https a una plataforma permitida (T-13)',
  PRIMARY KEY (id),
  CONSTRAINT uq_gol_imagen UNIQUE (imagen),
  CONSTRAINT ck_gol_minuto CHECK (minuto BETWEEN 1 AND 120),
  CONSTRAINT ck_gol_imagen CHECK (imagen IS NULL OR REGEXP_LIKE(imagen, '^[0-9a-f]{32}[.]webp$', 'c')),
  CONSTRAINT ck_gol_video CHECK (video IS NULL OR video LIKE 'https://%'),
  CONSTRAINT fk_gol_equipo FOREIGN KEY (equipo_id) REFERENCES equipo (id),
  CONSTRAINT fk_gol_partido_equipo FOREIGN KEY (partido_equipo_id, equipo_id)
    REFERENCES partido_equipo (id, equipo_id),
  CONSTRAINT fk_gol_plantel FOREIGN KEY (plantel_id, equipo_id)
    REFERENCES plantel (id, equipo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- T-13 (BR-001, BR-033): imágenes y videos del partido (no de un gol). Cada fila
-- es una imagen subida o un enlace a video, nunca las dos cosas. No cambian el
-- resultado ni los puntos: se pueden agregar desde que el partido empieza,
-- también después de confirmarlo.
CREATE TABLE multimedia_partido (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  partido_id BIGINT UNSIGNED NOT NULL,
  imagen     CHAR(37)        CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'archivo subido',
  video      VARCHAR(255)    NULL COMMENT 'enlace https a una plataforma permitida',
  creado_en  DATETIME        NOT NULL COMMENT 'UTC',
  PRIMARY KEY (id),
  INDEX idx_multimedia_partido (partido_id, id),
  CONSTRAINT uq_multimedia_imagen UNIQUE (imagen),
  CONSTRAINT fk_multimedia_partido FOREIGN KEY (partido_id) REFERENCES partido (id),
  CONSTRAINT ck_multimedia_tipo CHECK ((imagen IS NULL) <> (video IS NULL)),
  CONSTRAINT ck_multimedia_imagen CHECK (imagen IS NULL OR REGEXP_LIKE(imagen, '^[0-9a-f]{32}[.]webp$', 'c')),
  CONSTRAINT ck_multimedia_video CHECK (video IS NULL OR video LIKE 'https://%')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Módulo Polla
-- ---------------------------------------------------------------------------

-- BR-015/BR-016.
CREATE TABLE tipo_apuesta (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_tipo_apuesta_codigo UNIQUE (codigo),
  CONSTRAINT ck_tipo_apuesta_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-029: LOCAL_GANA / EMPATE / VISITANTE_GANA. Se usa como pronóstico en
-- seleccion (tipo resultado_general) y como resultado derivado (calculado,
-- nunca guardado en partido) al comparar los goles de partido_equipo.
CREATE TABLE resultado_general (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_resultado_general_codigo UNIQUE (codigo),
  CONSTRAINT ck_resultado_general_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-027: estados mínimos de una selección.
CREATE TABLE estado_seleccion (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estado_seleccion_codigo UNIQUE (codigo),
  CONSTRAINT ck_estado_seleccion_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-019/BR-025: agrupa una o varias selecciones confirmadas juntas.
-- BR-054 (T-10): clave_idempotencia es el UUID que el cliente manda en el
-- header Idempotency-Key al confirmar; uq_ticket_usuario_clave impide dos
-- tickets con la misma clave para el mismo usuario. huella_solicitud es el
-- SHA-256 de las selecciones pedidas: la misma clave con otras selecciones es
-- un error, no el mismo ticket. La clave dura lo que dura el ticket.
-- idx_ticket_usuario_fecha (T-11): los tickets de un usuario, del más reciente al más antiguo.
CREATE TABLE ticket (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id         BIGINT UNSIGNED NOT NULL,
  creado_en          DATETIME        NOT NULL COMMENT 'UTC',
  clave_idempotencia CHAR(36)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UUID en minúsculas (BR-054)',
  huella_solicitud   CHAR(64)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 hex de las selecciones pedidas',
  PRIMARY KEY (id),
  CONSTRAINT uq_ticket_usuario_clave UNIQUE (usuario_id, clave_idempotencia),
  INDEX idx_ticket_usuario_fecha (usuario_id, creado_en, id),
  CONSTRAINT fk_ticket_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id),
  CONSTRAINT ck_ticket_clave CHECK (REGEXP_LIKE(clave_idempotencia, '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'c')),
  CONSTRAINT ck_ticket_huella CHECK (REGEXP_LIKE(huella_solicitud, '^[0-9a-f]{64}$', 'c'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-014 a BR-018: una selección por apuesta individual, varias por partido y
-- por ticket, incluso con pronósticos contradictorios. ck_seleccion_pronostico
-- exige exactamente una de las dos formas de pronóstico (por tipo, igual que
-- la vieja ck_mercado_objetivo); que la forma usada corresponda al
-- tipo_apuesta (por código) es responsabilidad del backend. Costo (BR-020,
-- fijo en 1 moneda) no se guarda por selección: es una constante de negocio.
CREATE TABLE seleccion (
  id                         BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  ticket_id                  BIGINT UNSIGNED   NOT NULL,
  partido_id                 BIGINT UNSIGNED   NOT NULL,
  tipo_apuesta_id            BIGINT UNSIGNED   NOT NULL,
  pronostico_resultado_id    BIGINT UNSIGNED   NULL,
  pronostico_goles_local     SMALLINT UNSIGNED NULL,
  pronostico_goles_visitante SMALLINT UNSIGNED NULL,
  estado_seleccion_id        BIGINT UNSIGNED   NOT NULL,
  puntos_obtenidos           SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  -- T-11: las selecciones de un ticket con su estado y sus puntos, sin leer la fila
  -- (estado y totales del ticket, "Mis apuestas"). También es el índice de la FK.
  INDEX idx_seleccion_ticket_estado (ticket_id, estado_seleccion_id, puntos_obtenidos),
  -- T-14: las selecciones pendientes de un partido, que se liquidan al confirmar
  -- su resultado (y las que cuenta la vista previa). También es el índice de la FK.
  INDEX idx_seleccion_partido_estado (partido_id, estado_seleccion_id),
  CONSTRAINT fk_seleccion_ticket FOREIGN KEY (ticket_id) REFERENCES ticket (id),
  CONSTRAINT fk_seleccion_partido FOREIGN KEY (partido_id) REFERENCES partido (id),
  CONSTRAINT fk_seleccion_tipo_apuesta FOREIGN KEY (tipo_apuesta_id) REFERENCES tipo_apuesta (id),
  CONSTRAINT fk_seleccion_pronostico_resultado FOREIGN KEY (pronostico_resultado_id) REFERENCES resultado_general (id),
  CONSTRAINT fk_seleccion_estado FOREIGN KEY (estado_seleccion_id) REFERENCES estado_seleccion (id),
  CONSTRAINT ck_seleccion_pronostico CHECK (
    (pronostico_resultado_id IS NOT NULL AND pronostico_goles_local IS NULL AND pronostico_goles_visitante IS NULL)
    OR
    (pronostico_resultado_id IS NULL AND pronostico_goles_local IS NOT NULL AND pronostico_goles_visitante IS NOT NULL)
  ),
  CONSTRAINT ck_seleccion_puntos CHECK (puntos_obtenidos IS NULL OR puntos_obtenidos IN (0, 1, 3))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla 28 de business-rules.md: solo los eventos que mueven monedas.
CREATE TABLE tipo_movimiento (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_tipo_movimiento_codigo UNIQUE (codigo),
  CONSTRAINT ck_tipo_movimiento_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- BR-009/BR-053/BR-055: historial inmutable de cada cambio de saldo.
-- cantidad con signo (+10, -1, +1...); uq_movimiento_seleccion_tipo evita
-- procesar dos veces el mismo evento sobre la misma selección (p. ej. una
-- devolución duplicada); no aplica a "validacion", que no tiene selección.
-- Para esa (BR-008, T-04): sin_seleccion vale 1 solo si no hay selección, y
-- uq_movimiento_sin_seleccion permite un único movimiento sin selección por
-- usuario y tipo: una sola asignación de +10 aunque el backend fallara. Los
-- tipos con selección no se ven afectados (NULL no choca en un UNIQUE).
-- idx_movimiento_usuario_fecha (T-05): historial propio, del más reciente al
-- más antiguo, y la suma por usuario de la comprobación de consistencia.
CREATE TABLE movimiento_moneda (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id         BIGINT UNSIGNED NOT NULL,
  tipo_movimiento_id BIGINT UNSIGNED NOT NULL,
  seleccion_id       BIGINT UNSIGNED NULL,
  cantidad           SMALLINT        NOT NULL,
  creado_en          DATETIME        NOT NULL COMMENT 'UTC',
  sin_seleccion      TINYINT UNSIGNED
    GENERATED ALWAYS AS (IF(seleccion_id IS NULL, 1, NULL)) STORED
    COMMENT '1 si no hay selección; NULL si la hay. Solo para uq_movimiento_sin_seleccion',
  PRIMARY KEY (id),
  CONSTRAINT uq_movimiento_seleccion_tipo UNIQUE (seleccion_id, tipo_movimiento_id),
  CONSTRAINT uq_movimiento_sin_seleccion UNIQUE (usuario_id, tipo_movimiento_id, sin_seleccion),
  INDEX idx_movimiento_usuario_fecha (usuario_id, creado_en, id),
  CONSTRAINT fk_movimiento_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id),
  CONSTRAINT fk_movimiento_tipo FOREIGN KEY (tipo_movimiento_id) REFERENCES tipo_movimiento (id),
  CONSTRAINT fk_movimiento_seleccion FOREIGN KEY (seleccion_id) REFERENCES seleccion (id),
  CONSTRAINT ck_movimiento_cantidad CHECK (cantidad <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Módulo Auditoría
-- ---------------------------------------------------------------------------

-- NFR-006: las 5 acciones administrativas mínimas. `entidad` documenta qué
-- tabla afecta cada acción (siempre la misma por código), para no repetirlo
-- en cada fila de auditoria.
CREATE TABLE accion_auditoria (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo  VARCHAR(50)     NOT NULL,
  nombre  VARCHAR(100)    NOT NULL,
  entidad VARCHAR(50)     NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_accion_auditoria_codigo UNIQUE (codigo),
  CONSTRAINT ck_accion_auditoria_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- entidad_id es una referencia libre (sin FK): apunta a una fila de tablas
-- distintas según accion_id (usuario, partido...), y MySQL no permite una FK
-- condicional. Integridad a cargo del backend (ver EsquemaBD.md).
CREATE TABLE auditoria (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NOT NULL,
  accion_id  BIGINT UNSIGNED NOT NULL,
  entidad_id BIGINT UNSIGNED NOT NULL,
  creado_en  DATETIME        NOT NULL COMMENT 'UTC',
  PRIMARY KEY (id),
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id),
  CONSTRAINT fk_auditoria_accion FOREIGN KEY (accion_id) REFERENCES accion_auditoria (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
