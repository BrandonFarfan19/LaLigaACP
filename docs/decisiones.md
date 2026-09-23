# Decisiones tomadas por el coordinador

Registro de las dudas que normalmente se habrían consultado al usuario y que, por su pedido del 2026-09-16, el coordinador resolvió solo, eligiendo la opción más cercana al modelo de negocio y a su recomendación. Sirve para auditarlas al terminar el proyecto.

- Solo el coordinador escribe aquí. Una entrada por decisión, la más reciente al final.
- Las decisiones que el usuario tomó antes de esa fecha no están aquí: quedaron en `docs/business-rules.md`, `docs/plan-polla.md` y `historial.md`.
- Si el usuario revierte una decisión, se agrega una nota a su entrada, no se borra.

Formato de cada entrada:

```markdown
## D-NNN · AAAA-MM-DD · T-XX — Título corto

- **Pregunta:** qué había que decidir y por qué surgió.
- **Opciones:**
  1. Opción A: consecuencias.
  2. Opción B: consecuencias.
- **Decisión:** la opción elegida.
- **Motivo:** por qué es la más cercana al modelo de negocio.
- **Dónde quedó aplicada:** reglas, archivos o tarea.
```

---

## D-001 · 2026-09-16 · T-16 — ¿Se puede borrar un partido cancelado?

- **Pregunta:** la T-16 hizo definitiva la cancelación (BR-012, BR-045), pero `deleteMatch` sigue permitiendo borrar un partido cancelado que no tiene apuestas, goles ni resultado. BR-012 no dice nada del borrado. Lo señaló `tester_liga` en la revisión de la T-16.
- **Opciones:**
  1. Permitir borrar un partido cancelado sin apuestas, goles, resultado ni multimedia: sirve para limpiar errores de carga y no afecta a nadie.
  2. Prohibir borrar cualquier partido cancelado: el registro de la cancelación queda siempre, aunque no tenga datos asociados.
- **Decisión:** opción 1.
- **Motivo:** "definitiva" protege a los apostadores (no se reactiva ni se reprograma un partido con apuestas anuladas y monedas devueltas). Un partido cancelado sin ningún dato asociado no tiene efectos que proteger, y borrarlo permite corregir cargas erróneas. Con apuestas, goles, resultado o multimedia el borrado sigue rechazado, y la auditoría (T-17) conserva el rastro de la acción.
- **Dónde quedó aplicada:** BR-012 y BR-045 deben decirlo explícito; se pide al ejecutor en el paso 0 de la T-17.

## D-002 · 2026-09-17 · T-16 — Cancelar un partido con apuestas de una cuenta que hoy es administrador

- **Pregunta:** si un apostador tenía apuestas pendientes y después fue promovido a administrador (solo posible con datos a mano, porque `admin:create` no promueve cuentas que participaron), cancelar el partido falla entero con 403 `NOT_A_PARTICIPANT` y ninguna apuesta se anula. Lo señaló `tester_liga`.
- **Opciones:**
  1. Anular también esas selecciones, pero sin devolver monedas: un administrador no puede tener monedas (BR-001).
  2. Anular y devolver igual: el administrador quedaría con monedas, contra BR-001, y `coins:check` lo marcaría.
  3. Dejar que la cancelación falle hasta que alguien corrija los datos.
- **Decisión:** opción 1.
- **Motivo:** la cancelación tiene que poder completarse siempre, porque protege a los demás apostadores (BR-045, BR-055). Un administrador no participa ni tiene monedas, así que no corresponde devolverle. El caso queda visible en la vista previa y en la respuesta.
- **Dónde quedó aplicada:** paso 0 de la T-17 (servicio de cancelación, BR-045 y prueba).

## D-003 · 2026-09-17 · T-16 — Qué cuenta como "monedas devueltas"

- **Pregunta:** el comprobante, el resumen de mis apuestas y las estadísticas cuentan 1 moneda devuelta por cada selección anulada, aunque no se haya devuelto (selección sin débito, o de una cuenta que hoy es admin según D-002). Con esos datos muestran 7 cuando se devolvieron 5. Lo señaló `tester_liga`.
- **Opciones:**
  1. Calcularlo desde `movimiento_moneda` (devoluciones reales).
  2. Mantener el conteo por selección anulada y documentarlo.
- **Decisión:** opción 1.
- **Motivo:** el usuario ve su saldo y sus movimientos reales. Mostrar monedas que nunca recibió contradice BR-009 y BR-046, que hablan de las monedas efectivamente devueltas.
- **Dónde quedó aplicada:** paso 0 de la T-17 (comprobante, mis apuestas, resumen y estadísticas).

## D-004 · 2026-09-17 · T-17 — ¿Se audita una edición que no cambia nada?

- **Pregunta:** un PATCH de admin con los mismos valores que ya tenía el registro deja una fila de auditoría con `cambios` vacío. Lo señaló `tester_liga`.
- **Opciones:**
  1. No registrar nada si no cambió ningún campo (la respuesta sigue siendo 200).
  2. Registrarlo igual, marcado como "sin cambios".
- **Decisión:** opción 1.
- **Motivo:** NFR-006 pide auditar operaciones administrativas relevantes, y una edición que no modifica nada no altera ningún dato ni ninguna regla. Registrarla solo agrega ruido a la consulta de auditoría.
- **Dónde quedó aplicada:** corrección de la T-17.
- **Ampliación (2026-09-17, re-test de la T-17):**
  - **Registro de resultado:** la misma regla vale para volver a registrar exactamente el mismo marcador. `tester_liga` vio que hoy deja un `registro_resultado` con el marcador anterior igual al nuevo.
  - **Qué es "sin cambios":** la comparación se hace siempre sobre los valores reales, nunca sobre los recortados para la auditoría. `tester_liga_2` encontró que una foto o un escudo que cambiaba después del carácter 200 se guardaba sin dejar registro, porque se comparaban los valores recortados.

