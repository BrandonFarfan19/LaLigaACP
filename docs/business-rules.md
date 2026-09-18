# Business Rules

## 1. Objetivo del sistema

El sistema permitirá gestionar una polla deportiva en la que usuarios registrados y validados podrán utilizar monedas virtuales para realizar apuestas sobre diferentes eventos deportivos.

El sistema tendrá además una sección pública informativa donde cualquier visitante podrá consultar información relacionada con deportes, partidos, fixtures y tablas de posiciones.

El sistema deberá ser diseñado bajo un enfoque mobile first.

---

# 2. Roles del sistema

El sistema contará con dos roles:

* Administrador.
* Usuario.

## BR-001 – Rol Administrador

El administrador tendrá acceso a las funcionalidades administrativas del sistema.

Podrá:

* Administrar usuarios: validar participantes, confirmar su pago y consultarlos. El administrador no puede cambiar roles desde el sistema.
* Validar usuarios inscritos en la polla.
* Consultar el número de usuarios inscritos.
* Consultar el número de usuarios validados.
* Administrar deportes.
* Administrar equipos.
* Administrar partidos.
* Modificar información de partidos que todavía no tengan resultado confirmado.
* Administrar fechas y horarios.
* Registrar resultados.
* Registrar goles.
* Registrar los jugadores que realizaron los goles.
* Adjuntar imágenes relacionadas con el partido.
* Adjuntar o registrar videos relacionados con el partido.
* Consultar apuestas realizadas.
* Filtrar partidos por deporte.
* Filtrar partidos por fecha.
* Consultar resultados y estadísticas de la polla.

Precisión (T-13): las imágenes se suben como archivos (el sistema las revisa y las guarda en un formato propio, sin datos ocultos como la ubicación GPS) y los videos se registran como enlaces a YouTube o Vimeo; el sistema nunca descarga videos.

Los roles no se cambian desde la aplicación: ni el panel de administración ni la API ofrecen esa acción. Un administrador solo se crea, o una cuenta existente se promueve, con un comando que se ejecuta en el servidor. Solo se promueve una cuenta que nunca participó en la polla: pendiente, sin pago confirmado, sin monedas, sin movimientos y sin tickets. Crear o promover un administrador queda en el registro de auditoría (NFR-006, D-005).

Precisiones (T-21, panel de administración):

* "Consultar apuestas realizadas" muestra las apuestas de los participantes, una fila por selección, con su ticket, su partido, su estado y sus puntos, y quién la hizo (solo su nombre y su identificador). Es solo consulta: el administrador no crea, cambia ni anula apuestas desde ahí. Se filtra por participante, partido, ticket, estado de la apuesta y del ticket, deporte y fechas.
* Confirmar un pago, revertirlo y validar a un participante piden un paso de confirmación explícito, igual que confirmar un resultado, cancelar un partido o borrar un registro.
* Las fechas y horas del panel son de Lima: se muestran y se cargan en esa hora.

**El administrador no participa en la polla.** No es participante, no se le confirma pago, no se valida, no recibe monedas y no puede apostar, sin importar el estado que figure en su cuenta. Así quien carga los resultados nunca tiene apuestas en juego. Tampoco figura en la tabla de participantes, en los conteos, en el ranking ni en las estadísticas de la polla.

---

## BR-002 – Rol Usuario

El usuario es el único rol que participa en la polla. Los roles no se incluyen entre sí: un administrador no tiene los permisos de apuesta del usuario (ver BR-001).

El usuario podrá:

* Iniciar sesión.
* Consultar los partidos disponibles.
* Filtrar partidos.
* Realizar apuestas cuando se encuentre validado.
* Apostar en uno o varios partidos dentro de un mismo ticket.
* Realizar más de una apuesta sobre un mismo partido.
* Consultar sus apuestas realizadas.
* Consultar el detalle de cada apuesta.
* Consultar su saldo de monedas.
* Consultar el ranking de participantes.
* Consultar los resultados de partidos.
* Consultar los puntos obtenidos.

---

# 3. Registro, autenticación y validación

## BR-003 – Registro

El sistema deberá permitir que una persona cree una cuenta.

Cada cuenta deberá contener como mínimo:

* Correo electrónico (único).
* Nombre a mostrar.
* Contraseña.
* Identificador único.
* Estado de validación.
* Rol.

El correo electrónico es el dato con el que se entra; no hay un nombre de usuario aparte. El nombre a mostrar puede repetirse.

**Contraseña (C-01):** de **6 a 20 caracteres**, y nada más. No se exigen mayúsculas, minúsculas, números ni símbolos, ni se rechaza ninguna contraseña por ser "débil" o repetida: cualquier combinación de esa longitud se acepta. Los espacios, las letras con tilde y los emoji se pueden usar y cuentan como caracteres; algunos emoji compuestos —una familia, una bandera— están hechos de varios caracteres y cuentan más de uno, igual que una letra escrita con una tilde aparte. La misma regla vale para la contraseña que se elige al crear un administrador desde el servidor.

Precisión (D-011, corrección de T-18): el nombre a mostrar se ve en el ranking, así que sigue las mismas reglas que los nombres de deportes, equipos y jugadores: de 1 a 100 caracteres, con al menos una letra o un número, en una sola línea y sin caracteres de control ni invisibles. Un nombre formado solo por emojis o signos se rechaza.

Toda cuenta creada por registro nace con rol Usuario, estado `PENDIENTE`, pago pendiente y 0 monedas. Nadie puede registrarse como Administrador: un administrador solo se crea o promueve desde el servidor, y no participa en la polla (BR-001).

---

## BR-004 – Autenticación

El acceso a las funcionalidades privadas requerirá autenticación mediante:

* Correo electrónico.
* Contraseña.

Las contraseñas nunca deberán almacenarse en texto plano.

Ante credenciales incorrectas, el sistema responderá siempre lo mismo, sin revelar si el correo está registrado.

Precisión (D-024, C-01): **al iniciar sesión no se aplica el límite de 6 a 20 caracteres.** Ese límite es de alta: vale cuando se elige una contraseña (registro y creación de administrador), no cuando se usa. Así, una cuenta creada antes del cambio, con una contraseña más larga, sigue entrando. Un intento con una contraseña incorrecta —sea del largo que sea— recibe siempre la misma respuesta y tarda aproximadamente lo mismo.

---

## BR-005 – Estados del usuario

Los estados mínimos serán:

* Pendiente.
* Validado.

Un usuario en estado `PENDIENTE` podrá iniciar sesión y acceder al sistema, pero no podrá realizar apuestas.

