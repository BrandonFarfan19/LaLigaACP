-- La Liga ACP — filas de catálogo. La lógica filtra por `codigo`, nunca por `id`.
-- Solo catálogos globales: no se cargan equipos, jugadores ni partidos.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO rol (codigo, nombre) VALUES
  ('apostador', 'Apostador'),
  ('admin',     'Administrador');

INSERT INTO estado_partido (codigo, nombre) VALUES
  ('programado', 'Programado'),
  ('en_vivo',    'En vivo'),
  ('finalizado', 'Finalizado'),
  ('suspendido', 'Suspendido');

INSERT INTO mercado_tipo (codigo, nombre) VALUES
  ('ganador_partido',    'Ganador del partido'),
  ('campeon_disciplina', 'Campeón de la disciplina');

INSERT INTO estado_mercado (codigo, nombre) VALUES
  ('abierto',   'Abierto'),
  ('cerrado',   'Cerrado'),
  ('liquidado', 'Liquidado'),
  ('anulado',   'Anulado');
