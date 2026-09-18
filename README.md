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
│   └── spa-rewrites.ts     # genera dist/_redirects (Netlify, Cloudflare Pages)
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

Se publica la carpeta `dist/` en cualquier hosting estático. Como es una SPA, el servidor tiene que responder la app en sus rutas. Todavía no hay hosting elegido; el build deja lista la configuración para los habituales.

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

## 🗄️ Base de datos y backend (Docker)

MySQL 8.4 con el esquema de [EsquemaBD.md](EsquemaBD.md), más la API de `server/`. Desde T-18 el frontend usa la API para las cuentas (registro, ingreso, sesión y monedas) y, desde T-22, también para la parte informativa: la portada, las posiciones y las plantillas leen la API pública (`/public/...`), sin sesión.

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

La API ya tiene registro, login y roles (`/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout`), con sesión en cookie y protección CSRF. Todo registro crea un usuario común y pendiente. El panel no cambia roles: el primer administrador se crea (o una cuenta existente se promueve) desde el servidor. El comando pide la contraseña sin mostrarla:

```sh
docker compose exec -it -e ADMIN_EMAIL=ana@liga.test -e ADMIN_NOMBRE=Ana server npm run admin:create
```

No escribas la contraseña en el comando (`ADMIN_PASSWORD=...` o `-e ADMIN_PASSWORD=...`): queda en el historial de la terminal y, con `docker compose exec -e`, a la vista de cualquier proceso del equipo mientras corre. Para scripts y CI hay `ADMIN_PASSWORD_FILE` y `ADMIN_PASSWORD_STDIN`; `ADMIN_PASSWORD` solo sirve cuando la carga la plataforma de CI desde sus secretos.

Detalles y decisiones en [server/README.md](server/README.md#autenticación-y-roles-t-03).

**Conectarse a MySQL**

- Desde el host: `127.0.0.1`, puerto `MYSQL_PORT` (3306 por defecto), base `MYSQL_DATABASE`, usuario `MYSQL_USER` / `MYSQL_PASSWORD`.
- Desde el contenedor: `docker compose exec db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`

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
- **Los administradores no participan en la polla** (BR-001): no se validan, no tienen monedas y no aparecen en el ranking ni en las estadísticas. Un administrador se crea solo con `npm run server:admin:create`.
- **Un partido que ya empezó puede seguir guardado como `programado`**: el estado "en curso" se calcula al leer. Cualquier consulta hecha directo contra la base debe aplicar la misma regla.
- **`npm audit` no corre solo.** Hoy da 0 vulnerabilidades en el front y en `server/`; conviene repetirlo antes de cada despliegue.

## 👀 Documentación

- [Vite](https://vite.dev/guide/)
- [React](https://react.dev/)
- [React Router (data mode)](https://reactrouter.com/start/data/routing)
- [Express](https://expressjs.com/en/5x/api.html) — backend, ver [server/README.md](server/README.md)