Precisión (T-19): el usuario pendiente ve la pantalla de apuestas con los partidos y sus estados, igual que un validado, pero sin poder armar ni confirmar un ticket; la pantalla le explica por qué.

Solo un usuario con estado `VALIDADO` podrá apostar.

---

## BR-006 – Validación para participar

La validación será realizada manualmente por un administrador.

La validación representa la confirmación de que el usuario cumplió con las condiciones requeridas para participar, incluyendo la confirmación del pago correspondiente.

Cuando el administrador valide al usuario:

1. Su estado cambiará a `VALIDADO`.
2. El sistema le asignará 10 monedas.
3. El usuario quedará habilitado para realizar apuestas.

Precisiones (T-04):

* El administrador primero confirma el pago y después valida. Validar a un usuario sin pago confirmado no está permitido.
* La validación no se revierte. Un pago confirmado por error puede volver a pendiente solo mientras el usuario siga pendiente; nunca después de validarlo.
* Confirmar un pago ya confirmado, o validar a un usuario ya validado, se rechaza sin efectos.
* Solo se confirma el pago y se valida a usuarios (participantes). Sobre una cuenta de administrador estas acciones se rechazan: los administradores no participan (BR-001).

---

## BR-007 – Administración de inscritos

El administrador deberá contar con una tabla de participantes.

La tabla deberá mostrar como mínimo:

* Usuario.
* Fecha de inscripción.
* Estado de pago.
* Estado de validación.
* Saldo de monedas.
* Puntos acumulados.

El administrador deberá poder validar al usuario desde esta interfaz.

La tabla muestra solo usuarios (participantes); los administradores no figuran. Se puede filtrar por estado de pago y estado de validación, buscar por nombre o correo, y se ordena por fecha de inscripción. Los conteos de inscritos y validados cuentan solo participantes.

---

# 4. Monedas virtuales

## BR-008 – Asignación inicial

Cada participante recibirá:

`10 monedas`

Las monedas serán asignadas automáticamente cuando el administrador valide al usuario.

La asignación inicial deberá realizarse una sola vez.

---

## BR-009 – Saldo

El sistema deberá mantener actualizado el saldo de cada usuario.

El saldo nunca podrá ser negativo.

Precisiones (T-05):

* Todo cambio de saldo queda registrado como un movimiento (tabla 28), y el saldo es siempre la suma de los movimientos del usuario. El sistema puede comprobarlo y listar cualquier descuadre, sin corregirlo solo.
* Una operación que dejaría el saldo negativo se rechaza completa: no se descuenta una parte.
* El usuario puede consultar su saldo y el historial de sus movimientos, del más reciente al más antiguo. Los administradores no tienen saldo ni movimientos (BR-001).

---

## BR-010 – Visualización del saldo

El saldo deberá mostrarse permanentemente al usuario autenticado dentro del navbar.

Ejemplo:

`[moneda pixel art] 10`

El icono deberá respetar el estilo pixel art definido para el sistema.

Precisiones (T-18):

* Lo ve todo usuario autenticado con rol Usuario, también el pendiente, que ve 0 y una marca de "pendiente" que lleva a su cuenta, donde se explica que no puede apostar hasta que un administrador confirme su pago y lo valide. El administrador no ve el contador: no tiene monedas (BR-001).
* El saldo mostrado es el que informa el sistema. Se vuelve a consultar siempre al entrar a una página que exige sesión y después de cada operación que mueva monedas; en las páginas públicas se usa el último dato leído mientras tenga menos de un minuto (D-009), y al volver a la pestaña se renueva si es más viejo.
* Si la sesión termina mientras se ve una página que la exige, esa página deja de mostrarse y se pide ingresar de nuevo.
* Ingresar vuelve a la página desde la que se pidió, solo si es una página del propio sitio; si no, lleva a "Mi cuenta" (o a la administración, para un administrador).

---

# 5. Partidos

## BR-011 – Administración de partidos

El administrador podrá crear y modificar partidos mientras no exista un resultado final confirmado.

Cada partido deberá contener como mínimo:

* Deporte.
* Competición o torneo.
* Equipo local.
* Equipo visitante.
* Fecha.
* Hora.
* Estado.
* Resultado.
* Goles del equipo local.
* Goles del equipo visitante.

Precisiones (T-07):

* **Alta:** la fecha y hora se indican con zona horaria y tienen que ser futuras. Los dos equipos tienen que ser distintos y de esa competición. Los goles no se cargan en el alta: se registran con el resultado (BR-028).
* **Edición:** un partido `FINALIZADO` o `CANCELADO` no se modifica. Mientras tanto:
  * La jornada y la sede se pueden cambiar siempre.
  * La competición, los equipos y la fecha solo se cambian con el partido `PROGRAMADO`.
  * Si el partido ya tiene apuestas, no cambian los equipos ni la competición, y la fecha solo puede postergarse (ver BR-014).
* **Borrado:** solo se borra un partido que no esté finalizado y que no tenga apuestas ni goles.

---

## BR-012 – Estados del partido

Los estados mínimos serán:

* Programado.
* En curso.
* Finalizado.
* Cancelado.

Solo los partidos en estado `PROGRAMADO` y dentro del periodo permitido podrán recibir apuestas.

Transiciones (decisión del usuario en T-13; reemplaza las de T-07):

* Todo partido se crea `PROGRAMADO`.
* Pasa a `EN_CURSO` **automáticamente** al llegar su fecha y hora programadas, sin intervención del administrador.
* Un partido dura **60 minutos**. Pasado ese tiempo sigue `EN_CURSO` hasta que el administrador confirma su resultado: no hay un estado aparte para "terminado sin resultado".
* El administrador no cambia estados a mano: no puede adelantar el inicio ni devolver un partido a `PROGRAMADO`.
* `FINALIZADO` solo se alcanza al confirmar el resultado (BR-031), y `CANCELADO` solo con la cancelación que anula y devuelve las apuestas (BR-045 a BR-047).
* Un partido `FINALIZADO` o `CANCELADO` no cambia más de estado. La cancelación es definitiva (T-16): un partido cancelado no se reprograma, no se reactiva y no recibe resultado, goles, cambios ni multimedia nueva. Sí se puede **borrar** un partido cancelado que no tenga apuestas, goles, resultado ni multimedia (decisión D-001, T-17); con cualquiera de esos datos, el borrado se rechaza.
* Un partido que ya empezó no se puede postergar, cambiar de equipos ni borrar.
* Todas las pantallas, listados y filtros tratan como `EN_CURSO` a un partido cuya hora de inicio ya llegó.

