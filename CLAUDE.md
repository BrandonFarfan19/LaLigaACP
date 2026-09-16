## Project

**La Liga ACP** — a sports tournament web app (fixtures, standings, teams, players, match results).
In addition a betting platform.

### Mobile first

Design and build every screen for phone widths first (~390px), then scale up with min-width media queries. Touch targets at minimum 44px. Never ship a layout that only works on desktop and gets squeezed down.

### Visual style: pixel art, 90s video game

**The entire UI is pixel art — fonts, chrome, artwork, motion.** Nothing on screen may look like a modern web app. This rule overrides every other aesthetic preference; if a technique is not achievable in a 16-bit sprite, it does not go in.

**Typography**

- Pixel/bitmap faces only, self-hosted through `@fontsource` — never a CDN link. `Press Start 2P` for display (headings, names, scores, nav), `Silkscreen` for body and labels. Both are set as `--font-display` / `--font-body`.
- Font sizes come from the `--text-*` tokens and are **whole multiples of 8px**. A bitmap glyph at 13.5px lands between physical pixels and turns to mush.
- **Never synthesise weight or style.** Press Start 2P ships one weight: use `font-weight: 400`. No `700`/`800`, no italic, no `letter-spacing` in `em`.
- `-webkit-font-smoothing: none` stays on `body`. Antialiasing is what makes a pixel font look like a blurry web font instead of a sprite.

**Chrome and shape**

- **No `border-radius`. No blurred shadows. No `backdrop-filter`. No smooth gradients.** These are the four tells of a modern UI.
- Borders, bevels and shadows are built from hard offsets in multiples of `--px` (one "fat pixel"). Use the `.pixel-box`, `.pixel-bevel` and `.pixel-shadow` primitives in `global.css`.
- Gradients must be **banded**: hard color stops that step, imitating dithering. A continuous gradient is not allowed.
- Spacing sits on a strict 8px grid via the `--space-*` tokens.

**Color**

- A small, fixed palette, like a console with limited colors. Adding a color is a deliberate decision — extend the tokens in `global.css`, never hardcode a hex in a component.

**Artwork**

- Logos and crests are rendered small through `<PixelImage />` (32–96px) and upscaled by CSS with `image-rendering: pixelated` (the `.pixelated` class). This turns smooth artwork into real pixel art instead of a soft enlargement. Never render them at full size.

**Motion**

- Transitions and animations use `steps()`, never `ease`/`linear`. Movement snaps between frames the way sprite animation does.
- Every animation must be disabled under `prefers-reduced-motion: reduce`.

### Data: static now, backend-ready later

The frontend reads **static hardcoded data for now** — the backend in `server/` exists but the UI doesn't call it yet. Write it so the real API can replace the static source **without rewriting the UI**. Rules:

- **One data-access layer.** All reads go through functions in `src/lib/` (`getTeams()`, `getTeamById(id)`, `getFixtures()`, `getStandings()`). Pages and components call these functions — they never import the raw data files directly.
- **Async from day one.** Those functions return Promises even while reading local data, so swapping the body for a `fetch()` or a DB query changes nothing at the call sites.
- **Typed entities that mirror future tables.** Define `Team`, `Player`, `Match`, `Standing` etc. as TypeScript interfaces in `src/types/`. These are the contract the backend will have to honor.
- **Relations by id, not by nesting.** A `Match` holds `homeTeamId` / `awayTeamId`, not embedded team objects — the same shape a database returns. Resolve relations in the data layer.
- **Stable, unique ids** on every entity. Never key off array index or display name.
- **No hardcoded data inside components or pages.** Static data lives in `src/data/`, never inline in JSX.
- **Pages read in their route `loader`**, which calls `src/lib/` and hands the result to the page with `useLoaderData()`. Components receive data as props; they never fetch on their own. A route renders complete, so anchors like `/#fixture` exist when scrolling runs.
- Keep the output a static SPA for now (`vite build` to `dist/`). Pointing `src/lib/` at a real API later changes only those function bodies.

**Player stats are placeholder, random data.** Every other dataset is meant to become real data from the backend. The attribute ratings (`PlayerStats`: shooting, passing, strength, defense, speed, dribbling) are different: they are generated in `src/data/player-stats.ts`, each a random whole number from 70 to 90, so every player's average also falls between 70 and 90. The generator is seeded by the player id, so the numbers stay the same across builds instead of reshuffling on every deploy. They still follow the data rules above: read only through `getPlayerStatsByTeamId()`, keyed by `playerId`, so real ratings can replace them without touching the UI. They are shown as a pixel-art radar (`PlayerStatsDialog.tsx`, drawn by `src/utils/pixel-radar.ts`) plus a table, opened by clicking a player's name on `/plantilla/:id`.

