# La Liga ACP

Web del torneo (fixture, posiciones, equipos y plantillas), más una polla deportiva (autenticación, monedas, apuestas, resultados, ranking). Frontend: SPA estática con **Vite + React + TypeScript + React Router**, estética pixel art de videojuego de los 90. Backend: API REST en **Express + TypeScript** sobre MySQL — ver [server/README.md](server/README.md).

## 🚀 Estructura

```text
/
├── index.html              # shell de la SPA (head, favicon)
├── public/                 # favicon y cursores pixel art, servidos tal cual
├── vite.config.ts          # plugins y presets de imágenes
├── vercel.json             # reescrituras SPA para Vercel
├── vite-plugins/
│   ├── pixel-images.ts     # genera versiones webp pequeñas de las imágenes
│   ├── spa-rewrites.ts     # genera dist/_redirects (Netlify, Cloudflare Pages)
│   └── nginx-spa-routes.ts # genera deploy/nginx/spa-routes.conf (servidor propio)
├── src/
│   ├── main.tsx            # monta React e importa global.css
│   ├── App.tsx             # rutas (/, /posiciones, /plantilla/:id, /ingresar, /registro, /cuenta, /admin y sus secciones, /apuestas, /apuestas/tickets/:id, /mis-apuestas, /ranking, 404)
│   ├── layouts/Base.tsx    # fondo, navbar (con la barra de sesión) y <main>; refresca la sesión
│   ├── pages/              # Home, Posiciones, Plantilla, Ingresar, Registro, Cuenta, Apuestas, Ticket, MisApuestas, Ranking, NotFound (+ .module.css)
│   │   └── admin/          # el panel de administración (T-21): layout, secciones y sus rutas
│   ├── components/         # admin/AdminUi (piezas del panel), Navbar, SessionBar, CoinIcon, PixelIcon, TextField, BetMatchCard, TicketPanel, TeamCrest, Hero, Carousel, Fixture, MatchCard, SquadBoard, PlayerStatsDialog, PixelImage
│   ├── hooks/              # título por página, scroll, sesión y foco en errores
│   ├── lib/                # capa de datos (league.ts lee la API pública), cliente de la API (api.ts), sesión (auth.ts) y guardas de rutas
│   ├── data/               # atributos de muestra del radar (D-022); el resto de los datos vienen de la API
│   ├── types/              # contratos de las entidades y de la API (api.ts)
│   ├── test/               # utilidades de las pruebas del front (fetch simulado, router en memoria)
│   ├── utils/              # radar pixel y captura de imagen para compartir
│   ├── styles/global.css   # tokens, fuentes y primitivas pixel art
│   └── assets/             # escudos, logos y fondos (se importan con ?pixel=<preset>)
├── server/                 # API Express + TypeScript — package.json propio, ver server/README.md
├── db/init/                # esquema SQL, ver EsquemaBD.md
├── db/export-datos-reales.mjs # genera el volcado de datos reales para producción (solo lee)
├── compose.yaml            # desarrollo: base + backend con recarga
├── compose.prod.yaml       # producción: base + backend compilado
├── deploy/nginx/           # sitio nginx del servidor propio (+ spa-routes.conf generado)
└── docs/migracion-react.md # checklist de paridad de la migración desde Astro
```