---

## BR-013 – Orden de partidos

En todas las interfaces los partidos deberán ordenarse prioritariamente por proximidad de fecha.

El partido cuya fecha esté más próxima deberá aparecer primero.

Esta regla aplica a:

* Landing page.
* Fixture.
* Interfaz de apuestas.
* Administración de partidos.

Definición precisa (T-07), la misma en todas esas vistas:

1. Primero los partidos que todavía no empezaron según su fecha (`fecha_hora >= ahora`), del más cercano al más lejano.
2. Después los que ya pasaron su fecha (`fecha_hora < ahora`), del más reciente al más antiguo.
3. Con la misma fecha y hora, primero el que se creó antes.

"Ahora" es el momento de la consulta.

---

# 6. Cierre de apuestas

## BR-014 – Fecha límite

Las apuestas estarán disponibles únicamente hasta 24 horas antes del inicio programado del partido.

Regla:

`fecha_cierre = fecha_inicio_partido - 24 horas`

Una vez alcanzado el cierre:

* El partido seguirá visible.
* Podrá consultarse su información.
* No podrán registrarse nuevas apuestas sobre ese partido.

La validación deberá realizarse obligatoriamente en backend.

Precisión (T-08): un partido creado a menos de 24 horas de su inicio nace con las apuestas ya cerradas, porque su cierre ya pasó.

Precisión (T-13): entre el cierre y la hora de inicio el partido sigue programado, con las apuestas cerradas. Desde la hora de inicio está en curso (BR-012), y ya no puede postergarse.

Precisión (T-09): el momento exacto del cierre ya está cerrado. Se puede apostar mientras `ahora < fecha_cierre`, y solo si el partido está `PROGRAMADO` (BR-012). Un partido en curso, finalizado o cancelado no recibe apuestas aunque su cierre no haya pasado.

Precisión (T-07): si un partido con apuestas se reprograma, solo puede postergarse; adelantarlo se rechaza, porque correría el cierre por delante de apuestas ya hechas. Al postergarlo, el cierre se recalcula con la nueva fecha: las apuestas existentes siguen vigentes, y se puede volver a apostar hasta el nuevo cierre. Sin apuestas, la fecha puede moverse en cualquier sentido, siempre hacia el futuro.

---

# 7. Tipos de apuesta

## BR-015 – Resultado general

El usuario podrá apostar por:

* Gana equipo local.
* Empate.
* Gana equipo visitante.

El empate solo estará disponible en los deportes que admitan empate.

Cada deporte indicará si lo admite. En un deporte que siempre define un ganador, como vóley o básquet, la opción de empate no deberá ofrecerse ni aceptarse.

Precisión (T-09): en un deporte sin empate, un marcador exacto empatado (por ejemplo 1-1) tampoco se acepta, porque es el mismo pronóstico que el empate.

Precisión (T-06): si un deporte admite empate solo puede cambiarse mientras ninguna apuesta dependa de ello. El cambio se rechaza si alguno de sus partidos ya no está programado (en curso, finalizado o cancelado) o si sus partidos tienen alguna apuesta.

---

## BR-016 – Marcador exacto

El usuario podrá apostar por el marcador exacto.

Ejemplo:

`Equipo A 2 - 1 Equipo B`

Precisión (T-09): los goles de cada equipo son números enteros de 0 a 999. El máximo es alto para que sirva en deportes de muchos puntos, como el básquet.

---

## BR-017 – Múltiples apuestas por partido

Un usuario podrá realizar varias apuestas sobre un mismo partido.

Las apuestas podrán incluso representar resultados diferentes.

Ejemplo:

Para:

`Equipo A vs. Equipo B`

el usuario podrá apostar:

* Equipo A gana.
* Empate.
* Equipo B gana.

Estas serán consideradas tres apuestas independientes.

Precisión (T-09): también se puede repetir exactamente la misma apuesta (por ejemplo, dos veces "Equipo A gana" en el mismo ticket). Ninguna regla lo prohíbe, y cada repetición es otra selección que cuesta su moneda. La vista previa del ticket la marca como repetida para que el usuario lo confirme.

---

## BR-018 – Combinación de tipos de apuesta

El usuario también podrá realizar diferentes tipos de apuesta sobre el mismo partido.

Ejemplo:

* Equipo A gana.
* Marcador exacto 2-1.

Cada selección será registrada como una apuesta independiente.

---

# 8. Tickets

## BR-019 – Ticket múltiple

Un ticket podrá contener una o varias selecciones.

Las selecciones pueden corresponder:

* A diferentes partidos.
* Al mismo partido.
* A diferentes tipos de apuesta.

Ejemplo:

Ticket #001

1. Perú vs. Chile → Perú gana.
2. Argentina vs. Brasil → 2-1.
3. Perú vs. Chile → Empate.

Precisión (T-09): un ticket tiene como mínimo 1 selección y como máximo 50.

---

# 9. Costo de apuestas

## BR-020 – Costo por selección

Cada selección tendrá un costo de:

`1 moneda`

El costo no se determina por cantidad de partidos únicos, sino por cantidad total de apuestas realizadas.

Regla:

`costo_ticket = cantidad_selecciones × 1 moneda`

Ejemplo:

Un usuario realiza:

* Equipo A gana.
* Equipo A empata.
* Equipo A pierde.

Aunque corresponden al mismo partido:

`3 selecciones = 3 monedas`

---

## BR-021 – Validación de saldo

Antes de confirmar:

`saldo_usuario >= costo_ticket`

Si el saldo es insuficiente, el sistema deberá impedir la confirmación.

---

## BR-022 – Descuento de monedas

Las monedas solo deberán descontarse cuando el usuario confirme la apuesta.

Ejemplo:

Saldo inicial:

`10 monedas`

Selecciones:

`3`

Costo:

`3 monedas`

Saldo final:

`7 monedas`

---

# 10. Confirmación de apuesta

## BR-023 – Resumen previo

Antes de confirmar un ticket, el sistema deberá mostrar:

* Partidos seleccionados.
* Tipo de apuesta.
* Pronóstico.
* Costo de cada selección.
* Cantidad total de selecciones.
* Costo total.
* Saldo actual.
* Saldo posterior.

Precisión (T-09): el resumen indica, por cada selección, si es válida y por qué no (partido inexistente, apuestas cerradas, partido que ya no está programado o empate no permitido). Si alguna selección no es válida o el saldo no alcanza, el ticket no se puede confirmar. El resumen es una vista previa: no descuenta monedas ni guarda nada, y la confirmación (BR-024) vuelve a validar todo.

