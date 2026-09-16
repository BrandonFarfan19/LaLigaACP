# Historial de cambios probados y revisados

Registro de los cambios que hizo `ejecutor_liga` y que `tester_liga` verificó y aprobó. Solo entran cambios aprobados; los que fallan se corrigen primero y se registran cuando pasen.

Entradas en orden cronológico, la más reciente al final. Formato de cada entrada:

```markdown
## AAAA-MM-DD — Título corto del cambio

- **Cambio:** qué se hizo y por qué.
- **Archivos:** `ruta/archivo`, `ruta/otro`.
- **Verificación:** `astro check` OK · `npm run build` OK · páginas revisadas y demás pruebas.
- **Observaciones:** notas o pendientes (o "Ninguna").
```

---

## 2026-09-15 — Base de datos MySQL 8.4 en Docker

- **Cambio:** base local MySQL 8.4 en Docker con el esquema completo de `EsquemaBD.md` (16 tablas) y solo las filas de catálogo. Credenciales por `.env` (no versionado). La app no se conecta: sigue estática y SSG.
- **Archivos:** `compose.yaml`, `.env.example`, `.env` (ignorado por `.gitignore`), `db/init/01-schema.sql`, `db/init/02-catalogos.sql`, `README.md` (sección BD), `EsquemaBD.md`, `CLAUDE.md`.
- **Verificación:** `astro check` 0 errores (1 hint previo en `src/utils/share-image.ts:15`) · `npm run build` OK (5 páginas) · `docker compose down -v` + `up -d`: healthy, init 01 y 02 sin errores · MySQL 8.4.11, `time_zone` +00:00, utf8mb4_unicode_ci, 16 tablas InnoDB · catálogos con los códigos del esquema, 0 filas en equipo, jugador y partido · `01-schema.sql` contrastado tabla por tabla con `EsquemaBD.md` (tipos, UNIQUE y FKs compuestas coinciden) · restricciones probadas con ROLLBACK: cruce de disciplina en plantel y partido_equipo (1452), jugador fuera de su equipo o partido (1452), apuesta duplicada y lado o equipo repetido (1062), coins negativos y fechas invertidas (3819), coins fuera de rango (1264) · sin drivers de BD en `package.json` · `compose.yaml` sin passwords.
- **Observaciones:** `mercado` no tiene FK compuesta `(partido_id, disciplina_id)`: acepta un mercado de vóley sobre un partido de fútbol (coincide con el esquema actual, que no la pide). Los `CHECK` del SQL (`codigo <> ''`, `jornada >= 1`, coins ≥ 0, `actualizada_en >= creada_en`) no están documentados en `EsquemaBD.md`. `@astrojs/check` no es dependencia del proyecto y choca con TypeScript 7; se corrió desde la caché de npx con TypeScript 5. En `.env` el puerto es 3307 porque 3306 está ocupado en esta máquina.

## 2026-09-15 — Mercado referencia solo a lo que se apuesta

- **Cambio:** en `mercado`, `partido_id` y `disciplina_id` pasan a ser opcionales y `ck_mercado_objetivo` exige exactamente uno. `ganador_partido` usa solo `partido_id` y saca la disciplina del partido por JOIN; `campeon_disciplina` usa solo `disciplina_id`. Así desaparece la disciplina duplicada que permitía un mercado de vóley sobre un partido de fútbol. Se ajustaron las reglas de backend de `apuesta` a este modelo.
- **Archivos:** `db/init/01-schema.sql`, `EsquemaBD.md`, `CLAUDE.md`.
- **Verificación:** `npm run build` OK (5 páginas) · `src/` y `package.json` sin cambios · `docker compose down -v` + `up -d`: healthy, init 01 y 02 sin errores, 16 tablas · information_schema: `partido_id` y `disciplina_id` nullable, `ck_mercado_objetivo` presente y aplicado, sin FK compuesta (solo las simples a `partido` y `disciplina`) · con ROLLBACK: se aceptan `ganador_partido` con solo `partido_id` y `campeon_disciplina` con solo `disciplina_id`; se rechazan ambos, ninguno, el caso vóley sobre partido de fútbol y un UPDATE que llena los dos (3819) · `EsquemaBD.md`, `CLAUDE.md` y `01-schema.sql` coinciden, incluidas las reglas de backend de `apuesta`.
- **Observaciones:** la base acepta un `ganador_partido` con solo `disciplina_id`: que la columna corresponda al tipo queda como regla de backend, tal como está documentado. Sigue pendiente con el usuario si agregar `UNIQUE(disciplina_id)` para un solo mercado de campeón por disciplina. `CLAUDE.md:101` todavía dice `disciplina.permite_empate` sin aclarar que es la disciplina del partido (no contradice).

## 2026-09-15 — Un solo mercado de campeón por disciplina

- **Cambio:** `mercado` agrega `uq_mercado_disciplina UNIQUE (disciplina_id)`, así solo puede haber un mercado `campeon_disciplina` por disciplina. Los mercados de partido no chocan porque tienen `disciplina_id` NULL. Esa regla deja de ser de backend; en backend solo queda que la columna corresponda al tipo. `CLAUDE.md` aclara que `permite_empate` es de la disciplina del partido.
- **Archivos:** `db/init/01-schema.sql`, `EsquemaBD.md`, `CLAUDE.md`.
- **Verificación:** `npm run build` OK (5 páginas) · `src/` y `package.json` sin cambios · `docker compose down -v` + `up -d`: healthy, init 01 y 02 sin errores, 16 tablas InnoDB · information_schema.STATISTICS: `uq_mercado_partido` y `uq_mercado_disciplina` únicos, sin índice duplicado sobre `disciplina_id` (el UNIQUE sirve de índice de la FK), `fk_mercado_disciplina` sigue presente · con ROLLBACK: campeones en disciplinas distintas se aceptan, segundo campeón en la misma disciplina y segundo mercado del mismo partido dan 1062, tres `ganador_partido` con `disciplina_id` NULL se aceptan, ambos o ninguno dan 3819, disciplina inexistente da 1452 · `EsquemaBD.md`, `CLAUDE.md` y `01-schema.sql` coinciden.
- **Observaciones:** los cambios de las tareas 2 y 3 ya estaban en el commit `bd6b303` («Arreglo bd») cuando se probó; se verificó contra ese commit.

## 2026-09-15 — Migración de Astro a React SPA (Vite + React Router)