## D-005 · 2026-09-17 · T-17 — ¿Se audita la creación o promoción de administradores?

- **Pregunta:** `npm run admin:create` crea o promueve administradores desde el servidor y hoy no deja registro de auditoría. No hay un administrador autor, porque el comando no pasa por la API. Lo señaló `tester_liga`.
- **Opciones:**
  1. Auditarlo: una fila con acción propia (creación o promoción de administrador), con la cuenta afectada como autor y entidad, y un detalle que indique que el origen fue el comando del servidor.
  2. No auditarlo, porque está fuera de la aplicación, y dejar solo un mensaje en la salida del comando.
- **Decisión:** opción 1.
- **Motivo:** crear o promover un administrador es la acción más sensible del sistema (BR-001, NFR-005). Dejarla sin rastro contradice el objetivo de NFR-006. Usar la cuenta afectada como autor respeta la regla de que el autor de una fila de auditoría es un administrador, sin inventar un usuario de sistema.
- **Dónde quedó aplicada:** corrección de la T-17 (comando `admin:create`, `accion_auditoria` y NFR-006).

## D-006 · 2026-09-17 · T-18 — Cómo habla el front con la API

- **Pregunta:** la T-18 es la primera pantalla que usa la API con sesión. La cookie de sesión es `HttpOnly` y `SameSite=Strict`, en producción lleva el prefijo `__Host-`, y las escrituras exigen `Origin` igual al front y un token CSRF. Hay que decidir si el front llama a la API en otro origen (CORS con credenciales) o en el mismo origen.
- **Opciones:**
  1. Mismo origen: el front llama a rutas relativas bajo un prefijo (por ejemplo `/api`). En desarrollo, el proxy de Vite las reenvía al backend; en producción, un proxy inverso del hosting hace lo mismo.
  2. Otro origen: el front llama a `http://localhost:3001` (o al dominio de la API) con `credentials: 'include'`, y CORS permite el origen del front.
- **Decisión:** opción 1.
- **Motivo:** es lo más seguro y lo más simple para las reglas ya aprobadas. `__Host-` y `SameSite=Strict` funcionan sin excepciones, no hay que abrir CORS con credenciales y la verificación de `Origin` coincide sola. Además, el front no depende de la URL de la API en cada ambiente. El CORS actual se mantiene para quien llame desde otro origen.
- **Dónde quedó aplicada:** T-18 (cliente de la API del front, proxy de Vite, README y CLAUDE.md). La T-22 y el despliegue deben respetarla.

## D-007 · 2026-09-17 · T-18 — Dónde va la barra de sesión y las monedas en móvil

- **Pregunta:** BR-010 y NFR-004 piden el contador de monedas siempre visible en el navbar. En pantallas de menos de 64rem no entra en la fila actual del navbar, así que el ejecutor agregó una segunda fila (`--navbar-height` de 112/128 px) que baja el contenido de todas las páginas, incluida la landing.
- **Opciones:**
  1. Navbar de dos filas en móvil: la segunda fila lleva monedas, cuenta y salir, siempre visibles.
  2. Una sola fila con el contador compacto (icono y número) y el resto (cuenta, salir) dentro del menú.
  3. Mostrar las monedas solo dentro del menú en móvil.
- **Decisión:** opción 1, siempre que no rompa la landing (anclas como `/#fixture`, el hero y el desplazamiento quedan bien con la altura nueva). Si la revisión encuentra roturas, se pasa a la opción 2.
- **Motivo:** cumple BR-010 al pie de la letra (el saldo siempre a la vista) con targets de 44 px y sin esconder la acción de salir. La opción 3 incumple BR-010, y la 2 vuelve a amontonar la fila principal en 390 px.
- **Dónde quedó aplicada:** T-18 (`SessionBar`, `--navbar-height`). Se verifica en la revisión visual de la T-18.

## D-008 · 2026-09-17 · T-18 — Adónde va el usuario al entrar sin página de origen

- **Pregunta:** si alguien ingresa sin `?next=`, el ejecutor lo lleva a `/cuenta` (apostador) o a `/admin` (administrador). También vacía la contraseña tras cada intento fallido.
- **Opciones:**
  1. Llevarlo a su cuenta o al panel, y vaciar la contraseña tras un fallo.
  2. Llevarlo al inicio (`/`) y conservar la contraseña escrita.
- **Decisión:** opción 1. Cuando exista la pantalla de apuestas (T-19), un apostador validado sin `?next=` irá a apostar, que es la acción principal de la polla.
- **Motivo:** después de entrar, lo útil es ver el estado de la cuenta (pendiente o validada, monedas) o el panel. Vaciar la contraseña tras un fallo es la práctica habitual y evita que quede en pantalla.
- **Dónde quedó aplicada:** T-18; el ajuste del destino del apostador validado se pide en la T-19.

## D-009 · 2026-09-17 · T-18 — El front agota el límite general de peticiones

- **Pregunta:** el front consulta `/auth/me` en cada cambio de página, y el límite general del backend es de 100 peticiones cada 15 minutos por IP. `tester_liga` lo agotó navegando: el servidor respondió 429 a todo durante 15 minutos. Detrás de una IP compartida (oficina, NAT), pocos usuarios navegando bloquearían a todos.
- **Opciones:**
  1. Dejar `GET /auth/me` fuera del límite general, con un límite propio más amplio, y que el front lea la sesión solo cuando hace falta: siempre al entrar a una página protegida, y en las páginas públicas desde una copia en memoria de corta duración.
  2. Subir el límite general para todas las rutas.
  3. No cambiar nada y documentarlo.