`server/` tiene su propio `package.json` (no es un workspace de npm): corre y se despliega distinto al front, y hoy no comparte código con él. Ver el porqué en [server/README.md](server/README.md#por-qué-un-packagejson-propio-no-workspaces-de-npm).

## 🧞 Comandos

Desde la raíz del proyecto:

| Comando           | Acción                                                        |
| :---------------- | :------------------------------------------------------------ |
| `npm install`     | Instala las dependencias                                      |
| `npm run dev`     | Servidor de desarrollo en `localhost:5173`                    |
| `npm run build`   | Revisa tipos (`tsc -b`) y genera el sitio en `./dist/`        |
| `npm run preview` | Sirve `./dist/` en local, rutas profundas incluidas           |
| `npm test`        | Pruebas del front (Vitest + Testing Library en jsdom), sin base ni backend |
| `npm run test:watch` | Las mismas pruebas, en modo observación                   |
| `npm run server:install` | Instala las dependencias del backend (`server/`)        |
| `npm run server:dev` | Backend en modo desarrollo (fuera de Docker), `localhost:3001` |
| `npm run server:test` | Corre las pruebas del backend (necesita `docker compose up -d db`) |
| `npm run server:typecheck` | Revisa los tipos del backend y de sus pruebas |
| `npm run server:admin:create` | Crea o promueve un administrador; pide la contraseña (ver abajo) |
| `npm run server:coins:check` | Compara cada saldo de monedas con la suma de sus movimientos y lista los descuadres (sale con 1 si hay) |
| `npm run server:seed:dev` | Solo desarrollo: carga los datos de ejemplo (ver abajo) |
| `npm run server:seed:dev:clean` | Solo desarrollo: borra únicamente los datos de ejemplo |
| `npm run db:export-real` | Genera `db/datos-reales.sql` desde la base de desarrollo, para llevarlo a producción (solo lee) |

`npm run dev` y `npm run preview` sirven cualquier ruta, con o sin barra final (`/posiciones/`, `/plantilla/boca-juniors/`), con 200.

### El front y la API (T-18, D-006)

El front llama a la API **en su mismo origen**, con rutas relativas bajo `/api` (`/api/auth/me`). Así la cookie de sesión (`HttpOnly`, `SameSite=Strict` y, en producción, `__Host-`) y la comprobación de `Origin` del backend funcionan sin abrir CORS con credenciales.

- **En desarrollo**, `npm run dev` (y `npm run preview`) reenvían `/api` y `/api/*` (no `/apix`) al backend en `http://localhost:3001`, quitando el prefijo (`vite.config.ts`). Hace falta el backend levantado (`docker compose up -d`) y `CORS_ORIGIN=http://localhost:5173` en `.env`. Para apuntar a otro backend: `API_PROXY_TARGET=http://host:puerto npm run dev`.
- **Un solo cliente**, `src/lib/api.ts`: manda y recibe JSON, abre el sobre `{ data }` / `{ error }` (un error es un `ApiError` con `status`, `code`, `details` y, en un 429, `retryAfterSeconds`), guarda en memoria el `csrfToken` de `/auth/login` y `/auth/me` y lo manda en `X-CSRF-Token` en cada escritura (si el backend lo rechaza, lo renueva una vez con `/auth/me`), trata un 401 que no sea un login fallido como sesión vencida, y arma las URLs solo con una ruta fija y un objeto `query` explícito: **nunca reenvía parámetros de la URL de la página** (`?next=` y otros se quedan en el front).
- **La sesión** vive en `src/lib/auth.ts` (login, registro, logout, `refreshSession`). Cuándo se lee `/auth/me` (D-009, corrección de T-18):
  - **Páginas protegidas** (`/cuenta`, `/admin`, e `/ingresar` y `/registro` para saber si ya hay sesión): siempre, en su loader, antes de mostrar nada (`readSession`). Una sesión que se cerró en el servidor nunca se muestra como viva.
  - **Páginas públicas**: el layout usa la copia en memoria mientras tenga menos de **60 segundos** (`SESSION_CACHE_MS`) y, si es más vieja, la vuelve a leer (`cachedSession`), también al volver a la pestaña. Navegar por el sitio no gasta los límites del backend.
  - **Después de gastar monedas** (T-19): `refreshSession()`.
  - **Cualquier 401** vacía la sesión al instante. Si en ese momento se ve una página protegida, se pasa a `/ingresar?next=<página>` y sus datos desaparecen; si cambia el rol, la página vuelve a correr su loader (un apostador en `/admin` ve "Acceso restringido"). Salir desde una página protegida lleva al inicio.
- **Rutas protegidas** (`src/lib/route-guards.ts`): `/cuenta` exige sesión y `/admin`, rol admin. Sin sesión llevan a `/ingresar?next=<página>`; con otro rol muestran "Acceso restringido". Son una comodidad: el backend vuelve a comprobar todo en cada petición.
- **`?next=`** pasa por `safeNextPath` (`src/lib/next-path.ts`), que revisa el texto recibido **y** la ruta ya normalizada (corrección de T-18): `/.//evil.com` o `/%2e%2e//evil.com` se normalizan a `//evil.com`, que el router seguiría como URL externa. Todo lo que no quede como una ruta del propio sitio cae al destino por defecto (`/cuenta` o `/admin`).
- **Errores**: un 429 dice qué límite fue (`details.limite`): el formulario de ingreso solo habla de "intentos de ingreso" con el límite de ingreso, y una página protegida muestra "Espera un momento" con el tiempo de espera, no "Sin conexión".
- Las lecturas de la liga (portada, fixture, posiciones, plantillas) usan la **API pública** desde T-22 (ver la sección siguiente): son públicas, no dependen de la sesión y tienen su propio límite por minuto.

### Apuestas (T-19)

- **`/apuestas`** lista los partidos con su estado de apuesta (disponible, apuestas cerradas, en curso, finalizado, cancelado; cada uno con icono y texto), en el orden de la API (BR-013). Los filtros (deporte, desde, hasta, estado y página) viven en la URL de la página con los mismos nombres que la API (`deporteId`, `desde`, `hasta`, `estadoApuesta`, `page`). Las fechas son días en la hora de Lima y se mandan como `AAAA-MM-DDT00:00:00-05:00`. Un valor inválido se ignora con un aviso, y ningún otro parámetro de la página llega a la API. Nada se corta desde 320 px (D-014): los campos se ponen en columnas solo donde cada uno cabe entero (al menos 15rem; en un teléfono, uno debajo del otro), y el deporte se elige con opciones que parten el nombre en líneas en vez de un desplegable que lo recortaría.
- **Solo en los partidos disponibles** hay botones de resultado (sin empate si el deporte no lo admite) y de marcador exacto (0 a 999 por lado). Cada clic agrega una selección; se permiten varias por partido y repetidas (se marcan).
- **El ticket en armado** (`TicketPanel`) es una barra inferior que se abre en el teléfono, y una columna fija desde 64rem. Muestra cada selección con sus problemas, la cantidad (máximo 50), el costo y el saldo actual y el posterior, que salen de `POST /apuestas/vista-previa` (se pide 300 ms después del último cambio). Quitar una selección es "modificar" y vaciar es "cancelar" (BR-024). Los cambios se anuncian con `aria-live`.
- **El borrador** (D-012) vive en `sessionStorage`, por usuario (`src/lib/ticket-draft.ts`). Se borra al confirmar, al vaciarlo y al salir.
  - Si la sesión vence sola (sin pulsar "Salir"), el borrador queda en esa pestaña hasta cerrarla o hasta que ese mismo usuario lo confirme o lo vacíe. Está guardado por usuario: otra cuenta que entre en la pestaña no lo ve, y quien vuelva a entrar con la misma cuenta lo encuentra.
  - Al leerlo se valida entero (corrección de T-19): la selección según su tipo (solo sus campos), ids, goles de 0 a 999, los datos del partido y la clave (un UUID exacto). Lo que no cumple se descarta sin romper la página, y si algo se descartó o la clave no sirve, se prepara una clave nueva. Un error al dibujar el panel muestra un aviso con "Vaciar ticket", no la página de error.
  - Las fechas guardadas se validan campo por campo: un 30 de febrero o un 24:00:00 se descartan. Si se descartó algo, la página dice cuántas selecciones y por qué, en palabras simples.
  - La acción de la página rechaza un pedido que no sea vista previa ni confirmación, y nunca confirma un ticket más chico que el que se ve: si alguna selección no es válida, no envía nada y lo avisa.
  - Los datos de cada partido del ticket (equipos, fecha) se toman de la lista o de la vista previa, la que llegó último; al recargarse la lista se vuelve a pedir la vista previa.
  - Una confirmación que falla por falta de conexión, por un límite (429) o con el servidor caído (5xx) no vuelve a cargar la lista, y si una recarga de la lista falla mientras hay un ticket en armado, la página conserva la lista anterior y el ticket, con un aviso y "Reintentar". Si el reintento carga bien, se quita el error de confirmación anterior.
- **Confirmar** manda `POST /apuestas/tickets` con un `Idempotency-Key` (UUID) que identifica ese intento: cambia con cada cambio de las selecciones y se repite en un reintento tras un error de red o un doble clic, así que nunca se cobra dos veces (BR-054). Un 409 `TICKET_REJECTED` muestra el problema junto a cada selección sin perder el ticket; `IDEMPOTENCY_KEY_REUSED` prepara una clave nueva; un 401 lleva a ingresar con `?next=` (el ticket queda guardado); un 429 dice cuánto esperar. Al confirmar, el contador de monedas se actualiza y se abre el comprobante.
- **`/apuestas/tickets/:id`** es el comprobante (BR-025). Un ticket ajeno o inexistente muestra "Página no encontrada".
- Un apostador **pendiente** ve los partidos con los controles deshabilitados y el motivo; un **admin** ve "Acceso restringido" (no participa). Un apostador validado que ingresa sin `?next=` llega a `/apuestas` (D-008).

### Mis apuestas y ranking (T-20)

- **Navegación:** la barra de sesión de un apostador tiene el botón **Polla**, que abre Apostar, Mis apuestas y Ranking (se cierra con Escape, con un clic afuera o al cambiar de página). Así la fila entra a 320 px (D-007, D-014). El administrador tiene un enlace directo a Ranking. El destino al ingresar no cambia (D-008).
- **`/mis-apuestas`** (solo `apostador`; un administrador ve "Acceso restringido"): el resumen (tickets y selecciones por estado, puntos, aciertos, monedas usadas y devueltas) y la lista de la API agrupada por ticket, con fecha, partido, tipo, pronóstico, resultado real, estado (icono y texto), costo, puntos y el enlace al comprobante. Si una página corta un ticket, lo dice. Un pendiente ve su historial vacío y por qué.
  - Filtros en la URL, con los nombres de la API: `estado`, `estadoTicket`, `deporteId`, `competicionId` (solo junto con su deporte; las competiciones se piden a `/public/competiciones`), `desde`, `hasta` (días de confirmación en la hora de Lima) y `page`. Un valor inválido, un deporte que ya no existe o una competición de otro deporte se quitan con un aviso y no llegan a la API.
  - Paginación con enlaces que conservan los filtros. Estados vacío ("Todavía no tienes apuestas" con "Ir a apostar", o "No hay apuestas con esos filtros"), cargando (anunciado) y error: un fallo transitorio (sin conexión, 429 o 5xx) queda en la página con "Reintentar" y conserva lo que se veía.
- **`/ranking`** (cualquier sesión, BR-002): una tabla de puntajes con posición, participante, puntos y aciertos. Las posiciones compartidas se marcan con `=` (y "compartido" para lectores de pantalla); los encabezados son cortos en el teléfono y completos desde 48rem. El top llega a 50 filas como máximo y avisa cuántos empatados quedaron fuera (`topSinMostrar`). La fila propia lleva la marca **TÚ** y un marco (no solo color); si no entra en la lista, va al final tras un separador, y arriba se resume "Tu puesto". Un pendiente y un administrador ven por qué no tienen fila. "Actualizar" lo vuelve a leer (BR-044); un fallo transitorio queda en la página con "Reintentar".
- **Datos siempre frescos:** las dos páginas leen la API en su loader en cada visita, así que un ticket recién confirmado o un resultado recién confirmado se ven al entrar o al recargar.
- En `/apuestas`, un deporte de la URL que ya no existe se quita con un aviso y no se manda a la API (observación final de T-19).

### Portada, posiciones y plantillas con datos reales (T-22)

- **Todo lo que se ve sale de la API pública** (`/public/...`), sin sesión: la portada (equipos y fixture), `/posiciones` y `/plantilla/:id`. `src/lib/league.ts` es el único lugar que conoce los nombres en español de la API y los traduce a los tipos de `src/types`; las páginas siguen leyendo en su `loader` y los componentes siguen recibiendo props.
- **Qué competición se muestra (D-021, BR-048):** un selector de deporte y competición con opciones visibles. La elección queda en la URL (`/?deporteId=1&competicionId=10`), así que el enlace se puede compartir. Sin competición en la URL manda una sola regla (`defaultCompetition` en `src/lib/league.ts`): la competición del **próximo partido programado**; si no hay ninguno, la del **partido jugado más reciente**, salteando los cancelados (nunca tienen marcador ni cuentan en la tabla); si todos fueran cancelados, la del más reciente; y si no hay ningún partido, la primera competición de la lista. Con un deporte elegido la regla corre **entre los partidos de ese deporte**.
- **Fixture:** se pide por competición, de a 100 partidos (y por jornada cuando hace falta), en el orden de la API (BR-013). Las jornadas se agrupan en pantalla. Se leen como máximo 5 páginas (500 partidos): si la competición tiene más, la sección lo avisa en vez de cortar la lista en silencio.
- **Tabla de posiciones (BR-050, D-023):** muestra jugados, ganados, empatados, perdidos, goles a favor y en contra, diferencia y puntos. Como diez columnas no entran en un teléfono, la tabla se desplaza **dentro de su propia caja** (con foco y nombre propios) y el equipo queda fijo a la izquierda; la página nunca se desplaza de lado.
- **Un cambio hecho por la API tarda hasta 30 segundos en verse aquí.** Las respuestas de `/public/...` viajan con `Cache-Control: public, max-age=30` (`PUBLIC_RATE_LIMIT`/caché de la API pública, ver `server/README.md`): tras cargar un resultado o crear un partido desde el panel, la portada, `/posiciones` y `/plantilla/:id` pueden seguir mostrando lo anterior durante ese medio minuto, en el navegador o en un proxy intermedio. Recargar sin caché (Ctrl+F5) lo muestra en el acto. No es un error de la pantalla: el panel de administración responde `no-store` y siempre ve el dato nuevo.
- **Equipos:** `/plantilla/:id` usa el id numérico del equipo (`/plantilla/42`). Un id que no es número, o que no existe, muestra "Página no encontrada": la API responde 400 o 404 y la capa de datos trata los dos igual.
- **Imágenes:** los escudos y las fotos vienen de la API como URL `https://` o ruta del sitio, así que no son recortes generados al compilar: se muestran con `<img>` pequeños, tamaño fijo y `pixelated` (`Crest`), nunca como SVG incrustado. Si el valor no sirve, se ven las iniciales del equipo. Las ilustraciones propias (logo, cancha, retrato, fondos) siguen con `PixelImage` y sus presets.
- **Estados:** si no hay competiciones, si la competición no tiene nada cargado o si una lectura falla, la página lo dice sin taparse, y el fallo ofrece "Reintentar".
- **Radar del jugador (D-022):** los seis atributos siguen siendo de muestra, generados a partir del id real del jugador (iguales en cada recarga). La ficha lo advierte, y la cancha aclara que la ubicación es de muestra: el dorsal sí es el del plantel.

### Panel de administración (T-21)

- **`/admin`** y sus secciones son solo para administradores: sin sesión llevan a ingresar (con la sección pedida en `?next=`); un apostador, validado o no, ve "Acceso restringido" sin la navegación del panel. Cada sección carga su código la primera vez que se abre (`lazy`): los visitantes y apostadores no descargan el panel.
- **Secciones** (una lista de enlaces que se acomoda desde 320 px, sin tocar el navbar):
  - **Resumen**: conteos de participantes y estadísticas de la polla (solo apostadores).
  - **Participantes**: la tabla de BR-007 con búsqueda, filtros de pago y validación, orden y páginas. Confirmar pago, revertir pago y validar tienen cada uno un paso de confirmación explícito; tras validar se ve el saldo con las 10 monedas. No hay ninguna acción de cambio de rol.
  - **Partidos**: el listado en el orden de la API (BR-013) con filtros por deporte, competición, equipo, estado y fechas, y el alta. **Un partido** (`/admin/partidos/:id`) reúne sus datos (qué se puede editar según su estado y sus apuestas), el marcador con la vista previa y la confirmación definitiva, los goles con su autor, las imágenes y videos (del gol y del partido) y la cancelación.
  - **Apuestas**: la consulta de las apuestas de los participantes (`GET /admin/polla/apuestas`), solo lectura.
  - **Ranking**: el ranking completo con el id de cada participante.
  - **Deportes, Competiciones, Equipos, Jugadores y Planteles**: alta, edición en la misma fila y borrado de cada catálogo.
  - **Auditoría**: el registro de operaciones con filtros, el administrador por su nombre y el detalle en palabras (qué cambió, antes y después).
- **Fechas**: se muestran y se cargan en la hora de Lima; el alta y la edición mandan la fecha con su zona (`2026-10-01T20:00:00-05:00`).
- **Escrituras**: pasan por la acción de cada ruta y por `src/lib/api.ts` (con el token CSRF). Las imágenes se suben como `multipart/form-data` (el único envío que no es JSON); el formulario avisa antes de enviar si falta el archivo o pasa de 5 MB, y el backend revisa su contenido. Las imágenes se muestran solo desde `/api/admin/archivos/<nombre>.webp` y los videos solo con su dirección `embedUrl` en un `iframe` con `sandbox`.
- **Elegir un registro** (competición, equipo, jugador, inscripción; D-019): un buscador con lista de opciones, no un desplegable. Se escribe parte del nombre, la API devuelve las coincidencias de a 20 ("Ver más opciones" trae las siguientes) y la elegida se muestra entera, en varias líneas si hace falta. Se maneja con las flechas, Enter y Escape, anuncia cuántas opciones hay, se cierra al salir del campo con Tab y solo se abre cuando se lo pide (al escribir, al hacer clic o con las flechas). La búsqueda llega hasta 100 caracteres, el máximo que acepta la API: el campo no deja escribir más, un texto más largo (pegado) se recorta antes de pedir y el aviso lo dice. Así no hay tope de registros (con 150 jugadores se llega a cualquiera) y nada queda cortado a 320 px. Los equipos que ofrece dependen de la competición elegida. Las listas fijas cortas (estado, pago) siguen siendo desplegables; la de acciones de auditoría, por sus nombres largos, usa el buscador.
- **Errores**: cada rechazo del backend se muestra con su motivo y qué hacer (por ejemplo, borrar antes las competiciones de un deporte). Un error de un campo marca ese campo y le lleva el foco, también cuando el motivo es un conflicto (slug repetido, camiseta ocupada, jugador ya inscrito, mismo equipo, fecha pasada); si no, el foco va al mensaje. Al enviar un formulario se limpian los mensajes de los demás. Las acciones que no se deshacen (confirmar el resultado, cancelar un partido, borrar, quitar la imagen o el video de un gol) piden un paso explícito que dice qué va a pasar. Un fallo de lectura pasajero deja la página con su aviso y "Reintentar", y el foco va a ese aviso. Una página `?page=` más allá de la última muestra la última, lo dice y deja esa página en la URL (sin volver a leer nada), igual que en Mis apuestas. Si la sesión termina mientras se abre otra página, se filtra o se recarga, ingresar vuelve a la URL pedida, no a la que quedó en pantalla: cada forma de pedir una página (enlace, filtro o recarga) la registra al pedirla, igual en Mis apuestas, Apuestas, Ranking y el panel.
- **Tablas**: desde 48rem son tablas; en el teléfono cada fila se muestra como una tarjeta con el nombre de cada dato.

### Pruebas del front

`npm test` corre Vitest con la misma configuración de Vite (`vitest.config.ts`), en jsdom, solo sobre `src/**/*.test.{ts,tsx}`. No necesitan backend ni base: `fetch` se simula (`src/test/fetch-mock.ts`) y las páginas se montan en un router en memoria (`src/test/render-routes.tsx`). Cubren el cliente de la API (sobre, CSRF, 401, 429), la sesión, el validador de `?next=`, los formularios de ingreso y registro (errores por campo), las rutas protegidas y la barra de sesión con el contador de monedas.

Los `server:*` son atajos (`npm --prefix server run ...`); ver [server/README.md](server/README.md) para el resto de sus comandos.

## 🌐 Despliegue

Se publica la carpeta `dist/` en cualquier hosting estático. Como es una SPA, el servidor tiene que responder la app en sus rutas. El build deja lista la configuración para los hostings habituales.

> Esta sección describe los **hostings estáticos**. Para un **servidor propio con nginx y Docker**, que es el camino que sigue el proyecto, ver la sección siguiente, "Despliegue en servidor propio (nginx + Docker)".

**Rutas que se reescriben** (cada una con y sin barra final): `/posiciones`, `/plantilla/:id`, `/ingresar`, `/registro`, `/cuenta`, `/admin`, `/apuestas`, `/apuestas/tickets/:id`, `/mis-apuestas` y `/ranking`, donde `:id` es **un solo segmento**. `/` no necesita regla. No hay comodín `/*`: los archivos reales (`assets/`, `favicon.png`, `cursors/`) se sirven tal cual y las URLs que no existen conservan el 404.

| Hosting | Configuración | Rutas de la app | `/plantilla/no-existe` | `/plantilla/a/b`, `/plantilla`, `/cualquier/cosa` |
| :-- | :-- | :-- | :-- | :-- |
| Cloudflare Pages | `dist/_redirects`, destino `/` | 200 | 200 | 404 con `404.html` |
| Netlify | `dist/_redirects`, destino `/index.html` | 200 | 200 | 404 con `404.html` |
| Vercel | `vercel.json`, destino `/index.html` | 200 | 200 | 404 con `404.html` |
| GitHub Pages u otro sin reescrituras | solo `dist/404.html` | **404**, aunque la página se ve bien | 404 | 404 |

- **`_redirects` se genera al compilar** (`vite-plugins/spa-rewrites.ts`) porque el destino no puede ser el mismo en los dos hostings. Cloudflare Pages quita `/index` y `.html` del destino, toma `/index.html` como un bucle infinito y descarta la regla. Por eso necesita `/`. Netlify solo documenta `/index.html` como destino de una SPA, no `/`. El build usa `/index.html` cuando corre en Netlify (`NETLIFY=true`) y `/` en cualquier otro caso: Cloudflare, local o `wrangler pages dev`. **Si se sube a Netlify un `dist/` compilado fuera de Netlify, lleva el destino `/`, que Netlify no documenta:** conviene compilar en Netlify.
- **`404.html` es el respaldo** (copia de `index.html`): en un hosting sin reescrituras abre la app en cualquier ruta, pero con estado HTTP 404 incluso en páginas válidas. Eso afecta a buscadores y monitores. Donde hay reescrituras, las URLs desconocidas reciben ese mismo archivo con 404 y la app muestra "Página no encontrada".
- **Equipo inexistente:** `/plantilla/no-existe` coincide con `/plantilla/:id`, así que llega con **200** y la app muestra "Página no encontrada". Sin un servidor que consulte los datos, el hosting no puede saber qué ids existen.
- **Para agregar una ruta:** además de `src/App.tsx`, hay que listarla en `SPA_ROUTES` (`vite.config.ts`) y en `vercel.json`, con y sin barra final. El build falla si `vercel.json` no coincide con `SPA_ROUTES`.
- **La API detrás de `/api` (D-006).** El sitio publicado tiene que reenviar `/api/*` al backend en el **mismo dominio**, quitando el prefijo, con un proxy inverso. Sin eso, ingresar y todo lo que usa la sesión falla. El proxy debe:
  - pasar sin cambios el método, el cuerpo y las cabeceras `Cookie`, `Origin`, `Content-Type`, `X-CSRF-Token` e `Idempotency-Key`, y devolver `Set-Cookie`, `Retry-After`, `RateLimit-*`, `Location` e `Idempotent-Replayed`;
  - no cachear `/api` (el backend ya manda `Cache-Control`);
  - agregar `X-Forwarded-For`, y el backend tiene que tener `TRUST_PROXY` con la cantidad de saltos o las IPs del proxy (si no, todos los clientes comparten el límite de intentos), `CORS_ORIGIN` con el dominio del sitio y `NODE_ENV=production` (cookie `Secure` y `__Host-`, que exige HTTPS).

  Ejemplo con nginx, que sirve `dist/` y la API en el mismo `server`:

  ```nginx
  location /api/ {
      proxy_pass http://127.0.0.1:3001/;   # la barra final quita el prefijo /api
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      client_max_body_size 6m;             # las imágenes del panel pesan hasta 5 MB más el sobre multipart
  }
  ```

  **El límite de subida del proxy tiene que ser mayor que `UPLOAD_MAX_BYTES`** (5 MB por defecto): el envío multipart agrega el nombre del archivo, los separadores y los demás campos, así que con 5 MB justos nginx rechaza imágenes válidas. Su valor por defecto (1 MB) corta casi cualquier foto. Si aun así responde 413 —con su propia página HTML, sin el sobre `{ error }` de la API—, el panel lo explica igual ("El archivo es demasiado grande: el servidor lo rechazó antes de recibirlo entero"), no como una respuesta inesperada.

  Los hostings estáticos de la tabla lo resuelven distinto: Netlify con una regla de proxy en `_redirects` (`/api/*  https://api.ejemplo.com/:splat  200`, antes de las reglas de la SPA), Vercel con una reescritura externa en `vercel.json` y Cloudflare Pages con una Function (sus `_redirects` no hacen proxy a otro dominio). Hoy el build no genera esas reglas porque todavía no hay hosting ni dominio de la API: se agregan al elegirlos, respetando la lista de arriba.
- **Qué está probado:** Cloudflare Pages con `npx wrangler pages dev dist`, cuando había 4 reglas (antes de T-18). Hoy `_redirects` tiene una regla por cada ruta de `SPA_ROUTES`, con y sin barra final (42 reglas con las 21 rutas de la T-21), con el mismo formato y el mismo destino; no se volvió a correr wrangler con ellas. En esa prueba aceptó las reglas sin avisos; las rutas de la app, con y sin barra final, dieron 200; `/plantilla/a/b`, `/plantilla` y `/cualquier/cosa` dan 404 con la app; los archivos reales dan 200. Netlify y Vercel no se probaron en un despliegue: su configuración sigue la documentación de cada uno (placeholders de un segmento, prioridad de los archivos reales sobre las reescrituras).

## 🖥️ Despliegue en servidor propio (nginx + Docker)

Un servidor Linux con Docker para la base y el backend, y **nginx instalado en el host** (fuera de Docker) como servidor web y terminador de TLS. El front se **compila en el servidor** y nginx sirve `dist/` desde el disco. Los archivos que lo arman:

| Archivo | Qué es |
| :-- | :-- |
| `compose.prod.yaml` | base de datos + backend de producción |
| `server/Dockerfile.prod` | imagen del backend, compilada y sin devDependencies |
| `deploy/nginx/la-liga-acp.conf.example` | el sitio de nginx, con marcadores para el dominio y el certificado |
| `deploy/nginx/spa-routes.conf` | las 42 URLs de la SPA, **generadas en cada build** |

**Nada de esto toca el flujo de desarrollo:** `compose.yaml` y `server/Dockerfile` siguen igual.

### Antes de empezar: qué tiene que haber instalado

| Programa | Versión mínima | Para qué | Comprobar con |
| :-- | :-- | :-- | :-- |
| Docker Engine + plugin Compose | Compose **v2** | la base y el backend | `docker compose version` |
| **Node.js** | **22.12.0** | compilar el front en el servidor | `node -v` |
| nginx | 1.18 (1.25.1+ para `http2 on;`) | servidor web y TLS | `nginx -v` |
| git | cualquiera | traer el repo | `git --version` |
| openssl | cualquiera | generar `SESSION_SECRET` | `openssl version` |

**Ojo con Node.** Los dos `package.json` piden `node >= 22.12.0`, y el Node que traen los repositorios de Debian y Ubuntu estables es 18 o 20: si se instala `nodejs` con `apt` sin más, `npm ci` falla o compila mal. Dos formas de conseguir un Node 22 sin depender del repositorio de la distro:

```sh
# Opción A: repositorio oficial de NodeSource (instala en todo el sistema)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # tiene que decir v22.x

# Opción B: nvm, sin sudo y por usuario (útil si el servidor ya tiene otro Node)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
. "$HOME/.nvm/nvm.sh" && nvm install 22 && nvm use 22
node -v
```

Si el servidor no puede tener Node, la alternativa es compilar el front en otra máquina con la **misma versión** y copiar `dist/` y `deploy/nginx/spa-routes.conf` al servidor.

**Dos cosas más que suelen faltar en un servidor recién instalado:**

- **Permiso para usar Docker sin `sudo`.** Si `docker compose version` responde `permission denied` sobre `/var/run/docker.sock`, hay que agregar el usuario al grupo `docker` y **volver a entrar** (el grupo no se aplica en la sesión abierta): `sudo usermod -aG docker "$USER"` y después cerrar sesión y entrar de nuevo, o `newgrp docker`. La otra opción es anteponer `sudo` a cada `docker compose`.
- **Los puertos 80 y 443 abiertos** en el firewall del servidor y, si lo hay, en el del proveedor. Con `ufw`: `sudo ufw allow 'Nginx Full'`. Sin esto el certificado no se puede emitir y el sitio no se ve desde afuera, aunque todo lo demás esté bien.

### Pasos

Van en este orden. Los pasos 1 y 2 **tienen que estar terminados antes** de levantar nada: la contraseña de MySQL se graba al crear el volumen y después no se relee (ver el aviso de abajo).

```sh
# 1. Traer el repo. El usuario que lo clona va a ser su dueño.
git clone <repo> /srv/la-liga-acp && cd /srv/la-liga-acp

# 2. CONFIGURACIÓN — terminar ESTE paso antes de seguir.
cp .env.example .env
openssl rand -base64 48        # copiar la salida a SESSION_SECRET
nano .env                      # o vim, o el editor que haya
```

En `.env` hay que dejar, como mínimo (el detalle está en el bloque **PRODUCCIÓN** al final de `.env.example`):

- `MYSQL_PASSWORD` y `MYSQL_ROOT_PASSWORD`: contraseñas propias. **Nunca dejar las de ejemplo.**
- `SESSION_SECRET`: el valor que acaba de generar `openssl`. El backend rechaza el del ejemplo.
- `CORS_ORIGIN`: el dominio del sitio, con `https://` y **sin** barra final.
- `TRUST_PROXY=1`.

> ### ⚠️ La contraseña de MySQL se graba una sola vez
>
> `MYSQL_PASSWORD` y `MYSQL_ROOT_PASSWORD` **solo se leen cuando el volumen de datos se crea por primera vez**. MySQL las guarda adentro y, a partir de ahí, cambiarlas en `.env` no cambia nada: el backend sigue intentando entrar con la nueva y MySQL sigue esperando la vieja, así que falla con `Access denied for user 'liga'@'...'` y `/health` responde `503 DATABASE_UNAVAILABLE`.
>
> Pasa fácil: `.env.example` trae `MYSQL_PASSWORD=cambiar_password_app`, así que quien levante los contenedores **antes** de terminar de editar el `.env` deja esa contraseña grabada dentro de MySQL para siempre.
>
> **Si ya pasó**, hay dos salidas:
>
> **A) Cambiar la contraseña dentro de MySQL — conserva los datos.** Es la que conviene si la base ya tiene algo que no se quiera perder (equipos, jugadores, partidos, apuestas). Se entra con la contraseña **vieja** de root, la que quedó grabada:
>
> La contraseña **no se escribe en el comando**: `-p` a secas hace que `mysql` la pida, así no queda en el historial del shell ni en la línea de comandos del proceso (la misma regla que el proyecto ya aplica a `ADMIN_PASSWORD`, ver [server/README.md](server/README.md)). Y con `-p` pegado a un valor, una clave con espacios o con `$` se rompe.
>
> ```sh
> # Pide la contraseña VIEJA de root (la que estaba en el .env al crear el volumen).
> # NUEVA_APP es el MYSQL_PASSWORD que hay AHORA en el .env; va entre comillas simples.
> docker compose -f compose.prod.yaml exec -it db \
>   mysql -uroot -p -e \
>   "ALTER USER 'liga'@'%' IDENTIFIED BY 'NUEVA_APP'; FLUSH PRIVILEGES;"
>
> # Si también cambió MYSQL_ROOT_PASSWORD, la de root va aparte. Son DOS cuentas:
> # la imagen crea root@localhost y también root con host comodín, y si se cambia
> # solo una, la otra se queda con la clave vieja.
> docker compose -f compose.prod.yaml exec -it db \
>   mysql -uroot -p -e \
>   "ALTER USER 'root'@'localhost' IDENTIFIED BY 'NUEVA_ROOT';
>    ALTER USER 'root'@'%' IDENTIFIED BY 'NUEVA_ROOT';
>    FLUSH PRIVILEGES;"
>
> # `restart` NO sirve acá: reinicia el proceso con las variables que ya tenía.
> # Para que el contenedor vuelva a leer el .env hay que recrearlo:
> docker compose -f compose.prod.yaml up -d server
> curl -s http://127.0.0.1:3001/health
> ```
>
> Si `root'@'%'` no existe en esa instalación, ese `ALTER` falla con `ERROR 1396`; es inofensivo y se puede quitar. Hoy no se llega a esa cuenta desde afuera porque `compose.prod.yaml` no publica el 3306, pero sí en cuanto alguien descomente el puerto de mantenimiento.
>
> El usuario de la aplicación es el de `MYSQL_USER` (`liga` por defecto): si se cambió, va ese nombre.
>
> **Si tampoco se sabe la contraseña vieja de root**, todavía no hay que borrar nada: MySQL se puede arrancar saltándose la comprobación de permisos (`--init-file` con el `ALTER USER`, o `--skip-grant-tables`) y desde ahí fijar una contraseña nueva **conservando los datos**. Es más trabajo que A, pero mucho menos que perder la base y las imágenes subidas. La opción B es el último recurso, no el segundo.
>
> **B) Borrar el volumen y empezar de cero — se pierde TODO.** Solo si la base está recién creada o no tiene nada que importe. Borra la base **y las imágenes subidas**, y `db/init/` se vuelve a ejecutar desde cero:
>
> ```sh
> docker compose -f compose.prod.yaml down -v     # -v BORRA los datos y los uploads
> docker compose -f compose.prod.yaml up -d --build
> ```
>
> Con datos reales cargados, **A**. Con la base recién levantada y vacía, **B** es más rápido y más limpio.