- **Cambio:** la app pasa de Astro a una SPA con Vite, React 19, TypeScript y React Router (modo data). Se borran `astro.config.mjs` y los 11 `.astro`. Se crean `index.html`, `vite.config.ts`, `tsconfig.app/node`, `src/main.tsx`, `src/App.tsx`, `src/layouts/Base.tsx`, los hooks `useDocumentTitle` y `useScrollManagement`, las páginas Home, Posiciones, Plantilla y NotFound con loaders sobre `src/lib/`, 7 componentes `.tsx` con CSS Modules, `PixelImage.tsx` y el plugin `vite-plugins/pixel-images.ts` (sharp) en lugar de `astro:assets`. `Team.crest` y `CarouselSlide.image` pasan a `PixelImageSet`. Requisito: funcionalidad, diseño y comportamiento idénticos.
- **Archivos:** `package.json`, `package-lock.json`, `index.html`, `vite.config.ts`, `vite-plugins/pixel-images.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `src/**` (App, main, layouts, hooks, pages, components, types, data/teams, vite-env.d.ts), `CLAUDE.md`, `README.md`, `.gitignore`, `.vscode/*`, `docs/migracion-react.md`.
- **Verificación:** `npm ci` limpio · `npm run build` (`tsc -b && vite build`) sin errores ni avisos · `tsc -b --force` OK · sin `astro`/`@astrojs` en `package.json` ni en código · `dist/404.html` igual a `index.html` · 26 webp idénticas por SHA-256 a las de Astro, mismos tamaños 1x/2x, `srcset` y tamaño en pantalla · contra la línea base de Astro (`bd6b303`), con Chrome y los mismos flags: 33 de 34 capturas con 0 px de diferencia (`/`, `/posiciones` y las 3 plantillas a 390 y 1280, con y sin reduced motion, página completa, diálogo abierto y navbar desplazada). La restante es la fase de `logo-float` según el momento de montaje: congelada en el mismo instante quedan 40 px con Δ≤2 · layout computado (posición, tamaño y 18 propiedades de cada elemento visible) idéntico salvo nombres de clase · en ventana visible y con resultados iguales a Astro: scroll suave a `/#fixture` e `Inicio`, panel del navbar con `steps(4)` al desplazar, carrusel (autoplay 5 s, flechas y teclado en bucle, pausa con foco), ficha desde cancha y tabla, cierre con X, Esc y fondo con evento `close` y borrado del estado, foco a X y retorno al disparador, orden de Tab, `#stats-id`, radar de 340 celdas, compartir en escritorio (wa.me, facebook, copiar) y en móvil simulado (mismo PNG), reduced motion, navegación sin recarga con título y `aria-current`, Atrás/Adelante con scroll restaurado, 404 para id y ruta inexistentes, rutas profundas en `vite` y `vite preview` · capa de datos: páginas solo leen `src/lib` en loaders async, componentes por props · `CLAUDE.md` y `README.md` sin instrucciones de Astro, con las reglas de diseño, datos y BD intactas.
- **Observaciones:** diferencia no declarada: al cargar `/plantilla/<id>#stats-<id>` a 1280px, Astro dejaba la página desplazada 50px y la ficha 50px más arriba; React la deja centrada y la página arriba (a 390px coinciden, y el enlace con hash solo se genera en móvil). Diferencias declaradas y aceptables: primera carga en blanco hasta el JS y nada sin JS; fechas con `Intl` en el navegador (iguales en Chrome); 404 nueva (en `vite preview` responde HTTP 200 y en un hosting estático con `404.html` las rutas profundas válidas responderían 404); Atrás/Adelante reinicia el carrusel y cierra la ficha (Astro lo conservaba por bfcache); marcado no visible distinto; `logo-float` sigue incumpliendo CLAUDE.md. Pendiente: `AGENTS.md` todavía da instrucciones de Astro (`astro dev --background`, `.astro`, `astro:assets`). Durante la prueba se detuvo un `astro dev` huérfano del 14/09 que bloqueaba `npm ci` en el `node_modules` del repo.

## 2026-09-15 — AGENTS.md alineado con CLAUDE.md (Vite + React)

- **Cambio:** `AGENTS.md` se reemplaza por el mismo contenido de `CLAUDE.md` y ya no da instrucciones de Astro.
- **Archivos:** `AGENTS.md`.
- **Verificación:** `AGENTS.md` y `CLAUDE.md` idénticos (diff sin diferencias, sin contar finales de línea) · ningún otro archivo cambió después de la prueba de la migración, salvo `historial.md` · única mención a Astro: la nota histórica de `astro:assets` sobre `pixel-images.ts` · `npm run build` OK · `npm run dev` (5173) y `npm run preview` (4173) sirven `/` y `/plantilla/boca-juniors`; ambos servidores se detuvieron.
- **Observaciones:** quedan restos imprecisos fuera de alcance: comentarios «at build time» en `src/lib/matches.ts:23` y `src/lib/players.ts:14` (ahora la validación corre en el navegador) y `allowScripts.esbuild` en `package.json`. La migración sigue sin commitear, por lo que `git diff` no aísla este cambio; se verificó por contenido y fechas.

## 2026-09-15 — HTTP 200 en las rutas profundas de la SPA

- **Cambio:** reescrituras solo de las rutas reales de la app (`/posiciones` y `/plantilla/:id`, con y sin barra final, `:id` de un segmento) para que los hostings estáticos respondan 200, sin comodín `/*`. El plugin `vite-plugins/spa-rewrites.ts` genera `dist/_redirects` desde `SPA_ROUTES` (`vite.config.ts`), con destino `/` (Cloudflare Pages, que descarta `/index.html` por bucle) o `/index.html` si `NETLIFY=true`, y falla el build si `vercel.json` no coincide. Se borra `public/_redirects`; `vercel.json` queda con 4 reglas; `dist/404.html` sigue como respaldo. Corrige el primer intento, que en Cloudflare redirigía `/posiciones` a `/` e ignoraba `/plantilla/*`.
- **Archivos:** `vite-plugins/spa-rewrites.ts`, `vite.config.ts`, `vercel.json`, `public/_redirects` (borrado), `README.md` (Despliegue), `CLAUDE.md`, `AGENTS.md`.
- **Verificación:** `npm run build` OK con `dist/_redirects` de destino `/`; con `NETLIFY=true` el destino es `/index.html` (luego se limpió `dist` y se volvió al build normal) · guardia: quitar una regla de `vercel.json` hace fallar el build con el detalle esperado; restaurado con el mismo hash · `SPA_ROUTES` y `vercel.json` coinciden con las rutas de `src/App.tsx` · `wrangler pages dev` 4.132.0 sobre una copia de `dist`: «Parsed 4 valid redirect rules», sin avisos; `/`, `/posiciones`, `/posiciones/`, `/plantilla/<id>` y `/plantilla/<id>/` dan 200, igual que `/plantilla/no-existe`; `/plantilla/a/b`, `/plantilla`, `/plantilla/`, `/cualquier/cosa` y un asset inexistente dan 404 con la app; favicon, cursores, JS, CSS y webp dan 200; `/index.html` y `/404.html` dan 308 · en navegador, con y sin barra final: 0 px de diferencia, mismo título y `aria-current`, ficha por `#stats-p-10`, ficha y navegación desde `/plantilla/universitario/`, NotFound en las URLs 404 · `vite dev` y `vite preview` dan 200 con y sin barra final · ningún valor secreto de `.env` en `dist` (solo coincide el usuario `liga` dentro de los nombres de asset `la-liga-acp`) · README y CLAUDE.md describen lo probado y aclaran que Netlify y Vercel no se desplegaron · `AGENTS.md` idéntico a `CLAUDE.md` · `src/` sin cambios.
- **Observaciones:** `.wrangler/` (estado local de miniflare, sin secretos) quedó en la raíz del repo sin seguimiento y sin estar en `.gitignore`: conviene borrarlo o ignorarlo. Netlify y Vercel siguen sin probarse en un despliegue real. Un `dist/` compilado fuera de Netlify y subido a Netlify lleva destino `/` (documentado en el README).

## 2026-09-15 — Animación logo-float del Hero conforme a CLAUDE.md

- **Cambio:** `logo-float` pasa de `ease-in-out` con `rotate` y sombra desenfocada a `steps(1, end)` en 5 s, con cuatro frames de 1,25 s cada uno: sube 0, −4, −8 y −4 px en múltiplos de `--px`. La sombra es dura (`drop-shadow` con radio 0, color `--color-shadow`) y se desplaza 8/12/16/12 px. La sombra en reposo de `.league-logo`, la que se ve con reduced motion, también queda sin blur. Se mantiene `animation: none` con reduced motion.
- **Archivos:** `src/components/Hero.module.css`.
- **Verificación:** único archivo modificado; el diff contra el CSS aprobado solo toca `.league-logo` y `@keyframes logo-float` · sin ease/linear, rotate, blur ni hex nuevos · `npm run build` OK · ventana visible (`visibilityState` visible), muestreo por rAF unas 10 veces por segundo durante 6,5 s a 390px y 1280px: solo 3 transformaciones (0, −4, −8 px) y 3 sombras (8, 12, 16 px, blur 0), frames de ~1,25 s sin valores intermedios, tamaño constante (115,2 y 120 px) · `Emulation.setEmulatedMedia` con reduced motion: animación `none`, logo quieto con sombra dura de 8 px · capturas contra el estado aprobado de la migración: `/posiciones`, las 3 plantillas y el layout de todas las páginas sin cambios; en `/` las diferencias quedan dentro de la caja del logo y su sombra.
- **Observaciones:** incumplimientos previos fuera de alcance: `scroll-behavior: smooth` en `global.css` (se apaga con reduced motion); transiciones de color sin regla de reduced motion en Navbar (`.link`), Carousel (flechas) y Plantilla (`.back`); logo del Hero (115,2 px) y escudo de Plantilla escalados a tamaños no enteros; `docs/migracion-react.md` desactualizado.

## 2026-09-15 — Fechas del fixture iguales en cualquier navegador y zona horaria

- **Cambio:** `src/utils/format-date.ts` (nuevo) con `formatKickoff(iso)`, que devuelve `{ day: '05 sept', time: '20:00' }`. Usa meses fijos y aritmética UTC con la zona de la liga fija en UTC−5 (America/Lima), sin `Intl`. Acepta `Z` y `±HH:MM`; cualquier otro formato lanza error. `MatchCard.tsx` lo usa con el mismo marcado. Evita que otro motor abrevie el mes distinto o que la hora dependa de la zona del visitante.
- **Archivos:** `src/utils/format-date.ts`, `src/components/MatchCard.tsx`.
- **Verificación:** solo cambiaron esos dos archivos; `src/data` y CSS intactos; sin `Intl.` ni `toLocale` en `src` · prueba propia contra `Intl` (`es`, `America/Lima`) con 35 casos: las 6 fechas de `src/data`, los 12 meses, medianoche, 23:59, cambio de día y de año, entradas con `Z`, `+09:00`, `+05:30`, `-03:00` y `+00:00`, bisiesto, cambio de hora de EE. UU. y sin segundos. 0 fallos con `TZ` UTC, Asia/Tokyo, America/Los_Angeles y Pacific/Kiritimati, con salida idéntica en las 4 zonas · formatos inválidos lanzan un error claro · navegador (`vite preview` en 4500): los 6 `<time>` con el mismo `datetime` y el mismo texto que el HTML de Astro de la línea base · CDP `Emulation.setTimezoneOverride` con Tokyo, Los Ángeles y Kiritimati: textos iguales · capturas de `/` a 390 y 1280 contra el estado aprobado: 0 px en la página completa · `npm run build` OK.
- **Observaciones:** un `kickoff` mal formado lanza error durante el render de `MatchCard`; la ruta `/` no tiene `ErrorBoundary` (solo `/plantilla/:id` tiene `RouteError`), así que un solo dato roto reemplazaría toda la página de inicio, navbar incluida, por el error por defecto de React Router (conclusión por lectura de `src/App.tsx`, no ejecutada). Además, valores fuera de rango con formato válido (mes 13, día 32, hora 25) no lanzan error y se normalizan en silencio (`2026-13-05` sale como «05 ene»). Conviene validarlos en la capa de datos. El dev del usuario en 5173 no se tocó.

## 2026-09-15 — Ficha por hash en escritorio igual a Astro

- **Cambio:** `SquadBoard` abre la ficha del hash (`#stats-<id>`) en un `useLayoutEffect`, antes de que el layout coloque el scroll, y `useScrollManagement` detecta la ficha abierta, espera `document.fonts.ready` y llama `scrollIntoView()` con el comportamiento CSS. Así la ficha queda bajo el navbar como en Astro. Además, Atrás/Adelante ya no la reabre (`isInAppHistoryTraversal`). Commit `91ade9c`.
- **Archivos:** `src/hooks/useScrollManagement.ts`, `src/components/SquadBoard.tsx`.
- **Verificación:** contra Astro `bd6b303` en un worktree temporal, 2 fichas × 3 cargas × caché fría y caliente × headless y ventana visible: a 1280 ambos terminan en `y=49` con la ficha en `top=80,11` (headless) y `y=48,8` / `top=80` (visible); a 390, `y=0` y `top=16`. Sin variación entre corridas en ninguno de los dos · sin regresiones: clic desde cancha y tabla, cierre con X, Esc y fondo, foco al abrir (botón X) y al volver al disparador, Atrás/Adelante sin reabrir la ficha y con el mismo scroll, recarga sin hash conservando `y=150`, y dev con StrictMode (una sola ficha abierta, `close` una vez, sin errores de consola) · `npm run build` OK.
- **Observaciones:** (a) al llegar por hash Astro deja el foco en el `dialog` y React en el botón X. (b) `/#fixture` desde otra página: medido, Astro anima el scroll (~630 ms, con valores intermedios) porque es una carga de página con `scroll-behavior: smooth`, y React salta al destino (~50 ms). El ejecutor tiene razón; mi reporte de la tarea 4 midió el caso de la misma página, donde ambos animan igual (~500 ms). (c) **Diferencia nueva:** recargar (F5) una URL con hash a 1280 deja Astro en `y=49` / `top=80` y React en `y=0` / `top=129`, con la ficha centrada y visible; a 390 coinciden. Viene del retorno temprano de `useScrollManagement` cuando restaura con la ficha abierta. (d) `docs/migracion-react.md` sigue desactualizado en la sección 12 y en la diferencia 6.

## 2026-09-15 — Ficha del jugador sin tabla de stats en móvil

- **Cambio:** en `PlayerStatsDialog.module.css`, `.values` pasa a `display: none` por defecto (mobile first) y vuelve a `display: table` dentro del `@media (min-width: 48rem)` que ya existía. Pedido del usuario: en móvil basta el radar. Sin cambios de marcado ni de JS. Consecuencia aceptada: la imagen que se comparte desde un teléfono sale sin tabla (nombre, media, retrato y radar).
- **Archivos:** `src/components/PlayerStatsDialog.module.css`.
- **Verificación:** único archivo modificado; resto de `src/` intacto · 390px: la tabla no se ve, no ocupa espacio (`display: none`, rect 0x0) y no aparece en el árbol de accesibilidad (0 tablas, 0 filas, 0 textos de atributos; el fondo queda inerte por el modal). La ficha pasa de 812 a 700 px de alto y entra completa en 390x844 sin scroll interno · 1280px: ficha idéntica a la aprobada, 0 px de diferencia, con la tabla en su sitio · punto de corte: 767px sin tabla, 768px y 769px con tabla · redimensionar en vivo 390 → 1280 → 390 → 1280 con la ficha abierta: aparece y desaparece y sigue centrada (márgenes 16/16 y 192/192) · pantallas bajas 390x620 y 390x500: la ficha entra en la ventana, con scroll interno; al abrir se ve el botón Cerrar (44x44) y los de compartir (159x44) tras bajar; cierra con Esc y con el botón · compartir en móvil: la imagen sale sin tabla, completa y sin recortes (1170x1719), y WhatsApp, Facebook y Copiar enlace siguen funcionando · `/`, `/posiciones` y 2 plantillas con la ficha cerrada: 0 px a 390 y 1280 · `npm run build` OK.
- **Observaciones:** en la imagen compartida el radar sale como un círculo negro sólido, sin anillo ni relleno. **No lo causa este cambio:** pasa igual a 1280 y la imagen de Astro `bd6b303` tiene el mismo defecto (a 1280 las dos son byte a byte iguales, 122 920 bytes). Al quitar la tabla, el radar queda como único dato de la imagen en móvil, así que conviene arreglarlo aparte (parece que `html-to-image` no resuelve los `<rect>` del SVG).

## 2026-09-15 — Radar visible en la imagen compartida

- **Cambio:** en `PlayerStatsDialog.tsx`, un `useLayoutEffect` recorre el `<svg>` del radar y copia el color ya resuelto (`getComputedStyle().fill`) como atributo de presentación `fill` en cada `<rect>`, por tipo (`disc`, `ring`, `fill`, `edge`). `html-to-image` clona el SVG sin los estilos de sus descendientes, así que los `rect` perdían el color de las clases del CSS Module y el radar salía como un círculo negro. Al ser atributo de presentación tiene la menor prioridad, así que en pantalla sigue mandando el CSS Module.
- **Archivos:** `src/components/PlayerStatsDialog.tsx`.
- **Verificación:** único archivo del cambio (`pixel-radar.ts`, `share-image.ts`, datos y tipos intactos) · pantalla idéntica: ficha a 390 y 1280 con 0 px de diferencia contra el estado aprobado · imagen compartida generada para 4 jugadores (p-01, p-03, p-10 y p-15) a 390 y 1280: el radar tiene anillo, disco, relleno y borde, sin píxeles negros · la forma del polígono coincide con la de pantalla en los 6 ejes (desvío máximo 1 %, ruido de medición) y las proporciones también (relleno sobre anillo 0,77–0,82 y relleno sobre disco 56–60 %, iguales en ambas), a escala 3× exacta · cada jugador da una forma distinta · colores desde los tokens: `disc` = `--color-surface-raised` (35,39,82), `ring` = `--color-border` (77,83,166), `edge` = `--color-accent-alt` (255,210,63) y `fill` = `color-mix` al 35 % (112,99,75); ningún `rect` sin atributo `fill` (340–360 por ficha) · robustez: 4 aperturas y cierres, cambio de jugador y redimensionar 390 → 1280 → 390 antes de compartir, más `prefers-reduced-motion` y una segunda captura del mismo jugador: el radar sale bien siempre · imágenes de 81–125 kB, completas y sin recortes · todo sobre el build servido con `vite preview` · `npm run build` OK.
- **Observaciones:** el atributo copiado usa la sintaxis `color(srgb …)` que devuelve `getComputedStyle` para el `color-mix`; Chrome la interpreta bien en el clon exportado. En el árbol de trabajo hay dos cambios ajenos a esto: `.gitignore` ahora ignora `.wrangler/` (la observación que dejé en el pendiente 2) y `docs/business-rules.md` aparece vacío, sin seguimiento.

## 2026-09-15 — T-01 · Esquema de la polla deportiva

- **Cambio:** `EsquemaBD.md`, `db/init/` y la sección Database design de `CLAUDE.md` (copiada a `AGENTS.md`) se reescriben según `docs/business-rules.md`. Quedan 22 tablas, 27 FKs y 13 CHECK: `disciplina` se separa en `deporte` + `competicion`; desaparecen `mercado`, `apuesta`, `partido_jugador`, `estadistica_tipo` y `partido_jugador_estadistica`; se agregan `estado_usuario`, `estado_pago`, `gol`, `tipo_apuesta`, `resultado_general`, `estado_seleccion`, `ticket`, `seleccion`, `tipo_movimiento`, `movimiento_moneda`, `accion_auditoria` y `auditoria`. Monedas y puntos son enteros; `usuario.saldo_monedas` se guarda como columna y los puntos se calculan con `SUM`.
- **Archivos:** `EsquemaBD.md`, `db/init/01-schema.sql`, `db/init/02-catalogos.sql`, `CLAUDE.md`, `AGENTS.md`, `docs/plan-polla.md`.
- **Verificación:** cobertura regla por regla de las BR que tocan datos (BR-003 a BR-047 y NFR-006): todas tienen soporte; lo que no puede expresar el esquema queda como regla de backend y está documentado · la tabla de conflictos de `plan-polla.md` se cumple: varias selecciones por partido, ticket con selecciones, los dos tipos de apuesta, puntos enteros 3/1/3/0 (`CHECK ... IN (0,1,3)`), monedas enteras, estados de partido `programado`/`en_curso`/`finalizado`/`cancelado`, usuario con estado y pago, sin mercado de campeón · convenciones: MySQL 8.4.11, InnoDB en las 22 tablas, `utf8mb4_unicode_ci`, `snake_case` en español, todos los `id` `BIGINT UNSIGNED`, `DATETIME` sin `DEFAULT CURRENT_TIMESTAMP`, catálogos con `codigo` único, sin `DECIMAL`/`FLOAT`, nada calculado guardado salvo `saldo_monedas` · base recreada desde cero (`down -v` + `up -d`): healthy, init sin errores, 0 filas de datos y catálogos con acentos correctos · pruebas propias con ROLLBACK (0 filas después): FKs compuestas de `plantel`, `partido_equipo` y `gol` (1452), lados y camisetas duplicados (1062), email repetido (1062), saldo negativo bloqueado por el tipo (1690), `cantidad = 0`, puntos = 2 y pronóstico doble o ausente (3819), borrado de un deporte en uso (1451), movimiento repetido de la misma selección y tipo (1062), y devolución con otro tipo aceptada · casos de borde: dos tickets del mismo usuario, tercera selección contradictoria, movimiento sin selección, gol de un jugador ajeno al plantel y auditoría sin administrador · `npm run build` OK · `EsquemaBD.md`, el SQL, `CLAUDE.md` y `business-rules.md` coherentes, incluidas las dos resoluciones del usuario (BR-015: el empate depende de `deporte.permite_empate`, que sigue en el esquema y se aplicará en backend; BR-007: sin "Estado" suelto, bastan `estado_pago` y `estado_usuario`) · `AGENTS.md` idéntico a `CLAUDE.md`.
- **Observaciones:** quedan a cargo del backend, sin barrera en la base: BR-008 «una sola vez» (probé dos movimientos de validación de +10 al mismo usuario y los acepta; se podría cerrar con una columna generada y un índice único); `usuario.saldo_monedas` puede desincronizarse de `SUM(movimiento_moneda)` (lo reproduje: columna 8 contra suma 19), así que conviene una prueba de consistencia periódica; `seleccion.puntos_obtenidos` admite valor con estado `pendiente`; `auditoria.usuario_id` no exige rol `admin` y `entidad_id` no tiene FK (documentado); `gol.minuto` no tiene tope y los goles registrados no tienen que cuadrar con `partido_equipo.goles`. Menores: no hay índice propio sobre `partido.fecha_hora`, que es el orden de BR-013, y `EsquemaBD.md:31` todavía explica el marcador `[preguntar]` aunque ya no queda ninguno. Ajeno a T-01: `src/components/Navbar.module.css` está modificado en el árbol (logo del navbar desde 64rem), sin relación con esta tarea.

## 2026-09-16 — T-02 · Esqueleto del backend

- **Cambio:** backend en `server/` con su propio `package.json`: Express 5 + TypeScript en capas `routes` → `controllers` → `services` → `db/pool.ts`, con el pool inyectado desde `app.ts`. La configuración se valida con zod en `config/env.ts`: si algo falta o es inválido, el proceso sale con exit 1, un mensaje claro y sin stack. Todas las respuestas usan el sobre `{ data }` / `{ error: { code, message, details? } }` y los errores esperados usan `HttpError`. `GET /health` consulta la base en vivo con un reintento: 200, o 503 `DATABASE_UNAVAILABLE`, y el servidor arranca aunque la base esté caída. El pool usa `timezone: 'Z'`. Seguridad: helmet, CORS solo para `CORS_ORIGIN`, rate limit (sin contar `GET`/`HEAD /health`) antes de un límite de body de 100 KB. Pruebas con Vitest + Supertest sobre `la_liga_acp_test`, recreada desde `db/init` en cada corrida. Servicio `server` en `compose.yaml` con nodemon `--legacy-watch`. Scripts `server:*` en la raíz, incluido `server:typecheck`.
- **Archivos:** `server/**` (src, tests, `package.json`, `Dockerfile`, `.dockerignore`, `tsconfig*`, `vitest.config.ts`, `README.md`), `compose.yaml`, `.env.example`, `.gitignore`, `package.json`, `README.md`, `CLAUDE.md`, `AGENTS.md`.
- **Historia de la prueba:** se reprobó dos veces.
  - **Primer intento.** JSON mal formado, un cuerpo de más de 100 KB y un charset no soportado respondían 500 `INTERNAL_ERROR`. Además, con `NODE_ENV=development` exportado, las pruebas resolvían la base principal (`resetDatabase` la habría vaciado), y nada impedía que `MYSQL_DATABASE_TEST` fuera igual a `MYSQL_DATABASE`, en cuyo caso `global-setup` la habría borrado.
    - **Corrección 1:** esos cuerpos pasan a dar 400 `INVALID_JSON`, 413 `PAYLOAD_TOO_LARGE` y 415 `UNSUPPORTED_MEDIA_TYPE`. `vitest.config.ts` fuerza `NODE_ENV=test`, `env.ts` rechaza bases iguales, y `global-setup` y `resetDatabase` abortan si el destino no es la base de pruebas. `resetDatabase` conserva los catálogos. `/health` sale del rate limit y el limitador pasa antes de `express.json`.
  - **Segundo intento.** Un cuerpo gzip o brotli corrupto (error con status 400 y `expose`, pero sin `type`) seguía dando 500 y quedaba en el log.
    - **Corrección 2:** todo error con `expose: true` y status 4xx es error de cliente (código específico si el `type` es conocido, `BAD_REQUEST` si no) y no se registra en el log. La exclusión de `/health` sigue el criterio de Express: sin distinguir mayúsculas, con o sin barra final, solo `GET`/`HEAD`.
- **Verificación final:**
  - **Instalación y pruebas:** `npm ci` en `server/`, `npm run server:typecheck` (exit 0) y las pruebas dos veces seguidas con `NODE_ENV=development` exportado (7 archivos, 30/30). `npm run build` del front OK.
  - **Errores de cuerpo, contra el contenedor en 3001:** JSON mal formado 400 `INVALID_JSON`; 150 KB 413; charset desconocido 415; gzip, brotli y deflate corruptos y gzip truncado 400 `BAD_REQUEST`, sin detalles de zlib y sin log. Content-Encoding desconocido 415; JSON escalar y utf-16 400.
  - **Errores internos:** `errorHandler` montado en una app temporal. Un error real de mysql2 (tabla inexistente), un `ECONNREFUSED`, un error con `expose` y status 500, uno 400 sin `expose` y uno con status en texto dan `INTERNAL_ERROR` genérico con un solo log y sin filtrar detalles.
  - **Guardias, con una fila testigo en la base principal:** la suite con `NODE_ENV=development` usó `la_liga_acp_test`. Con `MYSQL_DATABASE_TEST=la_liga_acp`, el proceso y la suite se niegan antes de tocar nada, y un nombre con caracteres de inyección se rechaza. `resetDatabase` contra un pool de la principal aborta antes de pedir la conexión del truncate. La testigo siguió y después se borró.
  - **Base de pruebas:** los catálogos quedan intactos tras el reset.
  - **Rate limit, en instancia propia:** `/health`, `/HEALTH`, `/Health/` y `HEAD` no consumen ni llevan `RateLimit-*`. `POST /health`, `/health/extra`, `/healthz` y las demás rutas sí consumen, y un JSON inválido también cuenta. Se ve el 429 con sobre y `Retry-After`, y `/health` sigue en 200 después.
  - **Configuración:** una configuración inválida da exit 1 sin stack.
  - **Health y seguridad:** `/health` da 200, 503 con `db` detenida y vuelve a 200 sin reiniciar el server; 404 con sobre. CORS nunca refleja un origen ajeno, preflight incluido, y helmet está completo.
  - **Docker:** `up -d --build` levanta `db` y `server`, `/health` responde también desde dentro del contenedor, la recarga en caliente tarda unos 2 s y la imagen no lleva secretos.
  - **Documentación y front:** `CLAUDE.md` y `AGENTS.md` idénticos y coherentes; `src/` y `business-rules.md` sin cambios.
- **Observaciones:**
  - El 503 de `/health` tarda 8–9 s con la base caída (propuesta de `connectTimeout` de 2 s pendiente de decisión del usuario).
  - `/health//` (doble barra) responde el health pero consume el límite; sin importancia.
  - El preflight `OPTIONS` lo resuelve CORS antes del limitador.

## 2026-09-16 — T-03 · Registro, login y roles (backend)

- **Cambio:** autenticación y autorización en `server/`.
  - **Rutas:** `POST /auth/register` (201, sin abrir sesión; siempre `apostador`, `pendiente`, pago `pendiente` y 0 monedas), `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` y `GET /admin/sesion` como prueba de protección.
  - **Contraseñas:** argon2id, de 10 a 128 caracteres. Si el correo no existe, el login igual verifica un hash de relleno.
  - **Credenciales incorrectas:** la respuesta es siempre la misma, 401 `INVALID_CREDENTIALS`.
  - **Sesiones en servidor:** tabla `sesion` con el SHA-256 del token, `ON DELETE CASCADE`, `CHECK` de vencimiento e índice `idx_sesion_expira_en`. Cada login purga las sesiones vencidas de todos los usuarios. La cookie es HttpOnly, SameSite=Strict y Path=/, dura 12 h, y en producción es `Secure` con prefijo `__Host-`.
  - **CSRF:** `Origin` más un token firmado con `SESSION_SECRET` en todo lo que no sea GET/HEAD/OPTIONS.
  - **Middlewares:** `requireAuth` (401), `requireRole('admin')` (403) y `requireValidated` (403 `USER_NOT_VALIDATED`).
  - **Límites:** login con 5 fallos por IP + correo cada 15 min (los éxitos no cuentan); registro con 10 por IP por hora (decisión del usuario: se mantiene el 409 `EMAIL_TAKEN`). `TRUST_PROXY` configurable, nunca `true`. `SESSION_SECRET` obligatorio y rechaza valores de ejemplo.
  - **`admin:create`:** crea o promueve un administrador. Pide la clave sin eco y con confirmación, y también acepta `ADMIN_PASSWORD_FILE` o `ADMIN_PASSWORD_STDIN=1`. Al promover no toca contraseña, estado ni saldo, y avisa si ignoró una clave.
  - **Pruebas:** `resetDatabase` pasa a usar `DELETE`.
  - **Documentación:** `business-rules.md` alinea BR-003 y BR-004 (se entra con correo) y aclara BR-001: el panel no cambia roles, con nota en T-21 de `plan-polla.md`.
- **Archivos:** `server/src/**` (cli, config/env.ts, app.ts, controllers, lib, middleware, routes, schemas, services, types), `server/tests/**`, `server/package.json`, `server/package-lock.json`, `db/init/01-schema.sql`, `EsquemaBD.md`, `compose.yaml`, `.env.example`, `README.md`, `server/README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/business-rules.md`, `docs/plan-polla.md`.
- **Historia de la prueba:** se reprobó una vez. En el primer intento, `admin:create` recibía la clave en `ADMIN_PASSWORD` y los ejemplos de los dos README la escribían en la línea de comandos: quedaba en el historial de la terminal y, con `docker compose exec -e`, completa en la línea de comandos de `docker.exe` y `docker-compose.exe` (verificado escaneando procesos), aunque el README decía lo contrario.
  - **Corrección:** prompt sin eco con confirmación, las fuentes `ADMIN_PASSWORD_FILE` y `ADMIN_PASSWORD_STDIN`, y README corregidos con la explicación del riesgo.
  - **Observaciones incorporadas en la misma corrección:** rechazo del `SESSION_SECRET` de ejemplo, índice y purga global de sesiones, `TRUST_PROXY`, límite de registro por IP y mensajes más claros de `admin:create`.
- **Verificación final:**
  - **Instalación y pruebas:** `npm ci`, `npm run server:typecheck` (exit 0) y pruebas dos veces seguidas (14 archivos, 135/135). `npm run build` del front OK.
  - **Base:** recreada desde cero con `down -v` + `up -d --build`, sin errores; 23 tablas; `sesion` con PK, único de `token_hash`, `idx_sesion_expira_en` e índice de la FK.
  - **`admin:create` interactivo:** probado en una consola real (ConPTY con PowerShell y PSReadLine) siguiendo los ejemplos de los README, local y con `docker compose exec -it`.
    - La clave no se muestra, no queda en el historial de PSReadLine ni aparece en la línea de comandos de ningún proceso del host o del contenedor (escaneado entre la clave y su confirmación).
    - La confirmación distinta da «Las contraseñas no coinciden» con exit 1; Ctrl+C da «Cancelado» con exit 130.
    - `ADMIN_PASSWORD_FILE` (con CRLF y segunda línea), `ADMIN_PASSWORD_STDIN=1` local y `docker compose exec -T ... < archivo` crean administradores que después entran con esa clave.
    - Un archivo inexistente, dos fuentes a la vez, la falta de `ADMIN_EMAIL`, un correo nuevo sin clave ni terminal y una clave débil dan mensajes claros con exit 1.
    - Al promover un apostador validado con saldo 7 y una clave en archivo, avisa que la ignoró y el hash, el saldo y el estado quedan iguales; la clave original sigue entrando y la repetición dice «Ya era administrador».
  - **`SESSION_SECRET`:** se rechazan el valor de `.env.example`, `changeme…`, uno con «secreto», `Example…` y valores repetitivos o cortos; un secreto aleatorio arranca.
  - **Purga de sesiones:** el login de otro usuario borró una sesión vencida y dejó intactas las vigentes; `EXPLAIN` de la purga usa `idx_sesion_expira_en`.
  - **`TRUST_PROXY`:** sin configurar, cambiar `X-Forwarded-For` no evita el 429; con `1` la IP informada separa los contadores; `true`, `yes`, `-1` y un CIDR inválido se rechazan; `loopback`, una lista de rangos y `2` se aceptan.
  - **Límite de registro:** éxito, 409 y 400 cuentan, el cuarto intento con límite 3 da 429 `RATE_LIMITED` con `Retry-After`, el 409 no cambió y el login no se ve afectado.
  - **Casos propios del primer intento:** siguen pasando.
    - **Registro:** ignora los campos de rol, saldo y estado, normaliza el correo y valida los campos.
    - **Login:** fallo idéntico y con tiempos parecidos para correo inexistente y clave incorrecta; un éxito no reinicia el contador de fallos.
    - **Sesión y cookie:** `/auth/me` no expone el hash, la sesión vencida da 401, el logout invalida la cookie vieja y los flags son correctos en desarrollo y en producción.
    - **CSRF:** sin token, con token ajeno o de otra sesión, alterado, con Origin ajeno o `null` y en rutas en mayúsculas da 403, sin cortar la sesión; GET y HEAD no cambian nada.
    - **Autorización:** 401, 403 y 200 según corresponde, con cambios de rol y de estado aplicados en la petición siguiente; `requireValidated` probado con el middleware real; cascada al borrar el usuario.
    - **Repaso tras recrear la base:** registro, login, CSRF y autorización correctos.
  - **Documentación:** BR-001, BR-003 y BR-004 coherentes con el resto; `CLAUDE.md` y `AGENTS.md` idénticos; README al día; `compose.yaml` y `.env.example` con las variables nuevas.
  - **Limpieza:** los datos de prueba de la base de desarrollo se borraron (0 usuarios, 0 sesiones).
- **Observaciones:**
  - El `DELETE` de `resetDatabase` no debilita las guardias de T-02 y ninguna prueba depende de ids fijos.
  - Si alguien escribe la clave antes de que aparezca el prompt, la terminal la toma como comando y queda en su historial (comportamiento normal de cualquier prompt; lo vi al principio por un error de mi propio script).

## 2026-09-16 — T-04 · Validación de participantes (backend)

- **Cambio:** API de administración para validar participantes (BR-005 a BR-008).
  - **Tabla de inscritos:** `GET /admin/participantes`, paginada, con filtros de pago y validación, búsqueda por nombre o correo y orden por fecha de inscripción. Sin query string desconocida: un parámetro extra da 400.
  - **Conteos:** `GET /admin/participantes/conteos` da inscritos y validados; no acepta query.
  - **Acciones:** `POST /admin/participantes/:id/pago/confirmar`, `/pago/revertir` y `/validar`.
    - Validar exige el pago confirmado y da +10 monedas una sola vez. Usa una transacción con UPDATE condicional desde `pendiente` y un movimiento `validacion` (`MONEDAS_POR_VALIDACION` en `lib/coins.ts`).
    - El pago solo se revierte mientras el usuario sigue pendiente.
  - **Cambio de alcance durante la tarea (pausa del coordinador):** los administradores no participan en la polla.
    - La tabla y los conteos muestran solo apostadores y el filtro `rol` desapareció.
    - Las acciones sobre un admin dan 404 `NOT_A_PARTICIPANT`.
    - `requireRole` compara el rol exacto.
    - `requireBettor` reemplaza a `requireValidated` y responde 403 `ADMIN_CANNOT_BET` o `USER_NOT_VALIDATED`.
    - `admin:create` solo promueve cuentas limpias.
  - **Query string:** `rejectQueryParams` en `/auth/*` y en las rutas de `/admin` sin parámetros. En login y registro va antes del limitador propio, así que un 400 por query no cuenta como fallo ni gasta cupo (el limitador general sí lo cuenta). Hay una nota para T-18 en `server/README.md` y en `docs/plan-polla.md`.
  - **Mensajes de `page` y `pageSize`:** cada caso tiene el suyo (no es número, no es entero, menor que 1, mayor que el tope). `page` tiene tope 100000 y `pageSize` 100.
- **Archivos:**
  - **Rutas y controladores:** `server/src/routes/admin.route.ts`, `participants.route.ts`, `auth.route.ts`; `server/src/controllers/participants.controller.ts`.
  - **Servicios:** `server/src/services/participants.service.ts`, `participant-validation.service.ts`, `admin-bootstrap.service.ts`.
  - **Esquemas:** `server/src/schemas/participants.schema.ts`, `common.schema.ts`.
  - **Middleware y utilidades:** `server/src/middleware/auth.ts`, `no-query.ts`; `server/src/lib/coins.ts`, `error-codes.ts`; `server/src/db/transaction.ts`.
  - **Pruebas:** `server/tests/participants-list.test.ts`, `participants-actions.test.ts`, `query-params.test.ts`, `auth-rate-limits.test.ts`, `authorization.test.ts`, `create-admin.test.ts`.
  - **Documentación:** `server/README.md`, `docs/plan-polla.md` (notas en T-09, T-10, T-15, T-16, T-17, T-18 y T-21).
- **Verificación:**
  - **Chequeos:** `npm run server:typecheck` sin errores; 224/224 pruebas dos veces seguidas; `npm run build` del front sin errores ni advertencias; `CLAUDE.md` y `AGENTS.md` idénticos.
  - **Reprobaciones y correcciones:**
    - **Primera reprobación:** los conteos ignoraban la query (`?rol=admin` daba 200). Corregido: ahora dan 400.
    - **Segunda reprobación:** un login con query y clave correcta daba 400 pero contaba como fallo, y el sexto intento bloqueaba con 429. Además, `page=100001` decía «page debe ser un número». Ambas cosas están corregidas.
  - **Re-test final (instancia local con límite de registro 3):**
    - **Login con query:** 6 intentos con `?next=/x` y clave correcta dieron 400 sin cookie, y 6 con clave incorrecta, 400. Después, el login sin query dio 200.
    - **El límite de login sigue funcionando:** con clave incorrecta sin query hubo cinco 401 y el sexto dio 429 `RATE_LIMITED`. Mientras dura el bloqueo, la clave correcta da 429 y con query da 400. Otro correo desde la misma IP entra.
    - **Registro:** 6 intentos con query dieron 400 y no crearon cuentas; después, el registro sin query dio 201. Sin query, el tercero dio 201 y el cuarto 429 sin crear la cuenta; con el cupo agotado, un intento con query da 400.
    - **El limitador general sí descuenta los 400 por query:** `RateLimit-Remaining` baja en cada uno.
    - **Mensajes de `page` y `pageSize`:** `abc`, `1.5`, `0`, `-3`, `100001` y `101` dan cada uno su mensaje. `page=100000` y `pageSize=100` dan 200, y si fallan los dos parámetros llegan los dos detalles.
  - **Repaso de T-04 (script propio de 114 casos, sin fallos):**
    - **Tabla:** solo apostadores, filtros, búsqueda con comodines escapados y paginación.
    - **Conteos:** excluyen a los admins; con query dan 400.
    - **Acciones:** confirmar, validar y revertir; validación doble; 10 validaciones en paralelo con un solo +10.
    - **Admins:** las acciones sobre admins dan 404 sin efectos.
    - **Middlewares:** `requireBettor` y `requireRole` exacto.
    - **Query en `/auth/*` y `/admin/sesion`:** da 400 sin efectos.
  - **Orden de las comprobaciones:** 401 (anónimo), luego 403 `FORBIDDEN` (apostador), luego 403 `CSRF_FAILED` (sin token u Origin ajeno) y por último 400 (query o id inválido). Ninguna de esas peticiones cambió al usuario. Login y registro con Origin ajeno y query dan 403. El logout con query da 400 y la sesión sigue viva. Como control positivo, confirmar y validar dan 200 con +10 y un solo movimiento.
  - **Limpieza:** se borraron los datos de prueba de la base de desarrollo (usuarios, sesiones, movimientos, tickets, selecciones, partido, competición y deporte: todo en 0). La base y el server de Docker quedan corriendo.
- **Observaciones:**
  - **Detalles menores de los mensajes:** `page=` (vacío) responde «page debe ser 1 o mayor». Un número más allá del rango seguro, como `9007199254740993`, trae dos detalles («entero» y «mayor que 100000»). Los dos casos dan 400.
  - **D19 (ya documentado):** un movimiento `validacion` con `seleccion_id` esquiva la barrera de unicidad, y dos movimientos del mismo tipo sin selección chocan.

## 2026-09-16 — T-05 · Saldo y movimientos (backend)

- **Cambio:** saldo y movimientos de monedas (BR-009, BR-010, BR-020 a BR-022, BR-046, BR-047, BR-055, tablas 27 y 28).
  - **Un único punto que mueve monedas:** `services/coins.service.ts`. Su función principal es `applyCoinMovements(conn, usuario, movimientos)` y tiene tres atajos:
    - `grantValidationCoins`, que T-04 ya usa;
    - `debitSelections`, para T-10;
    - `refundSelections`, para T-16.
  - **Qué hace en la transacción del llamador:**
    - Bloquea la fila del usuario y rechaza el saldo negativo con 409 `INSUFFICIENT_BALANCE`, sin efectos.
    - Comprueba D19 y que cada selección sea del usuario.
    - Exige que cada devolución tenga su débito y ninguna devolución previa: si no, responde 409 `SELECTION_NOT_DEBITED` o `MOVEMENT_ALREADY_APPLIED` con `details.selecciones`.
    - Inserta los movimientos y fija el saldo.
  - **Tipos y montos:** los tipos se buscan por código con `Object.hasOwn`; los montos están en `lib/coins.ts`.
  - **Contrato de transacción exigido:** las funciones reciben `TransactionConnection`, que solo entrega `withTransaction`. Llamarlas con una conexión común no compila y, si se fuerza, se rechaza en ejecución antes de escribir.
  - **Rutas:**
    - `GET /monedas/saldo` y `GET /monedas/movimientos` (paginado, del más reciente al más antiguo) usan `requireParticipant`: un admin recibe 403 `NOT_A_PARTICIPANT`.
    - `GET /admin/monedas/consistencia` es de solo lectura.
  - **Consistencia:** `npm run coins:check` sale con 0 si todo cuadra, 1 si hay descuadres o admins con monedas, y 2 si no pudo correr.
  - **Esquema:** índice nuevo `idx_movimiento_usuario_fecha`.
  - **Reglas:** BR-009 y BR-046 precisados.
- **Archivos:**
  - **Servicios:** `server/src/services/coins.service.ts`, `coin-history.service.ts`, `coins-consistency.service.ts`, `participant-validation.service.ts`.
  - **Base y utilidades:** `server/src/db/transaction.ts`; `server/src/lib/coins.ts`, `error-codes.ts`.
  - **CLI, rutas y middleware:** `server/src/cli/coins-check.ts`; `server/src/routes/coins.route.ts`, `admin.route.ts`, `index.ts`; `server/src/controllers/coins.controller.ts`; `server/src/middleware/auth.ts`.
  - **Esquemas:** `server/src/schemas/common.schema.ts`, `participants.schema.ts`.
  - **Pruebas:** `server/tests/coins-service.test.ts`, `coins-routes.test.ts`, `helpers/participants.ts`.
  - **Base de datos y documentación:** `db/init/01-schema.sql`, `EsquemaBD.md`, `docs/business-rules.md`, `docs/plan-polla.md` (notas en T-10 y T-16), `README.md`, `server/README.md`, `CLAUDE.md`, `AGENTS.md`, `package.json`, `server/package.json`.
- **Verificación:**
  - **Chequeos:** `npm run server:typecheck` sin errores; 286/286 pruebas dos veces seguidas; build del front sin errores ni advertencias; `CLAUDE.md` y `AGENTS.md` idénticos.
  - **Reprobación:** en el primer test, `refundSelections` devolvía una selección que nunca se había debitado (el saldo pasó de 10 a 11). Además, los nombres del prototipo (`toString`, `constructor`, `__proto__`) pasaban la validación de tipo, y el contrato de transacción no se exigía: en autocommit, un lote con una selección repetida dejaba 2 movimientos sin tocar el saldo. Las tres cosas están corregidas.
  - **Devoluciones (pruebas propias):**
    - **Rechazos sin efectos:**
      - Una selección nunca debitada da 409 `SELECTION_NOT_DEBITED` con `details.selecciones`, sin datos personales.
      - Un lote mixto se rechaza entero.
      - Una devolución repetida, duplicada en el lote o seguida de un nuevo débito da 409 `MOVEMENT_ALREADY_APPLIED`.
      - Débito y devolución de la misma selección en un mismo lote se rechazan.
      - Un débito cargado a nombre de otro usuario no cuenta.
    - **Concurrencia:**
      - 12 devoluciones paralelas de la misma selección: pasa una.
      - Devolución contra débito de la misma selección (10 rondas): el saldo queda en 9 o 10, sin errores 500.
      - Mezcla de 30 operaciones: 10 débitos y 8 devoluciones, saldo igual a la suma y ninguna devolución huérfana en la base.
  - **Tipos:** `toString`, `constructor`, `__proto__`, `hasOwnProperty`, `valueOf`, `isPrototypeOf`, un número y `undefined` dan el mismo error de tipo desconocido, sin efectos.
  - **Contrato de transacción:**
    - Un archivo temporal con conexiones comunes (incluida una con `beginTransaction` manual) falla el typecheck exactamente en las 5 llamadas y en el tipo `bono`.
    - Forzado en ejecución, en autocommit, con transacción manual o con una conexión que quedó de una `withTransaction` ya cerrada, se rechaza sin escribir.
    - `withTransaction` deshace todo ante un `TypeError`, un string lanzado, un error SQL o `undefined`. Tras 40 fallos seguidos el pool sigue disponible.
  - **Repaso de lo aprobado en el primer test (sigue pasando):**
    - **Escritura:** ninguna otra parte de `server/src` escribe monedas.
    - **Débitos:** saldo insuficiente sin efectos; lotes atómicos; 25 débitos paralelos sobre 10 monedas dejan pasar 10; débitos contra devoluciones y validación contra débitos sin errores 500 ni bloqueos mutuos.
    - **T-04:** da +10 una sola vez; revalidar tras un reset manual da 409.
    - **Rutas:** 401, 403, 400 de query estricta, pendiente con saldo 0, orden, fechas UTC, paginación, coherencia con `/auth/me`; la consistencia de admin es solo de lectura.
    - **`coins:check`:** 0 con la base sana, 1 con un descuadre provocado y un admin con monedas, 2 con la base caída, un host inalcanzable o una configuración inválida.
    - **Esquema:** base desde cero con 23 tablas, y `EXPLAIN` usa el índice nuevo.
  - **Reglas:** BR-046 precisado es coherente con BR-045, BR-047 y BR-055.
  - **Limpieza:** la base de desarrollo quedó sin datos de prueba; la base y el server de Docker siguen corriendo.
- **Observaciones:**
  - En la segunda corrida del primer test hubo un cuelgue aislado de Vitest: en `coins-routes.test.ts`, el `beforeEach` (`resetDatabase`) superó el tiempo límite tras 103 s. No se repitió en las tres corridas completas siguientes.
  - Una selección duplicada dentro del lote responde «Esa selección ya se había devuelto» aunque no se hubiera devuelto antes. El código 409 es correcto; el texto es impreciso.

## 2026-09-16 — T-06 · Catálogo deportivo (backend)

- **Cambio:** CRUD de administración de deportes, competiciones, equipos, jugadores y planteles (BR-001, BR-011, BR-015, BR-048 a BR-050).
  - **Operaciones:** bajo `/admin/{deportes,competiciones,equipos,jugadores,planteles}` hay lista paginada con filtros, ver, crear (201), `PATCH` parcial y borrar. Body y query se validan con zod estricto.
  - **Slugs:**
    - Se generan del nombre y se normalizan.
    - Son únicos globalmente en deportes y únicos por deporte en competiciones, igual que en el esquema.
    - Un slug repetido da 409 `SLUG_TAKEN`.
    - Renombrar no cambia el slug; un `PATCH` con slug explícito sí lo cambia.
  - **Plantel:**
    - La competición sale del equipo; si el cliente manda otra, 409 `COMPETITION_MISMATCH`.
    - Un jugador por competición (409 `PLAYER_ALREADY_ENROLLED`).
    - Camiseta de 1 a 99, única por equipo (409 `SHIRT_NUMBER_TAKEN`).
    - Sin transferencias (409 `TRANSFER_NOT_ALLOWED`).
  - **Mover entre competiciones o deportes:**
    - Un equipo solo cambia de competición si no tiene partidos, inscritos ni goles.
    - Una competición solo cambia de deporte si no tiene partidos.
  - **Borrado:** solo si nada usa el registro; si no, 409 `*_IN_USE` con las cantidades. No hay cascada ni borrado lógico.
  - **`permite_empate` (BR-015 precisado):** solo cambia si ningún partido del deporte salió de `programado` y no hay apuestas; si no, 409 `DRAW_RULE_LOCKED`. La parte de apuestas es un `DrawRuleGuard` del módulo Polla, inyectado desde `routes/index.ts`, así que Informativo no importa Polla.
  - **Escudo, foto y color:** escudo y foto aceptan una URL `https://` o una ruta relativa a una imagen, de hasta 255 caracteres; el color es `#rrggbb` y se guarda en minúsculas.
  - **Errores de MySQL:** 1062, 1451, 1452, 1406, 1264 y 1366 se traducen en `lib/db-errors.ts` (nunca 500 ni el mensaje del driver).
  - **Escrituras:** pasan por `runAdminAction`, que deja el gancho para la auditoría de T-17.
  - **Corrección de T-05:** el duplicado dentro de un lote de devoluciones tiene su propio mensaje.
- **Archivos:**
  - **Servicios:** `server/src/services/sports.service.ts`, `competitions.service.ts`, `teams.service.ts`, `players.service.ts`, `enrollments.service.ts`, `bets-sport-guard.service.ts`, `admin-action.ts`, `catalog-query.ts`, `coins.service.ts`.
  - **Esquemas y utilidades:** `server/src/schemas/catalog.schema.ts`, `common.schema.ts`; `server/src/lib/db-errors.ts`, `slug.ts`, `error-codes.ts`.
  - **Controladores, rutas y middleware:** `server/src/controllers/catalog.controller.ts`; `server/src/routes/catalog.route.ts`, `admin.route.ts`, `index.ts`; `server/src/middleware/error-handler.ts`.
  - **Pruebas:** `server/tests/catalog-access.test.ts`, `catalog-sports.test.ts`, `catalog-competitions-teams.test.ts`, `catalog-players-enrollments.test.ts`, `helpers/catalog.ts` y la de servicio de monedas.
  - **Documentación:** `server/README.md`, `EsquemaBD.md`, `docs/business-rules.md` (BR-015), `docs/plan-polla.md` (notas en T-08, T-09, T-13 y T-17), `CLAUDE.md`, `AGENTS.md`. Sin cambio de esquema.
- **Verificación:**
  - **Chequeos:** `npm run server:typecheck` sin errores; 383/383 pruebas dos veces seguidas; build del front sin errores ni advertencias; `CLAUDE.md` y `AGENTS.md` idénticos; base creada desde cero (23 tablas) sin errores.
  - **Pruebas propias (12 casos, dos corridas sin fallos):**
    - **CRUD de las cinco entidades:**
      - **Operaciones:** crear, ver, listar (orden por nombre y luego id, paginación), filtros (`q` con `%` y `_` literales, `permiteEmpate`, `deporteId`, `competicionId`, `equipoId`, `jugadorId`), `PATCH` parcial y `foto: null`.
      - **Borrado:** da `{ id }` y después 404.
      - **Rechazos:** ids inválidos (`abc`, `0`, `-1`, `1.5`, `1e3`, `01`, 17 dígitos) dan 400; inexistentes, 404. Campos o query desconocidos, `PATCH {}`, tipos incorrectos, arrays, `null` y ids en texto dan 400, sin efectos.
      - **Respuestas:** sin datos de otros módulos.
    - **Slugs:**
      - **Generación:** acentos, ñ, espacios y símbolos se normalizan. Un nombre sin letras ni números (cirílico, emojis, `¡¡¡`, `---`) da 400 pidiendo un slug explícito. Con 100 caracteres, el slug queda dentro de 100.
      - **Unicidad:** mayúsculas, acentos, espacios o guion bajo repetidos dan 409 `SLUG_TAKEN`. Un slug explícito inválido da 400.
      - **Cambios:** renombrar conserva el slug y un `PATCH` con slug lo cambia; si choca, 409 sin efectos.
      - **Competiciones:** el mismo slug se puede repetir en distintos deportes. Mover una competición a un deporte donde su slug ya existe da 409.
      - **Concurrencia:** 8 `POST` paralelos con el mismo nombre dan un 201 y siete 409.
    - **Plantel:**
      - **Rechazos:** `COMPETITION_MISMATCH` (otra competición o una inexistente); `PLAYER_ALREADY_ENROLLED` (en el mismo equipo o en otro); `SHIRT_NUMBER_TAKEN`. Camiseta 0, 100, 1.5, `"7"`, `null`, −1 o 1000 da 400.
      - **Transferencias:** cambiar equipo o jugador da 409 `TRANSFER_NOT_ALLOWED`; mandar el mismo equipo con otra camiseta está permitido.
      - **Concurrencia:** 6 inscripciones paralelas con la misma camiseta dan un 201; el mismo jugador en 5 equipos a la vez, uno.
    - **Mover equipos y competiciones:**
      - Un equipo con plantel o con partidos da 409 `TEAM_IN_USE` con las cantidades. Hacia una competición inexistente, 404. Un equipo libre se mueve.
      - Un `UPDATE` directo en la base se frena por las FKs compuestas y se traduce a 409.
      - Una competición con partidos no cambia de deporte (409); sin partidos, sí.
    - **Errores de MySQL provocados a mano:** todos se traducen:
      - **1062:** slug, camiseta y jugador;
      - **1451:** deporte, competición y jugador;
      - **1452:** equipo, competición y plantel de otra competición;
      - **1406, 1264 y 1366:** dan 400.
      - Un error que no es de MySQL no se traduce. Nombres con caracteres raros nunca dan 500.
    - **Borrado en uso:** con partidos y goles insertados a mano, las cantidades son exactas:
      - deporte: 2 competiciones;
      - competición: 3 equipos, 2 partidos y 2 inscritos;
      - equipo: 2 partidos, 2 inscritos y 2 goles;
      - jugador: 1 inscripción y 2 goles;
      - plantel: 2 goles.
      - Sin dependencias, el borrado responde 200. Borrar el padre mientras se crea un hijo (8 rondas por tipo) no dio errores 500 ni dejó huérfanos.
    - **`permite_empate`:**
      - **Libre:** con partidos programados se puede cambiar.
      - **Bloqueos:** con un partido en curso, finalizado o cancelado da 409 `DRAW_RULE_LOCKED` sin aplicar el resto del `PATCH`; con una apuesta en un partido programado, también (con los dos motivos a la vez si coinciden).
      - **Sin bloqueo:** otro deporte no se ve afectado, y cambiar solo el nombre está permitido.
      - **Módulos:** Informativo no importa Polla (revisé los imports y las consultas).
      - **Guard:** sin guard no hay error. Un guard o un gancho de auditoría que falla deshace la transacción.
    - **Escudo, foto y color:**
      - **Aceptados:** `https://`, rutas relativas con extensión de imagen, 255 caracteres, espacios recortados.
      - **Rechazados:** `http:`, `javascript:`, `data:`, `ftp:`, `file:`, `..`, `%2f`, `/` inicial, `//`, `\`, `?`, extensión no imagen, `.png.exe`, usuario y clave en la URL, 256 caracteres y vacío.
      - **Colores:** `#fff`, `#GGGGGG`, `rgb()`, `red`, vacío, `null` y un número dan 400; ` #A1B2C3 ` se guarda como `#a1b2c3`.
    - **Seguridad:** en las cinco rutas, el anónimo recibe 401 y el apostador validado 403. Sin token, con token ajeno u Origin ajeno se responde 403 `CSRF_FAILED`, sin efectos. El rate limit general corta con 429.
  - **Otros:**
    - BR-015 precisado es coherente, y las notas del plan y `server/README.md` están al día.
    - El mensaje de T-05 para el duplicado dentro del lote quedó corregido.
    - El server de Docker sirve las rutas nuevas.
  - **Limpieza:** la base de desarrollo quedó sin datos de prueba; la base y el server de Docker siguen corriendo.
- **Observaciones (no bloquean):**
  - **Escudo y foto:** aceptan cualquier host `https` (incluidos `localhost` y `169.254.169.254`), URLs sin extensión de imagen, fragmentos con `"><script>` (se guardan tal cual) y SVG en rutas relativas. Hoy no hay riesgo, porque el server nunca descarga esas URLs y React escapa el texto. Pero T-13 no debería descargarlas del lado del servidor sin una lista de hosts permitidos, y el front debería mostrarlas solo con `<img>`.
  - **Nombres:** se aceptan caracteres de control (`\u0000`) y surrogates sueltos.
  - **Slugs:** `ß` queda como separador (`Straße` → `stra-e`), y `Ł`, `Æ` y `Ø` desaparecen.
  - **Concurrencia de borrado:** en las carreras de borrar contra crear, el orden fue siempre el mismo. Las FKs garantizan que no queden huérfanos igual.

## 2026-09-16 — T-07 · Partidos (backend)

- **Cambio:** administración de partidos bajo `/admin/partidos` (BR-011 a BR-014, precisados), más las observaciones del tester en T-06.
  - **CRUD y estado:** CRUD con zod estricto, más `POST /:id/estado`.
  - **Alta:**
    - Crea el partido y sus dos filas de `partido_equipo` (goles NULL) en una transacción, siempre en `programado`.
    - La fecha es ISO con zona y segundos, se guarda en UTC y tiene que ser futura (400 `MATCH_DATE_IN_PAST`).
    - Los equipos tienen que ser distintos (400 `SAME_TEAM`) y de la competición (409 `COMPETITION_MISMATCH`).
  - **Listado:**
    - Filtros por deporte, competición, equipo, estado y rango desde-hasta.
    - Orden por proximidad en `lib/match-order.ts`, definido en BR-013: primero los próximos en orden ascendente, después los pasados en orden descendente, y a igual fecha por id.
    - Cada partido trae `cierreApuestas` (`lib/betting.ts`, 24 h).
  - **Estados:**
    - Solo se permiten `programado` → `en_curso` (después del cierre de apuestas) y `en_curso` → `programado` (sin goles).
    - `finalizado`, `cancelado` y cualquier otro cambio dan 409 `INVALID_STATE_TRANSITION`.
  - **Edición:**
    - Un partido finalizado o cancelado da 409 `MATCH_LOCKED`.
    - Competición, equipos y fecha solo cambian en `programado` (409 `MATCH_NOT_PROGRAMMED`).
    - Con apuestas no cambian equipos ni competición, y la fecha solo se posterga (409 `MATCH_HAS_BETS`); postergar reabre las apuestas hasta el nuevo cierre (BR-014 precisado).
    - Con goles, los equipos no cambian.
  - **Borrado:** solo sin apuestas, sin goles y no finalizado; las dos filas se borran en la misma transacción.
  - **Bloqueos y módulos:**
    - La fila del partido queda bloqueada `FOR UPDATE` en toda escritura.
    - El conteo de apuestas es un `MatchBetsProbe` de Polla, inyectado desde `routes/index.ts`.
  - **Esquema:** índice nuevo `idx_partido_fecha_hora`.
  - **Observaciones de T-06 aplicadas:**
    - Los nombres (y la sede) rechazan caracteres de control y surrogates sueltos.
    - Los slugs transliteran (ß → ss, æ → ae, œ → oe, ø → o, ł → l, đ/ð → d, þ → th, ı → i, ħ → h).
    - Hay notas en el plan para T-13, T-18, T-21 y T-22 sobre las URLs de imágenes.
- **Archivos:**
  - **Servicios:** `server/src/services/matches.service.ts`, `bets-match-probe.service.ts`, `catalog-query.ts`, `admin-action.ts`.
  - **Utilidades:** `server/src/lib/match-order.ts`, `betting.ts`, `slug.ts`, `db-errors.ts`, `error-codes.ts`.
  - **Esquemas:** `server/src/schemas/matches.schema.ts`, `catalog.schema.ts`.
  - **Rutas:** `server/src/routes/catalog.route.ts`, `admin.route.ts`, `index.ts`.
  - **Pruebas:** `server/tests/matches.test.ts`, `catalog-names.test.ts`, `helpers/catalog.ts` y ajustes en las pruebas del catálogo.
  - **Base de datos y documentación:** `db/init/01-schema.sql`, `EsquemaBD.md`, `docs/business-rules.md` (BR-011 a BR-014), `docs/plan-polla.md` (notas para las tareas siguientes), `server/README.md`, `CLAUDE.md`, `AGENTS.md`.
- **Verificación:**
  - **Chequeos:** `npm run server:typecheck` sin errores; 469/469 pruebas dos veces seguidas; build del front sin errores ni advertencias; `CLAUDE.md` y `AGENTS.md` idénticos; base creada desde cero (23 tablas) sin errores.
  - **Pruebas propias (8 casos, dos corridas sin fallos):**
    - **Observaciones de T-06:**
      - Rechazados en las cinco entidades de nombre y en la sede, al principio, en medio y al final: NUL, TAB, LF, CR, ESC, DEL, U+0085, surrogate alto o bajo suelto, par invertido y medio emoji. También en `PATCH`.
      - Aceptados: emojis, ñ y acentos combinados. TAB y LF en los bordes se recortan.
      - Las 12 transliteraciones dan el slug esperado (`Straße Æ` → `strasse-ae`).
    - **Alta:**
      - Las dos filas quedan con local y visita correctos, goles NULL y la competición del partido. La fecha con `-05:00` se guarda en UTC (23:30) y `cierreApuestas` es 24 h antes.
      - **Fechas rechazadas (400):** sin zona, con espacio, sin segundos, offset `+2:00`, `+25:00` o `+0200`, 30 de febrero, mes 13, hora 24, segundo 60, año 2100 o posterior, timestamp numérico, vacío, `null` y minúsculas.
      - **Fechas aceptadas:** milisegundos y microsegundos (se truncan al segundo), `+14:00` y 2099-12-31. Las fechas pasadas dan 400 `MATCH_DATE_IN_PAST`.
      - **Otros rechazos:** `SAME_TEAM`, `COMPETITION_MISMATCH` (visita, local o competición), equipo o competición inexistente (404), jornada 0, 1000, 1.5, `"1"` o −1, sede de 151 caracteres o vacía, `estado` o goles en el body, id en texto y cada campo faltante: todo sin efectos.
      - **Límites y rollback:** jornada 999 y sede de 150 caracteres se aceptan. Si el gancho falla, la transacción se deshace y no queda ningún partido con menos de dos filas.
    - **Listado:**
      - **Orden exacto verificado:** uno en curso a +30 s, dos a +5 h (por id), +10 h, +100 h, y después los pasados de −2 h (dos, por id) y −50 h. Coincide con `compareByProximity` y con BR-013.
      - **Borde de «ahora»:** con `now` igual a la fecha de un partido, ese partido queda primero entre los próximos; 1 ms después pasa a los pasados.
      - **Filtros:** combinados funcionan.
      - **Rango:** `desde` y `hasta` son inclusivos (también con `+00:00`) y un segundo de diferencia deja el partido afuera. El rango invertido da 400 con mensaje.
      - **Paginación:** correcta.
      - **Query estricta:** estados inválidos o en mayúsculas, fechas sin zona, parámetros repetidos y desconocidos dan 400.
      - **Índice:** `EXPLAIN` del rango usa `idx_partido_fecha_hora`.
    - **Estados:**
      - `en_curso` a +25 h da 409; a +23 h, 200.
      - Repetir el mismo estado da 409; `finalizado` y `cancelado` por la API, 409.
      - `en_curso` → `programado` sin goles da 200 y con goles, 409.
      - Desde `finalizado` o `cancelado` puestos a mano, las cuatro transiciones dan 409.
      - Valores inválidos o con campo extra dan 400; un partido inexistente, 404.
      - **Borde del cierre:** 1 ms antes da 409 y en el cierre exacto se permite. Usa `HORAS_CIERRE_APUESTAS` = 24 de `lib/betting.ts`.
    - **Edición (sin efectos en cada rechazo):**
      - **Body:** `{}`, goles, estado o `cierreApuestas` dan 400. Los mismos valores dan 200 sin cambios.
      - **Equipos y competición:** intercambiar local y visita funciona. Cambiar a un mismo equipo da `SAME_TEAM`, y cambiar solo la competición da `COMPETITION_MISMATCH`. Cambiar competición y equipos juntos reescribe las dos filas con la competición nueva.
      - **Fecha:** una fecha pasada da 400.
      - **Con una apuesta a mano:** cambiar equipos, intercambiarlos, cambiar la competición o adelantar la fecha da 409 `MATCH_HAS_BETS`. Postergar da 200, con el cierre recalculado.
      - **Con goles:** cambiar equipos da `MATCH_HAS_GOALS`; la fecha sí se cambia.
      - **En curso:** fecha y equipos dan `MATCH_NOT_PROGRAMMED`; sede y jornada se cambian.
      - **Finalizado o cancelado:** `MATCH_LOCKED`.
      - Ninguna ruta escribe goles.
    - **Borrado:**
      - Con apuesta (también si está cancelado) da `MATCH_HAS_BETS`; con goles, `MATCH_HAS_GOALS`; finalizado, `MATCH_LOCKED`. Todos traen el motivo y las cantidades.
      - Libre, o cancelado sin apuestas, da 200 y borra las dos filas.
      - Un gancho que falla deshace la transacción.
    - **Sin probe:** `deleteMatch` y `updateMatch` con cambio de fecha lanzan `TypeError` antes de escribir, y la transacción se deshace. Un cambio sin fecha ni equipos funciona. En la app el probe es obligatorio por tipos.
    - **Concurrencia:** 6 rondas de 7 operaciones simultáneas (cambios de equipos, fecha, competición, estado y borrado) sin errores 500. Ningún partido quedó con un número de filas distinto de 2, ni con el mismo equipo de los dos lados o con competiciones distintas. De 10 `PATCH` de fecha paralelos, la fecha final es una de las enviadas.
    - **Seguridad:** anónimo 401, apostador 403, y sin token, con token ajeno u Origin ajeno 403 `CSRF_FAILED`, sin efectos, incluido `/estado`.
    - **Módulos:** Informativo (partidos) no importa Polla.
  - **Documentación:** BR-011 a BR-014 son coherentes entre sí y con BR-028 a BR-032 y BR-045. Las notas del plan y `server/README.md` están al día. El server de Docker sirve `/admin/partidos`.
  - **Limpieza:** la base de desarrollo quedó sin datos de prueba; la base y el server de Docker siguen corriendo.
- **Observaciones (no bloquean):**
  - **Apuesta contra adelanto de fecha:** en 5 de 5 carreras, una apuesta insertada a mano mientras se adelantaba la fecha no impidió el adelanto. Es esperable, porque el insert a mano no bloquea el partido. T-10 tiene que bloquear la fila del partido al apostar, como dice su nota.
  - **Caracteres invisibles:** los nombres aceptan caracteres de formato como U+202E (inversión de texto) y U+200B (espacio de ancho cero).
  - **Partidos con cierre ya pasado:** se puede crear un partido a menos de 24 h, que nace con las apuestas cerradas.
  - **Ordenamiento:** el orden por proximidad no usa el índice (hace un sort); el índice sirve para el filtro por rango.

## 2026-09-16 — T-08 · API pública (backend)

- **Cambio:** lecturas públicas sin sesión bajo `/public`, solo del Módulo Informativo (BR-013, BR-014, BR-048 a BR-050; BR-014, BR-049 y BR-050 precisados).
  - **Rutas:**
    - `GET /public/deportes`.
    - `GET /public/competiciones` (paginado, filtro por deporte), `/competiciones/:id`, `/competiciones/:id/equipos` y `/competiciones/:id/posiciones`.
    - `GET /public/partidos`: fixture paginado con filtros por deporte, competición, equipo, estado, jornada y fechas, en el orden de `lib/match-order.ts`.
    - `GET /public/partidos/:id` con goles, y `GET /public/equipos/:id` con plantel.
  - **Goles y marcador:**
    - Solo se muestran en partidos `finalizado` y con los dos lados cargados; si no, los dos lados son `null` y el detalle trae `goles: null`.
    - Los cancelados se muestran con su estado.
  - **Tabla de posiciones:**
    - Se calcula en cada pedido, 3/1/0 (`lib/standings.ts`), y solo cuenta partidos finalizados con los dos goles.
    - Los equipos sin partidos aparecen en cero.
    - Orden: puntos, diferencia, goles a favor, nombre (sin mayúsculas ni acentos) e id.
  - **Límite y caché:** rate limit público propio (`PUBLIC_RATE_LIMIT_*`) y `Cache-Control: public, max-age=30` en las respuestas exitosas. El resto de la API y todos los errores, incluido cualquier 429, van con `no-store`.
  - **Parámetros mal codificados:** un `%` mal codificado en la URL da 400 `INVALID_URL_ENCODING` sin log.
  - **Validación:** la query es estricta, los nombres más estrictos (invisibles y vacíos se rechazan) y hay topes para ventanas, máximos, puertos y pool en la configuración.
  - **Esquema e índices:** índice nuevo `idx_partido_jornada`. El filtro por deporte se reescribió como `IN` sobre `competicion`, y el de equipo como `IN` sobre `partido_equipo` (también en `/admin/partidos`).
  - **Documentación:** el mapeo a `src/types` para T-22 está en `server/README.md`, y hay notas en el plan para T-10, T-12, T-13 y T-22 (con los pendientes a, b y c del contrato).
- **Archivos:**
  - **Rutas, esquemas y servicios:** `server/src/routes/public.route.ts`, `index.ts`; `server/src/schemas/public.schema.ts`, `catalog.schema.ts`; `server/src/services/public.service.ts`, `matches.service.ts`.
  - **Utilidades, middleware y configuración:** `server/src/lib/standings.ts`, `error-codes.ts`; `server/src/middleware/security.ts`, `error-handler.ts`; `server/src/app.ts`; `server/src/config/env.ts`.
  - **Pruebas:** `server/tests/public-api.test.ts`, `url-encoding.test.ts`, `catalog-names.test.ts`, `rate-limit.test.ts` y otras actualizadas.
  - **Base de datos y documentación:** `db/init/01-schema.sql`, `EsquemaBD.md`, `docs/business-rules.md`, `docs/plan-polla.md`, `server/README.md`, `.env.example`, `CLAUDE.md`, `AGENTS.md`.
- **Verificación (revisión repartida entre dos testers):**
  - **Parte A, funcional (tester_liga), aprobada en la primera ronda.** Pruebas propias (7 casos, dos corridas sin fallos, en `la_liga_acp_test`):
    - **Rutas:** las 8 dan formas exactas, fechas ISO en UTC con `Z`, orden por nombre y paginación. Los ids inexistentes dan 404 con `no-store`; los ids inválidos (`abc`, `0`, `01`, `1.5`, 17 dígitos) y la query desconocida dan 400 en todas. Otros métodos dan 404.
    - **Fixture:**
      - **Filtros:** cada uno funciona solo y combinado. Jornada 1 y 999 se aceptan; 0, 1000, `01` y repetida dan 400.
      - **Fechas:** `desde` y `hasta` son inclusivos con `Z`, `+00:00` y `-05:00`; un rango invertido da 400.
      - **Orden:** exacto, igual al de `/admin/partidos` y al de `compareByProximity` (BR-013).
      - **Cancelados:** visibles con su estado.
    - **Goles:** en `programado`, `en_curso` y `cancelado` no aparecen marcador, autores, minutos, imagen ni video por ninguna ruta. En `finalizado` salen ordenados por minuto y luego id, con autor, foto, equipo, imagen y video; sin goles, la lista está vacía.
    - **Tabla:**
      - Coincide con un cálculo independiente (7 equipos, resultados pseudoaleatorios, partidos no finalizados ignorados).
      - Los desempates dirigidos (diferencia, goles a favor, nombre sin mayúsculas ni acentos, id) funcionan.
      - Una diferencia negativa no desborda.
      - Un equipo sin partidos queda en cero, otra competición no cuenta y una competición sin equipos da filas vacías.
    - **Plantel:** ordenado por camiseta, con foto `null` o URL. Un equipo sin plantel da lista vacía, y un jugador de otra competición no se mezcla.
    - **Privacidad:** con usuarios, saldo, apuestas, sesiones y auditoría en la base, ninguna respuesta contiene esas claves ni valores. La respuesta es idéntica sin sesión, con apostador y con admin, y no envía cookies. Solo aparecen claves esperadas.
    - **Contrato para T-22:** faltaba decidir la competición de la landing, recorrer el fixture paginado y tratar 400 y 404 como «no encontrado»; quedaron como notas a, b y c del plan.
    - **Detalle menor:** un finalizado con un solo lado cargado mostraba un marcador parcial.
  - **Parte B, seguridad, rendimiento, nombres y regresión (tester_liga_2): la primera ronda se reprobó** por dos bloqueantes:
    - un `%` mal codificado en los parámetros daba 500 y llenaba el log;
    - el 429 del límite general no llevaba `no-store`.
  - **Re-test de la parte A (tester_liga), aprobado:**
    - **Marcador entero o null:** un finalizado con un solo lado cargado (2-null, null-2, 0-null) muestra `null` en los dos lados y en `goles` del detalle, en el fixture con y sin filtros. Ninguna ruta deja ver el lado cargado ni las imágenes de sus goles, y la tabla lo ignora. Con ambos lados (0-0, 2-2, 3-1) salen enteros y cuentan.
    - **Documentación y regresión:** las notas a, b y c de T-22 están en el plan. La regresión funcional (incluidos el filtro por deporte con `IN` y la jornada con el índice nuevo) no cambió resultados. README y `CLAUDE.md` son coherentes, y `CLAUDE.md` y `AGENTS.md` idénticos.
  - **Re-test de la parte B (tester_liga_2), aprobado:**
    - **Codificación:** 12 codificaciones malas dan 400 `INVALID_URL_ENCODING` sin log, en rutas públicas y de admin. Solo se trata así el `URIError` del router; otros errores siguen siendo 500 con log.
    - **Límites y configuración:** todos los 429 llevan `no-store`, y se verificaron los máximos de ventanas, MAX, puertos y pool.
    - **Nombres:** se rechazan 34 invisibles o vacíos y se aceptan 27 razonables.
    - **Índices:** jornada usa `idx_partido_jornada`; deporte y los filtros combinados, índices; entre 3 y 17 ms sobre 3800 partidos.
    - **Suite y build:** 568/568 dos veces en `la_liga_acp_test_2`; build del front OK.
  - **Estado final:** la base y el server de Docker siguen corriendo; la parte A no usó la base de desarrollo.
- **Observaciones (no bloquean):**
  - **README:** atribuye «marcador entero o nada» a BR-049 y BR-050, pero esas reglas no lo dicen explícitamente.
  - **Caracteres de control literales:** `server/src/cli/read-secret.ts` y su prueba los tienen escritos tal cual. Funcionan, pero conviene escaparlos.
  - **Banderas con tags:** los emojis de bandera con tags se rechazan en los nombres.
  - **Invisibles que pasan:** algunos invisibles de categoría Mn y los espacios U+2000 a U+200A todavía se aceptan dentro de nombres con letras.
  - **Consultas sin índice:** un rango de fechas amplio y el listado de admin filtrado por deporte recorren la tabla (17 ms).