---

## BR-024 – Confirmación explícita

No deberán descontarse monedas hasta que el usuario confirme explícitamente la operación.

El usuario deberá tener como mínimo:

* Confirmar.
* Modificar.
* Cancelar.

Precisión (T-19): mientras se arma, el ticket se conserva en la pestaña del navegador aunque se recargue la página o se cambie de pantalla, y se borra al confirmar, al vaciarlo o al cerrar la sesión (D-012). No se guarda en el sistema ni mueve monedas. Al ingresar sin una página de origen, un usuario validado llega a la pantalla de apuestas (D-008).

Precisión (T-10): el resumen de BR-023 es la vista previa, que no guarda nada. Confirmar es la única operación que crea el ticket y descuenta monedas. Modificar y cancelar ocurren en la interfaz antes de confirmar: el ticket todavía no existe, así que no hay nada que cambiar ni deshacer en el sistema. Un ticket confirmado no se modifica ni se cancela; sus selecciones solo se anulan si se cancela el partido (BR-045).

---

## BR-025 – Ticket

Después de confirmar, el sistema deberá generar un ticket único.

El ticket deberá contener:

* Identificador.
* Usuario.
* Fecha y hora.
* Selecciones.
* Partidos.
* Pronósticos.
* Tipos de apuesta.
* Monedas utilizadas.
* Estado.
* Puntos obtenidos.

Precisiones (T-10):

* La fecha y la hora son las de la confirmación, en UTC.
* Monedas utilizadas: cantidad de selecciones × 1 moneda (BR-020). No cambia si después se devuelven monedas por una cancelación; el comprobante muestra aparte las monedas devueltas: las que realmente volvieron al usuario según sus movimientos (D-003, T-17), que pueden ser menos que las selecciones anuladas.
* Puntos obtenidos: la suma de los puntos de sus selecciones ya liquidadas (0 mientras no haya ninguna).
* Estado del ticket, calculado a partir de sus selecciones (BR-027), sin guardarse:
  * **Pendiente** mientras alguna selección esté pendiente.
  * **Anulado** si todas sus selecciones fueron anuladas.
  * **Finalizado** en los demás casos: ninguna pendiente y al menos una acertada o no acertada.
* Solo el dueño puede consultar su ticket. Para cualquier otra persona, incluido un administrador, el ticket no existe.
* Toda selección nace en estado pendiente y sin puntos.

---

# 11. Historial de apuestas

## BR-026 – Mis apuestas

El usuario deberá disponer de una sección donde pueda consultar sus apuestas.

Deberá mostrar como mínimo:

* Ticket.
* Fecha.
* Partido.
* Tipo de apuesta.
* Pronóstico.
* Resultado real.
* Monedas utilizadas.
* Estado.
* Puntos obtenidos.

Precisiones (T-11):

* Cada usuario ve solo sus propias apuestas. Un administrador no tiene apuestas (BR-001).
* Se muestra una fila por selección, con los datos de su ticket (número, fecha, estado, monedas y puntos del ticket).
* Orden: del ticket más reciente al más antiguo y, dentro de un ticket, en el orden en que se armó. No se usa el orden por proximidad de BR-013, porque es un registro de lo que el usuario apostó y cuándo, no una lista de partidos.
* La fecha es la de confirmación del ticket.
* Resultado real: el resultado general y el marcador del partido, solo si está finalizado y con los goles de ambos equipos cargados (la misma regla que BR-049). Mientras tanto no se muestra.
* Monedas utilizadas: 1 por selección (BR-020); las devueltas por cancelación se muestran aparte, y son las realmente devueltas según los movimientos (D-003).
* Filtros: estado de la selección, estado del ticket, ticket, partido, deporte, competición y rango de fechas.
* Resumen: cantidad de tickets y de selecciones por estado, monedas utilizadas y devueltas, puntos totales y aciertos (con la misma definición que el ranking, BR-042).

Precisiones (T-20):

* La pantalla agrupa las selecciones por ticket, con un enlace al comprobante. Si una página no alcanza a mostrar todas las selecciones de un ticket, lo dice.
* La pantalla ofrece estos filtros: estado de la selección, estado del ticket, deporte, competición y rango de fechas. El sistema admite además los filtros por ticket y por partido, que la pantalla no ofrece.
* El filtro por competición se usa junto con el de su deporte: al elegir un deporte aparecen sus competiciones. Un filtro que no es válido, o que nombra un deporte que ya no existe, se quita con un aviso. Un dato de la dirección que la pantalla no conoce se ignora sin aviso.
* Una página que no existe (más allá de la última) se avisa y se muestra la última, y la dirección pasa a decir esa página. Si falla la carga después de cambiar los filtros o la página, se sigue viendo la lista anterior y el aviso dice que no corresponde a lo elegido. Lo mismo vale si falla la comprobación de la sesión por un problema pasajero (sin conexión, el servidor caído o demasiadas solicitudes seguidas) en esta pantalla y en la del ranking: se conserva lo que se veía, con el aviso y "Reintentar". Si la sesión terminó, se pide ingresar de nuevo.
* Un usuario pendiente ve su historial vacío y el motivo. Un administrador no tiene esta sección.

---

## BR-027 – Estados de apuesta

Una selección podrá tener como mínimo los estados:

* Pendiente.
* Acertada.
* No acertada.
* Anulada.

---

# 12. Resultados

## BR-028 – Registro del resultado

El administrador será responsable de registrar el resultado oficial.

Deberá ingresar:

* Goles del equipo local.
* Goles del equipo visitante.

Ejemplo:

`Perú 2 - Chile 1`

Precisiones (T-12, actualizadas en T-13):

* Se cargan los goles de los dos equipos juntos: números enteros de 0 a 999.
* Se puede cargar y corregir desde la hora de inicio del partido (durante y después del juego) mientras el resultado no esté confirmado. Nunca antes de esa hora, ni con el partido finalizado o cancelado.
* El marcador no puede corregirse por debajo de la cantidad de goles de ese equipo que ya tienen autor registrado (BR-033): primero hay que borrar o corregir esos goles.
* Un partido registrado antes de jugarse puede recibir su resultado aunque su fecha haya pasado hace tiempo; no hay plazo máximo.
* Mientras no se confirme, el resultado cargado no es público: no se muestra en el fixture, no cuenta en la tabla de posiciones y no liquida apuestas.
* En un deporte sin empate se puede cargar momentáneamente un marcador igualado (por ejemplo, antes de un desempate), pero no se puede confirmar.