```sh
# 3. Base de datos y backend. Recién ahora, con el .env terminado.
docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml ps        # esperar a que db diga (healthy)
curl -s http://127.0.0.1:3001/health           # {"data":{"status":"ok","database":"up",...}}

# 4. El front, compilado acá. Genera dist/ y deploy/nginx/spa-routes.conf.
npm ci && npm run build
```

#### 5. El certificado, antes de tocar nginx

El sitio de ejemplo **no arranca sin certificado**: el bloque HTTPS apunta a dos archivos y, si no existen, `nginx -t` falla y `systemctl reload nginx` no aplica nada. Así que el orden es: **DNS apuntando al servidor → certificado emitido → recién entonces activar el sitio.**

**Caso (a): ya se tiene el certificado** (un `.crt`/`.pem` y su `.key`).

```sh
sudo mkdir -p /etc/ssl/la-liga-acp
sudo cp fullchain.crt /etc/ssl/la-liga-acp/fullchain.pem
sudo cp privada.key  /etc/ssl/la-liga-acp/privkey.pem

# La clave privada la lee nginx como root al arrancar: nadie más debe poder leerla.
sudo chown root:root /etc/ssl/la-liga-acp/*.pem
sudo chmod 600 /etc/ssl/la-liga-acp/privkey.pem
sudo chmod 644 /etc/ssl/la-liga-acp/fullchain.pem
```