- **Decisión:** opción 1, con el límite general configurable como ya está.
- **Motivo:** leer la propia sesión es barato y no expone nada. Separarlo evita que la navegación normal bloquee acciones reales. Subir el límite general (opción 2) debilitaría la protección de las escrituras y del resto de la API, y la opción 3 deja la polla inutilizable detrás de una IP compartida. Además, leer siempre la sesión en las páginas protegidas resuelve el defecto de sesión vencida que encontró `tester_liga`.
- **Dónde quedó aplicada:** corrección de la T-18 (backend `security.ts` y front `src/lib/auth.ts`).

## D-010 · 2026-09-17 · T-18 — Tuteo o voseo en los mensajes

- **Pregunta:** algunos mensajes del backend que ve el usuario usan voseo ("Probá de nuevo"), y el resto de la interfaz no.
- **Opciones:**
  1. Español neutro con tuteo en todos los mensajes visibles.
  2. Voseo en todos.
- **Decisión:** opción 1.
- **Motivo:** es el registro del resto de la interfaz y de los documentos del proyecto, y el más natural para una liga en Perú (el esquema fija la zona horaria de Lima).
- **Dónde quedó aplicada:** corrección de la T-18 (mensajes del backend y del front).

## D-011 · 2026-09-17 · T-18 — Nombre a mostrar en el registro

- **Pregunta:** el registro de cuentas (T-03) acepta un nombre formado solo por un emoji, mientras que los nombres del catálogo (T-06) exigen al menos una letra o un número y rechazan caracteres invisibles. El nombre de la cuenta se muestra en el ranking y en la auditoría.
- **Opciones:**
  1. Aplicar al nombre de la cuenta la misma validación que a los nombres del catálogo.
  2. Mantener la validación actual del registro.
- **Decisión:** opción 1.
- **Motivo:** el nombre aparece a otros usuarios en el ranking (BR-042). Un nombre invisible, vacío a la vista o engañoso confunde el ranking, igual que en el catálogo.
- **Dónde quedó aplicada:** corrección de la T-18 (esquema de registro y BR-003).

## D-012 · 2026-09-17 · T-19 — ¿Se conserva el ticket en armado si se recarga la página?

- **Pregunta:** en la interfaz de apuestas el usuario arma un ticket con varias selecciones antes de confirmarlo. Hay que decidir si ese borrador se pierde al recargar o al cambiar de página.
- **Opciones:**
  1. Guardarlo en `sessionStorage` del navegador, asociado al usuario, y borrarlo al confirmar, al cancelar y al salir.
  2. Guardarlo solo en memoria (se pierde al recargar).
  3. Guardarlo en el backend.
- **Decisión:** opción 1.
- **Motivo:** en el móvil es fácil recargar o cambiar de pestaña sin querer, y perder un ticket de varias selecciones frustra. El borrador no mueve monedas ni tiene valor hasta confirmarse (BR-022, BR-024), así que no hace falta guardarlo en el servidor. `sessionStorage` no sobrevive a cerrar la pestaña y no se comparte entre usuarios. Al confirmar, el backend vuelve a validar todo (cierre, saldo, empate).
- **Dónde quedó aplicada:** T-19.

## D-013 · 2026-09-17 · T-19 — Datos de ejemplo para desarrollo

- **Pregunta:** la base de desarrollo está vacía, y desde la T-19 las pantallas necesitan deportes, equipos, jugadores y partidos en varios estados para desarrollarlas y revisarlas en el navegador. `CLAUDE.md` pide no cargar equipos, jugadores ni partidos salvo que se pida explícitamente.
- **Opciones:**
  1. Un comando explícito solo de desarrollo (por ejemplo `npm run server:seed:dev`) que cargue datos ficticios marcados, que se niegue a correr fuera de desarrollo y que se pueda borrar con otro comando.
  2. Que cada tester cargue sus datos a mano por la API, como hasta ahora.
  3. Cargar datos en `db/init`, para que existan siempre.
- **Decisión:** opción 1.
- **Motivo:** mantiene la regla de `CLAUDE.md`, porque nada se carga solo: hace falta ejecutar el comando a propósito. Ahorra tiempo en cada revisión visual y hace las revisiones repetibles. La opción 3 mezclaría datos ficticios con la base real, y la 2 obliga a cada revisión de pantallas a rearmar todo.
- **Dónde quedó aplicada:** T-19 (comando, README y `CLAUDE.md`).

## D-014 · 2026-09-17 · T-19 — Ancho mínimo que debe soportar la interfaz

- **Pregunta:** al sumar "Apostar" a la barra de sesión, el ejecutor redujo su relleno a 4 px y aun así a 320 px no entra. `CLAUDE.md` dice que se diseña primero para ~390 px, pero no fija un mínimo.
- **Opciones:**
  1. Soportar desde 320 px: nada se corta ni genera scroll horizontal en ese ancho.
  2. Soportar desde 360 px y aceptar que en 320 px algo no entre.
- **Decisión:** opción 1.
- **Motivo:** 320 px todavía existe en teléfonos pequeños y con zoom de accesibilidad. La revisión de la T-18 ya verificó que la landing no tenía scroll horizontal a 320 px, así que ese es el piso vigente. La barra de sesión puede reorganizarse (por ejemplo, llevar "Apostar" a otra fila o a un menú) sin bajar los targets de 44 px.
- **Dónde quedó aplicada:** T-19 (se verifica en su revisión; si falla, se corrige en esa tarea).