---

## BR-029 – Resultado derivado

El sistema determinará automáticamente el resultado general.

Si:

`goles_local > goles_visitante`

Resultado:

`LOCAL_GANA`

Si:

`goles_local = goles_visitante`

Resultado:

`EMPATE`

Si:

`goles_local < goles_visitante`

Resultado:

`VISITANTE_GANA`

Precisión (T-12): el resultado derivado se calcula siempre a partir de los goles y nunca se guarda. La misma regla se usa en la vista previa del administrador, en la información pública (solo con el resultado confirmado), en el comprobante y el historial de apuestas, y en el cálculo de puntos.

---

# 13. Confirmación definitiva del resultado

## BR-030 – Vista previa del resultado

Antes de guardar el resultado definitivo, el administrador deberá visualizar un resumen.

Deberá mostrar:

* Partido.
* Equipo local.
* Equipo visitante.
* Marcador.
* Ganador o empate.
* Información adicional registrada.

Precisión (T-12): la información adicional incluye la competición, el deporte, la jornada, la fecha, la sede y los goles con su autor que ya estén registrados. El resumen también indica cuántas apuestas pendientes se van a liquidar y si el resultado puede confirmarse. Si no puede, dice por qué: falta un marcador, el partido todavía no empezó o es un empate en un deporte sin empate.

---

## BR-031 – Confirmación del administrador

El administrador deberá confirmar explícitamente que el resultado registrado es correcto.

La interfaz deberá advertir que después de la confirmación el resultado no podrá modificarse.

Precisiones (T-12):

* La confirmación es una operación aparte y explícita: el administrador confirma el marcador que vio en el resumen. Si el marcador se corrigió mientras tanto, la confirmación se rechaza y hay que revisarlo de nuevo.
* Solo se confirma con los goles de ambos equipos cargados.
* Solo se confirma cuando el partido terminó: pasados los 60 minutos desde su hora de inicio (T-13). Antes, el resultado puede cargarse y corregirse, pero no confirmarse.
* No hace falta registrar el autor de todos los goles para confirmar; el resumen avisa cuántos goles no tienen autor.
* En un deporte que no admite empate no se puede confirmar un marcador igualado.
* Un resultado se confirma una sola vez; un segundo intento se rechaza sin efectos.

---

## BR-032 – Resultado inmutable

Después de que el administrador confirme el resultado:

* El resultado deberá quedar bloqueado.
* No podrá ser modificado desde la aplicación.
* Los goles no podrán modificarse.
* El ganador no podrá modificarse.
* El sistema procederá al cálculo de apuestas y puntos.

El backend deberá aplicar esta restricción.

Precisión (T-12): al confirmar, el partido pasa a finalizado y queda bloqueado. Desde entonces no se pueden cambiar sus goles, su estado, su fecha, sus equipos, su jornada ni su sede, y tampoco borrarlo. El cálculo de apuestas y puntos ocurre en la misma operación que la confirmación: si falla, la confirmación no se aplica.

Precisión (T-13): también quedan bloqueados los goles con su autor, equipo y minuto. Las imágenes y los videos (del partido y de cada gol) sí se pueden agregar o quitar después de confirmar, porque no cambian el resultado, el ganador ni los puntos.

---

# 14. Registro de goles

## BR-033 – Autores de goles

El administrador podrá registrar información sobre cada gol:

* Jugador.
* Equipo.
* Minuto.
* Imagen opcional.
* Video opcional.

Precisiones (T-13):

* El jugador tiene que estar inscrito en el plantel de ese equipo en esa competición, y el equipo tiene que jugar el partido. No se registran goles en contra.
* El minuto es un número entero de 1 a 120: el partido dura 60 minutos y queda margen para descuentos y tiempos extra.
* Los goles con autor se registran, corrigen y borran desde la hora de inicio del partido hasta que se confirma su resultado.
* Un equipo no puede tener más goles con autor que los que figuran en el marcador. Primero se carga el marcador (BR-028).
* Cada gol tiene como máximo una imagen y un video. Además, el partido puede tener hasta 20 imágenes y 10 videos propios.
* Las imágenes se suben como archivo, hasta 5 MB cada una. Se aceptan JPEG, PNG, WebP y GIF, nunca SVG. El sistema las revisa por su contenido, las achica si hace falta y les quita los datos ocultos (por ejemplo, la ubicación GPS).
* Los videos se registran como enlace `https` a YouTube o Vimeo. El mismo video no se repite en un partido.
* Las imágenes y los videos se agregan desde la hora de inicio del partido, también después de confirmar el resultado (BR-032). En un partido cancelado no se agregan.

---

# 15. Cálculo automático de apuestas

## BR-034 – Procesamiento

Después de confirmar el resultado final, el sistema deberá buscar todas las apuestas asociadas al partido.

Cada selección deberá evaluarse independientemente.

Precisiones (T-14):

* Se evalúan solo las selecciones pendientes del partido. Cada una pasa a acertada (con sus puntos) o no acertada (con 0 puntos).
* Las selecciones anuladas o ya evaluadas no cambian, y tampoco las selecciones del mismo ticket que son de otros partidos: se evalúan cuando se confirme el resultado de su partido.
* Se usa el marcador confirmado (BR-028) y el resultado derivado de BR-029. Los goles con autor (BR-033) no influyen.
* Las selecciones repetidas o contradictorias se evalúan una por una, igual que las demás.
* Un ticket queda finalizado cuando ya no le quedan selecciones pendientes (BR-025).

---

## BR-035 – Apuesta por ganador

Si el usuario apostó correctamente por el equipo ganador:

`+3 puntos`

---

## BR-036 – Apuesta por empate

Si el usuario apostó correctamente por empate:

`+1 punto`

---

## BR-037 – Marcador exacto

Si el usuario acertó exactamente:

* Goles del equipo local.
* Goles del equipo visitante.

Obtendrá:

`+3 puntos`

---

## BR-038 – Evaluación independiente

Cada apuesta se evaluará independientemente.

No se asignarán automáticamente puntos adicionales por otros tipos de apuesta.

Ejemplo:

Un usuario apuesta únicamente:

`Equipo A gana`

y el resultado es:

`Equipo A 2 - Equipo B 1`

Obtendrá:

`3 puntos`

No obtendrá puntos adicionales por marcador exacto porque no realizó dicha apuesta.

Si realizó dos selecciones diferentes:

* Equipo A gana.
* Marcador exacto 2-1.