En `ssl_certificate` va la cadena **completa** (el certificado del dominio seguido de los intermedios). Si la autoridad los entregó por separado, se concatenan en ese orden: `cat dominio.crt intermedios.crt > fullchain.pem`. Con solo el certificado del dominio, los navegadores de escritorio suelen andar y los teléfonos fallan.

**Caso (b): emitirlo con certbot.** Acá hay un huevo y la gallina: certbot en modo `webroot` necesita que nginx ya esté sirviendo por HTTP, pero el sitio de ejemplo tiene el bloque HTTPS que impide arrancar sin certificado. La salida es usar el modo `--nginx`, que lo resuelve solo, **sobre el sitio por defecto y antes de instalar el de la app**:

```sh
sudo apt-get install -y certbot python3-certbot-nginx

# El sitio por defecto de Debian y Ubuntu trae `server_name _;`, que NO coincide
# con ningún dominio, y entonces certbot --nginx dice que no encuentra un vhost
# para él. Se le pone el dominio antes de pedir el certificado:
sudo sed -i 's|server_name _;|server_name DOMINIO.EJEMPLO;|' /etc/nginx/sites-available/default
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d DOMINIO.EJEMPLO
# Deja los archivos en /etc/letsencrypt/live/DOMINIO.EJEMPLO/
```

