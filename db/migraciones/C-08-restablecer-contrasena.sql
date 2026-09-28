-- La Liga ACP — migración C-08 (D-037): el admin restablece la contraseña de un participante.
--
-- Para una base que YA tiene datos (desarrollo o producción). Una base nueva no
-- la necesita: db/init/02-catalogos.sql ya carga el código. Cómo aplicarla:
-- README.md, «Migraciones de una base con datos». Requiere C-05 aplicada.
--
-- Qué hace, y nada más: agrega a accion_auditoria el código
-- restablecimiento_contrasena (entidad usuario). No cambia el esquema ni toca
-- ninguna otra fila.
--
-- El id: 34, el mismo que tiene en una base creada desde db/init, cuando está
-- libre (así los catálogos quedan iguales en todas las bases). Si otro código
-- ya lo usa (una base cuyos ids se corrieron, por ejemplo por un reintento de
-- C-05), toma el siguiente libre: la aplicación busca el código por codigo,
-- nunca por id, y el volcado de datos reales no lleva este catálogo.
--
-- Fallos y reintentos:
--   - Si ya se aplicó, falla sin tocar nada («C-08 ya está aplicada»). La marca
--     es el propio código, que entra en una sola transacción.
--   - Si falta C-05, falla sin tocar nada: los códigos van en orden.
--   - Si algo falla dentro de la transacción, se deshace entera y se puede
--     reintentar: con el id 34 libre, el reintento vuelve a usarlo aunque el
--     ROLLBACK haya gastado un valor de AUTO_INCREMENT.
-- El procedimiento temporal c08_migrar se borra siempre, también cuando la
-- migración se niega o falla (corrección de C-08): el procedimiento no lanza el
-- error, lo guarda en @c08_error y termina; el script borra el procedimiento y
-- recién entonces falla con ese motivo. El cliente mysql se detiene en el primer
-- error, así que un error lanzado dentro del CALL dejaba el procedimiento en la
-- base. El motivo sale impreso (columna «motivo») y en el error final, que se ve
-- así: ERROR 1231 (42000): Variable 'sql_mode' can't be set to the value of
-- '<motivo>'. Fuera de un procedimiento MySQL no tiene SIGNAL, y ese es un error
-- que repite el texto entero. Al empezar también se borra, por si quedó de una
-- versión anterior de este archivo.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS c08_migrar;

DELIMITER $$

CREATE PROCEDURE c08_migrar()
BEGIN
  -- Nada se lanza desde aquí: el motivo queda en @c08_error (ver arriba).
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 @c08_errno = MYSQL_ERRNO, @c08_error = MESSAGE_TEXT;
    ROLLBACK;
    IF @c08_errno <> 1644 THEN
      SET @c08_error = CONCAT('Error ', @c08_errno, ': ', @c08_error);
    END IF;
  END;

  -- 0. Ya aplicada: nada que hacer, y nada se toca.
  IF EXISTS (SELECT 1 FROM accion_auditoria WHERE codigo = 'restablecimiento_contrasena') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'C-08 ya está aplicada en esta base: no se cambió nada.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accion_auditoria WHERE codigo = 'registro_estadisticas_plantel') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falta aplicar C-05 antes que C-08: no se cambió nada.';
  END IF;

  START TRANSACTION;

  IF EXISTS (SELECT 1 FROM accion_auditoria WHERE id = 34) THEN
    INSERT INTO accion_auditoria (codigo, nombre, entidad) VALUES
      ('restablecimiento_contrasena', 'Restablecimiento de contraseña', 'usuario');
  ELSE
    INSERT INTO accion_auditoria (id, codigo, nombre, entidad) VALUES
      (34, 'restablecimiento_contrasena', 'Restablecimiento de contraseña', 'usuario');
  END IF;

  IF (SELECT COUNT(*) FROM accion_auditoria
      WHERE codigo = 'restablecimiento_contrasena' AND nombre = 'Restablecimiento de contraseña' AND entidad = 'usuario') <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El código de C-08 no quedó como se esperaba: se deshizo la transacción.';
  END IF;

  COMMIT;
END$$

DELIMITER ;

SET @c08_error = NULL;
CALL c08_migrar();
DROP PROCEDURE IF EXISTS c08_migrar;

-- Si se negó o falló: el motivo, y el error que detiene el script (nada más corre).
SELECT @c08_error AS motivo FROM DUAL WHERE @c08_error IS NOT NULL;
SET SESSION sql_mode = IF(@c08_error IS NULL, @@SESSION.sql_mode, @c08_error);

-- Lo que quedó: el código nuevo.
SELECT id, codigo, nombre, entidad FROM accion_auditoria WHERE codigo = 'restablecimiento_contrasena';
