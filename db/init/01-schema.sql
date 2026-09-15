-- La Liga ACP — esquema completo según EsquemaBD.md.
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

CREATE TABLE usuario (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rol_id BIGINT UNSIGNED NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  email  VARCHAR(254)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_usuario_email UNIQUE (email),
  CONSTRAINT fk_usuario_rol FOREIGN KEY (rol_id) REFERENCES rol (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Módulo Informativo
-- ---------------------------------------------------------------------------

CREATE TABLE disciplina (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre         VARCHAR(100)    NOT NULL,
  slug           VARCHAR(100)    NOT NULL,
  permite_empate BOOLEAN         NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_disciplina_slug UNIQUE (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D1: un equipo pertenece a una sola disciplina.
CREATE TABLE equipo (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  disciplina_id BIGINT UNSIGNED NOT NULL,
  nombre        VARCHAR(100)    NOT NULL,
  nombre_corto  VARCHAR(50)     NOT NULL,
  escudo        VARCHAR(255)    NOT NULL,
  color_acento  VARCHAR(32)     NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_equipo_id_disciplina UNIQUE (id, disciplina_id),
  CONSTRAINT fk_equipo_disciplina FOREIGN KEY (disciplina_id) REFERENCES disciplina (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE jugador (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(100)    NOT NULL,
  foto   VARCHAR(255)    NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D2 y D4: un jugador, un solo equipo por disciplina, sin cambios.
CREATE TABLE plantel (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  jugador_id      BIGINT UNSIGNED   NOT NULL,
  equipo_id       BIGINT UNSIGNED   NOT NULL,
  disciplina_id   BIGINT UNSIGNED   NOT NULL,
  numero_camiseta SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_plantel_jugador_disciplina UNIQUE (jugador_id, disciplina_id),
  CONSTRAINT uq_plantel_equipo_camiseta UNIQUE (equipo_id, numero_camiseta),
  CONSTRAINT uq_plantel_id_equipo UNIQUE (id, equipo_id),
  CONSTRAINT fk_plantel_jugador FOREIGN KEY (jugador_id) REFERENCES jugador (id),
  CONSTRAINT fk_plantel_disciplina FOREIGN KEY (disciplina_id) REFERENCES disciplina (id),
  CONSTRAINT fk_plantel_equipo_disciplina FOREIGN KEY (equipo_id, disciplina_id)
    REFERENCES equipo (id, disciplina_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estado_partido (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estado_partido_codigo UNIQUE (codigo),
  CONSTRAINT ck_estado_partido_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE partido (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  disciplina_id     BIGINT UNSIGNED   NOT NULL,
  estado_partido_id BIGINT UNSIGNED   NOT NULL,
  jornada           SMALLINT UNSIGNED NOT NULL,
  fecha_hora        DATETIME          NOT NULL COMMENT 'UTC',
  sede              VARCHAR(150)      NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_partido_id_disciplina UNIQUE (id, disciplina_id),
  CONSTRAINT fk_partido_disciplina FOREIGN KEY (disciplina_id) REFERENCES disciplina (id),
  CONSTRAINT fk_partido_estado FOREIGN KEY (estado_partido_id) REFERENCES estado_partido (id),
  CONSTRAINT ck_partido_jornada CHECK (jornada >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D5 y D6: una fila por lado del partido, con su marcador escrito a mano.
-- Backend: cada partido debe tener exactamente 2 filas.
CREATE TABLE partido_equipo (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  partido_id    BIGINT UNSIGNED   NOT NULL,
  equipo_id     BIGINT UNSIGNED   NOT NULL,
  disciplina_id BIGINT UNSIGNED   NOT NULL,
  es_visita     BOOLEAN           NOT NULL,
  marcador      SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_partido_equipo_lado UNIQUE (partido_id, es_visita),
  CONSTRAINT uq_partido_equipo_equipo UNIQUE (partido_id, equipo_id),
  CONSTRAINT uq_partido_equipo_id_equipo UNIQUE (id, equipo_id),
  CONSTRAINT fk_partido_equipo_disciplina FOREIGN KEY (disciplina_id) REFERENCES disciplina (id),
  CONSTRAINT fk_partido_equipo_partido_disciplina FOREIGN KEY (partido_id, disciplina_id)
    REFERENCES partido (id, disciplina_id),
  CONSTRAINT fk_partido_equipo_equipo_disciplina FOREIGN KEY (equipo_id, disciplina_id)
    REFERENCES equipo (id, disciplina_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El jugador solo juega para su equipo y en un partido donde ese equipo participa.
CREATE TABLE partido_jugador (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  partido_equipo_id BIGINT UNSIGNED NOT NULL,
  plantel_id        BIGINT UNSIGNED NOT NULL,
  equipo_id         BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_partido_jugador UNIQUE (partido_equipo_id, plantel_id),
  CONSTRAINT fk_partido_jugador_equipo FOREIGN KEY (equipo_id) REFERENCES equipo (id),
  CONSTRAINT fk_partido_jugador_partido_equipo FOREIGN KEY (partido_equipo_id, equipo_id)
    REFERENCES partido_equipo (id, equipo_id),
  CONSTRAINT fk_partido_jugador_plantel FOREIGN KEY (plantel_id, equipo_id)
    REFERENCES plantel (id, equipo_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estadistica_tipo (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  disciplina_id BIGINT UNSIGNED NOT NULL,
  codigo        VARCHAR(50)     NOT NULL,
  nombre        VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estadistica_tipo_disciplina_codigo UNIQUE (disciplina_id, codigo),
  CONSTRAINT fk_estadistica_tipo_disciplina FOREIGN KEY (disciplina_id) REFERENCES disciplina (id),
  CONSTRAINT ck_estadistica_tipo_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D7. Backend: la disciplina del tipo debe coincidir con la del partido.
CREATE TABLE partido_jugador_estadistica (
  partido_jugador_id  BIGINT UNSIGNED   NOT NULL,
  estadistica_tipo_id BIGINT UNSIGNED   NOT NULL,
  valor               SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (partido_jugador_id, estadistica_tipo_id),
  CONSTRAINT fk_pje_partido_jugador FOREIGN KEY (partido_jugador_id) REFERENCES partido_jugador (id),
  CONSTRAINT fk_pje_estadistica_tipo FOREIGN KEY (estadistica_tipo_id) REFERENCES estadistica_tipo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Módulo Polla
-- ---------------------------------------------------------------------------

CREATE TABLE mercado_tipo (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_mercado_tipo_codigo UNIQUE (codigo),
  CONSTRAINT ck_mercado_tipo_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estado_mercado (
  id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  codigo VARCHAR(50)     NOT NULL,
  nombre VARCHAR(100)    NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_estado_mercado_codigo UNIQUE (codigo),
  CONSTRAINT ck_estado_mercado_codigo CHECK (codigo <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- UNIQUE(partido_id): MySQL admite varios NULL, así que los mercados de campeón no chocan.
-- Backend: un solo campeon_disciplina por disciplina y partido_id obligatorio o vacío según el tipo.
CREATE TABLE mercado (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  mercado_tipo_id   BIGINT UNSIGNED NOT NULL,
  estado_mercado_id BIGINT UNSIGNED NOT NULL,
  disciplina_id     BIGINT UNSIGNED NOT NULL,
  partido_id        BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_mercado_partido UNIQUE (partido_id),
  CONSTRAINT fk_mercado_tipo FOREIGN KEY (mercado_tipo_id) REFERENCES mercado_tipo (id),
  CONSTRAINT fk_mercado_estado FOREIGN KEY (estado_mercado_id) REFERENCES estado_mercado (id),
  CONSTRAINT fk_mercado_disciplina FOREIGN KEY (disciplina_id) REFERENCES disciplina (id),
  CONSTRAINT fk_mercado_partido FOREIGN KEY (partido_id) REFERENCES partido (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- equipo_id NULL = empate. Backend: el equipo es de la disciplina del mercado,
-- y el empate solo vale en ganador_partido con disciplina.permite_empate.
CREATE TABLE apuesta (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id      BIGINT UNSIGNED NOT NULL,
  mercado_id      BIGINT UNSIGNED NOT NULL,
  equipo_id       BIGINT UNSIGNED NULL,
  creada_en       DATETIME        NOT NULL COMMENT 'UTC',
  actualizada_en  DATETIME        NOT NULL COMMENT 'UTC',
  coins_obtenidos DECIMAL(5,1)    NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_apuesta_usuario_mercado UNIQUE (usuario_id, mercado_id),
  CONSTRAINT fk_apuesta_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id),
  CONSTRAINT fk_apuesta_mercado FOREIGN KEY (mercado_id) REFERENCES mercado (id),
  CONSTRAINT fk_apuesta_equipo FOREIGN KEY (equipo_id) REFERENCES equipo (id),
  CONSTRAINT ck_apuesta_coins CHECK (coins_obtenidos IS NULL OR coins_obtenidos >= 0),
  CONSTRAINT ck_apuesta_fechas CHECK (actualizada_en >= creada_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
