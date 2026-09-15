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

- Logos and crests are rendered small through `<Image />` (32–96px) and upscaled by CSS with `image-rendering: pixelated` (the `.pixelated` class). This turns smooth artwork into real pixel art instead of a soft enlargement. Never render them at full size.

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
- **No hardcoded data inside `.astro` templates.** Static data lives in `src/data/` (or Astro content collections), never inline in markup.
- Keep the output static (SSG) for now; adding an adapter and switching to SSR later should be a config change, not a refactor.

**Player stats are placeholder, random data.** Every other dataset is meant to become real data from the backend. The attribute ratings (`PlayerStats`: shooting, passing, strength, defense, speed, dribbling) are different: they are generated in `src/data/player-stats.ts`, each a random whole number from 70 to 90, so every player's average also falls between 70 and 90. The generator is seeded by the player id, so the numbers stay the same across builds instead of reshuffling on every deploy. They still follow the data rules above: read only through `getPlayerStatsByTeamId()`, keyed by `playerId`, so real ratings can replace them without touching the UI. They are shown as a pixel-art radar (`PlayerStatsDialog.astro`, drawn by `src/utils/pixel-radar.ts`) plus a table, opened by clicking a player's name on `/plantilla/[id]`.

### Database design (planned, not built)

This section summarizes the target schema. Full detail (every column, constraint and the ER diagram) lives in [EsquemaBD.md](EsquemaBD.md), in Spanish. It is a **design only**: no database, tables or migrations exist, and **none should be created unless explicitly asked**.

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
- `mercado` (mercado_tipo_id, estado_mercado_id, disciplina_id, partido_id?) is something to bet on. Types: `ganador_partido` (requires partido_id) or `campeon_disciplina`. States: `abierto`, `cerrado`, `liquidado`, `anulado`.
- `apuesta` (usuario_id, mercado_id, equipo_id?, creada_en, actualizada_en, coins_obtenidos). A null `equipo_id` means a draw. `UNIQUE(usuario_id, mercado_id)` allows one pick per market.
- Composite FKs over `(id, disciplina_id)` and `(id, equipo_id)` guarantee teams, matches and players share a discipline. See `EsquemaBD.md`.

**Business rules (backend)**

- Standings **puntos**: win **3**, draw **1**, loss **0**. Tie-breaking does not matter. The champion is first in the table once every match of the discipline is `finalizado`.
- The pool is **coins only**; the user with most coins wins the prize, split on a tie.
- Bets are only on **which team wins**: a match (draw allowed only if `disciplina.permite_empate`) or a discipline champion.
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

Team crests and logos live in `src/assets/` and are imported through `astro:assets` `<Image />` for optimization — not referenced from `public/`.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
