-- La Liga ACP — partidos de la jornada 2: sábado 10 de octubre de 2026, en Lince.
--
-- Inserta los 11 partidos en `partido` (estado programado, sin goles) y sus dos
-- lados en `partido_equipo` (el primer equipo nombrado es el local). Los
-- equipos y las competiciones se buscan por NOMBRE, nunca por id, así que sirve
-- igual en desarrollo y en producción. Los nombres son los guardados en la base
-- (la comparación no distingue mayúsculas ni tildes).
--
-- Horas: se escriben en hora de Lima y se guardan en UTC (+5 h; Perú no tiene
-- horario de verano), como pide el esquema.
--
-- Barreras, antes de insertar nada:
--   - cada competición y cada equipo existe exactamente una vez (el equipo,
--     dentro de su competición);
--   - ninguna de esas competiciones tiene ya un partido a esa misma hora (si se
--     corre dos veces, la segunda se detiene).
-- Todo va en una sola transacción. Si una barrera falla, el script termina con
-- un error "Table ... doesn't exist" cuyo nombre dice el motivo, y no queda nada.
--
-- Nota: una carga por SQL no deja registro en `auditoria` (solo el panel lo hace).
--
-- Cómo correrlo (MySQL se detiene en el primer error):
--   docker compose exec -T db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' < db/partidos-jornada-2.sql
-- En producción, con compose.prod.yaml: agregar `-f compose.prod.yaml`.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @@session.sql_mode = CONCAT(@@session.sql_mode, ',STRICT_ALL_TABLES');
SET autocommit = 0;

SET @fecha   := '2026-10-10';
SET @jornada := 2;
SET @sede    := 'Lince';

