# Migración Astro → React (Vite + React Router)

Inventario del comportamiento de la app **antes** de migrar, sacado de cada `.astro` y del build de Astro (`astro build`, 5 páginas). Es el checklist de paridad: la versión React tiene que cumplir cada punto sin cambios visibles.

Marca cada casilla al verificarla. Las diferencias conocidas e inevitables están al final.

---

## 1. Rutas

- [ ] `/` — Home: `Hero` + `Fixture`. Título: `La Liga ACP`.
- [ ] `/posiciones` — tabla de posiciones. Título: `Posiciones · La Liga ACP`.
- [ ] `/plantilla/:id` — plantilla de un equipo. Título: `Plantilla · <team.name>` (ej. `Plantilla · FC Barcelona`).
  - [ ] Ids válidos: `barcelona`, `boca-juniors`, `universitario` (hoy `getStaticPaths` solo genera esos tres).
  - [ ] Un id inexistente (ej. `/plantilla/no-existe`) muestra una página 404. **Nuevo en React:** en Astro esa URL no existía y el hosting devolvía su propio 404.
- [ ] Cualquier otra URL desconocida muestra la misma 404.
- [ ] Recargar (F5) en una ruta profunda (`/posiciones`, `/plantilla/boca-juniors`) funciona en `npm run dev` y en `npm run preview`.
- [ ] `dist/404.html` existe (copia de `index.html`) para hosting estático.

## 2. Layout (`Base.astro`)

- [ ] `<html lang="es">`, `<meta charset="utf-8">`, `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- [ ] Favicon: `<link rel="icon" type="image/png" href="/favicon.png">`.
- [ ] Título por página (ver rutas). El nombre del sitio va incluido en el título que pasa cada página.
- [ ] Cursores pixel art: `/cursors/arrow.png` (hotspot 0 0) por defecto y `/cursors/hand.png` (hotspot 9 0) en enlaces, botones, `summary`, `label`, `select` y roles clicables. Botón o `select` deshabilitado → cursor por defecto.
- [ ] Fondo de estadio fijo (`.backdrop`, `position: fixed`, `z-index: 0`, `pointer-events: none`):
  - [ ] `<picture>` con `<source media="(min-width: 48rem)">` → `estadio-aficion.png` a **480×270** webp.
  - [ ] `<img class="pixelated">` → `estadio-aficion-vertical.png` a **240×426** webp, `width=240 height=426`, `loading="eager"`, `fetchpriority="high"`, `alt=""`, `aria-hidden` en el `<picture>`.
  - [ ] Velo `::after` con 5 bandas duras de `--color-bg` (92/82/74/84/94 %).
- [ ] `Navbar` arriba y `<main>` con `position: relative; z-index: 1`.
- [ ] Scanlines CRT (`body::after`, `z-index: 200`) sobre todo.
- [ ] `global.css` intacto: tokens, fuentes `@fontsource` (latin 400 de Press Start 2P; latin 400 y 700 de Silkscreen), `.pixelated`, `.pixel-box`, `.pixel-bevel`, `.pixel-shadow`, foco `:focus-visible` con contorno de `--px`, `scroll-padding-top` = alto del navbar, `scroll-behavior: smooth` (desactivado con reduced motion).
- [ ] `<meta name="generator" content="Astro v7.3.2">` **desaparece** (era de Astro; no es visible).

## 3. Navbar

- [ ] Barra fija (`z-index: 100`), alto `--navbar-height` (64px; 80px desde 48rem).
- [ ] Marca: enlace `/#inicio` con `aria-label="La Liga ACP, inicio"`; logo `logo-la-liga-acp-copa-dorada.png` a **32×32** (srcset 2x **64×64**), `alt=""`, `loading="eager"`; CSS 32px (40px desde 48rem).
- [ ] Wordmark `La Liga ACP` (ACP en acento) oculto en móvil, visible desde 48rem.
- [ ] Enlaces: `Inicio` → `/#inicio`, `Fixture` → `/#fixture`, `Posiciones` → `/posiciones`.
- [ ] `aria-current="page"` solo en `Posiciones` estando en `/posiciones` (los enlaces con `#` nunca se marcan). La comparación ignora la barra final.
- [ ] Enlace actual, hover y foco: color acento + cursor `▸` visible.
- [ ] Panel del navbar: invisible arriba del todo; aparece (`data-scrolled`) cuando `scrollY > 8`, con transición `opacity 200ms steps(4, end)`. Scroll con `requestAnimationFrame` (una lectura por frame). Estado correcto al cargar con la página ya desplazada. Sin transición con reduced motion.
- [ ] Máscara del panel en bandas duras (64/76/86/94 %).

