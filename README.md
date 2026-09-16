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
│   ├── App.tsx             # rutas (/, /posiciones, /plantilla/:id, 404)
│   ├── layouts/Base.tsx    # fondo, navbar y <main>
│   ├── pages/              # Home, Posiciones, Plantilla, NotFound (+ .module.css)
│   ├── components/         # Navbar, Hero, Carousel, Fixture, MatchCard, SquadBoard, PlayerStatsDialog, PixelImage
│   ├── hooks/              # título por página y manejo del scroll
│   ├── lib/                # capa de acceso a datos (async)
│   ├── data/               # datos estáticos
│   ├── types/              # contratos de las entidades
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
| `npm run server:install` | Instala las dependencias del backend (`server/`)        |
| `npm run server:dev` | Backend en modo desarrollo (fuera de Docker), `localhost:3001` |
| `npm run server:test` | Corre las pruebas del backend (necesita `docker compose up -d db`) |
| `npm run server:typecheck` | Revisa los tipos del backend y de sus pruebas |
| `npm run server:admin:create` | Crea o promueve un administrador; pide la contraseña (ver abajo) |

`npm run dev` y `npm run preview` sirven cualquier ruta, con o sin barra final (`/posiciones/`, `/plantilla/boca-juniors/`), con 200.

Los `server:*` son atajos (`npm --prefix server run ...`); ver [server/README.md](server/README.md) para el resto de sus comandos.

## 🌐 Despliegue

Se publica la carpeta `dist/` en cualquier hosting estático. Como es una SPA, el servidor tiene que responder la app en sus rutas. Todavía no hay hosting elegido; el build deja lista la configuración para los habituales.

**Rutas que se reescriben** (cada una con y sin barra final): `/posiciones` y `/plantilla/:id`, donde `:id` es **un solo segmento**. `/` no necesita regla. No hay comodín `/*`: los archivos reales (`assets/`, `favicon.png`, `cursors/`) se sirven tal cual y las URLs que no existen conservan el 404.

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
- **Qué está probado:** Cloudflare Pages con `npx wrangler pages dev dist`. Acepta las 4 reglas sin avisos; las rutas de la app, con y sin barra final, dan 200; `/plantilla/a/b`, `/plantilla` y `/cualquier/cosa` dan 404 con la app; los archivos reales dan 200. Netlify y Vercel no se probaron en un despliegue: su configuración sigue la documentación de cada uno (placeholders de un segmento, prioridad de los archivos reales sobre las reescrituras).

## 🗄️ Base de datos y backend (Docker)

MySQL 8.4 con el esquema de [EsquemaBD.md](EsquemaBD.md), más la API de `server/`. El frontend **todavía no consume la API**: el sitio sigue leyendo datos estáticos (eso llega en T-22 del [plan de la polla](docs/plan-polla.md)).

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

## 👀 Documentación

- [Vite](https://vite.dev/guide/)
- [React](https://react.dev/)
- [React Router (data mode)](https://reactrouter.com/start/data/routing)
- [Express](https://expressjs.com/en/5x/api.html) — backend, ver [server/README.md](server/README.md)