DROP TEMPORARY TABLE IF EXISTS tmp_fixture;
CREATE TEMPORARY TABLE tmp_fixture (
  n              TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  competicion    VARCHAR(100)     NOT NULL,
  local_nombre   VARCHAR(100)     NOT NULL,
  visita_nombre  VARCHAR(100)     NOT NULL,
  hora_lima      TIME             NOT NULL,
  competicion_id BIGINT UNSIGNED  NULL,
  local_id       BIGINT UNSIGNED  NULL,
  visita_id      BIGINT UNSIGNED  NULL,
  fecha_hora     DATETIME         NULL,
  partido_id     BIGINT UNSIGNED  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO tmp_fixture (n, competicion, local_nombre, visita_nombre, hora_lima) VALUES
  -- Torneo de fútbol masculino
  ( 1, 'torneo futbol masculino', 'Bad Legend',                'LOS IMPARABLES',            '09:45'),
  ( 2, 'torneo futbol masculino', 'Grupzul 2.0',               'SPORT LA PLATA FC',         '11:00'),
  ( 3, 'torneo futbol masculino', 'LOS IMPARABLES',            'LOS DIBUJITOS FC CON IA',   '11:45'),
  -- Torneo de fútbol femenino
  ( 4, 'torneo futbol femenino',  'FINZULIANAS',               'LAS GALACTICAS DEL MASTER', '09:00'),
  ( 5, 'torneo futbol femenino',  'NEXUS PRIME',               'LAS GALACTICAS DEL MASTER', '10:25'),
  ( 6, 'torneo futbol femenino',  'FINZULIANAS',               'LAS QUE MANDAN',            '12:30'),
  -- Torneo de voleibol
  ( 7, 'torneo de voleibol',      'FINANFORCE',                'NEXUS PRIME',               '09:30'),
  ( 8, 'torneo de voleibol',      'LOS GALACTICOS DEL MASTER', 'GRUZUL',                    '10:15'),
  ( 9, 'torneo de voleibol',      'FINANFORCE',                'Impacto Call B',            '11:00'),
  (10, 'torneo de voleibol',      'Impacto Call B',            'LOS GALACTICOS DEL MASTER', '11:45'),
  (11, 'torneo de voleibol',      'NEXUS PRIME',               'GRUZUL',                    '13:15');

UPDATE tmp_fixture SET fecha_hora = TIMESTAMP(@fecha, hora_lima) + INTERVAL 5 HOUR;

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- Barrera 1: cada competición y cada equipo se encuentra una sola vez.
-- ---------------------------------------------------------------------------
SET @sin_resolver := (
  SELECT COUNT(*) FROM tmp_fixture f
  WHERE (SELECT COUNT(*) FROM competicion c WHERE c.nombre = f.competicion) <> 1
     OR (SELECT COUNT(*) FROM equipo e JOIN competicion c ON c.id = e.competicion_id
         WHERE c.nombre = f.competicion AND e.nombre = f.local_nombre) <> 1
     OR (SELECT COUNT(*) FROM equipo e JOIN competicion c ON c.id = e.competicion_id
         WHERE c.nombre = f.competicion AND e.nombre = f.visita_nombre) <> 1
);
SELECT f.n, f.competicion, f.local_nombre, f.visita_nombre, 'nombre no encontrado o repetido' AS problema
FROM tmp_fixture f
WHERE (SELECT COUNT(*) FROM competicion c WHERE c.nombre = f.competicion) <> 1
   OR (SELECT COUNT(*) FROM equipo e JOIN competicion c ON c.id = e.competicion_id
       WHERE c.nombre = f.competicion AND e.nombre = f.local_nombre) <> 1
   OR (SELECT COUNT(*) FROM equipo e JOIN competicion c ON c.id = e.competicion_id
       WHERE c.nombre = f.competicion AND e.nombre = f.visita_nombre) <> 1;

SET @sql := IF(@sin_resolver = 0, 'SELECT ''Nombres OK'' AS control', 'SELECT * FROM `ABORTADO_hay_equipos_o_competiciones_que_no_se_encuentran`');
PREPARE comprobacion FROM @sql;
EXECUTE comprobacion;
DEALLOCATE PREPARE comprobacion;

UPDATE tmp_fixture f
  JOIN competicion c ON c.nombre = f.competicion
  JOIN equipo el ON el.competicion_id = c.id AND el.nombre = f.local_nombre
  JOIN equipo ev ON ev.competicion_id = c.id AND ev.nombre = f.visita_nombre
SET f.competicion_id = c.id, f.local_id = el.id, f.visita_id = ev.id;

-- ---------------------------------------------------------------------------
-- Barrera 2: no hay ya un partido de esa competición a esa hora.
-- ---------------------------------------------------------------------------
SET @repetidos := (
  SELECT COUNT(*) FROM tmp_fixture f
  JOIN partido p ON p.competicion_id = f.competicion_id AND p.fecha_hora = f.fecha_hora
);
SET @sql := IF(@repetidos = 0, 'SELECT ''Sin partidos repetidos'' AS control', 'SELECT * FROM `ABORTADO_ya_hay_partidos_a_esas_horas_se_corrio_antes`');
PREPARE comprobacion FROM @sql;
EXECUTE comprobacion;
DEALLOCATE PREPARE comprobacion;

-- ---------------------------------------------------------------------------
-- Los partidos y sus dos lados.
-- ---------------------------------------------------------------------------
INSERT INTO partido (competicion_id, estado_partido_id, jornada, fecha_hora, sede)
SELECT f.competicion_id,
       (SELECT id FROM estado_partido WHERE codigo = 'programado'),
       @jornada, f.fecha_hora, @sede
FROM tmp_fixture f
ORDER BY f.n;

-- Barrera 2 garantiza que (competición, hora) identifica a cada partido nuevo.
UPDATE tmp_fixture f
  JOIN partido p ON p.competicion_id = f.competicion_id AND p.fecha_hora = f.fecha_hora
                AND p.jornada = @jornada AND p.sede = @sede
SET f.partido_id = p.id;

INSERT INTO partido_equipo (partido_id, equipo_id, competicion_id, es_visita, goles)
SELECT f.partido_id, f.local_id, f.competicion_id, FALSE, NULL FROM tmp_fixture f ORDER BY f.n;

INSERT INTO partido_equipo (partido_id, equipo_id, competicion_id, es_visita, goles)
SELECT f.partido_id, f.visita_id, f.competicion_id, TRUE, NULL FROM tmp_fixture f ORDER BY f.n;

-- ---------------------------------------------------------------------------
-- Verificación: 11 partidos, 22 lados.
-- ---------------------------------------------------------------------------
SET @partidos := (SELECT COUNT(DISTINCT partido_id) FROM tmp_fixture WHERE partido_id IS NOT NULL);
SET @lados := (SELECT COUNT(*) FROM partido_equipo pe JOIN tmp_fixture f ON f.partido_id = pe.partido_id);
SET @sql := IF(@partidos = 11 AND @lados = 22, 'SELECT ''Verificación OK'' AS control', 'SELECT * FROM `VERIFICACION_FALLIDA_los_conteos_no_coinciden`');
PREPARE comprobacion FROM @sql;
EXECUTE comprobacion;
DEALLOCATE PREPARE comprobacion;

COMMIT;

SELECT f.partido_id, f.competicion, f.hora_lima AS hora_lima, f.fecha_hora AS fecha_hora_utc,
       f.local_nombre AS local, f.visita_nombre AS visita
FROM tmp_fixture f
ORDER BY f.fecha_hora, f.n;

DROP TEMPORARY TABLE tmp_fixture;