Después, en el paso 6, `/RUTA/AL/CERTIFICADO` es `/etc/letsencrypt/live/DOMINIO.EJEMPLO`.

> **Al terminar, certbot deja el sitio por defecto escuchando en el 443 con ese mismo `server_name`.** Como `sites-enabled` se incluye por orden alfabético, `default` va antes que `la-liga-acp.conf` y **se queda con el dominio**. `nginx -t` solo avisa `conflicting server name` y sigue diciendo *test is successful*, así que es fácil no verlo. Por eso el paso 6 desactiva el sitio por defecto (`rm -f /etc/nginx/sites-enabled/default`) antes de activar el de la app.

El `location` de `acme-challenge` que trae el ejemplo sirve para las **renovaciones** siguientes, que ya corren con el sitio de la app activo.

#### 6. Activar el sitio

Las rutas de abajo (`sites-available`, `sites-enabled`, el usuario `www-data`) son las de **Debian y Ubuntu**. En otras distribuciones el sitio va en `/etc/nginx/conf.d/` y el usuario suele ser `nginx`.

> **Cada marcador aparece DOS veces en el archivo**, salvo el del puerto, que aparece una. Olvidar la segunda aparición de `/RUTA/AL/CERTIFICADO` o de `/RUTA/AL/REPO` **falla ruidoso** en `nginx -t`, así que se nota enseguida. Olvidar la segunda de `DOMINIO.EJEMPLO` **falla en silencio**: nginx arranca sin quejarse, el `server_name` del bloque HTTP o del HTTPS no coincide con el dominio y sirve el sitio por defecto, y uno se pone a perseguir un fantasma. Por eso conviene reemplazarlos con `sed`, que cambia las dos de una vez, en lugar de editar a mano.

```sh
sudo cp deploy/nginx/la-liga-acp.conf.example /etc/nginx/sites-available/la-liga-acp.conf

# Reemplazar los tres marcadores, las dos apariciones de cada uno.
sudo sed -i 's|DOMINIO\.EJEMPLO|liga.ejemplo.com|g'                  /etc/nginx/sites-available/la-liga-acp.conf
sudo sed -i 's|/RUTA/AL/CERTIFICADO|/etc/letsencrypt/live/liga.ejemplo.com|g' /etc/nginx/sites-available/la-liga-acp.conf
sudo sed -i 's|/RUTA/AL/REPO|/srv/la-liga-acp|g'                     /etc/nginx/sites-available/la-liga-acp.conf

# Solo si se cambió PORT en el .env (aparece una vez, en proxy_pass):
# sudo sed -i 's|127\.0\.0\.1:3001|127.0.0.1:OTRO_PUERTO|' /etc/nginx/sites-available/la-liga-acp.conf

# Comprobar que no quedó ninguno sin reemplazar: tiene que imprimir 0.
grep -c 'DOMINIO\.EJEMPLO\|/RUTA/AL/' /etc/nginx/sites-available/la-liga-acp.conf
```

Si el sitio por defecto de la distribución sigue activo, **hay que desactivarlo antes** (ver el paso 5: después de `certbot --nginx` se queda escuchando en 443 con su propio `server_name`, y `sites-enabled` se incluye por orden alfabético, así que `default` gana):

```sh
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/la-liga-acp.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

nginx tiene que poder **leer** `dist/` y `deploy/nginx/`: el usuario `www-data` necesita permiso de ejecución sobre todas las carpetas del camino hasta el repo (`sudo -u www-data test -r /srv/la-liga-acp/dist/index.html && echo ok` lo comprueba).

#### 7. El primer administrador

No hay ninguno, y no se crea desde la app (BR-001). Pide la contraseña sin eco: por eso el `-it`.

```sh
docker compose -f compose.prod.yaml exec -it \
  -e ADMIN_EMAIL=admin@tu-dominio.example -e ADMIN_NOMBRE="Nombre Visible" \
  server node dist/cli/create-admin.js
