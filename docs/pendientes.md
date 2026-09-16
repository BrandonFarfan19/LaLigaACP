# Pendientes

Cosas detectadas y **decididas para después**. No están en curso: se toman de aquí cuando se quiera trabajarlas. Al completar una, se marca con `[x]`, se anota la fecha y el cambio se registra en [historial.md](../historial.md).

Anotado el 2026-09-15, tras la migración de Astro a React SPA (rama `feat/react/migracion`).

## Paridad con la versión Astro

Diferencias que quedaron al migrar. Ninguna rompe la app; todas están medidas por `tester_liga` contra el commit `bd6b303`.

- [ ] **Scroll a `/#fixture` desde otra página.** Astro baja con scroll suave (~630 ms, con valores intermedios); React salta de 0 a 720 en ~50 ms. Estando ya en `/`, ambos animan igual (~500 ms), así que solo difiere la llegada desde otra ruta.
- [ ] **Recargar con hash en escritorio.** `F5` sobre `/plantilla/<id>#stats-<id>` a 1280px: Astro queda en `y=49` con la ficha a `top=80`; React en `y=0` con la ficha centrada (`top=129`). A 390px coinciden. Viene del retorno temprano de `useScrollManagement` cuando restaura con la ficha abierta; faltaría el `scrollIntoView()` también en ese caso.
- [ ] **Foco al llegar por hash.** Astro deja el foco en el `<dialog>`; React en el botón de cerrar.

## Reglas de pixel art (`CLAUDE.md`)

Incumplimientos que ya existían antes de migrar.

- [ ] **Scroll suave sin frames.** `scroll-behavior: smooth` en `global.css` y `scrollTo({ behavior: 'smooth' })` en `Carousel.tsx`: el movimiento es continuo, no por `steps()`. Ambos se desactivan con `prefers-reduced-motion`.
- [ ] **Transiciones sin regla de movimiento reducido.** Usan `steps()`, pero ninguna regla `prefers-reduced-motion` las cubre: color de `.link` en `Navbar.module.css`, de `.arrow` en `Carousel.module.css` y de `.back` en `Plantilla.module.css`.
- [ ] **Escalados a tamaños no enteros.** El logo del Hero se agranda a 115,2px a 390px y a 87,6px a 1280px (por el tope `12svh`), y el escudo de Plantilla usa `5vw`. Con `image-rendering: pixelated` eso deja píxeles de tamaños desiguales.

## Documentación y limpieza

- [ ] **`docs/migracion-react.md` desactualizado.** La sección 12 y las diferencias 3, 6 y 8 describen el comportamiento anterior (animación con `ease-in-out`, `rotate()` y blur; fechas con `Intl`; scroll y hash previos).
- [ ] **`allowScripts: { esbuild: true }` en `package.json`.** Viene de la plantilla de Astro y ya no hace nada: `esbuild` no está instalado.
- [ ] **`docs/business-rules.md`.** Apareció vacío y sin seguimiento en git. Decidir si se escribe o se borra.

## Esquema de base de datos

Decisiones que `EsquemaBD.md` no define y que se tomaron por defecto al crear la base.

- [ ] **Confirmar los `CHECK` mínimos:** `codigo <> ''`, `jornada >= 1`, `coins_obtenidos >= 0` y `actualizada_en >= creada_en`.
- [ ] **Confirmar los largos de `VARCHAR`** (50 para `codigo` y `nombre_corto`, 100 para nombres y slug, 254 para email, 255 para escudo y foto, 150 para sede, 32 para `color_acento`).
- [ ] **Confirmar el borrado:** hoy no se puede borrar una fila que otras tablas usan; no hay borrado en cascada.
- [ ] **Confirmar los nombres visibles de los catálogos** ("Administrador", "Campeón de la disciplina"…): los códigos vienen del esquema, los nombres se inventaron.
- [ ] **`estadistica_tipo` sin cargar.** Es un catálogo por disciplina; falta decidir sus filas.
- [ ] **Apuesta al campeón:** el propio `EsquemaBD.md` deja abiertos su cierre y sus coins.
- [ ] **Validar valores fuera de rango en las fechas.** `formatKickoff` normaliza en silencio un mes 13 o una hora 25; además lanza error con un ISO mal formado y la ruta `/` no tiene `ErrorBoundary`, así que un dato malo reemplazaría toda la portada.

## Backend

Observaciones de la revisión de T-08, postergadas a propósito.

- [ ] **Banderas con secuencia de tags rechazadas en nombres.** Las banderas de subdivisiones (por ejemplo, Escocia o Gales) usan caracteres de etiqueta U+E0020 a U+E007F, que son categoría Cf. `displayName` los rechaza todos, así que un nombre con esas banderas da 400. Decidir si se aceptan solo como secuencia de bandera válida.
- [ ] **Invisibles que todavía pasan dentro de nombres con letras.** Marcas Mn que no se ven (U+034F, U+17B4, U+17B5, U+180B) y los espacios U+2000 a U+200A y U+205F se aceptan si el nombre tiene al menos una letra o número. Pueden hacer que dos nombres parezcan iguales. Evaluar rechazarlos o normalizarlos.
- [ ] **Consultas que recorren la tabla de partidos.** En el fixture público, un rango de fechas amplio, y en `/admin/partidos`, el filtro por deporte (con pocos deportes), recorren la tabla `partido` por decisión de costo de MySQL. Con 3800 partidos tardan unos 17 ms. Revisar si el volumen crece (ver `server/README.md`, sección de índices de T-08).
