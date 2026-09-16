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
- **The backend (`server/`) is an Express app, and must stay one.** No other framework (Fastify, Nest, Koa, Next API routes…). It already connects to this database through `mysql2` (see **Backend stack** below). As of T-04 it has `GET /health`, accounts (register, login, sessions, roles) and participant validation under `/admin/participantes`, plus the catalog, matches, the public API and (T-09) selection checks. No ticket is created yet (T-10).
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

**Modules.** Informativo must never depend on Polla or Auditoría. When an Informativo rule needs a Polla fact, Informativo declares an extension point (a function type) and the composition root (`server/src/routes/index.ts`) passes Polla's implementation in. Example: `DrawRuleGuard` in `services/sports.service.ts`, implemented by `services/bets-sport-guard.service.ts`.

| Module | Tables |
|---|---|
| Acceso | `rol`, `estado_usuario`, `estado_pago`, `usuario`, `sesion` |
| Informativo | `deporte`, `competicion`, `equipo`, `jugador`, `plantel`, `estado_partido`, `partido`, `partido_equipo`, `gol` |
| Polla | `tipo_apuesta`, `resultado_general`, `estado_seleccion`, `ticket`, `seleccion`, `tipo_movimiento`, `movimiento_moneda` |
| Auditoría | `accion_auditoria`, `auditoria` |

**Tables at a glance**

