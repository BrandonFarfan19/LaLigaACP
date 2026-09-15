## Project

**La Liga ACP** — a sports tournament web app (fixtures, standings, teams, players, match results).

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

Everything is **static hardcoded data for now** — no backend, no database. But write it so a real API and database can replace the static source **without rewriting the UI**. Rules:

- **One data-access layer.** All reads go through functions in `src/lib/` (`getTeams()`, `getTeamById(id)`, `getFixtures()`, `getStandings()`). Pages and components call these functions — they never import the raw data files directly.
- **Async from day one.** Those functions return Promises even while reading local data, so swapping the body for a `fetch()` or a DB query changes nothing at the call sites.
- **Typed entities that mirror future tables.** Define `Team`, `Player`, `Match`, `Standing` etc. as TypeScript interfaces in `src/types/`. These are the contract the backend will have to honor.
- **Relations by id, not by nesting.** A `Match` holds `homeTeamId` / `awayTeamId`, not embedded team objects — the same shape a database returns. Resolve relations in the data layer.
- **Stable, unique ids** on every entity. Never key off array index or display name.
- **No hardcoded data inside components or pages.** Static data lives in `src/data/`, never inline in JSX.
- **Pages read in their route `loader`**, which calls `src/lib/` and hands the result to the page with `useLoaderData()`. Components receive data as props; they never fetch on their own. A route renders complete, so anchors like `/#fixture` exist when scrolling runs.
- Keep the output a static SPA for now (`vite build` to `dist/`). Pointing `src/lib/` at a real API later changes only those function bodies.

**Player stats are placeholder, random data.** Every other dataset is meant to become real data from the backend. The attribute ratings (`PlayerStats`: shooting, passing, strength, defense, speed, dribbling) are different: they are generated in `src/data/player-stats.ts`, each a random whole number from 70 to 90, so every player's average also falls between 70 and 90. The generator is seeded by the player id, so the numbers stay the same across builds instead of reshuffling on every deploy. They still follow the data rules above: read only through `getPlayerStatsByTeamId()`, keyed by `playerId`, so real ratings can replace them without touching the UI. They are shown as a pixel-art radar (`PlayerStatsDialog.tsx`, drawn by `src/utils/pixel-radar.ts`) plus a table, opened by clicking a player's name on `/plantilla/:id`.

### Database design (local DB built, app not connected)

This section summarizes the target schema. Full detail (every column, constraint and the ER diagram) lives in [EsquemaBD.md](EsquemaBD.md), in Spanish.

- **A local MySQL 8.4 runs in Docker** (`compose.yaml`, credentials in `.env`, see `.env.example`). `db/init/01-schema.sql` creates every table and `db/init/02-catalogos.sql` loads only the catalog rows. Setup, connection and reset steps are in the README.
- **The app is not connected to it.** `src/lib/` stays static and the site stays a static SPA. Do not add drivers, seed teams/players/matches or wire queries unless explicitly asked.
- `EsquemaBD.md` and `db/init/01-schema.sql` must stay in sync: a schema change updates both in the same change.

- Treat it as the source of truth when adding or changing entities in `src/types/` or `src/data/`, so the static layer keeps converging on the future tables.
- Where the current types differ from the schema (e.g. `Match.homeTeamId`/`awayTeamId` vs. the `partido_equipo` rows), the data layer does the translation. The UI does not change.
- If a change contradicts the schema, update both this section and `EsquemaBD.md` in the same change.

**Engine and conventions**

- **MySQL 8** (≥ 8.0.16 so `CHECK` is enforced), InnoDB, `utf8mb4`.
- Table and column names are `snake_case` Spanish (`partido_equipo`, `es_visita`). TypeScript stays camelCase; the data layer maps between them.
- **Vocabulary:** the tournament uses **puntos** (standings, informational). The pool uses **coins** (what a user earns for a correct bet). Never mix the two terms in code, UI or schema.
- Ids: `BIGINT UNSIGNED AUTO_INCREMENT`. Dates: `DATETIME`, always UTC (MySQL stores no zone). Pool coins: `DECIMAL(5,1)`, never `FLOAT`.
- Catalog tables (`rol`, `estado_partido`, `mercado_tipo`, `estado_mercado`) have a stable unique `codigo`. Logic matches on `codigo`, never on the numeric id.
- **Computed, never stored:** standings, top scorers, champion, pool ranking, bet closing time.
- **Scoring and closing rules live in backend code**, not in tables.

**Modules.** Informativo must never depend on Polla.

| Module | Tables |
|---|---|
| Acceso | `rol`, `usuario` |
| Informativo | `disciplina`, `equipo`, `jugador`, `plantel`, `estado_partido`, `partido`, `partido_equipo`, `partido_jugador`, `estadistica_tipo`, `partido_jugador_estadistica` |
| Polla | `mercado_tipo`, `estado_mercado`, `mercado`, `apuesta` |