## D-015 · 2026-09-17 · T-19 — ¿La limpieza de los datos de ejemplo borra su auditoría?

- **Pregunta:** `server:seed:dev:clean` borra también los registros de auditoría de las cuentas de ejemplo, y la auditoría es inmutable dentro de la aplicación (NFR-006).
- **Opciones:**
  1. Borrarlos: son datos ficticios de desarrollo y el comando solo corre en desarrollo.
  2. Conservarlos: la auditoría no se borra nunca, ni siquiera en desarrollo.
- **Decisión:** opción 1, solo para filas cuyo autor es una cuenta de ejemplo y solo con el comando de desarrollo.
- **Motivo:** la inmutabilidad protege el rastro de operaciones reales. Las filas de las cuentas de ejemplo no representan operaciones reales, y dejarlas impediría borrar esas cuentas (el autor de la auditoría es obligatorio) o dejaría registros sin sentido. Ninguna ruta de la aplicación gana la capacidad de borrar auditoría.
- **Dónde quedó aplicada:** T-19 (`server:seed:dev:clean`), documentado en el README.

## D-016 · 2026-09-17 · T-19 — Cómo se protegen e identifican los datos de ejemplo

- **Pregunta:** `tester_liga_2` encontró dos problemas:
  - el comando de datos de ejemplo corría sin `NODE_ENV` (la configuración asume "development") y contra cualquier base, creando un administrador con clave conocida;
  - la limpieza reconocía sus datos por nombres, slugs y el dominio `@demo.liga.test`, y borraba datos reales parecidos, además de inscripciones y goles reales colgados de datos de ejemplo.
- **Opciones:**
  1. **Marcar y proteger:**
     - los datos de ejemplo se marcan con una tabla propia de desarrollo (`dato_demo`: tabla e id de cada fila creada), que el comando crea y que el alta real nunca toca;
     - el comando exige `NODE_ENV=development` escrito explícitamente (no el valor por defecto), que la base sea exactamente la de desarrollo configurada y una bandera explícita en la línea de comandos;
     - la limpieza borra solo las filas registradas en `dato_demo` y se niega, sin borrar nada, si hay datos reales colgados de ellas (apuestas, inscripciones, goles, multimedia, resultados).
  2. Mantener la identificación por nombres y reservar prefijos y el dominio para que el alta real no los pueda usar.
- **Decisión:** opción 1.
- **Motivo:** una marca que el alta real no puede producir elimina el riesgo de borrar datos reales, y reservar nombres (opción 2) restringe al usuario real sin garantizar nada. La triple exigencia (variable explícita, base de desarrollo y bandera) hace muy difícil ejecutar el comando por error en un servidor real. La tabla `dato_demo` no forma parte del esquema de la aplicación: la crea el comando solo en la base de desarrollo, y `EsquemaBD.md` la menciona como herramienta de desarrollo.
- **Dónde quedó aplicada:** corrección de la T-19 (comando, README, `CLAUDE.md` y `EsquemaBD.md`).

## D-017 · 2026-09-17 · T-19 — Filtro de deporte: lista desplegable u opciones visibles

- **Pregunta:** para cumplir D-014 (nada cortado a 320 px), el ejecutor cambió el filtro de deporte de `/apuestas` de una lista desplegable (`select`) a un grupo de opciones visibles (radios pixel art de 44 px). Un `select` cerrado corta los nombres largos de deporte.
- **Opciones:**
  1. Grupo de opciones visibles, que muestra los nombres completos y deja cada opción a un toque.
  2. Mantener el `select` y acortar o partir el texto visible.
- **Decisión:** opción 1, mientras haya pocos deportes. Si la cantidad de deportes crece al punto de alargar demasiado la pantalla en móvil, se vuelve a evaluar.
- **Motivo:** la polla maneja pocos deportes (fútbol, básquet, vóley, "otros configurados" según BR-048). Con pocos elementos, las opciones visibles se leen mejor y cumplen D-014 sin cortar texto. Además, un `select` nativo se ve como control del sistema y rompe el estilo pixel art.
- **Dónde quedó aplicada:** tercera corrección de la T-19 (`Apuestas.tsx`).

## D-018 · 2026-09-17 · T-20 — Cómo se llega a las pantallas de la polla desde el navbar

- **Pregunta:** con Mis apuestas y Ranking, la barra de sesión pasa a tener tres destinos de la polla además de monedas, cuenta y salir. A 320 px no entran como enlaces sueltos (D-014). El ejecutor los agrupó en un botón "Polla" que abre un menú (Apostar, Mis apuestas, Ranking) y dejó un enlace directo a Ranking para el administrador.
- **Opciones:**
  1. Un botón "Polla" con menú desplegable pixel art, accesible con teclado (Escape y clic afuera lo cierran).
  2. Enlaces sueltos en una tercera fila del navbar en móvil.
  3. Llevar esos enlaces solo a la página de cuenta.
- **Decisión:** opción 1.
- **Motivo:** mantiene el navbar en dos filas (D-007) y nada cortado a 320 px (D-014), con los tres destinos a dos toques. Una tercera fila empujaría aún más el contenido de todas las páginas, y dejarlos solo en la cuenta los esconde. El contador de monedas sigue siempre visible (BR-010).
- **Dónde quedó aplicada:** T-20 (`SessionBar`). Se verifica en su revisión: accesibilidad del menú (roles, foco, teclado) y pixel art.

## D-019 · 2026-09-17 · T-21 — Cómo se eligen competiciones, equipos y jugadores en el panel