- `rol` (codigo: `apostador` = BR-002's "Usuario", `admin`) → `usuario` (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, saldo_monedas, creado_en). One role per user; roles do not include each other. **Admins never take part in the pool** (user decision, BR-001): they are not participants, never get payment confirmed, validated or coins, and never bet. A user is not a player. `estado_usuario`: `pendiente`/`validado` (BR-005). `estado_pago`: `pendiente`/`confirmado` (BR-006).
  - **Login is by email only**; there is no separate username (BR-003/BR-004 say "usuario o correo", and `business-rules.md` now says email). `email` is stored trimmed and lowercased; `nombre` is display-only and may repeat. `password_hash` is argon2id.
  - API registration always creates `apostador` + `pendiente` + pago `pendiente` + 0 coins. An `admin` only comes from the server-side `admin:create` command.
- `sesion` (usuario_id, token_hash, creado_en, expira_en, indexed) is one server-side login session (NFR-005). It stores only the SHA-256 of the cookie token, never the token. A session is live while `expira_en > now`, and logout deletes the row. `ON DELETE CASCADE` from `usuario`.
- `deporte` (nombre, slug, permite_empate) and `competicion` (deporte_id, nombre, slug) — BR-011 splits these; a competición is one standalone tournament, no seasons.
- `equipo` (competicion_id, nombre, nombre_corto, escudo, color_acento). A team belongs to exactly one competición.
- `jugador` is the person. `plantel` (jugador_id, equipo_id, competicion_id, numero_camiseta) enrolls that person in a team. `UNIQUE(jugador_id, competicion_id)` means one team per competición and no mid-tournament transfers.
- `partido` (competicion_id, estado_partido_id, jornada, fecha_hora, sede). States: `programado`, `en_curso`, `finalizado`, `cancelado` (BR-012). "Deporte" (BR-011) comes via `JOIN` through `competicion`, never duplicated. Goals and the general result are never columns here (see `partido_equipo` and Business rules).
- `partido_equipo` (partido_id, equipo_id, es_visita, goles) holds **exactly two rows per match**, local (`es_visita = false`) and away. Goals are entered by hand by an admin (BR-028), locked once the match is `finalizado`.
- `gol` (partido_equipo_id, plantel_id, equipo_id, minuto, imagen?, video?) — a goal's scorer, team and minute, with optional media (BR-033). Replaces the old generic `partido_jugador`/`estadistica_tipo`/`partido_jugador_estadistica`, which no BR needs (the frontend's player radar stats are unrelated random data, see above).
- `tipo_apuesta` (codigo: `resultado_general`, `marcador_exacto` — BR-015/BR-016). `resultado_general` catalog (codigo: `local_gana`, `empate`, `visitante_gana` — BR-029) is reused both as a `seleccion`'s pronóstico and as a match's derived result.
- `ticket` (usuario_id, creado_en) groups one or more `seleccion` rows (BR-019). Coins used and points are always computed from its selections, never stored on the ticket.
- `seleccion` (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id?, pronostico_goles_local?, pronostico_goles_visitante?, estado_seleccion_id, puntos_obtenidos?) is one individual bet. `CHECK` enforces exactly one pronóstico shape is filled; matching it to `tipo_apuesta` by `codigo` is backend logic. States: `pendiente`, `acertada`, `no_acertada`, `anulada` (BR-027). Several selections per match and per ticket, even contradictory ones, are allowed (BR-017/BR-018) — no uniqueness constraint groups them. The 1-coin cost per selection (BR-020) is a backend constant, never a column.
- `tipo_movimiento` (codigo: `validacion` +10, `seleccion_confirmada` −1, `devolucion_cancelacion` +1 — the only tabla-28 events that move coins) → `movimiento_moneda` (usuario_id, tipo_movimiento_id, seleccion_id?, cantidad con signo, creado_en). `UNIQUE(seleccion_id, tipo_movimiento_id)` stops the same selection from being processed twice under the same movement type. A generated column `sin_seleccion` (1 when `seleccion_id` is NULL) plus `UNIQUE(usuario_id, tipo_movimiento_id, sin_seleccion)` allows at most one selection-less movement per user and type, which makes the `validacion` +10 unique at the database level (BR-008, EsquemaBD D19). Revisit that index if a repeatable selection-less movement type is ever added.
- `accion_auditoria` (codigo, nombre, entidad — the table each code affects) → `auditoria` (usuario_id = admin, accion_id, entidad_id, creado_en). `entidad_id` has **no FK** (it points at different tables depending on `accion_id`, and MySQL can't express a conditional FK) — the backend owns that integrity.
- Composite FKs over `(id, competicion_id)` and `(id, equipo_id)` guarantee teams, matches, players and goals share a competición. See `EsquemaBD.md`.

**Business rules (backend)**

- Standings **puntos** (informational, per competición): win **3**, draw **1**, loss **0**. Unrelated to the pool's own points.
- The pool: monedas fund bets (BR-008 to BR-010), puntos measure performance (BR-039) — never convert one into the other.
- A `seleccion` closes **24 h before** `partido.fecha_hora`, and only while the match is `programado` (BR-014). A match created less than 24 h ahead is born closed.
- A match registered before it is played can get its result, goals and media **after** its date (user decision): T-12/T-13 must not require a future date.
- Points per selection, evaluated independently when the match's result is confirmed (BR-034 to BR-038):

  | Bet type | Condition | Points |
  |---|---|---|
  | `resultado_general` | Correct winner | +3 |
  | `resultado_general` | Correct draw | +1 |
  | `marcador_exacto` | Correct exact score | +3 |
  | Either | Wrong | 0 |

- Confirming a result (admin action) moves the match to `finalizado`: that transition **is** the lock (BR-031/BR-032) — goals and state become immutable in the app from then on, no separate "confirmed" column. The system then settles every `seleccion` for that match per the table above.
- Cancelling a match (`cancelado`) voids every one of its selections (`anulada`) and refunds 1 coin each via a `devolucion_cancelacion` movement, updating the balance in the same transaction (BR-045 to BR-047, BR-055). Other selections in the same ticket, from other matches, are untouched.
- Validating a user (`estado_usuario → validado`) grants +10 coins exactly once (BR-006 to BR-008). The backend allows only the transition from `pendiente` with payment `confirmado`, in a conditional UPDATE in the same transaction as the movement, and the database refuses a second `validacion` movement (D19). The amount lives only in `server/src/lib/coins.ts`.
- Participation flow (§23): confirm payment, then validate. A payment can be reverted only while the user is still `pendiente`. Validation is never reverted. These actions only apply to `apostador` accounts; on an admin account they return 404 `NOT_A_PARTICIPANT`. The participant table and counts show **only apostadores**.
- **Every pool query excludes admins** (`rol = 'apostador'`): participant table, counts, ranking (T-15), pool statistics and bet listings (T-21).
- Pool ranking: `SUM(seleccion.puntos_obtenidos)` per user, ordered by `puntos DESC, aciertos DESC`; a full tie shares position (BR-041 to BR-044, left open by BR-043).
- **Resolved:** `resultado_general`'s "empate" is gated by `deporte.permite_empate` (BR-015, confirmed) — not enforced by the schema itself, applied in backend logic when betting rules are built (T-09). BR-007's admin table shows only `estado_pago` and `estado_usuario`, no separate "Estado" column.
- **Still open, listed in `EsquemaBD.md`:** whether `ticket`'s idempotency key (BR-054) belongs on the table at all — deferred to the task that builds ticket confirmation.

### Change history

[historial.md](historial.md) (in Spanish) is the log of **tested and reviewed changes**. A change is recorded only after `tester_liga` has verified the work of `ejecutor_liga` and approved it. Each entry states the date, what changed, the files and how it was verified.

- Read it to learn which changes are already verified before building on them.
- Only `tester_liga` appends entries, at the end of the file. Never rewrite or delete past entries.
- **Report back to the coordinator (Herdr pane `w4:p1`) with `herdr agent prompt w4:p1 "<summary>"`**, no double quotes inside the text. `ejecutor_liga` reports when it finishes a task or a fix, or when it is blocked on a decision; `tester_liga` reports every verdict, pass or fail. The coordinator relies on these messages to hand work over.
- **Two testers work in parallel:** `tester_liga` (pane `w4:p3`) and `tester_liga_2` (pane `w4:p5`, its own tab). The coordinator may split one task between them; each verifies only its part, and only the one told to close the task ticks `docs/plan-polla.md` and writes `historial.md` (re-read both before writing). To avoid clashing:
  - Test database: `la_liga_acp_test` for `tester_liga`, `la_liga_acp_test_2` for `tester_liga_2` (set as `MYSQL_DATABASE_TEST` in its tab's environment; never change it).
  - Local backend instances: ports 3950–3999 for `tester_liga`, 3900–3949 for `tester_liga_2`. Never 3001 or 5173.
  - Never run `docker compose down -v`, or stop/recreate `db` or `server`, unless the coordinator explicitly asks. To test a database outage, point a local instance at a closed port.
  - Test data in the development database carries a per-tester prefix (`t1_`, `t2_`); each tester deletes only its own.
- **Context near capacity:** before the coordinator sends a new instruction to any pane, it checks that agent's context. If it is near capacity (≥ 80% of the window, or Claude Code shows "% until auto-compact"), the coordinator runs `/clear` on that pane (never mid-task), re-sends the agent's role, rules and current goal, and only then the instruction. An agent that receives a message starting with "CONTEXTO REINICIADO" must re-read the listed files before doing anything else.

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
- **Config:** `server/src/config/env.ts` validates every environment variable with `zod` in `loadEnv()`, called once at startup by `index.ts`; the process refuses to start rather than run half-configured, printing every bad/missing variable and exiting with code 1 (no stack trace). `MYSQL_DATABASE_TEST` must differ from `MYSQL_DATABASE`. Nothing else reads `process.env` directly. Reuses the root `.env`/`.env.example` (same file `compose.yaml` uses for `db`) — see it for the full variable list, including `DB_HOST`/`DB_PORT` (differ between bare local dev and the `server` compose service) and `MYSQL_DATABASE_TEST`.
- **Validate every input, including the query string.** Bodies, `:params` and query go through zod. Query schemas are `z.strictObject`, and a route that takes no query uses `rejectQueryParams` (`middleware/no-query.ts`, after `requireAuth`). No route under `/auth` or `/admin` may silently ignore an unknown parameter: it's a 400. `/health` is the deliberate exception.
- **Response envelope:** every response is `{ data }` or `{ error: { code, message, details? } }` — success and error alike, including `404`s and validation failures. Controllers/services `throw new HttpError(...)` (`server/src/lib/http-error.ts`) or let a `ZodError` propagate; Express 5 forwards a rejected async handler to the error middleware automatically, no manual `try/catch`/`next(err)`. Any error with `expose: true` and a 4xx `status` (what `express.json()` raises for a bad body) is a client error, not a crash: it keeps its status, isn't logged, and never forwards the library's message. Known body-parser `type`s get their own code — `INVALID_JSON` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415) — and the rest, including a corrupt gzip/brotli body (no `type`), get `BAD_REQUEST`. A 5xx or non-exposed error is always `INTERNAL_ERROR`. Unexpected errors always log the real cause server-side and return a generic `INTERNAL_ERROR` — never a stack trace or driver message to the client.
- **`GET /health`** checks the database live (with one retry) on every call — it does **not** gate process startup; the app comes up even with the database down, so `/health` itself can report that clearly (`503 DATABASE_UNAVAILABLE`) instead of the whole process being unreachable.
- **Security base (NFR-005):** `helmet()`, CORS locked to `CORS_ORIGIN` (no wildcard), a basic global rate limit, then a 100kb JSON body limit (no uploads yet — BR-033's goal media needs its own task), all wired in `server/src/middleware/security.ts`. The limiter runs before body parsing, so invalid bodies count too, and skips `GET /health` with the same matching the route uses (case-insensitive, optional trailing slash).
- **Tests:** Vitest + Supertest, against `MYSQL_DATABASE_TEST` — never the real database. `server/tests/global-setup.ts` recreates and migrates it from `db/init/` once per run (as `root`, since the app's own MySQL user only has grants on `MYSQL_DATABASE`), so it can't drift from the real schema. Test files run serially (`fileParallelism: false`): they share one database. `resetDatabase()` (`server/tests/helpers/db.ts`) empties every table except the catalogs loaded by `02-catalogos.sql`, for use in `beforeEach`. It uses `DELETE` (`TRUNCATE` made each reset take ~1 s), so AUTO_INCREMENT keeps counting and tests must never assume specific ids. `server/tests/helpers/auth.ts` has the register/login/role shortcuts.
- **Never let tests touch the real database.** `vitest.config.ts` forces `NODE_ENV=test` (a value exported in the terminal can't override it). `global-setup.ts` and `resetDatabase()` refuse to run unless their target is exactly `MYSQL_DATABASE_TEST` (`server/tests/helpers/test-database.ts`). Keep all three guards.
- **Auth (T-03, details and rationale in `server/README.md`):**
  - Server-side sessions, not JWT, so logout really invalidates. The cookie (`HttpOnly`, `SameSite=Strict`, `Path=/`, plus `Secure` and the `__Host-` prefix in production) expires after `SESSION_TTL_HOURS`. The user is re-read from the database on every request, so role and state changes apply immediately.
  - Passwords use argon2id (19 MiB, t=2, p=1). A failed login always returns the same `401 INVALID_CREDENTIALS`, and an unknown email still runs a dummy verification so both cases take about the same time.
  - `/auth/login` has its own limit: `LOGIN_RATE_LIMIT_MAX` failed attempts per IP + email. `/auth/register` has another one: `REGISTER_RATE_LIMIT_MAX` attempts per IP, successful or not. The user decided the duplicate email keeps answering 409 `EMAIL_TAKEN`.
  - Rate limits key on `req.ip`, which is the socket address unless `TRUST_PROXY` (off by default; a hop count or IPs/CIDRs, never `true`) names the proxies allowed to set `X-Forwarded-For`. It is applied in `app.ts`.
  - `SESSION_SECRET` rejects placeholder-looking values, including the one in `.env.example`. Every login also purges expired sessions of all users, via `idx_sesion_expira_en`.
  - **CSRF** (`middleware/csrf.ts`) applies to every non-GET request. A foreign `Origin` gets 403. With a session cookie, `X-CSRF-Token` must equal the `csrfToken` returned by login and `/auth/me` (an HMAC of the session token with `SESSION_SECRET`). Login and register are exempt from the token, not from the Origin check.
  - **Route protection:** `requireAuth` (401) → `requireRole(role)` (403, exact role; roles don't include each other) / `requireParticipant` (403 `NOT_A_PARTICIPANT`: any `apostador`, for their own pool data) / `requireBettor` (403). Everything under `/admin` already has `requireAuth` + `requireRole('admin')`.
  - **Every betting or coin-spending route (T-09 on) must use `requireAuth, requireBettor`.** It lets through only a validated `apostador`: an admin gets 403 `ADMIN_CANNOT_BET` even if the database says `validado`, and a `pendiente` user gets 403 `USER_NOT_VALIDATED` (they can still log in and browse, BR-005).
  - **Roles are never changed from the app** (user decision, BR-001). There is no admin panel or API action for it, and T-21 must not add one. An admin is only created or promoted with `npm run admin:create` on the server. Promotion is refused for any account that took part in the pool: not `pendiente`, payment confirmed, coins, movements or tickets.
  - That command takes `ADMIN_EMAIL`/`ADMIN_NOMBRE` from the environment and **prompts for the password without echo** (`docker compose exec -it ...`). Never document or use a password typed on the command line (`ADMIN_PASSWORD=...`, `-e ADMIN_PASSWORD=...`): it ends up in shell history and in docker's visible process command line. For non-interactive use there are `ADMIN_PASSWORD_FILE`, `ADMIN_PASSWORD_STDIN=1`, or `ADMIN_PASSWORD` only when injected by a CI secret store.
- **Coins (T-05, details in `server/README.md`):**
  - **`services/coins.service.ts` is the only code that writes `usuario.saldo_monedas` or `movimiento_moneda`.** Use `applyCoinMovements(conn, userId, movements)` inside the caller's `withTransaction`, or the shortcuts `grantValidationCoins` (T-04), `debitSelections` (T-10) and `refundSelections` (T-16).
  - They take a `TransactionConnection` (`db/transaction.ts`), which only `withTransaction` hands out: calling them outside a transaction doesn't compile and is rejected at runtime. Use this branded type for any future function that must not run in autocommit.
  - It locks the user row (`FOR UPDATE OF u`), refuses a negative balance (409 `INSUFFICIENT_BALANCE`, nothing written), inserts the movements and sets the new balance in the same transaction.
  - Callers pass a movement type, never an amount: amounts and signs live in `lib/coins.ts`. D19 is checked first: `validacion` never has a `seleccionId`, debits and refunds always have one, and it must belong to that user.
  - A repeated movement gets 409 `MOVEMENT_ALREADY_APPLIED` and the whole batch rolls back.
  - A refund needs that user's `seleccion_confirmada` for the selection and no earlier refund (BR-046). Otherwise it gets 409 `SELECTION_NOT_DEBITED` or `MOVEMENT_ALREADY_APPLIED`, and nothing is written.
  - The participant's own `GET /monedas/saldo` and `GET /monedas/movimientos` (paginated, newest first) use `requireParticipant`: an admin gets 403 `NOT_A_PARTICIPANT`. `npm run coins:check` and `GET /admin/monedas/consistencia` report `saldo_monedas <> SUM(cantidad)` and admins with coins, read-only.
- **Sports catalog (T-06, details in `server/README.md`):**
  - Admin CRUD under `/admin/{deportes,competiciones,equipos,jugadores,planteles}`: paginated lists with filters, read, create (201), PATCH, delete. Strict zod for body and query.
  - Slugs come from the name when not sent and are always normalized (`lib/slug.ts`). A taken one is 409 `SLUG_TAKEN`.
  - Deletes are refused while anything uses the row (409 `*_IN_USE` with counts). No cascade, no soft delete.
  - Plantel: the competition always comes from the team. A different one sent by the client is 409 `COMPETITION_MISMATCH`, and changing team or player is 409 `TRANSFER_NOT_ALLOWED` (D4).
  - `permite_empate` only changes while no match left `programado` and no bet exists: 409 `DRAW_RULE_LOCKED`.
  - Names (`displayName` in `schemas/catalog.schema.ts`) reject control characters, the whole Unicode Cf category except ZWJ/ZWNJ (bidi, zero-width, BOM, soft hyphen, tag characters…), line/paragraph separators, blank-looking fillers and lone surrogates, and must contain at least one letter or digit. Slugs transliterate letters that have no accent decomposition (ß→ss, æ→ae, ł→l…).
  - Crest and photo: an `https://` URL or a relative image path, up to 255 characters. Color: `#rrggbb`. The server must never fetch those URLs without a host allowlist (any https host is accepted today, including internal ones). The frontend shows them only with `<img>`/`<PixelImage>`, never as inline SVG or in any other context.
  - Every write goes through `runAdminAction` (`services/admin-action.ts`), whose `hooks.inTransaction` is T-17's audit point.
- **MySQL constraint errors are translated in one place: `lib/db-errors.ts`**, called by the error handler. 1062, 1451 and 1452 map by constraint name to a specific code, with generic 409 codes as the fallback; 1406, 1264 and 1366 become 400. A constraint violation is never a 500 and never shows the driver's text. When adding a UNIQUE or FK, add its mapping there. Services still pre-check the common cases to give details.
- **Public API (T-08, details in `server/README.md`):**
  - Read-only `GET /public/...`, no session: deportes, competiciones (and their equipos and posiciones), partidos (fixture and detail), equipos/:id with squad. It is Módulo Informativo only (`services/public.service.ts`): it must never read or import users, sessions, coins, bets or audit.
  - Scores and goals are shown only once a match is `finalizado` with both sides loaded (otherwise both are null, and standings skip it). Cancelled matches are listed with their state. Standings are computed per request (3/1/0, only `finalizado`, ordered by points, goal difference, goals for, name, id; positions never shared).
  - Answers embed what a card needs (teams inside matches, team inside each standing row), so `src/lib` can map them without N+1 calls. The mapping to `src/types` for T-22 is in the README.
  - The API has its own per-IP limit (`PUBLIC_RATE_LIMIT_*`, 120/min by default) and is skipped by the global limiter. Successes carry `Cache-Control: public, max-age=30`; everything else in the API is `no-store`, errors and every 429 included (the no-store default is the first middleware in `app.ts`).
- **A malformed `%` in a route param** is 400 `INVALID_URL_ENCODING`, not logged. `error-handler.ts` recognizes only the router's own decode error; any other `URIError` stays a logged 500.
- **Matches (T-07, details in `server/README.md`):**
  - `/admin/partidos`: CRUD plus `POST /:id/estado`. Creating a match writes both `partido_equipo` rows (goals NULL) in the same transaction, always `programado`.
  - Dates are ISO 8601 with zone and seconds (`schemas/matches.schema.ts`), stored in UTC, and must be in the future.
  - Only `programado` ↔ `en_curso` here. `programado` → `en_curso` is allowed once betting has closed; going back is allowed while there are no goals. `finalizado` is T-12 only and `cancelado` T-16 only: 409 `INVALID_STATE_TRANSITION`.
  - `finalizado`/`cancelado` lock the match (409 `MATCH_LOCKED`). Competition, teams and date change only while `programado`.
  - With bets, teams and competition never change, and the date can only be postponed (BR-014 precision).
  - Delete only if not `finalizado` and with no bets or goals.
  - The match row is locked (`FOR UPDATE`) for every write; betting code must lock it too.
  - The bets check is the injected `MatchBetsProbe` (Polla's `services/bets-match-probe.service.ts`, wired in `routes/index.ts`). T-07 never writes goals.
- **Match order (BR-013) is defined once, in `lib/match-order.ts`:** upcoming (`fecha_hora >= now`) soonest first, then past most recent first, then id. Every match list (T-07, T-08, T-19, T-21) uses `proximityOrderBy`. The 24 h betting close lives in `lib/betting.ts` (`bettingCloseTime`, and `isBeforeBettingClose`, the only comparison against it: the close instant itself is already closed).
- **Selections (T-09, Módulo Polla, details in `server/README.md`):**
  - `/apuestas` uses `requireAuth, requireBettor`. `GET /apuestas/partidos` lists every match with `apuesta: { estado, cierre, pronosticosAdmitidos }` (BR-052 states `disponible`/`cerrada`/`en_curso`/`finalizado`/`cancelado`), filterable by sport, competition, dates and betting state, in BR-013 order. `POST /apuestas/vista-previa` evaluates a proposed ticket and writes nothing.
  - `services/betting.service.ts` is the one place that checks selections: the match exists, is `programado` and before its close, and a draw (as a result or a tied exact score) only where `deporte.permite_empate`. Problems are reported per selection (`errores`, `valida`) plus `INSUFFICIENT_BALANCE` for the ticket. `valido` is what T-10 must require. A malformed shape is a 400.
  - Limits and rules live in `lib/betting.ts`: `MAX_GOLES_PRONOSTICO` (999), `MAX_SELECCIONES_POR_TICKET` (50), bet type and result codes. Identical repeated selections are allowed and flagged with `repiteA`. The cost is `COSTO_POR_SELECCION` per selection, valid or not.
  - T-10 must call `evaluateTicketInTransaction` first inside its `withTransaction`: it locks the user row `FOR UPDATE` (same lock as the debit), then the match, competition and sport rows `FOR SHARE`. On a non-transaction connection it rejects the promise. A `BETTING_CLOSED` error carries `cierre` in its own field.
- **Locking and concurrency (T-09 fix, details in `server/README.md`, "Orden de bloqueo y concurrencia"):**
  - Lock with one statement per table, by primary key only (`SELECT id FROM t FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR ...`). Never lock through a join or a secondary index: the plan can change and lock index ranges (the ticket once deadlocked with `changeMatchState` that way).
  - Fixed order across tables: usuario → partido → plantel → equipo → jugador → competicion → deporte, ascending id within a table. Read the facts a rule depends on with a locking read, after locking.
  - `withTransaction` reruns the whole transaction on a deadlock (1213), up to 3 attempts, so transaction work must only touch the database. A persistent deadlock or a lock wait timeout (1205) is 409 `CONCURRENT_UPDATE`, never a 500.
  - `tests/concurrency-stress.test.ts` must see zero deadlocks. `tests/betting.test.ts` checks, through `performance_schema.data_locks`, that the ticket only takes record locks on primary keys.
- **Participants (T-04, details in `server/README.md`):**
  - Admin actions live in `services/participant-validation.service.ts`. Each runs through `withTransaction` (`db/transaction.ts`) with `READ COMMITTED` and changes state only through an `UPDATE ... WHERE <expected state>`, so a repeated or concurrent call gets 409 without side effects.
  - Their `hooks.inTransaction(conn, outcome)` is where T-17's audit insert goes: same transaction, before commit.
  - Coin amounts go in `lib/coins.ts`, never inline.
  - Participant points are always `SUM(seleccion.puntos_obtenidos)` in the query.
- **Docker dev reload:** the `server` compose service bind-mounts the source, but a Windows-host bind mount doesn't deliver the native filesystem events `tsx watch` needs. It runs `dev:docker` (`nodemon --legacy-watch`, polling-based) instead; bare local dev (`npm run dev` in `server/`, no mount involved) keeps the faster `tsx watch`. After adding a new dependency, if the container comes up with `<package>: not found`, the anonymous `node_modules` volume is stale — `docker compose up -d --force-recreate -V server` forces it to pick up the new image's install.

## Development

```
npm run dev             # Vite dev server, http://localhost:5173
npm run build           # tsc -b && vite build → dist/
npm run preview         # serve dist/ locally
npm run server:dev      # backend, http://localhost:3001 (needs `docker compose up -d db`)
npm run server:test     # backend test suite (Vitest + Supertest)
npm run server:typecheck # backend type check, src + tests
npm run server:admin:create # create/promote an admin (ADMIN_EMAIL, ADMIN_NOMBRE; asks for the password)
npm run server:coins:check   # balance vs SUM(movements) per participant; exit 1 on mismatches
```

Start the dev server as a background process so it doesn't block the session, and stop it when done. `npm run build` must finish with no TypeScript errors or warnings. For the backend, `docker compose up -d` (from the repo root) runs both `db` and `server` together, with reload — see `server/README.md` for the full command reference and layer conventions.

## Documentation

- [Vite](https://vite.dev/guide/): config, static assets, CSS Modules, plugins, building for production.
- [React](https://react.dev/reference/react): components, hooks, `<dialog>` and form handling.
- [React Router, data mode](https://reactrouter.com/start/data/routing): routes, loaders, error boundaries, navigation.
- [sharp](https://sharp.pixelplumbing.com/api-resize): the resize options the pixel-images plugin mirrors.
- [Express 5](https://expressjs.com/en/5x/api.html): routing, error-handling middleware, async handler forwarding.
- [zod](https://zod.dev/): schema validation, used for both env config and request bodies (`server/src/schemas/`).
- [OWASP cheat sheets](https://cheatsheetseries.owasp.org/): Password Storage, Session Management and CSRF Prevention, which the T-03 auth design follows.
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