## 4. Home — Hero (`#inicio`)

- [ ] Sección `id="inicio"`, alto exacto de una pantalla (`100svh`), `overflow: hidden`, borde inferior escalonado.
- [ ] Logo de la liga **96×96** (srcset 2x **192×192**), `alt="La Liga ACP"`, `loading="eager"`, `fetchpriority="high"`.
- [ ] Animación `logo-float` 5s infinita. **Ojo:** hoy usa `ease-in-out`, `rotate(±0.4deg)` y `drop-shadow` con desenfoque; incumple CLAUDE.md, pero se conserva tal cual (cero cambios de CSS). Se apaga con reduced motion.
- [ ] Título `Conoce a los equipos` (`equipos` en acento) y texto `Los 3 clubes que disputan el torneo.` (cuenta desde `getTeams()`).
- [ ] Media queries por alto: `max-height: 46rem` (logo y título más chicos) y `max-height: 30rem` (se ocultan logo y texto).

## 5. Carousel

- [ ] `<section aria-roledescription="carrusel" aria-label="Equipos participantes">`, autoplay activado, intervalo 5000 ms.
- [ ] Una diapositiva por equipo, en el orden de `getTeams()`: `<article aria-roledescription="diapositiva" aria-label="N de 3">`, `--slide-accent` = `team.accent`.
- [ ] Cada escudo es un enlace a `/plantilla/<id>` con `aria-label="Ver plantilla de <team.name>"`.
- [ ] Escudo a **96px de ancho** (alto proporcional: Boca **96×112**), srcset 2x (**192px**), `alt="Escudo de <team.name>"`; `loading="eager"` en la primera diapositiva y `lazy` en las demás.
- [ ] Texto: eyebrow = país (color del equipo), título = `shortName`.
- [ ] Foco halo fijo (`.spotlight`) en bandas duras.
- [ ] Track con scroll horizontal nativo, `scroll-snap` una diapositiva a la vez, sin barra de scroll, `tabindex="0"`, sin contorno de foco (`outline: none`).
- [ ] Flechas `<` (Anterior) y `>` (Siguiente), 44×44, centradas en el escudo; hover/foco en acento.
- [ ] Clic en flecha: va a la anterior/siguiente **en bucle** (de la última a la primera y al revés) y reinicia el intervalo de autoplay.
- [ ] Teclado con foco en el track: `ArrowRight` siguiente, `ArrowLeft` anterior (en bucle).
- [ ] Desplazamiento `smooth`, o `auto` con reduced motion.
- [ ] El índice actual sigue al scroll real (IntersectionObserver, umbral 0.6): después de un swipe, las flechas parten de la diapositiva visible.
- [ ] Autoplay: avanza cada 5 s en bucle. Se pausa con el puntero encima, con foco dentro, al tocar el track (`pointerdown`) y con la pestaña oculta; se reanuda al salir el puntero, perder el foco o volver a la pestaña.
- [ ] Sin autoplay con `prefers-reduced-motion: reduce` o con una sola diapositiva.
- [ ] Hover/foco en el escudo: sube un `--px` y la sombra se duplica (`steps(2, end)`); sin transición con reduced motion.

## 6. Home — Fixture (`#fixture`)

- [ ] Sección `id="fixture"`, `aria-labelledby="fixture-title"`; kicker `Calendario`, título `Fixture`, texto `Todos los enfrentamientos del torneo, jornada por jornada.`
- [ ] Jornadas en orden (`getFixturesByMatchday()`): `<section aria-label="Jornada N">`, número con dos dígitos (`01`…`06`) + `Jornada`.
- [ ] Grilla de tarjetas: una columna en móvil; `auto-fit, minmax(22rem, 1fr)` desde 48rem; ancho máximo 72rem desde 64rem.

## 7. MatchCard

