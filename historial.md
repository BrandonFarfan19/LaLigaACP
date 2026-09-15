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