y ambas son correctas, ambas apuestas podrán generar sus puntos respectivos.

---

# 16. Sistema de puntos

## BR-039 – Independencia entre monedas y puntos

Las monedas y los puntos representan conceptos diferentes:

`Monedas = capacidad para apostar`

`Puntos = rendimiento dentro de la polla`

Los puntos no incrementan automáticamente el saldo de monedas.

---

## BR-040 – Cálculo automático

Los puntos deberán calcularse automáticamente después de que el administrador confirme el resultado oficial.

Precisión (T-14): el cálculo ocurre en la misma operación que la confirmación (BR-032). Si falla, el resultado no queda confirmado y todas las apuestas siguen pendientes. Cada selección se evalúa una sola vez, aunque la operación se reintente.

---

# 17. Ranking

## BR-041 – Ranking

El ranking deberá ordenarse inicialmente por:

`puntos_totales DESC`

Precisiones (T-15):

* Participan del ranking solo los usuarios validados. Los administradores nunca figuran (BR-001), y un usuario pendiente tampoco, porque todavía no puede apostar (BR-005).
* Un usuario validado sin apuestas, o sin apuestas liquidadas, figura con 0 puntos y 0 aciertos: ya está en la polla.
* El ranking se calcula en cada consulta a partir de las selecciones liquidadas; nunca se guarda.
* Lo consulta cualquier usuario con sesión, incluidos los pendientes y los administradores, que lo ven sin fila propia. No hay versión pública sin sesión: el ranking relaciona el nombre de cada participante con sus resultados en la polla, y eso queda dentro de la polla.

---

## BR-042 – Top 10

El sistema deberá mostrar los diez participantes con mayor cantidad de puntos.

Como mínimo:

* Posición.
* Participante.
* Puntos.
* Cantidad de apuestas acertadas.

Precisiones (T-15):

* El top muestra a todos los participantes cuya posición va de 1 a 10. Si hay empate en el puesto 10 (o antes), entran todos los empatados, así que la lista puede tener más de diez filas.
* Como máximo se muestran 50 filas (corrección de T-15). Con la polla recién abierta todos empatan en 0 y estarían todos en el puesto 1; en ese caso se muestran las primeras 50, en el orden de presentación de BR-043, y se informa cuántos empatados del top quedaron sin mostrar. La fila propia se muestra aparte si no entró en la lista.
* De cada participante se muestra solo su nombre a mostrar, nunca su correo, su saldo ni su estado.
* Si el usuario que consulta es participante, también ve su propia fila (posición, puntos y aciertos), esté o no en el top.
* El administrador ve además el ranking completo, paginado, y las estadísticas de la polla: participantes inscritos y validados, tickets y selecciones por estado, monedas utilizadas, devueltas y disponibles, puntos y aciertos. Estas cifras cuentan solo usuarios, nunca administradores.

Precisiones (T-20):

* Los empatados muestran la misma posición, marcada como compartida.
* La fila propia se distingue con una marca escrita (no solo con color). Si no está en la lista, se muestra aparte, al final.
* El ranking se vuelve a calcular al entrar a la pantalla o al pedir que se actualice. La pantalla avisa si se actualizó o si falló; si falla, sigue mostrando el ranking anterior.

Precisión (T-11): una **apuesta acertada** es una selección en estado Acertada, de cualquier tipo. Cuenta igual un ganador (+3), un empate (+1) o un marcador exacto (+3). Las anuladas y las no acertadas no cuentan. Los **puntos totales** son la suma de los puntos de las selecciones liquidadas. El resumen de "Mis apuestas" usa estas mismas definiciones.

---

## BR-043 – Desempate

Cuando dos o más usuarios tengan la misma cantidad de puntos, tendrá mejor posición quien tenga mayor cantidad de apuestas acertadas.

Orden:

1. Mayor cantidad de puntos.
2. Mayor cantidad de apuestas acertadas.

Conceptualmente:

```text
ORDER BY
    puntos DESC,
    apuestas_acertadas DESC
```

Si ambos valores continúan siendo iguales, los usuarios podrán compartir la misma posición hasta que se defina una regla adicional.

Precisión (T-15): los empatados en puntos y aciertos comparten la posición, y el siguiente salta tantos puestos como empatados hubo (por ejemplo 1, 1, 3). Así la posición siempre dice cuántos participantes están por delante, más uno. Dentro de un empate, la lista los muestra por nombre, con el orden alfabético del español (la ñ es una letra aparte, después de la n; no se distinguen mayúsculas ni acentos) y, a igual nombre, por antigüedad de la cuenta; ese orden es solo de presentación y no cambia la posición.

---

## BR-044 – Actualización

El ranking deberá actualizarse automáticamente después del procesamiento de los resultados.

Precisión (T-15): como se calcula en cada consulta, refleja un resultado confirmado o una apuesta anulada desde la consulta siguiente, sin ningún proceso aparte.

---

# 18. Cancelación de partidos

## BR-045 – Partido cancelado

Cuando un partido sea declarado `CANCELADO`, todas las apuestas relacionadas deberán quedar anuladas.

Precisiones (T-16):

* Cancelar es una acción explícita del administrador. Antes, el sistema muestra un resumen sin efectos: cuántas apuestas se anulan, cuántas monedas se devuelven, a cuántos usuarios y cuántos tickets quedan anulados por completo. La confirmación advierte que es definitiva.
* Se puede cancelar un partido programado o en curso, aunque ya tenga marcador, goles o multimedia cargados. No se puede cancelar un partido finalizado ni uno ya cancelado.
* La cancelación es definitiva (BR-012). Un partido cancelado solo se puede borrar si no tiene apuestas, goles, resultado ni multimedia (D-001). El marcador, los goles y la multimedia que tuviera se conservan, pero nunca se muestran al público: un partido cancelado no tiene resultado oficial (BR-049).
* Se anulan las apuestas pendientes del partido. Una apuesta anulada no tiene puntos (no suma en el ranking ni cuenta como acertada).
* Un partido no finalizado no puede tener apuestas ya evaluadas. Si por datos cargados a mano hubiera alguna evaluada o ya anulada, no se modifica ni se devuelve.
* Si una apuesta pendiente es de una cuenta que hoy es administrador (solo posible con datos cargados a mano), se anula igual pero **no** se devuelve su moneda, porque un administrador no tiene monedas (BR-001). La cancelación nunca se bloquea por eso (D-002). El resumen previo y el resultado informan cuántas apuestas se anulan sin devolución y por qué: sin descuento o de una cuenta de administrador.
* El partido cancelado sigue visible en el fixture con su estado (BR-049).