### Database design (local DB built, frontend not connected)

This section summarizes the target schema. Full detail (every column, constraint and the ER diagram) lives in [EsquemaBD.md](EsquemaBD.md), in Spanish. The schema now models the betting pool from `docs/business-rules.md` (see **Betting platform** below) — `disciplina`/`mercado`/`apuesta` are gone, replaced by `deporte`/`competicion` and `ticket`/`seleccion`.

- **A local MySQL 8.4 runs in Docker** (`compose.yaml`, credentials in `.env`, see `.env.example`). `db/init/01-schema.sql` creates every table and `db/init/02-catalogos.sql` loads only the catalog rows. Setup, connection and reset steps are in the README.
- **The frontend is not connected to it.** `src/lib/` stays static and the site stays a static SPA until T-22 of `docs/plan-polla.md`. Do not wire `src/lib/` to the API, or seed teams/players/matches, unless explicitly asked.
- **The backend (`server/`) is an Express app, and must stay one.** No other framework (Fastify, Nest, Koa, Next API routes…). It already connects to this database through `mysql2` (see **Backend stack** below) — but, as of T-02, only for `GET /health`; there is no business logic yet.
- `EsquemaBD.md` and `db/init/01-schema.sql` must stay in sync: a schema change updates both in the same change.

- Treat it as the source of truth when adding or changing entities in `src/types/` or `src/data/`, so the static layer keeps converging on the future tables.
- Where the current types differ from the schema (e.g. `Match.homeTeamId`/`awayTeamId` vs. the `partido_equipo` rows), the data layer does the translation. The UI does not change.
- If a change contradicts the schema, update both this section and `EsquemaBD.md` in the same change.

**Engine and conventions**

- **MySQL 8** (≥ 8.0.16 so `CHECK` is enforced), InnoDB, `utf8mb4`.
- Table and column names are `snake_case` Spanish (`partido_equipo`, `es_visita`). TypeScript stays camelCase; the data layer maps between them.
- **Vocabulary:** the tournament uses **puntos** (standings, informational). The pool uses **monedas** (what a user spends to bet, earns on validation) and, separately, its own **puntos** (BR-039: never the same thing as coins). Never mix the terms.
- Ids: `BIGINT UNSIGNED AUTO_INCREMENT`. Dates: `DATETIME`, always UTC (MySQL stores no zone), no `DEFAULT CURRENT_TIMESTAMP` — the backend sets it explicitly. Pool coins and points: whole integers (`SMALLINT UNSIGNED`/`SMALLINT`), never `DECIMAL`/`FLOAT` — the old anticipation-based fractional bonus is gone.
- Catalog tables have a stable unique `codigo`. Logic matches on `codigo`, never on the numeric id.
- **Computed, never stored:** standings, top scorers, a match's general result, the pool ranking, bet closing time. The one deliberate exception is `usuario.saldo_monedas` (must never go negative, and MySQL can't `CHECK` against another table's sum) — kept in sync with `movimiento_moneda` by the backend, in the same transaction.
- **Business rules that matter never live only in the frontend** (project-wide rule for the betting platform).

**Modules.** Informativo must never depend on Polla or Auditoría.

| Module | Tables |
|---|---|
| Acceso | `rol`, `estado_usuario`, `estado_pago`, `usuario` |
| Informativo | `deporte`, `competicion`, `equipo`, `jugador`, `plantel`, `estado_partido`, `partido`, `partido_equipo`, `gol` |
| Polla | `tipo_apuesta`, `resultado_general`, `estado_seleccion`, `ticket`, `seleccion`, `tipo_movimiento`, `movimiento_moneda` |
| Auditoría | `accion_auditoria`, `auditoria` |

**Tables at a glance**

