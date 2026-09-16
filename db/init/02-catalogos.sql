-- La Liga ACP — filas de catálogo. La lógica filtra por `codigo`, nunca por `id`.
-- Solo catálogos globales: no se cargan deportes, competiciones, equipos,
-- jugadores, partidos ni usuarios.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO rol (codigo, nombre) VALUES
  ('apostador', 'Usuario'),
  ('admin',     'Administrador');

INSERT INTO estado_usuario (codigo, nombre) VALUES
  ('pendiente', 'Pendiente'),
  ('validado',  'Validado');

INSERT INTO estado_pago (codigo, nombre) VALUES
  ('pendiente',  'Pendiente'),
  ('confirmado', 'Confirmado');

INSERT INTO estado_partido (codigo, nombre) VALUES
  ('programado', 'Programado'),
  ('en_curso',   'En curso'),
  ('finalizado', 'Finalizado'),
  ('cancelado',  'Cancelado');

INSERT INTO tipo_apuesta (codigo, nombre) VALUES
  ('resultado_general', 'Resultado general'),
  ('marcador_exacto',   'Marcador exacto');

INSERT INTO resultado_general (codigo, nombre) VALUES
  ('local_gana',      'Gana el equipo local'),
  ('empate',          'Empate'),
  ('visitante_gana',  'Gana el equipo visitante');

INSERT INTO estado_seleccion (codigo, nombre) VALUES
  ('pendiente',    'Pendiente'),
  ('acertada',     'Acertada'),
  ('no_acertada',  'No acertada'),
  ('anulada',      'Anulada');

INSERT INTO tipo_movimiento (codigo, nombre) VALUES
  ('validacion',             'Validación de usuario'),
  ('seleccion_confirmada',   'Selección confirmada'),
  ('devolucion_cancelacion', 'Devolución por cancelación');

INSERT INTO accion_auditoria (codigo, nombre, entidad) VALUES
  ('validacion_usuario',    'Validación de usuario',            'usuario'),
  ('modificacion_partido',  'Modificación de partido',          'partido'),
  ('registro_resultado',    'Registro de resultado',            'partido'),
  ('confirmacion_resultado','Confirmación definitiva de resultado', 'partido'),
  ('cancelacion_partido',   'Cancelación de partido',           'partido');