**Tables at a glance**

- `rol` (codigo: `apostador`, `admin`) → `usuario` (rol_id, nombre, email). One role per user; `admin` includes betting. A user is not a player.
- `disciplina` (nombre, slug, permite_empate). Each discipline **is** the tournament: there are no seasons.
- `equipo` (disciplina_id, nombre, nombre_corto, escudo, color_acento). A team belongs to exactly one discipline.
- `jugador` is the person. `plantel` (jugador_id, equipo_id, disciplina_id, numero_camiseta) enrolls that person in a team. `UNIQUE(jugador_id, disciplina_id)` means one team per discipline and no mid-tournament transfers.
- `partido` (disciplina_id, estado_partido_id, jornada, fecha_hora, sede). States: `programado`, `en_vivo`, `finalizado`, `suspendido`.
- `partido_equipo` (partido_id, equipo_id, es_visita, marcador) holds **exactly two rows per match**, local (`es_visita = false`) and away. The score is entered by hand by an admin, never derived from stats.
- `partido_jugador` (partido_equipo_id, plantel_id) records who played. `partido_jugador_estadistica` (partido_jugador_id, estadistica_tipo_id, valor) stores per-match numbers. `estadistica_tipo` is a per-discipline catalog (`goles`, `faltas`, `aces`…).
- `mercado` (mercado_tipo_id, estado_mercado_id, partido_id?, disciplina_id?) is something to bet on, and references **only** that thing: `ganador_partido` sets `partido_id` (its discipline comes from the match via JOIN), `campeon_disciplina` sets `disciplina_id`. `CHECK ((partido_id IS NULL) <> (disciplina_id IS NULL))` enforces exactly one. `UNIQUE(partido_id)` allows one market per match and `UNIQUE(disciplina_id)` one champion market per discipline (NULLs don't collide). Matching the column to the type is backend logic by `codigo`. States: `abierto`, `cerrado`, `liquidado`, `anulado`.
- `apuesta` (usuario_id, mercado_id, equipo_id?, creada_en, actualizada_en, coins_obtenidos). A null `equipo_id` means a draw. `UNIQUE(usuario_id, mercado_id)` allows one pick per market.
- Composite FKs over `(id, disciplina_id)` and `(id, equipo_id)` guarantee teams, matches and players share a discipline. See `EsquemaBD.md`.

**Business rules (backend)**

- Standings **puntos**: win **3**, draw **1**, loss **0**. Tie-breaking does not matter. The champion is first in the table once every match of the discipline is `finalizado`.
- The pool is **coins only**; the user with most coins wins the prize, split on a tie.
- Bets are only on **which team wins**: a match (draw allowed only if `permite_empate` is true on the match's discipline, reached via `mercado.partido_id` → `partido.disciplina_id`) or a discipline champion.
- Match bets close **24 h before** `partido.fecha_hora`. They can be changed until then; each change resets `actualizada_en`.
- Match bet coins, with anticipation measured as `fecha_hora − actualizada_en`:

  | Correct pick | ≥ 48 h before | 24–48 h before |
  |---|---|---|
  | Winner | 3.5 | 3 |
  | Draw | 1.5 | 1 |
  | Wrong | 0 | 0 |

- An admin enters scores and sets the match to `finalizado`. The system then settles the market (fills `coins_obtenidos`, sets `liquidado`). Correcting a settled score re-settles it. A suspended match voids its market (0 coins) and reopens it if rescheduled.
- If several teams tie for first, every tied team counts as a correct champion pick.
- **Open:** closing time and coins for champion bets are not defined yet.

### Change history

[historial.md](historial.md) (in Spanish) is the log of **tested and reviewed changes**. A change is recorded only after `tester_liga` has verified the work of `ejecutor_liga` and approved it. Each entry states the date, what changed, the files and how it was verified.

- Read it to learn which changes are already verified before building on them.
- Only `tester_liga` appends entries, at the end of the file. Never rewrite or delete past entries.

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

## Development

```
npm run dev       # Vite dev server, http://localhost:5173
npm run build     # tsc -b && vite build → dist/
npm run preview   # serve dist/ locally
```

Start the dev server as a background process so it doesn't block the session, and stop it when done. `npm run build` must finish with no TypeScript errors or warnings.

## Documentation

- [Vite](https://vite.dev/guide/): config, static assets, CSS Modules, plugins, building for production.
- [React](https://react.dev/reference/react): components, hooks, `<dialog>` and form handling.
- [React Router, data mode](https://reactrouter.com/start/data/routing): routes, loaders, error boundaries, navigation.
- [sharp](https://sharp.pixelplumbing.com/api-resize): the resize options the pixel-images plugin mirrors.