- [ ] `<article class="match pixel-box" data-status="…">`.
- [ ] Estado: `Programado` / `En vivo` / `Finalizado`. Finalizado en acento; en vivo en rojo con parpadeo `steps(1, end)` (apagado con reduced motion).
- [ ] Fecha en hora de Lima: `<time datetime="<kickoff ISO>">DD mmm · HH:MM</time>`. Valores esperados: `05 sept · 20:00`, `09 sept · 18:30`, `19 sept · 21:00`, `26 sept · 20:00`, `03 oct · 19:00`, `10 oct · 18:30`.
- [ ] Escudos a **48px de ancho** (Boca **48×56**), srcset 2x (**96px**), `alt="Escudo de <name>"`, `loading="lazy"`; CSS 64px (80px desde 48rem).
- [ ] Nombre corto de cada equipo.
- [ ] Resultado: `2-1` (guion atenuado) si está finalizado con marcador; `VS` si no.
- [ ] Sede al pie.

## 8. Posiciones

- [ ] Kicker `Clasificación`, `<h1 id="standings-title">Posiciones</h1>`, texto `Los equipos ordenados por puntos obtenidos.`
- [ ] `<table class="table pixel-box">` con `<caption>` oculto `Tabla de posiciones`.
- [ ] Cabecera: `#` (`<abbr title="Posición">`), `Equipo`, `Pts` (`<abbr title="Puntos">`), sin subrayado en `abbr`.
- [ ] Filas en el orden de `getStandings()`: posición, escudo + nombre completo (`<th scope="row">`), puntos.
- [ ] Escudos **recortados a 32×32** (srcset 2x **64×64**; en Boca el recorte es centrado), `alt=""`, `loading="eager"`; CSS 32px (48px desde 48rem).
- [ ] Primer puesto: posición y puntos en dorado (`--color-accent-alt`).
- [ ] Filas pares con fondo elevado; hover (solo con puntero real) en `--color-border`, `steps(2, end)`; sin transición con reduced motion.

## 9. Plantilla (`/plantilla/:id`)

- [ ] `<section class="squad">` con `--team-accent` = `team.accent`.
- [ ] Enlace `< Volver` → `/#inicio` (hover/foco en acento).
- [ ] Escudo a **32px de ancho** (Boca **32×37**), srcset 2x (**64px**), `alt="Escudo de <name>"`, `loading="eager"`, `fetchpriority="high"`; CSS `5vw`, halo en bandas con el color del equipo.
- [ ] `<h1>` con `team.name`.

### SquadBoard

- [ ] Móvil: cancha arriba y tabla abajo; desde 48rem, lado a lado centrados verticalmente (cancha 48 %).
- [ ] Cancha `cancha-vertical.png` a **240×426** (srcset 2x **480×852**), `alt=""`, `loading="lazy"`.
- [ ] Jugadores en la cancha según `getSquadPlacementsByTeamId()`: posición `--x`/`--y` en %, sprite SVG 16×24 (camiseta con color del equipo), dorsal de muestra y nombre.
- [ ] Botón de cada jugador: `aria-label="Ver estadísticas de <name>, dorsal de muestra <n>"`, `aria-haspopup="dialog"`, `aria-controls="stats-<player id>"`; deshabilitado (opacidad 0.65) si no tiene stats.
- [ ] Hover (puntero real) o foco: sprite sube un `--px` y el nombre pasa a dorado; sin transición con reduced motion.
- [ ] Texto `Toca un jugador para ver su ficha`.
- [ ] Tabla `Plantilla` (`<caption>` visible) con columna `Jugador`: nombre como botón (`aria-haspopup="dialog"`) si tiene stats, texto plano si no. Cursor `▸` en hover/foco; filas pares en bandas; hover de fila solo con puntero real.
- [ ] Clic en un jugador (cancha o tabla) abre su ficha como modal (`showModal`).
- [ ] Abrir la URL con `#stats-<player id>` (ej. `/plantilla/barcelona#stats-p-03`) abre directamente esa ficha.

### PlayerStatsDialog