```

Es **distinto del comando de desarrollo** (`npm run admin:create`), que usa `tsx` y `src/`: en la imagen de producción no existe ninguno de los dos. Ver [server/README.md](server/README.md#primer-administrador).

#### 8. Comprobar que quedó bien

```sh
curl -sI  https://DOMINIO.EJEMPLO/            | head -1   # 200
curl -sI  https://DOMINIO.EJEMPLO/posiciones  | head -1   # 200 (ruta de la SPA)
curl -sI  https://DOMINIO.EJEMPLO/no-existe   | head -1   # 404
curl -s   https://DOMINIO.EJEMPLO/api/health              # {"data":{"status":"ok",...}}
curl -sI  http://DOMINIO.EJEMPLO/             | head -1   # 301 a https
```

Y en el navegador: entrar con la cuenta de administrador. **Si el ingreso falla pero `/api/health` responde bien**, casi siempre es una de dos: el sitio se está sirviendo por HTTP (la cookie `__Host-` necesita HTTPS) o `CORS_ORIGIN` no coincide **exactamente** con el dominio que muestra el navegador.

**Para actualizar** (código nuevo): `git pull`; después `npm ci && npm run build` (el front, que reescribe `spa-routes.conf`); después `docker compose -f compose.prod.yaml up -d --build server`; y `sudo nginx -t && sudo systemctl reload nginx` solo si cambiaron las rutas de la SPA.

### Llevar los datos reales a producción

La base de producción arranca **vacía**: al crear el volumen se ejecutan `db/init/01-schema.sql` (el esquema) y `db/init/02-catalogos.sql` (los 9 catálogos). Los datos que ya están cargados en la base de desarrollo —**3 deportes, 3 competiciones, 15 equipos, 102 jugadores y 134 planteles**— se llevan con un volcado.

**Qué viaja y qué no.** Solo las cinco tablas con datos reales del Módulo Informativo: `deporte`, `competicion`, `equipo`, `jugador` y `plantel`, en ese orden, que es el de las claves foráneas. **No** viajan los catálogos (los carga `02-catalogos.sql`, y repetirlos rompe por `codigo` único) ni `usuario`, `sesion`, `auditoria`, `ticket`, `seleccion` o `movimiento_moneda`: llevar hashes de contraseña y sesiones de una base de desarrollo a un servidor real es justo lo que no hay que hacer. **El administrador de producción se crea allá**, con `create-admin` (paso 7). Las tablas de partidos (`partido`, `partido_equipo`, `gol`, `multimedia_partido`) están vacías en desarrollo, así que no hay nada que llevar.

**Los ids se conservan.** Las URLs de la app son `/plantilla/42`, o sea que el id es visible y estable, y `plantel` referencia equipos y jugadores por id. El volcado los trae explícitos.

#### Paso 1 — generar el volcado (en la máquina de desarrollo)

```sh
docker compose up -d db      # la base de DESARROLLO
npm run db:export-real       # escribe db/datos-reales.sql
```

Solo lee: lo único que corre contra MySQL son `mysqldump` y `SELECT COUNT(*)`. La base de desarrollo no se toca. La salida dice cuántas filas lleva cada tabla; tienen que ser 3, 3, 15, 102 y 134.

#### Paso 2 — copiarlo al servidor

```sh
scp db/datos-reales.sql usuario@DOMINIO.EJEMPLO:/srv/la-liga-acp/db/
```

#### Paso 3 — cargarlo en el contenedor de producción

Hay que entrar como **root de MySQL**, no con el usuario de la aplicación: `MYSQL_USER` solo tiene permisos sobre su propia base y no alcanza. La contraseña es `MYSQL_ROOT_PASSWORD` del `.env` del servidor.

```sh
cd /srv/la-liga-acp

# Las comillas SIMPLES son importantes: hacen que $MYSQL_ROOT_PASSWORD y
# $MYSQL_DATABASE se expandan DENTRO del contenedor, donde la imagen de MySQL
# ya los tiene definidos. Así la contraseña no pasa por la terminal del host ni
# queda en su historial, y la base es la que dice el .env sin escribirla a mano.
# -T porque el archivo entra por la entrada estándar y no hace falta terminal.
docker compose -f compose.prod.yaml exec -T db \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" --default-character-set=utf8mb4 "$MYSQL_DATABASE"' \
  < db/datos-reales.sql
```

> **No intentar que `mysql` pida la contraseña acá.** Con `-p` sin valor, y como la entrada estándar ya está ocupada por el volcado, `mysql` toma **la primera línea del archivo** como si fuera la contraseña y falla con `ERROR 1045 (28000): Access denied`. El mensaje culpa a la contraseña y no al método, así que es un callejón sin salida difícil de ver. Comprobado. Por eso el comando de arriba no la pide: la lee del entorno del propio contenedor.

**Qué tiene que salir.** El archivo imprime su propio control:

```text
control
Base vacía: se puede cargar
tabla        filas  esperadas
deporte      3      3
competicion  3      3
equipo       15     15
jugador      102    102
plantel      134    134
control
Verificación OK
resultado
Carga completa y verificada.
```

**Si algo sale mal**, `mysql` corta en el primer error y **nada queda a medias**: todo va dentro de una transacción que nunca llega al `COMMIT`.

| Error | Qué pasó | Qué hacer |
| :-- | :-- | :-- |
| `Table '...ABORTADO_la_base_ya_tiene_datos_informativos' doesn't exist` | Las tablas ya tenían filas. El archivo **no** insertó nada. | Mirar qué hay cargado antes de decidir. No se vuelve a correr "por las dudas". |
| `Table '...VERIFICACION_FALLIDA_los_conteos_no_coinciden' doesn't exist` | Entraron menos filas de las esperadas (archivo truncado en la copia). La transacción se deshizo: la base quedó **vacía**. | Copiar el archivo de nuevo y repetir. La tabla de conteos que se imprime arriba dice qué tabla falló. |
| Un error de clave foránea | El archivo llegó cortado. También se deshizo todo. | Igual que el anterior. |

**Se corre una sola vez.** El archivo **no es idempotente a propósito**: en lugar de `INSERT IGNORE` o `REPLACE`, lleva una barrera que aborta si las cinco tablas no están vacías. Es una carga inicial única sobre una base nueva; si ya hay algo, lo correcto es detenerse y mirar por qué, no mezclar en silencio con lo que hubiera. Correrlo dos veces falla limpio y **no duplica ni una fila**.

Después de cargar, el sitio ya muestra equipos y plantillas. Lo que falta cargar desde el panel son los **partidos**, que en desarrollo no existen.

### Qué está probado y qué no

**La pila de producción se ejecutó entera contra Docker real**, no solo se revisó. Esto es lo que se midió:

- **La imagen se construye en 15 s y no compila nada nativo.** `npm ci --omit=dev` baja binarios musl ya compilados: no aparece `node-gyp`, `make`, `g++` ni "building from source" en ninguna línea del build. La imagen final pesa **339 MB** con **117 paquetes**, contra 221 en la etapa de build. `argon2` y `sharp` se ejecutaron **dentro** de la imagen: hashea y verifica (`$argon2id`) y recodifica a webp (libvips 8.18.6).
- **La imagen lleva lo que dice y nada más:** sin `/app/src`, sin `tsx`, `nodemon`, `typescript` ni `vitest`; con `dist/index.js`, `dist/cli/create-admin.js` y `/app/package.json`. El proceso corre como `node` (uid 1000) y `/data/uploads` le es escribible.
- **La pila levanta:** `db` en estado *healthy* a los 5 s, `db/init/` ejecutado (24 tablas y catálogos), `GET /health` 200 con `version 0.1.0` —que es la prueba en vivo de que `package.json` resuelve desde `dist/services/`— y el healthcheck del contenedor en *healthy*.
- **La cookie de sesión real:** `Set-Cookie: __Host-liga_sid ... HttpOnly; Secure; SameSite=Strict`.
- **El administrador se creó con `node dist/cli/create-admin.js`** (variante `ADMIN_PASSWORD_STDIN`), sin `tsx`; después `login` 200 y `/admin/participantes` 200.
- **El volcado de datos de la sección anterior se cargó con el comando exacto del paso 3:** 3, 3, 15, 102, 134 y `Verificación OK`, comprobado además leyendo la API pública.
- **nginx (1.31.4) aceptó el archivo del proyecto:** `nginx -t` da *syntax is ok* y *test is successful*, **sin advertencias**. Los cinco `curl` del paso 8 dan lo prometido: portada 200, `/posiciones` 200, `/no-existe` 404, `/api/health` con su sobre y HTTP 301 con `Location` a https.
- **Las cabeceras se midieron**, no se razonaron: `/`, `/index.html`, `/404.html`, `/posiciones`, `/plantilla/42` y `/mis-apuestas` salen con `no-store`, HSTS y `nosniff`; `/assets/` es la **única** inmutable; `/api/health` conserva el `no-store` del backend y `/api/public/deportes` su `max-age=30`, o sea **nginx no pisa ninguno**; y `/api` pelado responde 308 a `/api/`.

**Lo que sigue sin probarse**, y por lo tanto es lo primero que puede fallar en el servidor:

- **`npm ci` y `npm run build` sobre Linux.** El front se compiló en Windows y dentro de una imagen, nunca en el Linux del servidor. Es el paso donde pega lo de la versión de Node.
- **`certbot`**, en cualquiera de sus dos variantes. Nunca se emitió un certificado.
- **El firewall** (`ufw` o el del proveedor) y la resolución DNS del dominio.
- **El despliegue sobre el hardware y el dominio reales**: todo lo de arriba corrió en contenedores de una máquina de desarrollo, con certificados y nombres de prueba.

> **El certificado va antes de activar el sitio.** Está comprobado que el bloque HTTPS **no arranca** si los archivos del certificado no existen: `nginx -t` corta con `emerg`. No es un defecto, es el orden — por eso el paso 5 va antes del 6.

### Por qué está armado así