---

## BR-046 – Devolución de monedas

El sistema deberá devolver automáticamente las monedas utilizadas en las apuestas correspondientes al partido cancelado.

Ejemplo:

El usuario realizó tres apuestas sobre el partido:

`3 monedas utilizadas`

Si el partido es cancelado:

`3 monedas devueltas`

Precisión (T-05): solo se devuelven monedas que se descontaron de verdad, una vez por selección. Devolver una selección que nunca se cobró, o devolverla dos veces, se rechaza sin efectos.

Precisión (T-16): al cancelar, cada apuesta anulada devuelve 1 moneda a su dueño. Una apuesta pendiente sin descuento registrado (solo posible con datos cargados a mano) se anula sin devolución, porque nunca costó nada, y lo mismo una de una cuenta que hoy es administrador (D-002). Cada devolución queda registrada con su apuesta.

Precisión (T-17, D-003): las "monedas devueltas" que muestran el comprobante, el historial de apuestas, su resumen y las estadísticas de la polla son las devoluciones registradas en los movimientos del usuario, no la cantidad de apuestas anuladas.

---

## BR-047 – Tickets con múltiples partidos

Si un ticket contiene apuestas de diferentes partidos y solo uno es cancelado, se devolverán únicamente las monedas correspondientes a las selecciones asociadas con el partido cancelado.

Las demás apuestas continuarán vigentes.

Precisión (T-16): el estado del ticket sigue la regla de BR-025. Si todas sus apuestas quedaron anuladas, el ticket queda anulado; si le quedan apuestas de otros partidos, sigue pendiente o finalizado según ellas. Las monedas utilizadas del ticket no cambian, y las devueltas se muestran aparte.

---

# 19. Landing page

La landing será principalmente informativa.

## BR-048 – Filtro por deporte

El usuario podrá filtrar contenido según el tipo de deporte.

Ejemplos:

* Fútbol.
* Básquet.
* Vóley.
* Otros configurados.

---

## BR-049 – Fixture

El usuario podrá consultar el fixture.

Los partidos deberán mostrarse ordenados desde el encuentro más próximo.

Precisiones (T-08):

* El fixture es público: no requiere sesión.
* Muestra también los partidos cancelados, indicando su estado; ocultarlos haría desaparecer un partido anunciado sin explicación.
* El marcador y los goles (autor, equipo, minuto, imagen y video) solo se muestran cuando el partido está finalizado. Antes de confirmar el resultado no son públicos, aunque el administrador ya haya empezado a cargarlos.
* Regla común con BR-050: el marcador de un partido se muestra, y el partido cuenta en la tabla de posiciones, solo si está finalizado y con los goles de ambos equipos cargados. Si solo está cargado un lado, no se muestran ni el marcador ni los goles del partido (autor, equipo, minuto, imagen y video).
* Precisión (T-13): las imágenes y los videos del partido siguen la misma regla que los goles: solo se muestran con el resultado confirmado y completo. Hasta entonces tampoco se puede abrir una imagen por su enlace.
* Precisión (T-13): un partido cuya hora de inicio ya llegó se muestra como en curso (BR-012).

---

## BR-050 – Tabla de posiciones

La landing deberá permitir consultar la tabla de posiciones de los equipos correspondientes a cada competición.

Definición (T-08):

* Se calcula en cada consulta; nunca se guarda.
* Regla común con BR-049: el marcador de un partido se muestra, y el partido cuenta en la tabla de posiciones, solo si está finalizado y con los goles de ambos equipos cargados.
* Solo cuentan los partidos finalizados de esa competición con el marcador de los dos equipos cargado: 3 puntos por victoria, 1 por empate y 0 por derrota.
* Columnas: partidos jugados, ganados, empatados y perdidos, goles a favor, goles en contra, diferencia de goles y puntos.
* Aparecen todos los equipos de la competición; los que no jugaron, con ceros.
* Orden, siempre el mismo:
  1. Más puntos.
  2. Mayor diferencia de goles.
  3. Más goles a favor.
  4. Nombre del equipo en orden alfabético, sin distinguir mayúsculas ni acentos.
  5. El equipo registrado antes.
* Las posiciones son consecutivas (1, 2, 3…); no hay posiciones compartidas.

---

# 20. Interfaz de apuestas

## BR-051 – Filtros

La interfaz de la polla deberá permitir filtrar partidos por:

* Tipo de deporte.
* Fecha del encuentro.

---

## BR-052 – Estado visual

La interfaz deberá diferenciar:

* Disponible para apostar.
* Apuestas cerradas.
* Partido en curso.
* Finalizado.
* Cancelado.

---

# 21. Integridad transaccional

## BR-053 – Transacción atómica

La creación del ticket y el descuento de monedas deberán formar parte de una única transacción.

Nunca deberá producirse:

`ticket creado + monedas no descontadas`

ni:

`monedas descontadas + ticket no creado`

Precisión (T-10): si una sola selección no es válida (partido inexistente, apuestas cerradas, partido que ya no está programado, empate no permitido) o el saldo no alcanza, se rechaza el ticket completo: no se crea el ticket, ni ninguna selección, ni se descuenta nada.

---

## BR-054 – Idempotencia

Un doble clic, reintento de navegador o problema de conexión no deberá provocar que una misma confirmación genere dos tickets.

El backend deberá implementar protección contra operaciones duplicadas.

Precisión (T-10):

* Cada confirmación lleva una clave única generada por la interfaz (un UUID). Los reintentos de esa misma confirmación repiten la clave.
* Si llega otra vez la misma clave con las mismas selecciones, el sistema devuelve el ticket ya creado, sin crear otro ni descontar de nuevo.
* Si llega la misma clave con selecciones distintas, se rechaza: una clave identifica una sola confirmación.
* La clave queda asociada al ticket para siempre. Si la confirmación fue rechazada, no se creó nada y la misma clave puede usarse otra vez.
* Dos tickets iguales enviados con claves distintas son dos tickets: el usuario puede apostar lo mismo más de una vez (BR-017).

---

## BR-055 – Devolución atómica

Cuando corresponda devolver monedas debido a una cancelación:

* La apuesta deberá marcarse como anulada.
* El saldo deberá actualizarse.
* La devolución deberá registrarse.

Estas operaciones deberán ejecutarse de manera consistente.

