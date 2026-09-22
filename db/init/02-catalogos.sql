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

-- Las 5 de NFR-006 y, desde T-17, el resto de las escrituras del admin.
INSERT INTO accion_auditoria (codigo, nombre, entidad) VALUES
  ('validacion_usuario',     'Validación de usuario',                'usuario'),
  ('modificacion_partido',   'Modificación de partido',              'partido'),
  ('registro_resultado',     'Registro de resultado',                'partido'),
  ('confirmacion_resultado', 'Confirmación definitiva de resultado', 'partido'),
  ('cancelacion_partido',    'Cancelación de partido',               'partido'),
  ('confirmacion_pago',      'Confirmación de pago',                 'usuario'),
  ('reversion_pago',         'Reversión de pago',                    'usuario'),
  ('creacion_administrador', 'Creación de administrador',            'usuario'),
  ('promocion_administrador','Promoción a administrador',            'usuario'),
  ('alta_partido',           'Alta de partido',                      'partido'),
  ('borrado_partido',        'Borrado de partido',                   'partido'),
  ('alta_deporte',           'Alta de deporte',                      'deporte'),
  ('modificacion_deporte',   'Modificación de deporte',              'deporte'),
  ('borrado_deporte',        'Borrado de deporte',                   'deporte'),
  ('alta_competicion',       'Alta de competición',                  'competicion'),
  ('modificacion_competicion', 'Modificación de competición',        'competicion'),
  ('borrado_competicion',    'Borrado de competición',               'competicion'),
  ('alta_equipo',            'Alta de equipo',                       'equipo'),
  ('modificacion_equipo',    'Modificación de equipo',               'equipo'),
  ('borrado_equipo',         'Borrado de equipo',                    'equipo'),
  ('alta_jugador',           'Alta de jugador',                      'jugador'),
  ('modificacion_jugador',   'Modificación de jugador',              'jugador'),
  ('borrado_jugador',        'Borrado de jugador',                   'jugador'),
  ('alta_plantel',           'Inscripción en plantel',               'plantel'),
  ('modificacion_plantel',   'Modificación de inscripción',          'plantel'),
  ('borrado_plantel',        'Baja de inscripción',                  'plantel'),
  ('alta_gol',               'Registro de gol',                      'gol'),
  ('modificacion_gol',       'Modificación de gol',                  'gol'),
  ('borrado_gol',            'Borrado de gol',                       'gol'),
  ('alta_multimedia',        'Alta de multimedia del partido',       'multimedia_partido'),
  ('borrado_multimedia',     'Borrado de multimedia del partido',    'multimedia_partido');
