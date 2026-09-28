# Script de estadísticas

Carga en `plantel_estadistica` los valores de [relacionUsuarios.md](relacionUsuarios.md). Busca a cada persona por su **nombre real** en `jugador.nombre`, nunca por id. La comparación usa la collation de la tabla, así que no distingue mayúsculas ni tildes, pero el nombre tiene que estar completo y en el mismo orden.

## Qué hace

- **A qué plantel va cada valor:** los valores de fútbol van a cada plantel de la persona en un deporte con perfil `futbol` (fútbol o fútbol femenino). Los de vóley van a su plantel de vóley. Quien juega los dos deportes recibe los dos juegos si el archivo trae los dos.
- **Qué atributos carga:** 5 por deporte. Fútbol: Disparo, Pase, Defensa, Velocidad y Dribbling. Vóley: Mate, Saque, Recepción, Armado y Bloqueo. Es el catálogo **sin Fuerza**.
- **Se puede volver a correr:** si un plantel ya tenía estadísticas, se reemplazan.
- **Resultado:** al final lista cada plantel cargado con sus valores. Contra los datos de desarrollo son 54 planteles: 45 de fútbol y 9 de vóley, 270 filas en total.

## Qué quedó distinto al archivo

- **Cuatro valores de 100 se cargan como 99**, porque el máximo es 99 y la base rechaza el 100. Están marcados con `-- en el archivo: 100`:
  - Rodriguez Mancilla Juan Gustavo: Pase y Defensa.
  - Ferrel Salcedo Daryl: Disparo.
  - Benites Chuquimia Tomas: Pase y Defensa.
  - Quintana Flores Miguel Angel: Disparo.
- **VERASTEGUI RAMOS ALESSANDRA, fútbol, queda comentado:** solo está inscrita en vóley, así que sus valores de fútbol no tienen plantel donde ir. Sus valores de vóley sí se cargan.
- **Las personas sin valores en el archivo no se tocan.** Son KATHY, ERIKA, PATRICIA y ANA (posible), y siguen mostrando «Sin estadísticas».

## Comprobaciones antes de escribir

Si una falla, el script se detiene con este error y **no escribe nada**:

| Error | Qué significa |
|---|---|
| `ABORTADO_hay_nombres_que_no_estan_en_jugador` | Un nombre no está en `jugador`, o está más de una vez. La consulta 4a, justo antes, muestra cuál. |
| `ABORTADO_hay_personas_sin_plantel_de_ese_deporte` | Alguien trae valores de un deporte en el que no está inscrito, o ese deporte no tiene perfil. La consulta 4b muestra quién. |
| `ABORTADO_el_catalogo_no_tiene_estos_5_y_5_atributos` | El catálogo `estadistica` no tiene exactamente estos 10 atributos. Pasa en una base que todavía tiene Fuerza, como hoy la de desarrollo: ahí las fichas de fútbol quedarían con un atributo vacío. |
| `ABORTADO_un_valor_pasa_de_99` | Algún valor del script pasa de 99. |

Se probó en una copia desechable de la base de desarrollo:
- Con Fuerza en el catálogo, se detiene sin escribir nada.
- Sin Fuerza, como está producción, carga 270 filas en 54 planteles. Una segunda corrida deja las mismas 270.
- Con un nombre mal escrito, o con los valores de fútbol de Alessandra, se detiene sin escribir nada.

## Cómo correrlo en producción

Como root de MySQL, con respaldo antes, desde `/srv/la-liga-acp`. Guarda el bloque SQL de abajo como `carga-estadisticas.sql`:

```sh
docker compose -f compose.prod.yaml exec -T db \
  sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --databases "$MYSQL_DATABASE"' \
  > respaldo-antes-de-estadisticas.sql
docker compose -f compose.prod.yaml exec -T db \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$MYSQL_DATABASE"' \
  < carga-estadisticas.sql
```

Desde DBeaver también funciona. Ejecútalo como script completo (Alt+X), no sentencia por sentencia, porque usa tablas temporales de la misma sesión.

**Esta carga no deja registro en la auditoría**, porque no pasa por el backend. Lo que se cargue o corrija después desde Admin → Planteles sí queda registrado.

## El script