Precisión (T-16): el cambio del partido a cancelado, la anulación de sus apuestas, las devoluciones y el nuevo saldo de cada usuario ocurren en una sola operación. Si algo falla, no se aplica nada. Cancelar dos veces, o cancelar y confirmar el resultado a la vez, nunca devuelve monedas dos veces: solo una de las dos acciones se aplica.

---

# 22. Requisitos no funcionales

## NFR-001 – Mobile first

Todo el sistema deberá diseñarse inicialmente para dispositivos móviles.

---

## NFR-002 – Responsive

La interfaz deberá adaptarse como mínimo a:

* Smartphones.
* Tablets.
* Laptops.
* Monitores de escritorio.

---

## NFR-003 – Pixel art

La aplicación utilizará una línea visual inspirada en pixel art y videojuegos.

Esta identidad podrá aplicarse a:

* Monedas.
* Botones.
* Indicadores.
* Ranking.
* Tarjetas.
* Elementos relacionados con apuestas.

---

## NFR-004 – Indicador de monedas

El navbar del usuario autenticado deberá mostrar permanentemente:

* Icono pixel art de moneda.
* Cantidad disponible.

Ejemplo:

`[moneda pixel art] 7`

---

## NFR-005 – Seguridad

El sistema deberá implementar como mínimo:

* Hash seguro de contraseñas.
* Autorización basada en roles.
* Protección de rutas.
* Validaciones en backend.
* Gestión segura de sesiones o tokens.

Las reglas de negocio nunca deberán depender únicamente del frontend.

---

## NFR-006 – Auditoría

Las operaciones administrativas relevantes deberán registrar:

* Administrador.
* Acción.
* Fecha.
* Hora.
* Registro afectado.

Como mínimo:

* Validación de usuario.
* Modificación de partido.
* Registro de resultado.
* Confirmación definitiva de resultado.
* Cancelación de partido.

Precisiones (T-17):

* Además de las cinco mínimas, se registran la creación y la promoción de administradores con el comando del servidor (D-005) y todas las escrituras del administrador: confirmar y revertir un pago; alta, modificación y borrado de partidos, deportes, competiciones, equipos, jugadores e inscripciones en planteles; alta, modificación y borrado de goles (poner o quitar la imagen o el video de un gol es una modificación), y alta y borrado de imágenes y videos del partido.
* Cada registro guarda el administrador, la acción, la fecha y hora (UTC), el registro afectado y un detalle breve: los datos que cambiaron con su valor anterior y el nuevo, lo creado o lo borrado, el marcador registrado o confirmado, o las cifras de la cancelación.
* El detalle nunca guarda contraseñas, claves, tokens, correos ni saldos, y tiene un tamaño máximo; si no entra, se guardan solo los nombres de los datos.
* El registro se hace en la misma operación que la acción: una acción rechazada o fallida no deja registro, y si no se puede registrar, la acción no se aplica.
* Una edición que no cambia ningún dato no deja registro (D-004), y tampoco volver a registrar exactamente el mismo marcador. Para saber si un dato cambió se comparan siempre sus valores reales, nunca los recortados para el registro: un texto que cambia después del carácter 200 es un cambio, y el registro lo marca como recortado.
* El detalle guarda solo datos que el sistema guarda, nunca valores calculados (por ejemplo, el cierre de apuestas de un partido o el resultado derivado del marcador).
* En la creación o promoción de un administrador con el comando del servidor, el autor del registro es la propia cuenta creada o promovida, y el detalle dice que el origen fue el comando. Si la cuenta ya era administrador, no se registra nada (D-005).
* Los registros no se modifican ni se borran, ni desde la aplicación ni cuando se borra el dato afectado.
* Solo el administrador consulta el registro, del más reciente al más antiguo, con filtros por acción, tipo de dato, registro afectado, administrador y rango de fechas. Del administrador se muestra el nombre, no el correo.

---

# 23. Flujo de participación

```text
Usuario se registra
        ↓
Usuario inicia sesión
        ↓
Estado PENDIENTE
        ↓
Puede navegar, pero no apostar
        ↓
Administrador confirma pago
        ↓
Administrador valida usuario
        ↓
Estado VALIDADO
        ↓
Sistema asigna 10 monedas
        ↓
Usuario puede apostar
```

---

# 24. Flujo de apuesta

```text
Usuario VALIDADO
        ↓
Ingresa a la polla
        ↓
Filtra partidos
        ↓
Selecciona apuestas
        ↓
Puede seleccionar uno o varios partidos
        ↓
Puede realizar varias apuestas sobre el mismo partido
        ↓
1 selección = 1 moneda
        ↓
Sistema calcula costo
        ↓
Usuario revisa resumen
        ↓
Usuario confirma
        ↓
Backend valida fecha límite
        ↓
Backend valida saldo
        ↓
Crea ticket
        ↓
Descuenta monedas
        ↓
Apuesta confirmada
```

---

# 25. Flujo de resultados

```text
Partido finaliza
        ↓
Administrador registra resultado
        ↓
Sistema muestra resumen
        ↓
Administrador confirma
        ↓
Resultado queda bloqueado
        ↓
Sistema determina ganador/empate
        ↓
Busca apuestas relacionadas
        ↓
Evalúa cada selección
        ↓
Asigna puntos
        ↓
Actualiza apuestas
        ↓
Actualiza ranking
```

---

# 26. Flujo de cancelación

```text
Administrador cancela partido
        ↓
Sistema busca apuestas relacionadas
        ↓
Marca selecciones como ANULADAS
        ↓
Calcula monedas utilizadas
        ↓
Devuelve monedas
        ↓
Actualiza saldo
        ↓
Registra devolución
```

---

# 27. Tabla consolidada de puntuación

| Tipo de apuesta   | Condición                      |                   Puntos |
| ----------------- | ------------------------------ | -----------------------: |
| Ganador           | Acertar equipo ganador         |                       +3 |
| Empate            | Acertar empate                 |                       +1 |
| Marcador exacto   | Acertar goles de ambos equipos |                       +3 |
| Incorrecta        | No acertar                     |                        0 |
| Partido cancelado | Apuesta anulada                | 0 + devolución de moneda |

Cada selección se procesa independientemente.

---

# 28. Tabla consolidada de monedas

| Evento                    |                      Movimiento |
| ------------------------- | ------------------------------: |
| Usuario validado          |                     +10 monedas |
| Cada selección confirmada |                       -1 moneda |
| Partido cancelado         | +1 moneda por selección anulada |
| Apuesta incorrecta        |                  Sin devolución |
| Apuesta acertada          |       Sin devolución automática |

Los puntos obtenidos no generan monedas adicionales.