- **Pregunta:** la revisión de la T-21 encontró dos defectos en los mismos controles:
  - las listas desplegables cargan una sola página de 100 opciones, así que con más de 100 jugadores o equipos algunos no se pueden elegir (`tester_liga_2`);
  - a 320 y 390 px, los `select` con nombres largos se cortan y no se lee la opción elegida, contra D-014 (`tester_liga`).
- **Opciones:**
  1. Un selector con búsqueda (combobox accesible, pixel art) que pide las opciones a la API ya filtradas (texto buscado, competición o equipo) y paginadas, y que muestra la opción elegida completa, en varias líneas si hace falta. En los filtros con pocas opciones (por ejemplo, las acciones de auditoría) se usa un grupo de opciones visibles como en D-017.
  2. Mantener los `select` nativos, recorrer todas las páginas y acortar el texto visible.
- **Decisión:** opción 1.
- **Motivo:**
  - resuelve los dos defectos: sin tope, porque la búsqueda llega a cualquier registro, y sin cortes, porque la elección se muestra entera;
  - escala con el crecimiento real del catálogo, cosa que no logra recorrer todas las páginas;
  - un `select` nativo no puede partir el texto y rompe el estilo pixel art, igual que en D-017.
- **Dónde quedó aplicada:** corrección de la T-21 (formularios y filtros del panel). Si la API no permite filtrar por texto en algún recurso, se agrega ese filtro en el backend con sus pruebas.

## D-020 · 2026-09-17 · T-21 — Quién manda en la base de desarrollo

- **Pregunta:** el ejecutor limpió la base de desarrollo al cerrar una corrección, como pide la regla, y borró datos de ejemplo que un tester acababa de cargar para su revisión en el navegador. Hoy ningún pane sabe si otro está usando la base.
- **Opciones:**
  1. Turnos: la base de desarrollo es de quien está trabajando en ese momento. Mientras el ejecutor implementa o corrige, es suya y la deja vacía al reportar; desde que reporta hasta que la tarea se cierra, es del tester que revisa en el navegador, y el ejecutor no la toca ni la limpia.
  2. Una base de desarrollo por pane.
  3. Que el coordinador avise cada vez.
- **Decisión:** opción 1, con el aviso del coordinador como respaldo.
- **Motivo:** el turno se deduce del propio flujo, sin inventar infraestructura ni depender de un aviso que puede llegar tarde. Cada agente ya sabe si está implementando o revisando. Una base por pane (opción 2) obligaría a más configuración y a que el front apunte a distintos backends; los testers ya tienen sus propias bases para pruebas automáticas.
- **Dónde quedó aplicada:** `CLAUDE.md` (regla de convivencia) y aviso a los tres panes. El ejecutor limpia solo lo suyo antes de reportar y nunca después; el tester que revisa carga y limpia sus datos de ejemplo.

## D-021 · 2026-09-17 · T-22 — Qué competición muestra la landing

- **Pregunta:** la landing pública muestra fixture y tabla de posiciones, pero la API los pide por competición, y hoy los datos son de muestra. `tester_liga` lo dejó anotado en la T-08.
- **Opciones:**
  1. Un selector de deporte y competición (BR-048), con una elección por defecto: la competición con el partido programado más próximo y, si no hay ninguno, la más reciente con partidos. La elección queda en la URL para poder compartir el enlace.
  2. Fijar una competición en la configuración del sitio.
  3. Mostrar todas las competiciones juntas.
- **Decisión:** opción 1.
- **Motivo:** BR-048 pide poder filtrar por deporte, y la polla admite varios deportes a la vez (fútbol, vóley, básquet). Una competición fija en configuración obliga a tocar el despliegue en cada torneo, y mezclar todas las competiciones haría ilegible la tabla de posiciones, que solo tiene sentido por competición.
- **Dónde quedó aplicada:** T-22 (landing, `/posiciones` y `src/lib/`).

## D-022 · 2026-09-17 · T-22 — Las estadísticas del radar de jugador siguen siendo de muestra

- **Pregunta:** al conectar la landing a la API, los jugadores pasan a ser reales. Sus atributos del radar (tiro, pase, fuerza, defensa, velocidad, regate) son números al azar generados en el front, y ninguna regla de negocio los define ni el esquema los guarda.
- **Opciones:**
  1. Mantenerlos como datos de muestra, ahora generados a partir del id real del jugador (estables entre recargas), con un aviso visible de que son de muestra.
  2. Quitar el radar hasta que existan atributos reales.
  3. Agregarlos al esquema y al panel para cargarlos a mano.
- **Decisión:** opción 1.
- **Motivo:** el radar es parte de la identidad visual del proyecto y ninguna BR pide atributos reales, así que inventar tablas y pantallas para cargarlos excede el alcance del plan. Mantenerlos como muestra, con el aviso, evita que alguien los tome por datos oficiales. Si más adelante se definen atributos reales, se reemplaza la fuente sin tocar la pantalla, como con el resto de los datos.
- **Dónde quedó aplicada:** T-22 (`src/data/player-stats.ts`, `CLAUDE.md` y la ficha del jugador).

## D-024 · 2026-09-18 · C-01 — Qué pasa al iniciar sesión con una contraseña más larga que el nuevo máximo

- **Pregunta:** el usuario pidió que la contraseña sea de 6 a 20 caracteres, sin exigir nada más (hoy son 10 a 128). Las cuentas creadas antes pueden tener contraseñas de más de 20, y sus hashes siguen siendo válidos.
- **Opciones:**
  1. El límite de 6 a 20 se aplica al **crear o cambiar** una contraseña (registro y `admin:create`). Al **iniciar sesión** no se rechaza por longitud: se verifica el hash como siempre, con un tope técnico alto (por ejemplo 128) solo para no procesar entradas enormes.
  2. Aplicar 6 a 20 también al iniciar sesión.
