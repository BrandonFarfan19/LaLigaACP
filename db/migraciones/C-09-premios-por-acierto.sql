-- La Liga ACP — migración C-09 (D-038): los aciertos también pagan monedas (BR-057).
--
-- Para una base que YA tiene datos (desarrollo o producción). Una base nueva no
-- la necesita: db/init/02-catalogos.sql ya carga los dos tipos. Cómo aplicarla:
-- README.md, «Migraciones de una base con datos».
--
-- Qué hace, y nada más: agrega a tipo_movimiento los dos tipos de premio,
-- premio_resultado_general (+1) y premio_marcador_exacto (+2; los montos viven en
-- server/src/lib/coins.ts, no en la base). No cambia el esquema: un premio lleva
-- siempre su selección, así que uq_movimiento_seleccion_tipo impide pagarlo dos
-- veces y sin_seleccion (D19) queda NULL. No toca ninguna otra fila: no paga
-- nada por los partidos que ya estaban confirmados (D-038, no es retroactivo).
--
-- Los ids: 4 y 5, los mismos que tienen en una base creada desde db/init, cuando
-- están libres (así el catálogo queda igual en todas las bases). Si otro tipo ya
-- usa uno de ellos, ese toma el siguiente libre: la aplicación busca los tipos
-- por codigo, nunca por id, y el volcado de datos reales no lleva este catálogo.
--
-- Fallos y reintentos:
--   - Si ya se aplicó, o si alguno de los dos códigos ya existe, falla sin tocar
--     nada («C-09 ya está aplicada»). Los dos entran en una sola transacción.
--   - Si algo falla dentro de la transacción, se deshace entera y se puede
--     reintentar: con los ids libres, el reintento vuelve a usarlos aunque el
--     ROLLBACK haya gastado valores de AUTO_INCREMENT.
-- El procedimiento temporal c09_migrar se borra siempre, también cuando la
-- migración se niega o falla (como C-05 y C-08): el procedimiento guarda el
-- motivo en @c09_error y termina; el script borra el procedimiento y recién
-- entonces falla con ese motivo, que sale impreso (columna «motivo») y en el
-- error final: ERROR 1231 (42000): Variable 'sql_mode' can't be set to the value
-- of '<motivo>'. Fuera de un procedimiento MySQL no tiene SIGNAL, y ese es un
-- error que repite el texto entero.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS c09_migrar;

DELIMITER $$

CREATE PROCEDURE c09_migrar()
BEGIN
  -- Nada se lanza desde aquí: el motivo queda en @c09_error (ver arriba).
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 @c09_errno = MYSQL_ERRNO, @c09_error = MESSAGE_TEXT;
    ROLLBACK;
    IF @c09_errno <> 1644 THEN
      SET @c09_error = CONCAT('Error ', @c09_errno, ': ', @c09_error);
    END IF;
  END;

  -- 0. Ya aplicada (o uno de los códigos ya está): nada que hacer, y nada se toca.
  IF EXISTS (SELECT 1 FROM tipo_movimiento WHERE codigo IN ('premio_resultado_general', 'premio_marcador_exacto')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'C-09 ya está aplicada en esta base: no se cambió nada.';
  END IF;

  START TRANSACTION;

  IF EXISTS (SELECT 1 FROM tipo_movimiento WHERE id = 4) THEN
    INSERT INTO tipo_movimiento (codigo, nombre) VALUES ('premio_resultado_general', 'Premio por acertar el resultado general');
  ELSE
    INSERT INTO tipo_movimiento (id, codigo, nombre) VALUES (4, 'premio_resultado_general', 'Premio por acertar el resultado general');
  END IF;

  IF EXISTS (SELECT 1 FROM tipo_movimiento WHERE id = 5) THEN
    INSERT INTO tipo_movimiento (codigo, nombre) VALUES ('premio_marcador_exacto', 'Premio por acertar el marcador exacto');
  ELSE
    INSERT INTO tipo_movimiento (id, codigo, nombre) VALUES (5, 'premio_marcador_exacto', 'Premio por acertar el marcador exacto');
  END IF;

  IF (SELECT COUNT(*) FROM tipo_movimiento
      WHERE (codigo, nombre) IN (('premio_resultado_general', 'Premio por acertar el resultado general'),
                                 ('premio_marcador_exacto', 'Premio por acertar el marcador exacto'))) <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Los tipos de C-09 no quedaron como se esperaba: se deshizo la transacción.';
  END IF;

  COMMIT;
END$$

DELIMITER ;

SET @c09_error = NULL;
CALL c09_migrar();
DROP PROCEDURE IF EXISTS c09_migrar;

-- Si se negó o falló: el motivo, y el error que detiene el script (nada más corre).
SELECT @c09_error AS motivo FROM DUAL WHERE @c09_error IS NOT NULL;
SET SESSION sql_mode = IF(@c09_error IS NULL, @@SESSION.sql_mode, @c09_error);

-- Lo que quedó: el catálogo de movimientos completo.
SELECT id, codigo, nombre FROM tipo_movimiento ORDER BY id;