- [ ] Un `<dialog class="stats pixel-box" id="stats-<player id>" aria-labelledby="stats-<id>-title">` por jugador con stats.
- [ ] Cabecera: nombre (`<h2>`) y `Media <promedio redondeado>` en dorado.
- [ ] Botón `X` (`aria-label="Cerrar"`) dentro de `<form method="dialog">`: cierra la ficha.
- [ ] `Esc` cierra la ficha. Clic en el fondo (fuera de la caja) la cierra; clic dentro no.
- [ ] Al abrir, el foco va al primer control (botón `X`); al cerrar vuelve al botón que la abrió (comportamiento nativo del `<dialog>`).
- [ ] Fondo del modal plano al 80 % de `--color-shadow`, sin blur.
- [ ] Retrato `jugador-marron-claro-fifa2002.png` a **96×96** (sin 2x), `alt=""`, `loading="eager"`, mostrado a 192px (×2 exacto) con `.pixel-bevel`.
- [ ] Radar pixel: SVG `viewBox="0 0 80 80"` `shape-rendering="crispEdges"` con los `<rect>` de `rasterizeRadar()` (clases `disc`, `ring`, `fill`, `edge`); 240px en móvil (3px por celda), 320px desde 48rem. `aria-hidden`.
- [ ] Etiquetas de ejes `DIS`, `PAS`, `FUE`, `DEF`, `VEL`, `DRI`, en el sentido de las agujas del reloj desde arriba.
- [ ] Tabla de valores (caption oculto `Estadísticas de <name>`): Disparo, Pase, Fuerza, Defensa, Velocidad, Dribbling.
- [ ] Móvil: retrato, radar y tabla en columna; desde 48rem en fila, ficha hasta 56rem.
- [ ] Barra `Compartir` excluida de la captura (`data-capture-exclude`), igual que el formulario del botón `X`.
  - [ ] **Escritorio** (sin puntero táctil o sin `navigator.canShare` con archivos): botones `WhatsApp`, `Facebook`, `Copiar enlace`; `Instagram` oculto. WhatsApp abre `https://wa.me/?text=Plantilla de <team> en La Liga ACP <url del equipo>`; Facebook abre `sharer.php?u=<url del equipo>`; en pestaña nueva con `noopener,noreferrer`. `Copiar enlace` copia la URL del equipo.
  - [ ] **Móvil con hoja de compartir que acepta archivos:** botones `WhatsApp`, `Facebook`, `Instagram`, `Copiar enlace`. Al abrir la ficha se captura su imagen PNG (`la-liga-acp-<player id>.png`, html-to-image, ×3, con margen). WhatsApp/Facebook comparten archivo + texto `<name> · Media <n> en La Liga ACP <url>#stats-<id>`; Instagram solo el archivo. `Copiar enlace` copia la URL con `#stats-<id>`.
  - [ ] Mensajes de estado (`role="status"`): `¡Enlace copiado!`; si el portapapeles falla, muestra la URL; `No se pudo compartir` si falla el share (cancelar no muestra nada). El mensaje se borra al pulsar otro botón y al cerrar la ficha. Vacío = oculto.
  - [ ] Botones: bisel que se invierte al presionar; hover/foco en dorado; `steps(2, end)`; sin transición con reduced motion. Grilla de 2 columnas en móvil, una fila desde 48rem.

## 10. Imágenes (resumen de tamaños generados por Astro)

Todas en **webp**, generadas con `sharp` (resize por ancho; recorte centrado cuando se dan ancho y alto; calidad por defecto). Se agrandan con CSS y `.pixelated`. **Nunca a tamaño completo.**

| Uso | Archivo | 1x | 2x |
|---|---|---|---|
| Fondo escritorio | `backgrounds/estadio-aficion.png` | 480×270 | — |
| Fondo móvil | `backgrounds/estadio-aficion-vertical.png` | 240×426 | — |
| Logo navbar | `logo-la-liga-acp-copa-dorada.png` | 32×32 | 64×64 |
| Logo hero | `logo-la-liga-acp-copa-dorada.png` | 96×96 | 192×192 |
| Escudo carrusel | escudos | ancho 96 | ancho 192 |
| Escudo MatchCard | escudos | ancho 48 | ancho 96 |
| Escudo plantilla | escudos | ancho 32 | ancho 64 |
| Escudo posiciones | escudos | 32×32 (recorte) | 64×64 (recorte) |
| Cancha | `backgrounds/cancha-vertical.png` | 240×426 | 480×852 |
| Retrato ficha | `jugadoresPixel/futbol/jugador-marron-claro-fifa2002.png` | 96×96 | — |

Escudos: `barcelona.webp`, `boca.avif` (no cuadrado: 96×112, 48×56, 32×37), `Logo_Universitario.png`. Todos los `<img>` de `<Image />` llevan `decoding="async"` y los atributos `width`/`height` del archivo generado.

## 11. Movimiento y accesibilidad (transversal)

- [ ] Todas las transiciones con `steps()`; todas se apagan con `prefers-reduced-motion: reduce`.
- [ ] Objetivos táctiles de al menos 44px (flechas, enlaces del navbar, jugadores, botones de la ficha, filas de la tabla).
- [ ] Sin `border-radius`, sin sombras con blur nuevas, sin `backdrop-filter`, sin degradados continuos nuevos.