- **Decisión:** opción 1.
- **Motivo:** la opción 2 dejaría fuera de su cuenta a quien ya tenga una contraseña más larga, sin forma de entrar ni de cambiarla. El límite es una regla de alta, no de verificación. Además, rechazar por longitud en el login daría una pista sobre la contraseña guardada, y BR-004 pide que un intento fallido responda siempre lo mismo.
- **Dónde quedó aplicada:** C-01 (BR-003, BR-004, esquema de registro, `admin:create` y el front).

## D-025 · 2026-09-18 · C-02 — Qué pasa con el botón "Crear cuenta" y el verde suelto del navbar

- **Pregunta:** el usuario pidió que todo lo que no sea sección de la landing vaya en dorado. "Crear cuenta" era el único botón verde relleno del navbar (la acción principal), y el contador de monedas usaba verde al pasar el mouse. Si solo se cambian los enlaces, quedan uno o dos verdes sueltos entre dorados.
- **Opciones:**
  1. "Crear cuenta" pasa a dorado relleno, con texto oscuro, y el contador usa dorado pálido al pasar el mouse: toda la zona de la polla y la cuenta queda en la misma familia de color, y la acción principal se sigue distinguiendo por ser el único botón relleno.
  2. Dejar "Crear cuenta" en verde: se mantiene el contraste de la acción principal, pero queda un verde suelto en una barra dorada.
  3. Dejar en verde tanto ese botón como el contador.
- **Decisión:** opción 1.
- **Motivo:** el pedido era distinguir de un vistazo las secciones informativas de lo que pertenece a la polla y a la cuenta. Dejar verdes sueltos ahí debilita esa lectura. La jerarquía de "Crear cuenta" no depende del color: sigue siendo el único relleno, con contraste medido de 13.44, y el anillo de foco sigue siendo verde, así que no se pierde visibilidad.
- **Dónde quedó aplicada:** C-02 (`SessionBar`). Se verifica en su revisión.

## D-023 · 2026-09-17 · T-22 — La tabla de posiciones no muestra todas las columnas de BR-050

- **Pregunta:** `tester_liga` encontró que la tabla de posiciones muestra solo puesto, equipo y puntos. BR-050 y la API incluyen además jugados, ganados, empatados, perdidos, goles a favor, goles en contra y diferencia. Viene de la versión estática anterior, así que no lo introdujo la T-22.
- **Opciones:**
  1. Corregirlo dentro de la T-22, con las columnas completas y una presentación legible a 320 px (por ejemplo, columnas clave en móvil y el detalle al desplegar o en una tabla con desplazamiento horizontal propio).
  2. Anotarlo en `docs/pendientes.md` y dejarlo para después del proyecto.
- **Decisión:** opción 1.
- **Motivo:** es un requisito explícito de una regla de negocio (BR-050), no una mejora estética, y la API ya devuelve los datos. La T-22 es justamente la tarea que conecta la tabla con datos reales, así que es su lugar natural; dejarlo pendiente cerraría el proyecto con una regla sin cumplir.
- **Dónde quedó aplicada:** corrección de la T-22 (`/posiciones`).

## D-026 · 2026-09-18 · Carga D-01 — Cómo se cargan los equipos reales del usuario

- **Pregunta:** el usuario entregó los 15 equipos reales de sus tres competiciones (13 fútbol masculino, 14 fútbol femenino, 15 voleibol) y pidió insertarlos en la tabla `equipo`, con `nombre` igual a `nombre_corto` y `escudo` y `color_acento` vacíos. El proyecto dice que las filas reales de la liga las carga un administrador por el panel (T-21), nunca a mano, y que toda escritura de administrador queda auditada.
- **Opciones:**
  1. Cargarlos por el panel o por la API de administrador, para que quede el registro de auditoría de cada creación.
  2. Cargarlos con SQL directo contra la base de desarrollo, en una transacción, aceptando que esa carga no deje auditoría.
  3. Pedirle al usuario la contraseña de su cuenta de administrador para poder usar la API.
- **Decisión:** opción 2.
- **Motivo:** la opción 1 necesita una sesión de administrador y ninguno de los agentes tiene la contraseña de `admin@admin.com`; la 3 le pide al usuario una credencial que no debe circular por el chat ni por los paneles. La 2 es la única viable hoy y el riesgo es acotado: son datos de catálogo, sin partidos ni apuestas colgando, en la base de desarrollo. La ausencia de auditoría queda registrada aquí a propósito, para que al revisar el registro no parezca un hueco.
- **Nota sobre los campos vacíos:** `escudo` y `color_acento` son `NOT NULL`, así que "vacío" es cadena vacía, no `NULL`. El front lo tolera: `imageSrc` en `src/lib/league.ts` devuelve `null` para una cadena vacía y `Crest` muestra las iniciales del equipo en lugar del escudo. La API de administrador, en cambio, no acepta cadena vacía en esos campos, así que editar uno de estos equipos por el panel obligará a darles un valor válido.
- **Dónde quedó aplicada:** carga D-01, tabla `equipo` de la base de desarrollo. No toca el repositorio.

## D-027 · 2026-09-18 · Carga D-02 — Una persona que juega en dos competiciones, ¿es un jugador o dos?

