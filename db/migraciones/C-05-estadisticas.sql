-- La Liga ACP — migración C-05 (D-034): estadísticas reales de los jugadores, por deporte.
--
-- Para una base que YA tiene datos (desarrollo o producción). Una base nueva no
-- la necesita: db/init/ ya crea todo esto. Cómo aplicarla: README.md,
-- «Migraciones de una base con datos».
--
-- Qué hace, y nada más:
--   1. crea perfil_estadistico, estadistica y plantel_estadistica (vacías);
--   2. agrega deporte.perfil_estadistico_id (NULL) con su clave foránea;
--   3. en UNA transacción: carga los dos perfiles con sus 11 atributos, los dos
--      códigos nuevos de accion_auditoria y el perfil de cada deporte existente
--      según su nombre (fútbol en cualquier variante → futbol; vóley, voley,
--      voleibol, volley → voley; cualquier otro, o uno que diga los dos, queda
--      NULL). Comprueba los conteos antes del COMMIT.
-- No toca ninguna otra fila existente: ningún jugador recibe estadísticas.
--
-- Fallos y reintentos. El DDL de MySQL hace COMMIT implícito, así que el orden
-- está pensado para que un corte a medias se note y se pueda reintentar:
--   - Si la migración ya se aplicó entera, falla en el primer paso sin tocar
--     nada («C-05 ya está aplicada»). La marca es el código
--     registro_estadisticas_plantel, que entra en la misma transacción que los
--     datos: existe solo si todo terminó.
--   - Si se cortó en el DDL, las tablas nuevas quedan vacías y la columna puede
--     existir o no: reintentar reutiliza lo que haya (CREATE TABLE IF NOT EXISTS
--     y la columna se agrega solo si falta) y comprueba que esté vacío.
--   - Si falla la transacción, se deshace entera y se puede reintentar igual.
--     Los catálogos entran con ids explícitos (los de db/init): un ROLLBACK no
--     devuelve los valores de AUTO_INCREMENT que gastó, y sin ids fijos el
--     reintento dejaría futbol en 3 y los atributos en 12 a 22. Antes del COMMIT
--     se comprueban los ids código por código.
-- El procedimiento temporal c05_migrar se borra siempre, también cuando la
-- migración se niega o falla (corrección de C-08): el procedimiento no lanza el
-- error, lo guarda en @c05_error y termina; el script borra el procedimiento y
-- recién entonces falla con ese motivo. El cliente mysql se detiene en el primer
-- error, así que un error lanzado dentro del CALL dejaba el procedimiento en la
-- base. El motivo sale impreso (columna «motivo») y en el error final, que se ve
-- así: ERROR 1231 (42000): Variable 'sql_mode' can't be set to the value of
-- '<motivo>'. Fuera de un procedimiento MySQL no tiene SIGNAL, y ese es un error
-- que repite el texto entero. Al empezar también se borra, por si quedó de una
-- versión anterior de este archivo.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS c05_migrar;

DELIMITER $$