## 12. Navegación (MPA → SPA)

- [ ] Los enlaces internos no recargan la página, pero se comportan como antes:
  - [ ] Ir a otra ruta empieza arriba del todo, sin animación de scroll.
  - [ ] `/#inicio` o `/#fixture` desde otra ruta llega directo a la sección (sin animación).
  - [ ] `Inicio` / `Fixture` estando ya en `/` desplaza con `smooth` a la sección (instantáneo con reduced motion), y el ancla queda bajo el navbar (`scroll-padding-top`).
  - [ ] Atrás/Adelante del navegador vuelven a la posición de scroll anterior.
- [ ] Abrir directamente `/#fixture` en una pestaña nueva llega a la sección.

## Verificación hecha por ejecutor_liga

- `npm run build` (`tsc -b && vite build`): sin errores ni avisos.
- Imágenes: las 26 webp de `dist/assets` son **idénticas byte a byte** (mismo SHA-256) a las 26 del build de Astro.
- Estilos: script que recorre todos los elementos y compara estilos calculados (50 propiedades más `::before`/`::after`), posición y tamaño, textos y atributos, contra el build de Astro servido en paralelo. Resultado **idéntico** en `/`, `/posiciones` y `/plantilla/:id` a 1536×730 y a 390×844 (174, 53 y 490 elementos).
- Comportamiento (build y dev): carrusel siguiente/anterior/teclado en bucle, igual que en Astro; autoplay de una diapositiva cada 5 s; sin listeners duplicados con StrictMode; ficha abierta desde la cancha y desde la tabla; cierre con X, Esc y clic en el fondo; apertura por `#stats-<id>`; mensaje de estado y su borrado al cerrar; navegación sin recarga con título y `aria-current`; `/#fixture` desde otra ruta queda justo bajo el navbar; Atrás/Adelante restauran el scroll; 404 para id inexistente y ruta desconocida; rutas profundas en `preview`; consola sin errores.
- No se pudo probar con una pestaña visible: el navegador de pruebas tenía la pestaña oculta, así que el scroll suave, `requestAnimationFrame` (panel del navbar) y el evento `close` del `<dialog>` no avanzan ahí, **ni en Astro ni en React**. Conviene revisarlos a mano: panel del navbar al desplazar, animación del carrusel y captura/compartir en un teléfono real.

## Diferencias conocidas

1. **Primera carga:** Astro entregaba el HTML completo; la SPA muestra solo el fondo de `body` hasta que carga el JavaScript (una fracción de segundo en local). Sin JavaScript la página no se ve (antes se veía todo menos las interacciones).
2. **`<meta name="generator" content="Astro v7.3.2">`** ya no existe. No es visible.
3. **Fechas del fixture:** antes se formateaban en Node al compilar; ahora las formatea el navegador con `Intl` (misma zona `America/Lima`). En Chrome el texto es idéntico (`05 sept · 20:00`); otro motor podría abreviar el mes distinto (por ejemplo `sep`).
4. **Página 404:** nueva, con el mismo estilo que Posiciones. Antes esas URLs dependían del 404 del hosting.
5. **Barra de compartir:** en Astro llevaba `hidden` hasta que corría el script; en React se renderiza ya visible (siempre hay JavaScript). El resultado en pantalla es el mismo.
6. **Navegación sin recarga:** el scroll imita la carga de página (ver sección 12) y el navbar se vuelve a montar en cada ruta. Atrás/Adelante vuelven a renderizar la página (el carrusel empieza en la primera diapositiva y la ficha queda cerrada), mientras que la caché del navegador en Astro podía restaurar ese estado. Las posiciones de scroll se guardan en `sessionStorage` (`la-liga-acp:scroll`).
7. **Marcado no visible:** las clases llevan sufijo de CSS Modules (`crest_x1Ab2`), no hay atributos `data-astro-cid-*`, hay un `<div id="root">` entre `body` y el contenido, y `.table abbr` reemplaza al selector `abbr` (con el mismo efecto, porque solo Posiciones tiene `abbr`).
8. **Sin cambio, pero incumple CLAUDE.md desde antes:** la animación `logo-float` del Hero usa `ease-in-out`, `rotate()` y `drop-shadow` con desenfoque. Se conservó tal cual porque la tarea pide cero cambios de CSS.