- **`compose.prod.yaml` es un archivo aparte, no un override.** Compose fusiona las listas de `volumes` **agregando, nunca quitando**: un override no puede sacar el bind mount `./server:/app` ni el volumen anónimo de `node_modules` que `compose.yaml` necesita para desarrollar. Comprobado con `docker compose -f compose.yaml -f override.yaml config`. En producción eso taparía la imagen compilada con el código del host. Por eso se usa `-f compose.prod.yaml` y no `-f compose.yaml -f ...`.
- **El backend se publica solo en `127.0.0.1`** y **la base no se publica**. `compose.yaml` publica `3306` y `3001` en todas las interfaces, que en desarrollo es cómodo y en un servidor con IP pública dejaría **MySQL abierto a internet** y el backend accesible saltándose nginx (sin TLS y sin el límite de tamaño de subida).
- **`TRUST_PROXY=1`, no `loopback`.** Aunque nginx llegue a `127.0.0.1:3001`, el puerto se publica con NAT: el contenedor ve como origen la puerta de enlace del bridge de Docker (`172.x.x.x`), así que `loopback` no coincidiría, el backend ignoraría `X-Forwarded-For` y **todos los clientes compartirían los límites de intentos** (una persona equivocándose de contraseña dejaría fuera a las demás). Con `1`, la IP real es la última de `X-Forwarded-For`, la que pone nginx, y nadie puede falsearla porque el puerto solo escucha en el loopback del host. `true` lo rechaza `env.ts` a propósito.
- **La imagen de producción no lleva `tsx`.** `tsc -b` compila también `src/cli`, así que existen `dist/cli/create-admin.js`, `dist/cli/coins-check.js` y `dist/cli/seed-dev.js`, y esos comandos se corren con `node`. Solo importan módulos internos, `zod` y builtins de node, por eso la imagen puede ir con `npm ci --omit=dev`.
- **La imagen instala sus dependencias en la etapa final**, en vez de copiar `node_modules` de la de build: `argon2` y `sharp` son nativas, y así sus binarios se resuelven contra la imagen que realmente las va a ejecutar. La base es `node:22-alpine` (musl) porque es la misma que la de desarrollo, donde las dos vienen funcionando desde T-03 y T-13.
- **La imagen incluye `package.json`.** `services/health.service.ts` lee la versión con `require('../../package.json')`, que desde `dist/services/` resuelve a `/app/package.json`. Sin ese archivo, `GET /health` falla.
- **La configuración de nginx de la SPA se genera.** 21 rutas con y sin barra final son 42 URLs, y una lista así a mano se desincroniza a la primera. `vite-plugins/nginx-spa-routes.ts` la escribe desde `SPA_ROUTES` en cada build, igual que `spa-rewrites.ts` escribe `dist/_redirects`. Se escribe **fuera de `dist/`** a propósito: `dist/` es la raíz web, y un `.conf` ahí dentro se serviría a quien lo pidiera.
- **Y, a diferencia de `dist/_redirects`, `deploy/nginx/spa-routes.conf` sí se versiona.** Es deliberado, aunque sea un archivo generado. `_redirects` vive dentro de `dist/`, que está entero en `.gitignore` y lo produce el hosting al compilar; este lo lee **nginx del servidor**, y si falta, el `include` hace que **nginx no arranque**. Versionado, el archivo existe apenas se clona o se hace `git pull`, y el orden de los pasos deja de ser crítico; ignorado, bastaría con recargar nginx antes de compilar para tirar el sitio. El build lo reescribe igual en cada corrida, así que no puede quedar desactualizado: si alguien agrega una ruta y compila, el cambio aparece en el `git status` junto al resto.
- **Sin comodín `/*`.** Las rutas fijas son `location =` exactos y las que llevan `:id` son expresiones regulares de **un solo segmento** (`[^/]+`). Así `/plantilla/no-existe` da **200** y la app muestra su propia página de no encontrado, mientras que `/plantilla/a/b`, `/plantilla` y cualquier URL inventada dan **404** con `dist/404.html`, y los archivos reales se sirven tal cual.
- **Caché:** `dist/assets/` lleva hash en el nombre, así que va con `max-age=31536000, immutable`; **todo lo demás va con `no-store`**, porque cualquier ruta de la app devuelve el shell y un shell cacheado después de un despliegue apunta a archivos con hash que ya no existen (`vite build` vacía `dist/`), o sea la página queda rota hasta recargar a mano. La API queda afuera: el `Cache-Control` lo manda el backend (30 s en `/public`).
- **Las cabeceras se ponen una sola vez, con un `map`.** En nginx una cabecera agregada **no se hereda** en un bloque que tenga la suya, así que un `add_header Cache-Control` dentro de cada `location` cancelaría ahí mismo todas las del `server` —`Strict-Transport-Security` incluida— justo en las respuestas que más se piden. Por eso el archivo generado no lleva ninguna cabecera y el sitio las define para todas las respuestas. **Regla para quien edite el sitio: el bloque `location /api/` sí tiene cabeceras propias (a propósito, para no pisar el `Cache-Control` del backend), así que toda cabecera que se agregue al `server` hay que repetirla también ahí, o la API se queda sin ella.**
- **TLS y HSTS:** el ejemplo fija `ssl_protocols TLSv1.2 TLSv1.3` (si no, queda lo que traiga por defecto la versión de nginx instalada, que en las viejas incluye TLS 1.0 y 1.1) y manda `Strict-Transport-Security` con un año. **HSTS es difícil de revertir**: mientras no venza, los navegadores que ya lo recibieron se niegan a entrar por HTTP a ese dominio aunque el servidor lo vuelva a permitir, y no se puede borrar a distancia. Conviene probar primero con un `max-age` corto; va sin `preload` ni `includeSubDomains` a propósito.

### Cuidado con esto

- **`NODE_ENV=production` exige HTTPS.** El backend decide **solo por esa variable** si la cookie de sesión lleva `Secure` y el prefijo `__Host-`; no mira si hay TLS. Servir `production` por HTTP deja el sitio **sin poder iniciar sesión** (el navegador descarta la cookie), y servir `development` por HTTPS manda la cookie sin `Secure`. Por eso el sitio de nginx redirige HTTP a HTTPS.
- **La base real nunca puede llamarse `la_liga_acp_test`.** `MYSQL_DATABASE_TEST` vale `la_liga_acp_test` por defecto y el backend **no arranca** si coincide con `MYSQL_DATABASE`. En producción no hace falta definirla, pero sí evitar ese nombre para la base real.
- **No hay sistema de migraciones.** Los scripts de `db/init/` corren **una sola vez**, con el volumen de MySQL vacío. Con datos reales cargados, cambiar `01-schema.sql` no hace nada: hay que aplicar el cambio a mano con `ALTER TABLE` sobre la base en marcha (con respaldo antes) y dejar `01-schema.sql` y `EsquemaBD.md` en paso, para que una instalación nueva nazca igual. Borrar el volumen para "reaplicar el esquema" **borra los datos**. Respaldo antes de tocar nada:

  ```sh
  # Comillas simples: la contraseña y el nombre de la base se expanden DENTRO
  # del contenedor, no en la terminal del host (donde no están definidas y
  # además quedarían en el historial). -T por la redirección.
  docker compose -f compose.prod.yaml exec -T db \
    sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "$MYSQL_DATABASE"' \
    > respaldo.sql
  ```

- **Las imágenes subidas viven en un volumen** (`uploads-data`, montado en `/data/uploads`), no en el repo ni en `dist/`. No se pierden al recompilar ni al recrear el contenedor, pero **sí** con `docker compose -f compose.prod.yaml down -v`. Van en un respaldo aparte del `mysqldump`.
- **`npm audit` no corre solo:** conviene pasarlo en el front y en `server/` antes de cada despliegue.

## 🗄️ Base de datos y backend en DESARROLLO (Docker)

MySQL 8.4 con el esquema de [EsquemaBD.md](EsquemaBD.md), más la API de `server/`. Desde T-18 el frontend usa la API para las cuentas (registro, ingreso, sesión y monedas) y, desde T-22, también para la parte informativa: la portada, las posiciones y las plantillas leen la API pública (`/public/...`), sin sesión.

> **Todo lo de esta sección es de DESARROLLO.** Los `docker compose` de acá van sin `-f`, o sea usan `compose.yaml`: código montado desde el host, recarga en caliente y puertos publicados en todas las interfaces. Para el servidor, ver "Despliegue en servidor propio", que usa `-f compose.prod.yaml`. **`down -v` borra los datos**, así que hay que mirar dos veces contra qué compose se está corriendo.

**Levantar todo** (base de datos + backend, con recarga en caliente)

```sh
cp .env.example .env   # la primera vez; cambiar los passwords y SESSION_SECRET
docker compose up -d
docker compose ps      # esperar a que "db" diga (healthy)
curl http://localhost:3001/health
```

La primera vez, con el volumen de MySQL vacío, se ejecutan los scripts de `db/init/` en orden: `01-schema.sql` (todas las tablas) y `02-catalogos.sql` (catálogos). El backend espera a que `db` esté `healthy` antes de arrancar.

Para levantar solo la base (por ejemplo, para correr el backend fuera de Docker — ver [server/README.md](server/README.md)):

```sh
docker compose up -d db
```

**Datos de ejemplo (solo desarrollo, D-013 y D-016)**

La base de desarrollo empieza vacía. Para ver las pantallas con datos:

```sh
# bash
NODE_ENV=development npm run server:seed:dev -- --yes-dev-data         # carga (o recarga)
NODE_ENV=development npm run server:seed:dev:clean -- --yes-dev-data   # borra solo los datos de ejemplo

# PowerShell
$env:NODE_ENV='development'; npm run server:seed:dev -- --yes-dev-data

# dentro de Docker (el servicio ya tiene NODE_ENV=development)
docker compose exec server npm run seed:dev -- --yes-dev-data   # (y seed:dev:clean)
```

**Tres barreras** (D-016): si falta cualquiera, el comando no se conecta ni cambia nada.

1. `NODE_ENV=development` definida en el entorno del proceso. El valor por defecto no cuenta, y tampoco una línea en `.env`.
2. La base tiene que ser exactamente `DEV_SEED_DATABASE`, nunca una de pruebas (la de `MYSQL_DATABASE_TEST` o cualquier nombre con `test`). Además se comprueba en la conexión misma. **Viene desactivada**: en `.env.example` está comentada, así que hay que activarla a propósito en el `.env` del equipo de desarrollo (`DEV_SEED_DATABASE=la_liga_acp`, igual a `MYSQL_DATABASE`) y, para Docker, recrear el servicio (`docker compose up -d server`). Nunca se define en un servidor real.
3. La bandera `--yes-dev-data` en la línea de comandos.


- Carga 3 deportes ficticios (Fútbol con empate, Vóley y Básquet sin empate), sus competiciones, 8 equipos con 3 jugadores cada uno y 14 partidos en todos los estados de apuesta: disponibles, cerrados (a menos de 24 h), en curso, finalizados con resultado y cancelados (desde T-21, uno empezó hace 2 horas y espera que el admin confirme su resultado). Desde T-20 carga también 7 tickets con selecciones pendientes, acertadas, no acertadas y una anulada con su devolución (con los movimientos de monedas reales), y un ranking con empates: Ana y Carla comparten el primer puesto. Las fechas se calculan desde el momento en que se corre: si pasaron horas, conviene volver a correrlo.
- **Cuentas de ejemplo, solo para desarrollo** (nunca en otro ambiente):

  | Correo | Contraseña | Cuenta |
  | :-- | :-- | :-- |
  | `admin@demo.liga.test` | `demo-admin-2026` | administrador |
  | `ana@demo.liga.test` | `demo-ana-2026` | apostador validado, con tickets (6 monedas al cargar) |
  | `carla@demo.liga.test` | `demo-carla-2026` | apostador validado, con tickets (7 monedas al cargar) |
  | `beto@demo.liga.test` | `demo-beto-2026` | apostador pendiente |
  | `dani@`, `eva@`, `fede@`, `gabi@`, `hugo@`, `ines@`, `julio@`, `kari@demo.liga.test` | `demo-<nombre>-2026` (por ejemplo `demo-dani-2026`) | apostadores validados, para un ranking con empates (Dani y Eva con un ticket; el comando muestra el saldo de cada cuenta) |

- **Marcas, no nombres** (D-016): cada fila que crea queda anotada en la tabla `dato_demo` (tabla e id), que el propio comando crea solo en la base de desarrollo. La limpieza borra solo esas filas y lo que hicieron las cuentas de ejemplo (sus tickets, movimientos, sesiones y registros de auditoría, y los goles y la multimedia que cargó el admin de ejemplo). Un deporte con slug `demo-...`, un jugador con `(demo)` o una cuenta `@demo.liga.test` creados de verdad no se tocan.
- **Se niega sin borrar nada** si hay datos reales colgados de los de ejemplo: apuestas de otras cuentas, inscripciones, equipos, competiciones, partidos, goles o multimedia reales, o cualquier acción auditada de un administrador real sobre ellos (por ejemplo, un resultado cargado). Lista qué encontró.
- Correrlo dos veces reemplaza los datos de ejemplo por sus marcas, sin duplicar. Si ya existe una cuenta real con uno de esos correos, o un deporte real con uno de esos slugs, se niega.
- Los escudos de ejemplo usan el logo del sitio (`favicon.png`): no hay archivos ni hosts externos.

**Cuentas y primer administrador**

La API ya tiene registro, login y roles (`/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout`), con sesión en cookie y protección CSRF. Todo registro crea un usuario común y pendiente.

**La contraseña es de 6 a 20 caracteres, y nada más** (BR-003): no se exigen mayúsculas, números ni símbolos, y los espacios, los acentos y los emoji se pueden usar y cuentan como caracteres (algunos emoji compuestos, como una familia o una bandera, cuentan más de uno). Vale igual para el administrador que se crea desde el servidor. **Al ingresar no se aplica ese límite** (D-024): una cuenta creada antes del cambio, con una contraseña más larga, sigue entrando.

El panel no cambia roles: el primer administrador se crea (o una cuenta existente se promueve) desde el servidor. El comando pide la contraseña sin mostrarla:

```sh
docker compose exec -it -e ADMIN_EMAIL=ana@liga.test -e ADMIN_NOMBRE=Ana server npm run admin:create
```

No escribas la contraseña en el comando (`ADMIN_PASSWORD=...` o `-e ADMIN_PASSWORD=...`): queda en el historial de la terminal y, con `docker compose exec -e`, a la vista de cualquier proceso del equipo mientras corre. Para scripts y CI hay `ADMIN_PASSWORD_FILE` y `ADMIN_PASSWORD_STDIN`; `ADMIN_PASSWORD` solo sirve cuando la carga la plataforma de CI desde sus secretos.

Detalles y decisiones en [server/README.md](server/README.md#autenticación-y-roles-t-03).

**Conectarse a MySQL**

- Desde el host: `127.0.0.1`, puerto `MYSQL_PORT` (3306 por defecto), base `MYSQL_DATABASE`, usuario `MYSQL_USER` / `MYSQL_PASSWORD`.
- Desde el contenedor: `docker compose exec db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`
- **El usuario de la aplicación solo tiene permisos sobre `MYSQL_DATABASE`.** La imagen de MySQL se los da únicamente sobre esa base, así que crear otra (una base propia para probar, o la de pruebas de `MYSQL_DATABASE_TEST`) falla con ese usuario: hay que hacerlo como `root` y darle los permisos a mano.

  ```sh
  docker compose exec db sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "
    CREATE DATABASE IF NOT EXISTS mi_base CHARACTER SET utf8mb4;
    GRANT ALL PRIVILEGES ON mi_base.* TO \"$MYSQL_USER\"@\"%\";
    FLUSH PRIVILEGES;"'
  ```

  Por eso la suite del backend crea y migra su base con `root` (`server/tests/global-setup.ts`) y no con el usuario de la aplicación.

**Resetear** (borra todos los datos de MySQL y vuelve a ejecutar los scripts de `db/init/`)

```sh
docker compose down -v
docker compose up -d
```

Los scripts de `db/init/` solo corren con el volumen vacío: si los cambias, hay que resetear. T-03 agregó la tabla `sesion` (con su índice sobre `expira_en`): un volumen creado antes no la tiene, así que el backend falla al iniciar sesión hasta que resetees. `down -v` también borra el volumen anónimo de `node_modules` del servicio `server`; no hay que hacer nada, porque el siguiente `up` lo vuelve a llenar con las dependencias de la imagen. El backend no tiene otros datos propios que se pierdan.

## ⚠️ Limitaciones conocidas

Lo que conviene saber antes de usarlo o desplegarlo. El detalle, y todo lo demás que quedó abierto, está en [docs/pendientes.md](docs/pendientes.md).

- **Las pantallas públicas van hasta 30 segundos atrás** de lo que acaba de cargar el administrador: la API pública responde `Cache-Control: public, max-age=30` (ver arriba). El panel siempre ve el dato nuevo.
- **Las estadísticas del radar del jugador son de muestra** (D-022): se generan a partir del id real del jugador y ninguna regla de negocio las define. La ficha lo dice en pantalla, igual que la ubicación en la cancha.
- **El escudo del equipo y la foto del jugador se cargan como URL o ruta**, no como archivo subido: el servidor nunca las descarga, y el front solo las muestra con `<img>`. Migrarlas a la subida de T-13 es una tarea propia.
- **El ranking suma todas las apuestas en cada consulta** (unos 25 ms con 30 000 selecciones). Si la polla crece mucho, conviene cachearlo o guardar un resumen por usuario.
- **Los administradores no participan en la polla** (BR-001): no se validan, no tienen monedas y no aparecen en el ranking ni en las estadísticas. Un administrador se crea solo desde el servidor: en desarrollo con `npm run server:admin:create`, y en producción con `node dist/cli/create-admin.js` dentro del contenedor (la imagen de producción no tiene `tsx` ni `src/`; ver el paso 7 del despliegue).
- **Un partido que ya empezó puede seguir guardado como `programado`**: el estado "en curso" se calcula al leer. Cualquier consulta hecha directo contra la base debe aplicar la misma regla.
- **`npm audit` no corre solo.** Hoy da 0 vulnerabilidades en el front y en `server/`; conviene repetirlo antes de cada despliegue.

## 👀 Documentación

- [Vite](https://vite.dev/guide/)
- [React](https://react.dev/)
- [React Router (data mode)](https://reactrouter.com/start/data/routing)
- [Express](https://expressjs.com/en/5x/api.html) — backend, ver [server/README.md](server/README.md)
