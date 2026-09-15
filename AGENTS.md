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