CREATE PROCEDURE c05_migrar()
BEGIN
  -- Nada se lanza desde aquí: el motivo queda en @c05_error (ver arriba).
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 @c05_errno = MYSQL_ERRNO, @c05_error = MESSAGE_TEXT;
    ROLLBACK;
    IF @c05_errno <> 1644 THEN
      SET @c05_error = CONCAT('Error ', @c05_errno, ': ', @c05_error);
    END IF;
  END;

  -- 0. Ya aplicada: nada que hacer, y nada se toca.
  IF EXISTS (SELECT 1 FROM accion_auditoria WHERE codigo = 'registro_estadisticas_plantel') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'C-05 ya está aplicada en esta base: no se cambió nada.';
  END IF;

  -- 1. Tablas nuevas (vacías). Idénticas a db/init/01-schema.sql.
  CREATE TABLE IF NOT EXISTS perfil_estadistico (
    id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    codigo VARCHAR(50)     NOT NULL,
    nombre VARCHAR(100)    NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_perfil_estadistico_codigo UNIQUE (codigo)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CREATE TABLE IF NOT EXISTS estadistica (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    perfil_estadistico_id BIGINT UNSIGNED  NOT NULL,
    codigo                VARCHAR(50)      NOT NULL,
    nombre                VARCHAR(100)     NOT NULL,
    orden                 TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_estadistica_perfil_codigo UNIQUE (perfil_estadistico_id, codigo),
    CONSTRAINT uq_estadistica_perfil_orden UNIQUE (perfil_estadistico_id, orden),
    CONSTRAINT fk_estadistica_perfil FOREIGN KEY (perfil_estadistico_id) REFERENCES perfil_estadistico (id),
    CONSTRAINT ck_estadistica_orden CHECK (orden >= 1)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  CREATE TABLE IF NOT EXISTS plantel_estadistica (
    plantel_id     BIGINT UNSIGNED  NOT NULL,
    estadistica_id BIGINT UNSIGNED  NOT NULL,
    valor          TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (plantel_id, estadistica_id),
    CONSTRAINT fk_plantel_estadistica_plantel FOREIGN KEY (plantel_id) REFERENCES plantel (id),
    CONSTRAINT fk_plantel_estadistica_estadistica FOREIGN KEY (estadistica_id) REFERENCES estadistica (id),
    CONSTRAINT ck_plantel_estadistica_valor CHECK (valor BETWEEN 0 AND 99)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  -- Lo que quedó de un intento cortado tiene que estar vacío: nunca se
  -- mezclan filas de otro origen.
  IF EXISTS (SELECT 1 FROM perfil_estadistico) OR EXISTS (SELECT 1 FROM estadistica) OR EXISTS (SELECT 1 FROM plantel_estadistica) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Las tablas de C-05 ya tienen filas, pero la migración no terminó: revísalas a mano antes de reintentar.';
  END IF;

  -- 2. La columna de deporte, NULL (ningún deporte cambia de comportamiento), con su FK.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'deporte' AND column_name = 'perfil_estadistico_id'
  ) THEN
    ALTER TABLE deporte
      ADD COLUMN perfil_estadistico_id BIGINT UNSIGNED NULL,
      ADD CONSTRAINT fk_deporte_perfil_estadistico FOREIGN KEY (perfil_estadistico_id) REFERENCES perfil_estadistico (id);
  END IF;

  -- 3. Los datos, todo o nada.
  START TRANSACTION;

  -- Ids explícitos, los mismos de db/init/02-catalogos.sql (EsquemaBD: futbol = 1,
  -- voley = 2, atributos 1 a 11): un intento anterior deshecho ya gastó valores de
  -- AUTO_INCREMENT (un ROLLBACK no los devuelve), y con ids corridos el volcado de
  -- datos reales se negaría a cargar en una base nueva. Las tablas están vacías:
  -- se comprobó arriba.
  INSERT INTO perfil_estadistico (id, codigo, nombre) VALUES
    (1, 'futbol', 'Fútbol'),
    (2, 'voley',  'Vóley');

  INSERT INTO estadistica (id, perfil_estadistico_id, codigo, nombre, orden) VALUES
    (1,  1, 'disparo',   'Disparo',   1),
    (2,  1, 'pase',      'Pase',      2),
    (3,  1, 'fuerza',    'Fuerza',    3),
    (4,  1, 'defensa',   'Defensa',   4),
    (5,  1, 'velocidad', 'Velocidad', 5),
    (6,  1, 'dribbling', 'Dribbling', 6),
    (7,  2, 'mate',      'Mate',      1),
    (8,  2, 'saque',     'Saque',     2),
    (9,  2, 'recepcion', 'Recepción', 3),
    (10, 2, 'armado',    'Armado',    4),
    (11, 2, 'bloqueo',   'Bloqueo',   5);

  -- El perfil de cada deporte existente, por su nombre sin mayúsculas ni
  -- tildes (utf8mb4_0900_ai_ci): «Fútbol», «futbol femenino» → futbol;
  -- «Vóley mixto», «Voleibol», «Volleyball» → voley. Un nombre que no dice
  -- ninguno, o que dice los dos, queda NULL: el administrador lo elige después.
  UPDATE deporte
  SET perfil_estadistico_id = (SELECT id FROM perfil_estadistico WHERE codigo = 'futbol')
  WHERE nombre COLLATE utf8mb4_0900_ai_ci LIKE '%futbol%'
    AND NOT (nombre COLLATE utf8mb4_0900_ai_ci LIKE '%voley%'
      OR nombre COLLATE utf8mb4_0900_ai_ci LIKE '%volley%'
      OR nombre COLLATE utf8mb4_0900_ai_ci LIKE '%voleibol%');

  UPDATE deporte
  SET perfil_estadistico_id = (SELECT id FROM perfil_estadistico WHERE codigo = 'voley')
  WHERE (nombre COLLATE utf8mb4_0900_ai_ci LIKE '%voley%'
      OR nombre COLLATE utf8mb4_0900_ai_ci LIKE '%volley%'
      OR nombre COLLATE utf8mb4_0900_ai_ci LIKE '%voleibol%')
    AND NOT nombre COLLATE utf8mb4_0900_ai_ci LIKE '%futbol%';

  -- Los códigos de auditoría de C-05 (y la marca de «aplicada»).
  INSERT INTO accion_auditoria (codigo, nombre, entidad) VALUES
    ('registro_estadisticas_plantel', 'Registro de estadísticas de una inscripción', 'plantel'),
    ('borrado_estadisticas_plantel',  'Borrado de estadísticas de una inscripción',  'plantel');

  -- Antes del COMMIT: los catálogos completos y con sus ids, código por código.
  IF (SELECT COUNT(*) FROM perfil_estadistico) <> 2
    OR (SELECT COUNT(*) FROM estadistica) <> 11
    OR (SELECT COUNT(*) FROM perfil_estadistico WHERE (id, codigo) IN ((1, 'futbol'), (2, 'voley'))) <> 2
    OR (SELECT COUNT(*) FROM estadistica e JOIN perfil_estadistico p ON p.id = e.perfil_estadistico_id
        WHERE (e.id, p.codigo, e.codigo, e.orden) IN (
          (1, 'futbol', 'disparo', 1), (2, 'futbol', 'pase', 2), (3, 'futbol', 'fuerza', 3),
          (4, 'futbol', 'defensa', 4), (5, 'futbol', 'velocidad', 5), (6, 'futbol', 'dribbling', 6),
          (7, 'voley', 'mate', 1), (8, 'voley', 'saque', 2), (9, 'voley', 'recepcion', 3),
          (10, 'voley', 'armado', 4), (11, 'voley', 'bloqueo', 5))) <> 11 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los catálogos de C-05 no quedaron completos o con otros ids: se deshizo la transacción.';
  END IF;

  COMMIT;
END$$

DELIMITER ;

SET @c05_error = NULL;
CALL c05_migrar();
DROP PROCEDURE IF EXISTS c05_migrar;

-- Si se negó o falló: el motivo, y el error que detiene el script (nada más corre).
SELECT @c05_error AS motivo FROM DUAL WHERE @c05_error IS NOT NULL;
SET SESSION sql_mode = IF(@c05_error IS NULL, @@SESSION.sql_mode, @c05_error);

-- Lo que quedó: cada deporte con su perfil (NULL = sin estadísticas; se elige en el panel, Deportes).
SELECT d.id, d.nombre, p.codigo AS perfil FROM deporte d LEFT JOIN perfil_estadistico p ON p.id = d.perfil_estadistico_id ORDER BY d.id;
