-- La Liga ACP — migración C-15 (D-044): puntos nuevos de la polla. Acertar el
-- resultado general da 3 puntos, sea el ganador o el empate (el empate daba 1),
-- y acertar el marcador exacto da 5 (daba 3). Fallar sigue dando 0.
--
-- Para una base que YA tiene datos (desarrollo o producción). Una base nueva no
-- la necesita: db/init/ ya crea la restricción así. Cómo aplicarla: README.md,
-- «Migraciones de una base con datos». Se aplica ANTES de levantar el backend
-- nuevo: con la restricción vieja, confirmar un resultado con un marcador
-- exacto acertado falla (el 5 no entra) y no se confirma nada.
--
-- Qué hace, y nada más:
--   1. cambia ck_seleccion_puntos para que admita 0, 1, 3 y 5 (admitía 0, 1 y
--      3). El 1 se queda admitido aunque ya nada lo escribe;
--   2. en UNA transacción, recalcula las selecciones YA liquidadas como
--      acertadas con la regla vieja: resultado_general con 1 punto (un empate)
--      pasa a 3, y marcador_exacto con 3 puntos pasa a 5. Comprueba antes del
--      COMMIT que no quede ninguna con el valor viejo.
-- No toca estados, tickets ni ninguna otra fila: las no acertadas (0), las
-- pendientes y las anuladas (NULL) quedan igual. El ranking y «Mis apuestas» se
-- calculan al leer, así que muestran los puntos nuevos solos.
--
-- Fallos y reintentos. El DDL de MySQL hace COMMIT implícito:
--   - Si ya se aplicó entera, falla sin tocar nada («C-15 ya está aplicada»):
--     la restricción ya admite el 5 y no queda ninguna selección por recalcular.
--   - Si se cortó después de cambiar la restricción, el reintento la deja como
--     está y hace solo el recálculo.
--   - Si falla la transacción, se deshace entera y se puede reintentar.
-- El procedimiento temporal c15_migrar se borra siempre, también cuando la
-- migración se niega o falla (como C-14): el motivo sale impreso (columna
-- «motivo») y en el error final: ERROR 1231 (42000): Variable 'sql_mode' can't
-- be set to the value of '<motivo>'.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS c15_migrar;

DELIMITER $$

CREATE PROCEDURE c15_migrar()
BEGIN
  DECLARE admite_cinco INT DEFAULT 0;
  DECLARE por_recalcular INT DEFAULT 0;

  -- Nada se lanza desde aquí: el motivo queda en @c15_error (ver arriba).
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 @c15_errno = MYSQL_ERRNO, @c15_error = MESSAGE_TEXT;
    ROLLBACK;
    IF @c15_errno <> 1644 THEN
      SET @c15_error = CONCAT('Error ', @c15_errno, ': ', @c15_error);
    END IF;
  END;

  SELECT COUNT(*) INTO admite_cinco
  FROM information_schema.CHECK_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND CONSTRAINT_NAME = 'ck_seleccion_puntos'
    AND CHECK_CLAUSE LIKE '%5%';

  SELECT COUNT(*) INTO por_recalcular
  FROM seleccion s
  JOIN tipo_apuesta ta     ON ta.id = s.tipo_apuesta_id
  JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
  WHERE es.codigo = 'acertada'
    AND ((ta.codigo = 'resultado_general' AND s.puntos_obtenidos = 1)
      OR (ta.codigo = 'marcador_exacto' AND s.puntos_obtenidos = 3));

  -- 0. Ya aplicada: nada que hacer, y nada se toca.
  IF admite_cinco > 0 AND por_recalcular = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'C-15 ya está aplicada en esta base: no se cambió nada.';
  END IF;

  -- 1. La restricción, idéntica a db/init/01-schema.sql.
  IF admite_cinco = 0 THEN
    ALTER TABLE seleccion
      DROP CHECK ck_seleccion_puntos,
      ADD CONSTRAINT ck_seleccion_puntos CHECK (puntos_obtenidos IS NULL OR puntos_obtenidos IN (0, 1, 3, 5));
  END IF;

  -- 2. Las selecciones ya liquidadas, en una transacción.
  START TRANSACTION;

  UPDATE seleccion s
  JOIN tipo_apuesta ta     ON ta.id = s.tipo_apuesta_id
  JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
  SET s.puntos_obtenidos = 3
  WHERE es.codigo = 'acertada' AND ta.codigo = 'resultado_general' AND s.puntos_obtenidos = 1;
  SET @c15_empates = ROW_COUNT();

  UPDATE seleccion s
  JOIN tipo_apuesta ta     ON ta.id = s.tipo_apuesta_id
  JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
  SET s.puntos_obtenidos = 5
  WHERE es.codigo = 'acertada' AND ta.codigo = 'marcador_exacto' AND s.puntos_obtenidos = 3;
  SET @c15_exactos = ROW_COUNT();

  IF EXISTS (
    SELECT 1
    FROM seleccion s
    JOIN tipo_apuesta ta     ON ta.id = s.tipo_apuesta_id
    JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
    WHERE es.codigo = 'acertada'
      AND ((ta.codigo = 'resultado_general' AND s.puntos_obtenidos = 1)
        OR (ta.codigo = 'marcador_exacto' AND s.puntos_obtenidos = 3))
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Quedó alguna selección acertada con los puntos viejos: se deshizo la transacción.';
  END IF;

  COMMIT;
END$$

DELIMITER ;

SET @c15_error = NULL;
SET @c15_empates = 0;
SET @c15_exactos = 0;
CALL c15_migrar();
DROP PROCEDURE IF EXISTS c15_migrar;

-- Si se negó o falló: el motivo, y el error que detiene el script (nada más corre).
SELECT @c15_error AS motivo FROM DUAL WHERE @c15_error IS NOT NULL;
SET SESSION sql_mode = IF(@c15_error IS NULL, @@SESSION.sql_mode, @c15_error);

-- Lo que quedó: cuántas se recalcularon y los puntos por tipo de apuesta.
SELECT @c15_empates AS empates_de_1_a_3, @c15_exactos AS marcadores_exactos_de_3_a_5;
SELECT ta.codigo AS tipo, es.codigo AS estado, s.puntos_obtenidos AS puntos, COUNT(*) AS selecciones
FROM seleccion s
JOIN tipo_apuesta ta     ON ta.id = s.tipo_apuesta_id
JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
GROUP BY ta.codigo, es.codigo, s.puntos_obtenidos
ORDER BY ta.codigo, es.codigo;
