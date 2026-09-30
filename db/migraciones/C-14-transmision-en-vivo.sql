-- La Liga ACP — migración C-14 (D-043): la sección «En vivo», con la transmisión de Facebook.
--
-- Para una base que YA tiene datos (desarrollo o producción). Una base nueva no
-- la necesita: db/init/ ya crea todo esto. Cómo aplicarla: README.md,
-- «Migraciones de una base con datos». Requiere C-08 aplicada.
--
-- Qué hace, y nada más:
--   1. crea la tabla transmision_en_vivo (idéntica a db/init/01-schema.sql);
--   2. en UNA transacción: su única fila (id 1, sin transmisión) y los dos
--      códigos nuevos de accion_auditoria, actualizacion_transmision y
--      retiro_transmision (entidad transmision_en_vivo), con los ids 35 y 36 de
--      db/init cuando están libres (si no, los siguientes libres: la aplicación
--      busca los códigos por codigo, nunca por id). Comprueba todo antes del COMMIT.
-- No toca ninguna otra fila.
--
-- Fallos y reintentos. El DDL de MySQL hace COMMIT implícito:
--   - Si ya se aplicó entera, falla sin tocar nada («C-14 ya está aplicada»). La
--     marca es el código actualizacion_transmision, que entra en la misma
--     transacción que la fila: existe solo si todo terminó.
--   - Si falta C-08, falla sin tocar nada: los códigos van en orden.
--   - Si se cortó después del CREATE TABLE, la tabla queda (vacía o con su fila
--     sin enlace): el reintento la reutiliza (CREATE TABLE IF NOT EXISTS, la fila
--     se inserta solo si falta) y exige que no tenga ningún enlace cargado.
--   - Si falla la transacción, se deshace entera y se puede reintentar.
-- El procedimiento temporal c14_migrar se borra siempre, también cuando la
-- migración se niega o falla (como C-05 y C-08 desde la corrección de C-08): el
-- procedimiento no lanza el error, lo guarda en @c14_error y termina; el script
-- borra el procedimiento y recién entonces falla con ese motivo, que sale
-- impreso (columna «motivo») y en el error final: ERROR 1231 (42000): Variable
-- 'sql_mode' can't be set to the value of '<motivo>'.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS c14_migrar;

DELIMITER $$

CREATE PROCEDURE c14_migrar()
BEGIN
  -- Nada se lanza desde aquí: el motivo queda en @c14_error (ver arriba).
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 @c14_errno = MYSQL_ERRNO, @c14_error = MESSAGE_TEXT;
    ROLLBACK;
    IF @c14_errno <> 1644 THEN
      SET @c14_error = CONCAT('Error ', @c14_errno, ': ', @c14_error);
    END IF;
  END;

  -- 0. Ya aplicada: nada que hacer, y nada se toca.
  IF EXISTS (SELECT 1 FROM accion_auditoria WHERE codigo = 'actualizacion_transmision') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'C-14 ya está aplicada en esta base: no se cambió nada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accion_auditoria WHERE codigo = 'restablecimiento_contrasena') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta aplicar C-08 antes que C-14: no se cambió nada.';
  END IF;

  -- 1. La tabla (vacía). Idéntica a db/init/01-schema.sql.
  CREATE TABLE IF NOT EXISTS transmision_en_vivo (
    id             TINYINT UNSIGNED NOT NULL,
    url            VARCHAR(255)     NULL,
    actualizado_en DATETIME         NULL COMMENT 'UTC',
    PRIMARY KEY (id),
    CONSTRAINT ck_transmision_una_fila CHECK (id = 1),
    CONSTRAINT ck_transmision_url CHECK (url IS NULL OR url LIKE 'https://www.facebook.com/%')
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

  -- Lo que quedó de un intento cortado no puede tener un enlace cargado.
  IF EXISTS (SELECT 1 FROM transmision_en_vivo WHERE url IS NOT NULL OR actualizado_en IS NOT NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'transmision_en_vivo ya tiene un enlace cargado: revísala a mano antes de reintentar. No se cambió nada más.';
  END IF;

  -- 2. La fila y los códigos, en una transacción.
  START TRANSACTION;

  INSERT IGNORE INTO transmision_en_vivo (id, url, actualizado_en) VALUES (1, NULL, NULL);

  IF EXISTS (SELECT 1 FROM accion_auditoria WHERE id IN (35, 36)) THEN
    INSERT INTO accion_auditoria (codigo, nombre, entidad) VALUES
      ('actualizacion_transmision', 'Actualización de la transmisión en vivo', 'transmision_en_vivo'),
      ('retiro_transmision',        'Retiro de la transmisión en vivo',        'transmision_en_vivo');
  ELSE
    INSERT INTO accion_auditoria (id, codigo, nombre, entidad) VALUES
      (35, 'actualizacion_transmision', 'Actualización de la transmisión en vivo', 'transmision_en_vivo'),
      (36, 'retiro_transmision',        'Retiro de la transmisión en vivo',        'transmision_en_vivo');
  END IF;

  IF (SELECT COUNT(*) FROM transmision_en_vivo) <> 1
    OR NOT EXISTS (SELECT 1 FROM transmision_en_vivo WHERE id = 1 AND url IS NULL AND actualizado_en IS NULL)
    OR (SELECT COUNT(*) FROM accion_auditoria
        WHERE entidad = 'transmision_en_vivo'
          AND ((codigo = 'actualizacion_transmision' AND nombre = 'Actualización de la transmisión en vivo')
            OR (codigo = 'retiro_transmision' AND nombre = 'Retiro de la transmisión en vivo'))) <> 2 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La fila o los códigos de C-14 no quedaron como se esperaba: se deshizo la transacción.';
  END IF;

  COMMIT;
END$$

DELIMITER ;

SET @c14_error = NULL;
CALL c14_migrar();
DROP PROCEDURE IF EXISTS c14_migrar;

-- Si se negó o falló: el motivo, y el error que detiene el script (nada más corre).
SELECT @c14_error AS motivo FROM DUAL WHERE @c14_error IS NOT NULL;
SET SESSION sql_mode = IF(@c14_error IS NULL, @@SESSION.sql_mode, @c14_error);

-- Lo que quedó: la fila y los códigos nuevos.
SELECT id, url, actualizado_en FROM transmision_en_vivo;
SELECT id, codigo, nombre, entidad FROM accion_auditoria WHERE entidad = 'transmision_en_vivo' ORDER BY id;