- `rol` (codigo: `apostador` = BR-002's "Usuario", `admin`) → `usuario` (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, saldo_monedas, creado_en). One role per user; `admin` includes betting. A user is not a player. `estado_usuario`: `pendiente`/`validado` (BR-005). `estado_pago`: `pendiente`/`confirmado` (BR-006).
- `deporte` (nombre, slug, permite_empate) and `competicion` (deporte_id, nombre, slug) — BR-011 splits these; a competición is one standalone tournament, no seasons.
- `equipo` (competicion_id, nombre, nombre_corto, escudo, color_acento). A team belongs to exactly one competición.
- `jugador` is the person. `plantel` (jugador_id, equipo_id, competicion_id, numero_camiseta) enrolls that person in a team. `UNIQUE(jugador_id, competicion_id)` means one team per competición and no mid-tournament transfers.
- `partido` (competicion_id, estado_partido_id, jornada, fecha_hora, sede). States: `programado`, `en_curso`, `finalizado`, `cancelado` (BR-012). "Deporte" (BR-011) comes via `JOIN` through `competicion`, never duplicated. Goals and the general result are never columns here (see `partido_equipo` and Business rules).
- `partido_equipo` (partido_id, equipo_id, es_visita, goles) holds **exactly two rows per match**, local (`es_visita = false`) and away. Goals are entered by hand by an admin (BR-028), locked once the match is `finalizado`.
- `gol` (partido_equipo_id, plantel_id, equipo_id, minuto, imagen?, video?) — a goal's scorer, team and minute, with optional media (BR-033). Replaces the old generic `partido_jugador`/`estadistica_tipo`/`partido_jugador_estadistica`, which no BR needs (the frontend's player radar stats are unrelated random data, see above).
- `tipo_apuesta` (codigo: `resultado_general`, `marcador_exacto` — BR-015/BR-016). `resultado_general` catalog (codigo: `local_gana`, `empate`, `visitante_gana` — BR-029) is reused both as a `seleccion`'s pronóstico and as a match's derived result.
- `ticket` (usuario_id, creado_en) groups one or more `seleccion` rows (BR-019). Coins used and points are always computed from its selections, never stored on the ticket.
- `seleccion` (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id?, pronostico_goles_local?, pronostico_goles_visitante?, estado_seleccion_id, puntos_obtenidos?) is one individual bet. `CHECK` enforces exactly one pronóstico shape is filled; matching it to `tipo_apuesta` by `codigo` is backend logic. States: `pendiente`, `acertada`, `no_acertada`, `anulada` (BR-027). Several selections per match and per ticket, even contradictory ones, are allowed (BR-017/BR-018) — no uniqueness constraint groups them. The 1-coin cost per selection (BR-020) is a backend constant, never a column.
- `tipo_movimiento` (codigo: `validacion` +10, `seleccion_confirmada` −1, `devolucion_cancelacion` +1 — the only tabla-28 events that move coins) → `movimiento_moneda` (usuario_id, tipo_movimiento_id, seleccion_id?, cantidad con signo, creado_en). `UNIQUE(seleccion_id, tipo_movimiento_id)` stops the same selection from being processed twice under the same movement type.
- `accion_auditoria` (codigo, nombre, entidad — the table each code affects) → `auditoria` (usuario_id = admin, accion_id, entidad_id, creado_en). `entidad_id` has **no FK** (it points at different tables depending on `accion_id`, and MySQL can't express a conditional FK) — the backend owns that integrity.
- Composite FKs over `(id, competicion_id)` and `(id, equipo_id)` guarantee teams, matches, players and goals share a competición. See `EsquemaBD.md`.

**Business rules (backend)**

- Standings **puntos** (informational, per competición): win **3**, draw **1**, loss **0**. Unrelated to the pool's own points.
- The pool: monedas fund bets (BR-008 to BR-010), puntos measure performance (BR-039) — never convert one into the other.
- A `seleccion` closes **24 h before** `partido.fecha_hora`, and only while the match is `programado` (BR-014).
- Points per selection, evaluated independently when the match's result is confirmed (BR-034 to BR-038):

  | Bet type | Condition | Points |
  |---|---|---|
  | `resultado_general` | Correct winner | +3 |
  | `resultado_general` | Correct draw | +1 |
  | `marcador_exacto` | Correct exact score | +3 |
  | Either | Wrong | 0 |

- Confirming a result (admin action) moves the match to `finalizado`: that transition **is** the lock (BR-031/BR-032) — goals and state become immutable in the app from then on, no separate "confirmed" column. The system then settles every `seleccion` for that match per the table above.
- Cancelling a match (`cancelado`) voids every one of its selections (`anulada`) and refunds 1 coin each via a `devolucion_cancelacion` movement, updating the balance in the same transaction (BR-045 to BR-047, BR-055). Other selections in the same ticket, from other matches, are untouched.
- Validating a user (`estado_usuario → validado`) grants +10 coins exactly once — enforced by only allowing the transition from `pendiente`, not by a table constraint (BR-006 to BR-008).
- Pool ranking: `SUM(seleccion.puntos_obtenidos)` per user, ordered by `puntos DESC, aciertos DESC`; a full tie shares position (BR-041 to BR-044, left open by BR-043).
- **Resolved:** `resultado_general`'s "empate" is gated by `deporte.permite_empate` (BR-015, confirmed) — not enforced by the schema itself, applied in backend logic when betting rules are built (T-09). BR-007's admin table shows only `estado_pago` and `estado_usuario`, no separate "Estado" column.
- **Still open, listed in `EsquemaBD.md`:** whether `ticket`'s idempotency key (BR-054) belongs on the table at all — deferred to the task that builds ticket confirmation.

### Change history

[historial.md](historial.md) (in Spanish) is the log of **tested and reviewed changes**. A change is recorded only after `tester_liga` has verified the work of `ejecutor_liga` and approved it. Each entry states the date, what changed, the files and how it was verified.

- Read it to learn which changes are already verified before building on them.
- Only `tester_liga` appends entries, at the end of the file. Never rewrite or delete past entries.

### Backlog

[docs/pendientes.md](docs/pendientes.md) (in Spanish) lists known issues **deliberately postponed**: Astro-parity gaps left by the React migration, pixel-art rules the CSS still breaks, doc cleanup and open schema decisions.

- Nothing there is in progress. Work on an item only when asked for it.
- Add an item when something is found and postponed; tick it off when it ships, and record the change in `historial.md`.

### Assets

Team crests and logos live in `src/assets/` and are imported with a rendition preset, `?pixel=<preset>` (e.g. `import crest from '../assets/boca.avif?pixel=crest'`), then rendered through `<PixelImage />` — not referenced from `public/`.

- `vite-plugins/pixel-images.ts` builds small webp renditions with sharp, byte-identical to what `astro:assets` produced. Presets live in `vite.config.ts`; each spec is a width (`"96"`), a crop (`"32x32"`) or a density of either (`"96@2"`).
- `<PixelImage image width height? densities? />` picks the 1x rendition, adds the `srcset`, and sets `width`/`height` from the real file. Asking for a size that isn't in the preset throws: add it to the preset instead of loading the original.
- Declare every new preset in `src/vite-env.d.ts` so the import is typed.

## Stack

- **Vite + React + TypeScript**, React Router in data mode (`createBrowserRouter` in `src/App.tsx`). Entry: `index.html` → `src/main.tsx`.
- **Routes:** `/` (`src/pages/Home.tsx`), `/posiciones` (`Posiciones.tsx`), `/plantilla/:id` (`Plantilla.tsx`). An unknown team id throws a 404 from the loader; unknown URLs hit the `*` route. Both render `NotFound.tsx` inside the layout.
- **Layout:** `src/layouts/Base.tsx` (backdrop, navbar, `<main>`). The `<head>` lives in `index.html`; each page sets its title with `useDocumentTitle()`.
- **Styles:** `src/styles/global.css` is imported first in `main.tsx`. Each component has a `Component.module.css` next to it. Global primitives (`pixel-box`, `pixel-bevel`, `pixel-shadow`, `pixelated`) are plain class names; everything else goes through the module.
- **Scrolling:** `useScrollManagement()` (in the layout) keeps multi-page behavior: a new route starts at the top or at its `#anchor` instantly, a same-page anchor scrolls with the CSS behavior, and Back/Forward and reload restore the offset.
- **Static hosting:** the app's deep routes (`SPA_ROUTES` in `vite.config.ts`: `/posiciones`, `/plantilla/:id`, each with and without a trailing slash, `:id` = one path segment) are rewritten with 200. There is never a `/*` catch-all, so real files keep their response and unknown URLs get 404.
  - `vite-plugins/spa-rewrites.ts` generates `dist/_redirects` at build time. The target is `/` (Cloudflare Pages rejects `/index.html` as an infinite loop) unless the build runs on Netlify (`NETLIFY=true`), which gets its documented `/index.html`. Don't add a static `public/_redirects`.
  - `vercel.json` holds the same rewrites for Vercel. The build fails if it doesn't match `SPA_ROUTES`. **Adding a route in `src/App.tsx` means adding it to `SPA_ROUTES` and `vercel.json`.**
  - `vite build` also writes `dist/404.html` (a copy of `index.html`): the body hosts send for unknown URLs, and the only fallback on hosts without rewrites, where deep links render but return 404.
  - Verify Cloudflare behavior with `npx wrangler pages dev dist` (no invalid-rule warnings). `vite dev` and `vite preview` serve deep links, with or without a trailing slash, with 200. Details in the README's deployment section.

## Backend stack

- **Express 5 + TypeScript**, its own `server/` project with its own `package.json` — not an npm workspace, see `server/README.md` for why. Layers: `routes` (URL + verb only) → `controllers` (HTTP shaping) → `services` (business logic + data access) → `db/pool.ts` (mysql2/promise pool). The `pool` is threaded down as a parameter from `app.ts`, never a module-level singleton — that's what lets tests inject their own (including one pointed at an unreachable host, to exercise failure paths for real).
- **Config:** `server/src/config/env.ts` validates every environment variable with `zod` at import time; the process refuses to start (naming every bad/missing variable) rather than run half-configured. Nothing else reads `process.env` directly. Reuses the root `.env`/`.env.example` (same file `compose.yaml` uses for `db`) — see it for the full variable list, including `DB_HOST`/`DB_PORT` (differ between bare local dev and the `server` compose service) and `MYSQL_DATABASE_TEST`.
- **Response envelope:** every response is `{ data }` or `{ error: { code, message, details? } }` — success and error alike, including `404`s and validation failures. Controllers/services `throw new HttpError(...)` (`server/src/lib/http-error.ts`) or let a `ZodError` propagate; Express 5 forwards a rejected async handler to the error middleware automatically, no manual `try/catch`/`next(err)`. Unexpected errors always log the real cause server-side and return a generic `INTERNAL_ERROR` — never a stack trace or driver message to the client.
- **`GET /health`** checks the database live (with one retry) on every call — it does **not** gate process startup; the app comes up even with the database down, so `/health` itself can report that clearly (`503 DATABASE_UNAVAILABLE`) instead of the whole process being unreachable.
- **Security base (NFR-005):** `helmet()`, CORS locked to `CORS_ORIGIN` (no wildcard), a 100kb JSON body limit (no uploads yet — BR-033's goal media needs its own task), and a basic global rate limit, all wired in `server/src/middleware/security.ts`.
- **Tests:** Vitest + Supertest, against `MYSQL_DATABASE_TEST` — never the real database. `server/tests/global-setup.ts` recreates and migrates it from `db/init/` once per run (as `root`, since the app's own MySQL user only has grants on `MYSQL_DATABASE`), so it can't drift from the real schema. Test files run serially (`fileParallelism: false`): they share one database.
- **Docker dev reload:** the `server` compose service bind-mounts the source, but a Windows-host bind mount doesn't deliver the native filesystem events `tsx watch` needs. It runs `dev:docker` (`nodemon --legacy-watch`, polling-based) instead; bare local dev (`npm run dev` in `server/`, no mount involved) keeps the faster `tsx watch`. After adding a new dependency, if the container comes up with `<package>: not found`, the anonymous `node_modules` volume is stale — `docker compose up -d --force-recreate -V server` forces it to pick up the new image's install.

## Development

```
npm run dev             # Vite dev server, http://localhost:5173
npm run build           # tsc -b && vite build → dist/
npm run preview         # serve dist/ locally
npm run server:dev      # backend, http://localhost:3001 (needs `docker compose up -d db`)
npm run server:test     # backend test suite (Vitest + Supertest)
```

Start the dev server as a background process so it doesn't block the session, and stop it when done. `npm run build` must finish with no TypeScript errors or warnings. For the backend, `docker compose up -d` (from the repo root) runs both `db` and `server` together, with reload — see `server/README.md` for the full command reference and layer conventions.

## Documentation

- [Vite](https://vite.dev/guide/): config, static assets, CSS Modules, plugins, building for production.
- [React](https://react.dev/reference/react): components, hooks, `<dialog>` and form handling.
- [React Router, data mode](https://reactrouter.com/start/data/routing): routes, loaders, error boundaries, navigation.
- [sharp](https://sharp.pixelplumbing.com/api-resize): the resize options the pixel-images plugin mirrors.
- [Express 5](https://expressjs.com/en/5x/api.html): routing, error-handling middleware, async handler forwarding.
- [zod](https://zod.dev/): schema validation, used for both env config and (from T-03 on) request validation.
- [mysql2](https://sidorares.github.io/node-mysql2/docs): promise pool, prepared statements.


## Betting platform
Construir una plataforma web de polla deportiva con autenticación, roles, monedas virtuales, apuestas, resultados, ranking y administración de partidos.

El agente debe leer antes de desarrollar:

@business-rules.md

### Reglas generales de trabajo para Betting platform

1. Implementar una tarea a la vez.
2. No avanzar a la siguiente tarea si la actual tiene errores.
3. Toda regla de negocio crítica debe validarse en backend.
4. No confiar únicamente en validaciones frontend.
5. Toda funcionalidad nueva debe incluir pruebas.
6. No modificar reglas de negocio sin actualizar `business-rules.md`.