```sql
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 1. Los valores, como en relacionUsuarios.md: un renglón por persona y deporte.
--    futbol: v1 Disparo, v2 Pase, v3 Defensa, v4 Velocidad, v5 Dribbling
--    voley:  v1 Mate,    v2 Saque, v3 Recepción, v4 Armado, v5 Bloqueo
DROP TEMPORARY TABLE IF EXISTS carga_estadisticas;
CREATE TEMPORARY TABLE carga_estadisticas (
  nombre VARCHAR(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  perfil VARCHAR(50)  COLLATE utf8mb4_unicode_ci NOT NULL,
  v1 TINYINT UNSIGNED NOT NULL,
  v2 TINYINT UNSIGNED NOT NULL,
  v3 TINYINT UNSIGNED NOT NULL,
  v4 TINYINT UNSIGNED NOT NULL,
  v5 TINYINT UNSIGNED NOT NULL,
  PRIMARY KEY (nombre, perfil),
  CONSTRAINT ABORTADO_un_valor_pasa_de_99 CHECK (GREATEST(v1, v2, v3, v4, v5) <= 99),
  CONSTRAINT ABORTADO_perfil_desconocido CHECK (perfil IN ('futbol', 'voley'))
);

INSERT INTO carga_estadisticas (nombre, perfil, v1, v2, v3, v4, v5) VALUES
  ('Taboada Yarleque Miguel Luis',              'futbol', 85, 78, 82, 78, 80),
  ('Silva Pachas José David',                   'futbol', 85, 88, 90, 87, 60),
  ('Rodriguez Mancilla Juan Gustavo',           'futbol', 94, 99, 99, 86, 80),  -- en el archivo: 100
  ('Valdez Neyra Cesar',                        'futbol', 88, 93, 93, 85, 96),
  ('Yenque Herrera Jose Carlos Hector',         'futbol', 90, 86, 92, 94, 86),
  ('Ferrel Salcedo Daryl',                      'futbol', 99, 94, 95, 85, 70),  -- en el archivo: 100
  ('Serpa Nostades Nefi Mauro',                 'futbol', 88, 90, 94, 92, 93),
  ('Bravo Cordova Juan',                        'futbol', 90, 94, 89, 95, 91),
  ('Benites Chuquimia Tomas',                   'futbol', 94, 99, 99, 86, 85),  -- en el archivo: 100
  ('Quintana Flores Miguel Angel',              'futbol', 99, 94, 95, 85, 87),  -- en el archivo: 100
  ('Silva Arias Jorge Leonardo',                'futbol', 85, 88, 90, 87, 87),
  ('Zorrilla Chávez Jason Grover',              'futbol', 90, 86, 92, 94, 86),
  ('Tenorio Santillana Orlando',                'futbol', 88, 90, 94, 92, 93),
  ('Wong Carcamo Raul Alfonso',                 'futbol', 90, 94, 89, 95, 91),
  ('Suasnabar Padilla Jairo Jandir',            'futbol', 88, 93, 93, 85, 96),
  ('Leyva Rodriguez Aaron',                     'futbol', 95, 92, 94, 96, 85),
  ('Luis Angel Pendola Guerrero',               'voley',  97, 93, 91, 92, 94),
  ('Farfan Canales Max Javier',                 'voley',  97, 94, 91, 92, 94),
  ('Herrera Cortez Joel Antonio Anibal',        'voley',  97, 94, 91, 92, 94),
  ('Luis F. Solís Sánchez',                     'futbol', 80, 80, 80, 80, 80),
  ('Fabian Gilgrados Cardoza',                  'futbol', 90, 90, 90, 90, 90),
  ('Jean González Fernández',                   'futbol', 70, 70, 70, 70, 70),
  ('Bryan Adriano Souza López',                 'futbol', 92, 92, 92, 92, 92),
  ('Kevin Luis Saravia Huárez',                 'futbol', 85, 90, 90, 90, 90),
  ('Gian Marco Gil Bueno',                      'futbol', 70, 70, 70, 70, 70),
  ('Juan Diego Yanqui Huillca',                 'futbol', 80, 80, 80, 80, 85),
  ('Oscar Gabriel Melchor Arias',               'futbol', 80, 80, 90, 80, 80),
  ('Paul Vargas Falcón',                        'futbol', 85, 90, 90, 90, 90),
  ('MORANTE ESPINOZA NAYELI MIRELLA',           'futbol', 91, 81, 84, 98, 94),
  ('MORANTE ESPINOZA NAYELI MIRELLA',           'voley',  87, 86, 85, 90, 84),
  ('SEGAMA VILLA PATRICIA GRACIELA',            'futbol', 94, 84, 99, 87, 86),
  ('SEGAMA VILLA PATRICIA GRACIELA',            'voley',  84, 86, 85, 90, 84),
  ('HERRERA CHOCOS GRECIA ANDREINA',            'futbol', 88, 83, 91, 94, 84),
  ('HERRERA CHOCOS GRECIA ANDREINA',            'voley',  90, 89, 86, 90, 89),
  ('ANDREA LINARES',                            'futbol', 96, 80, 97, 93, 94),
  ('LOARTE PRETEL GIOMIRA ROSSY',               'futbol', 81, 80, 85, 75, 81),
  ('HERRERA LOPEZ DE ALFARO MARSHELLI',         'futbol', 74, 71, 81, 73, 70),
  ('SOJO PITA MIRELLA PATRICIA',                'futbol', 83, 85, 85, 77, 82),
  ('SOJO PITA MIRELLA PATRICIA',                'voley',  89, 89, 87, 90, 85),
  ('CARRERA RUIZ KAREN RUTH',                   'futbol', 80, 78, 80, 77, 75),
  ('HENS MACHADO BRIGGITHE STEPHANY',           'futbol', 74, 71, 81, 73, 70),
  ('DELGADO MARTINEZ NOEMI TABATA NAZIRA',      'futbol', 80, 78, 76, 77, 70),
  ('ZAPATA VILLEGAS CINTYA LESLY',              'futbol', 83, 85, 85, 77, 82),
  ('HUAMAN LLACTAS ZULMA ZULIANA',              'futbol', 81, 80, 85, 73, 81),
  ('YOSELIN MATIENZO DEZA',                     'futbol', 90, 85, 75, 70, 80),
  ('MAGALY LUCERO ZAPATA ROSADO',               'futbol', 65, 70, 70, 60, 60),
  ('ELIZABETH WENDY GUTIERREZ SILVA',           'futbol', 75, 70, 70, 70, 70),
  ('TRACY SOLANGE MARIA LOREN ESPINOZA FRANCIA','futbol', 80, 70, 75, 65, 65),
  ('MAYRIN IRENE PALOMINO MACEDO',              'futbol', 75, 70, 70, 70, 70),
  ('YESSENIA ISABEL ZAVALETA CHAPARRO',         'futbol', 65, 70, 70, 60, 60),
  ('MELISSA KARINA TABOADA SUAREZ',             'futbol', 80, 80, 80, 80, 70),
  ('CARLA ESTEFANIA RODRIGUEZ ANGULO',          'futbol', 70, 75, 68, 70, 65),
  -- ('VERASTEGUI RAMOS ALESSANDRA',            'futbol', 99, 93, 99, 96, 87),  -- sin plantel de fútbol: solo juega vóley
  ('VERASTEGUI RAMOS ALESSANDRA',               'voley',  83, 83, 85, 90, 85),
  ('REYES PASTOR LEYDI LIZETT',                 'voley',  85, 87, 85, 90, 85);

-- 2. Qué columna es cada atributo.
DROP TEMPORARY TABLE IF EXISTS carga_columnas;
CREATE TEMPORARY TABLE carga_columnas (
  perfil   VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  posicion TINYINT UNSIGNED NOT NULL,
  atributo VARCHAR(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (perfil, posicion)
);
INSERT INTO carga_columnas (perfil, posicion, atributo) VALUES
  ('futbol', 1, 'disparo'), ('futbol', 2, 'pase'),  ('futbol', 3, 'defensa'),   ('futbol', 4, 'velocidad'), ('futbol', 5, 'dribbling'),
  ('voley',  1, 'mate'),    ('voley',  2, 'saque'), ('voley',  3, 'recepcion'), ('voley',  4, 'armado'),    ('voley',  5, 'bloqueo');

-- 3. Un renglón por atributo.
DROP TEMPORARY TABLE IF EXISTS carga_filas;
CREATE TEMPORARY TABLE carga_filas AS
SELECT c.nombre, c.perfil, m.atributo,
       CASE m.posicion WHEN 1 THEN c.v1 WHEN 2 THEN c.v2 WHEN 3 THEN c.v3 WHEN 4 THEN c.v4 ELSE c.v5 END AS valor
FROM carga_estadisticas c
JOIN carga_columnas m ON m.perfil = c.perfil;

-- 4. Comprobaciones. Si alguna falla, el script se detiene aquí con el nombre de
--    la comprobación en el error, y no se ha escrito nada en plantel_estadistica.
--    Las consultas de diagnóstico muestran qué renglones fallan (deben salir vacías).

-- 4a. Nombres que no están en jugador (o que están más de una vez).
SELECT c.nombre, (SELECT COUNT(*) FROM jugador j WHERE j.nombre = c.nombre) AS coincidencias
FROM carga_estadisticas c
WHERE (SELECT COUNT(*) FROM jugador j WHERE j.nombre = c.nombre) <> 1;

-- 4b. Personas sin un plantel del deporte de sus valores.
SELECT c.nombre, c.perfil
FROM carga_estadisticas c
WHERE NOT EXISTS (
  SELECT 1
  FROM jugador j
  JOIN plantel p             ON p.jugador_id = j.id
  JOIN competicion co        ON co.id = p.competicion_id
  JOIN deporte d             ON d.id = co.deporte_id
  JOIN perfil_estadistico pe ON pe.id = d.perfil_estadistico_id
  WHERE j.nombre = c.nombre AND pe.codigo = c.perfil
);

DROP TEMPORARY TABLE IF EXISTS carga_guardia;
CREATE TEMPORARY TABLE carga_guardia (
  nombres   TINYINT NULL,
  planteles TINYINT NULL,
  catalogo  TINYINT NULL,
  CONSTRAINT ABORTADO_hay_nombres_que_no_estan_en_jugador CHECK (nombres = 1),
  CONSTRAINT ABORTADO_hay_personas_sin_plantel_de_ese_deporte CHECK (planteles = 1),
  CONSTRAINT ABORTADO_el_catalogo_no_tiene_estos_5_y_5_atributos CHECK (catalogo = 1)
);

INSERT INTO carga_guardia (nombres)
SELECT COUNT(*) = 0
FROM carga_estadisticas c
WHERE (SELECT COUNT(*) FROM jugador j WHERE j.nombre = c.nombre) <> 1;

INSERT INTO carga_guardia (planteles)
SELECT COUNT(*) = 0
FROM carga_estadisticas c
WHERE NOT EXISTS (
  SELECT 1
  FROM jugador j
  JOIN plantel p             ON p.jugador_id = j.id
  JOIN competicion co        ON co.id = p.competicion_id
  JOIN deporte d             ON d.id = co.deporte_id
  JOIN perfil_estadistico pe ON pe.id = d.perfil_estadistico_id
  WHERE j.nombre = c.nombre AND pe.codigo = c.perfil
);

-- 4c. Fútbol y vóley tienen exactamente estos atributos (sin Fuerza): si el
--     catálogo tuviera uno más, las fichas quedarían con el radar incompleto.
INSERT INTO carga_guardia (catalogo)
SELECT (SELECT COUNT(*)
        FROM estadistica e
        JOIN perfil_estadistico pe ON pe.id = e.perfil_estadistico_id
        WHERE pe.codigo IN ('futbol', 'voley')) = 10
   AND (SELECT COUNT(*)
        FROM carga_columnas m
        JOIN perfil_estadistico pe ON pe.codigo = m.perfil
        JOIN estadistica e         ON e.perfil_estadistico_id = pe.id AND e.codigo = m.atributo) = 10;

-- 5. La carga. Los valores van a cada plantel de la persona cuyo deporte tiene
--    ese perfil. Si ya tenía estadísticas, se reemplazan: se puede volver a correr.
INSERT INTO plantel_estadistica (plantel_id, estadistica_id, valor)
SELECT * FROM (
  SELECT p.id AS plantel_id, e.id AS estadistica_id, f.valor
  FROM carga_filas f
  JOIN jugador j             ON j.nombre = f.nombre
  JOIN plantel p             ON p.jugador_id = j.id
  JOIN competicion co        ON co.id = p.competicion_id
  JOIN deporte d             ON d.id = co.deporte_id
  JOIN perfil_estadistico pe ON pe.id = d.perfil_estadistico_id AND pe.codigo = f.perfil
  JOIN estadistica e         ON e.perfil_estadistico_id = pe.id AND e.codigo = f.atributo
) AS s
ON DUPLICATE KEY UPDATE valor = s.valor;

-- 6. Resultado: cada plantel cargado con sus valores, en el orden del radar.
SELECT j.nombre, eq.nombre AS equipo, pe.codigo AS perfil,
       GROUP_CONCAT(CONCAT(e.nombre, ' ', ps.valor) ORDER BY e.orden SEPARATOR ', ') AS estadisticas
FROM carga_estadisticas c
JOIN jugador j               ON j.nombre = c.nombre
JOIN plantel p               ON p.jugador_id = j.id
JOIN equipo eq               ON eq.id = p.equipo_id
JOIN plantel_estadistica ps  ON ps.plantel_id = p.id
JOIN estadistica e           ON e.id = ps.estadistica_id
JOIN perfil_estadistico pe   ON pe.id = e.perfil_estadistico_id AND pe.codigo = c.perfil
GROUP BY j.nombre, eq.nombre, pe.codigo
ORDER BY pe.codigo, eq.nombre, j.nombre;

DROP TEMPORARY TABLE IF EXISTS carga_guardia, carga_filas, carga_columnas, carga_estadisticas;
```