- **Pregunta:** el usuario entregó las plantillas de las tres competiciones y muchas personas aparecen en dos de ellas, escritas de forma distinta: con el orden invertido (`Kevin Luis Saravia Huárez` en fútbol y `SARAVIA HUÁREZ KEVIN LUIS` en vóley), en mayúsculas, con o sin tilde, con un nombre de pila ampliado (`Miguel Sanchez Fernandez` / `SANCHEZ FERNANDEZ MIGUEL ANGEL`) o con un apellido de casada añadido (`HERRERA LOPEZ MARSHELLI` / `HERRERA LOPEZ DE ALFARO MARSHELLI`). ¿Se crea una fila de `jugador` por lista, o una sola por persona inscrita en las dos competiciones?
- **Opciones:**
  1. Una fila de `jugador` por persona, con una fila de `plantel` por competición.
  2. Una fila de `jugador` por cada vez que aparece un nombre, sin unir nada: cero riesgo de unir a dos personas distintas, pero la misma persona queda duplicada.
  3. Unir solo dentro de una misma competición y duplicar entre competiciones.
- **Decisión:** opción 1, uniendo únicamente cuando la coincidencia no admite duda: mismos apellidos y mismos nombres de pila, tolerando el orden invertido, las tildes, las mayúsculas, un nombre de pila que se extiende y un apellido de casada añadido. Ante cualquier duda real, se dejan separadas.
- **Motivo:** es exactamente para lo que el esquema separa `jugador` (la persona) de `plantel` (su inscripción), con `UNIQUE(jugador_id, competicion_id)` que dice "un equipo por competición" y admite que la misma persona juegue en varias. Duplicar la persona partiría en dos sus goles y su ficha, y obligaría a editar el mismo nombre en dos sitios. Las 30 coincidencias encontradas son de apellidos y nombres idénticos, no parecidos, así que el riesgo de unir a dos personas distintas es mínimo.
- **Nombre que se guarda:** el de la **primera aparición** siguiendo el orden en que el usuario entregó las listas (competición 13, luego 14, luego 15, y dentro de cada una el orden de los equipos), tal cual lo escribió. No se normaliza el orden ni las mayúsculas: inventar un formato propio deformaría datos reales. Por eso una persona puede figurar en la plantilla de vóley con la grafía que el usuario usó en fútbol.
- **Dónde quedó aplicada:** carga D-02, tablas `jugador` y `plantel` de la base de desarrollo. Las 102 personas y sus 134 inscripciones se fijaron en `jugadores.tsv` y `plantel.tsv`, preparados por el coordinador para que el ejecutor no tuviera que adivinar ninguna identidad.

## D-028 · 2026-09-18 · Carga D-02 — Una jugadora figura en dos equipos de la misma competición

- **Pregunta:** `VASQUEZ RODRIGUEZ PATRICIA MARIBEL` aparece en las listas de **LAS GALACTICAS DEL MASTER** y de **NEXUS PRIME**, los dos de la competición 14 (fútbol femenino). El esquema lo prohíbe: `UNIQUE(jugador_id, competicion_id)` significa un equipo por competición, sin traspasos durante el torneo.
- **Opciones:**
  1. Inscribirla en el primer equipo en que la nombró el usuario (LAS GALACTICAS DEL MASTER) y no inscribirla en el segundo, avisando para que él lo corrija si el equipo correcto es el otro.
  2. Crear dos filas de `jugador` con el mismo nombre para que las dos inscripciones existan.
  3. No inscribirla en ninguno de los dos y dejarla fuera hasta que el usuario decida.
- **Decisión:** opción 1.
- **Motivo:** la opción 2 esquiva a propósito la restricción que existe justamente para impedir esto, y dejaría a dos personas con el mismo nombre en la misma competición, que es lo que más confunde después al cargar goles. La 3 la borra de un torneo en el que sí juega. La 1 conserva una inscripción real, es reversible con un `UPDATE` de una línea y no inventa una persona. Se eligió el primer equipo listado por ser el único criterio no arbitrario disponible.
- **Aviso al usuario:** quedó señalado en el informe de la carga, no enterrado en el registro, porque es el único dato de las plantillas que no se pudo cargar tal como lo entregó.
- **Dónde quedó aplicada:** carga D-02, `plantel` de la competición 14. NEXUS PRIME quedó con 8 inscripciones en vez de 9.

## D-029 · 2026-09-18 · C-03 — Hasta qué ancho vale el escape que evita el desborde de la cabecera

- **Pregunta:** el arreglo de C-03 (la cabecera de la ficha de plantilla puede pasar a dos líneas y el nombre puede partirse) está acotado a menos de 24rem, o sea 384 px. El ejecutor avisó que, con ese tope, un nombre futuro de **una sola palabra de más de 14 caracteres** volvería a desbordar entre 384 px y unos 430 px. Quitar el tope lo haría a prueba de cualquier nombre, pero cambia la cabecera a 768 px en 7 de los 15 equipos (el párrafo de la competición baja de renglón), que es justo lo que el encargo pedía no tocar.
- **Opciones:**
  1. Subir el tope hasta que cubra todo el rango donde un nombre largo puede desbordar, dejándolo igualmente muy por debajo de 768 px. El escape deja de tener un agujero y los anchos grandes no se enteran.
  2. Dejar el tope en 24rem: con los 15 nombres actuales no falla, y el agujero solo aparecería si alguien carga un equipo con un nombre más largo.
  3. Quitar el tope: robusto ante cualquier nombre, pero cambia el dibujo a 768 px en 7 equipos.
