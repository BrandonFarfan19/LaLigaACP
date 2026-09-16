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

Los roles no se cambian desde la aplicación: ni el panel de administración ni la API ofrecen esa acción. Un administrador solo se crea, o una cuenta existente se promueve, con un comando que se ejecuta en el servidor. Solo se promueve una cuenta que nunca participó en la polla: pendiente, sin pago confirmado, sin monedas, sin movimientos y sin tickets.

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

Toda cuenta creada por registro nace con rol Usuario, estado `PENDIENTE`, pago pendiente y 0 monedas. Nadie puede registrarse como Administrador: un administrador solo se crea o promueve desde el servidor, y no participa en la polla (BR-001).

---

## BR-004 – Autenticación

El acceso a las funcionalidades privadas requerirá autenticación mediante:

* Correo electrónico.
* Contraseña.

Las contraseñas nunca deberán almacenarse en texto plano.

Ante credenciales incorrectas, el sistema responderá siempre lo mismo, sin revelar si el correo está registrado.

---

## BR-005 – Estados del usuario

Los estados mínimos serán:

* Pendiente.
* Validado.

Un usuario en estado `PENDIENTE` podrá iniciar sesión y acceder al sistema, pero no podrá realizar apuestas.

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

---

## BR-010 – Visualización del saldo

El saldo deberá mostrarse permanentemente al usuario autenticado dentro del navbar.

Ejemplo:

`[moneda pixel art] 10`

El icono deberá respetar el estilo pixel art definido para el sistema.

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

---

## BR-012 – Estados del partido

Los estados mínimos serán:

* Programado.
* En curso.
* Finalizado.
* Cancelado.

Solo los partidos en estado `PROGRAMADO` y dentro del periodo permitido podrán recibir apuestas.

---

## BR-013 – Orden de partidos

En todas las interfaces los partidos deberán ordenarse prioritariamente por proximidad de fecha.

El partido cuya fecha esté más próxima deberá aparecer primero.

Esta regla aplica a:

* Landing page.
* Fixture.
* Interfaz de apuestas.
* Administración de partidos.

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

---

# 7. Tipos de apuesta

## BR-015 – Resultado general

El usuario podrá apostar por:

* Gana equipo local.
* Empate.
* Gana equipo visitante.

El empate solo estará disponible en los deportes que admitan empate.

Cada deporte indicará si lo admite. En un deporte que siempre define un ganador, como vóley o básquet, la opción de empate no deberá ofrecerse ni aceptarse.

---

## BR-016 – Marcador exacto

El usuario podrá apostar por el marcador exacto.

Ejemplo:

`Equipo A 2 - 1 Equipo B`

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

---

## BR-024 – Confirmación explícita

No deberán descontarse monedas hasta que el usuario confirme explícitamente la operación.

El usuario deberá tener como mínimo:

* Confirmar.
* Modificar.
* Cancelar.

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

---

## BR-031 – Confirmación del administrador

El administrador deberá confirmar explícitamente que el resultado registrado es correcto.

La interfaz deberá advertir que después de la confirmación el resultado no podrá modificarse.

---

## BR-032 – Resultado inmutable

Después de que el administrador confirme el resultado:

* El resultado deberá quedar bloqueado.
* No podrá ser modificado desde la aplicación.
* Los goles no podrán modificarse.
* El ganador no podrá modificarse.
* El sistema procederá al cálculo de apuestas y puntos.

El backend deberá aplicar esta restricción.

---

# 14. Registro de goles

## BR-033 – Autores de goles

El administrador podrá registrar información sobre cada gol:

* Jugador.
* Equipo.
* Minuto.
* Imagen opcional.
* Video opcional.

---

# 15. Cálculo automático de apuestas

## BR-034 – Procesamiento

Después de confirmar el resultado final, el sistema deberá buscar todas las apuestas asociadas al partido.

Cada selección deberá evaluarse independientemente.

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

---

# 17. Ranking

## BR-041 – Ranking

El ranking deberá ordenarse inicialmente por:

`puntos_totales DESC`

---

## BR-042 – Top 10

El sistema deberá mostrar los diez participantes con mayor cantidad de puntos.

Como mínimo:

* Posición.
* Participante.
* Puntos.
* Cantidad de apuestas acertadas.

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

---

## BR-044 – Actualización

El ranking deberá actualizarse automáticamente después del procesamiento de los resultados.

---

# 18. Cancelación de partidos

## BR-045 – Partido cancelado

Cuando un partido sea declarado `CANCELADO`, todas las apuestas relacionadas deberán quedar anuladas.

---

## BR-046 – Devolución de monedas

El sistema deberá devolver automáticamente las monedas utilizadas en las apuestas correspondientes al partido cancelado.

Ejemplo:

El usuario realizó tres apuestas sobre el partido:

`3 monedas utilizadas`

Si el partido es cancelado:

`3 monedas devueltas`

---

## BR-047 – Tickets con múltiples partidos

Si un ticket contiene apuestas de diferentes partidos y solo uno es cancelado, se devolverán únicamente las monedas correspondientes a las selecciones asociadas con el partido cancelado.

Las demás apuestas continuarán vigentes.

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

---

## BR-050 – Tabla de posiciones

La landing deberá permitir consultar la tabla de posiciones de los equipos correspondientes a cada competición.

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

---

## BR-054 – Idempotencia

Un doble clic, reintento de navegador o problema de conexión no deberá provocar que una misma confirmación genere dos tickets.

El backend deberá implementar protección contra operaciones duplicadas.

---

## BR-055 – Devolución atómica

Cuando corresponda devolver monedas debido a una cancelación:

* La apuesta deberá marcarse como anulada.
* El saldo deberá actualizarse.
* La devolución deberá registrarse.

Estas operaciones deberán ejecutarse de manera consistente.

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