- **Decisión:** opción 1.
- **Motivo:** las opciones 2 y 3 se planteaban como si hubiera que elegir entre robustez y no tocar los anchos grandes, y no es cierto: el rango problemático termina cerca de 430 px, muy lejos de los 768 px donde estaba la objeción. Subir el tope a un ancho intermedio compra las dos cosas. Además los equipos los carga un administrador por el panel (T-21), así que mañana puede aparecer un nombre más largo que los quince de hoy; dejar un agujero conocido en el diseño para que lo encuentre un usuario real no se justifica cuando cerrarlo no cuesta nada.
- **Cómo se comprueba que no costó nada:** las medidas a 768 y 1280 px deben seguir siendo idénticas, equipo por equipo, a la línea base que el ejecutor tomó antes de editar.
- **Dónde quedó aplicada:** corrección de C-03, `src/pages/Plantilla.module.css` y su prueba.

## D-030 · 2026-09-18 · C-03 — Corrige a D-029: el agujero no era una banda, seguía hacia arriba

- **Qué se había supuesto mal:** D-029 decidió subir el tope del escape con el argumento de que "el rango problemático termina cerca de 430 px". Esa premisa era **falsa**, y quien lo demostró midiendo fue `tester_liga` al revisar C-03. Por encima del tope el CSS repone `overflow-wrap: normal` y `min-width: auto`, así que una palabra larga **no puede partirse en ningún ancho grande**: con 25 letras ya se come el margen a 576 y a 768 px, con 28 la página desborda 9 px a 576 y 25 px a 768, y con 33 desborda 49, 37 y 85 px a 576, 600 y 768. Subir el tope movía el agujero, no lo cerraba.
- **Pregunta:** entonces, ¿se cierra del todo o se acepta el agujero?
- **Opciones:**
  1. Dejar `min-width: 0` y `overflow-wrap: break-word` **sin acotar**, y mantener acotados solo el salto de fila (`flex-wrap`) y el renglón propio del párrafo, que son los que sí cambian el dibujo. La palabra puede partirse en cualquier ancho y el agujero desaparece.
  2. Dejarlo como está y aceptar el agujero, anotándolo en `docs/pendientes.md`.
- **Decisión:** opción 1.
- **Motivo:** el tester midió lo que cuesta y es casi nada: de los equipos cargados, **12 de 13 dan medidas idénticas a 768 y 1280 px**, y el único que cambia es FINZULIANAS, 5 px de ancho de título, con la misma caja y la misma fila. Cerrar un desborde real de hasta 85 px por 5 px de ancho de título en un equipo es un cambio obviamente bueno. Lo que justificaba acotar el escape era no mover el diseño a los anchos grandes, y `min-width` y `overflow-wrap` no lo mueven: lo mueve el `flex-wrap`, que sigue acotado.
- **Lección que conviene retener:** D-029 razonó sobre un rango que nunca se midió. El número "430 px" salió de un informe, no de una medición, y la revisión lo desmintió. Cuando una decisión se apoye en un límite numérico, el límite se mide antes de decidir.
- **Dónde quedó aplicada:** segunda corrección de C-03, `src/pages/Plantilla.module.css` y su prueba.

## D-031 · 2026-09-18 · C-03 — Qué se sacrifica: un nombre imaginario o dos nombres reales

- **Qué apareció:** al implementar D-030 el ejecutor encontró dos cosas. Primera, que `overflow-wrap: break-word` **no cierra** el agujero (parte la palabra dentro de la caja pero no baja el `min-content`, así que la cabecera sigue creciendo hasta la palabra entera y empuja la página); hace falta `overflow-wrap: anywhere`. Segunda, y más importante, que el costo real de dejarlo sin acotar **no** son los 5 px de ancho que midió el tester: es que el título **se parte a mitad de palabra**. Con el archivo real, a 576 px se parten FINZULIANAS y FINANFORCE, y a 768 px FINZULIANAS sale como "FINZULIANA" más una "S" sola en el renglón siguiente. El tester midió anchos y filas, no renglones de texto, y por eso lo leyó como "misma caja, misma fila": la fila flex es la misma, pero el texto pasa de uno a dos renglones.
- **Pregunta:** ¿qué se sacrifica?
- **Opciones:**
  1. Dejar `anywhere` sin acotar: el agujero queda cerrado para cualquier largo, pero dos equipos reales se parten a mitad de palabra en las bandas 576–690 y 768–775.
  2. Dar al párrafo de competición su propio renglón también arriba del tope: no hay cortes, pero cambia el dibujo a 768 y 1280 px en la mayoría de los equipos.
  3. Acotar `anywhere` a los anchos donde hace falta para que la página no desborde, y aceptar como límite conocido que un nombre de **una sola palabra de 25 letras o más** desborde en anchos grandes.
- **Decisión:** el orden de prioridades es: (1) que la página nunca desborde en un ancho real, (2) que ningún nombre **realmente cargado** se parta a mitad de palabra, (3) que el diseño no cambie en los anchos grandes, y (4) robustez ante un nombre de una sola palabra de 25+ letras. Si algo tiene que ceder, cede el 4. Primero se busca una salida que no obligue a elegir; si no existe, se aplica la opción 3.
- **Motivo:** la opción 1 cambia un problema **hipotético** por uno **real y presente**: hoy, con los datos del usuario, FINZULIANAS se ve partida a 768 px, que es un ancho de tableta corriente. Un nombre de equipo de una sola palabra de 25 letras no existe en ningún deporte. Cambiar algo que se ve mal hoy por algo que no va a pasar nunca es un mal negocio, y D-029 y D-030 ya se equivocaron dos veces por razonar sobre casos imaginarios en vez de sobre los datos que hay.
- **Nota para quien audite esta serie:** D-029, D-030 y D-031 son tres decisiones sobre el mismo punto, y las dos primeras estaban equivocadas. Se dejan las tres, con su error a la vista, en vez de reescribirlas: el valor del registro está en poder ver cómo se corrigió, no en que parezca que se acertó a la primera.
- **Dónde quedó aplicada:** tercera corrección de C-03.
