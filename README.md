# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 🗄️ Base de datos (MySQL en Docker)

MySQL 8.4 con el esquema de [EsquemaBD.md](EsquemaBD.md). La app **todavía no se conecta**: el sitio sigue leyendo datos estáticos.

**Levantar**

```sh
cp .env.example .env   # la primera vez; cambiar los passwords
docker compose up -d
docker compose ps      # esperar a que diga (healthy)
```

La primera vez, con el volumen vacío, se ejecutan los scripts de `db/init/` en orden: `01-schema.sql` (todas las tablas) y `02-catalogos.sql` (roles, estados y tipos de mercado).

**Conectarse**

- Desde el host: `127.0.0.1`, puerto `MYSQL_PORT` (3306 por defecto), base `MYSQL_DATABASE`, usuario `MYSQL_USER` / `MYSQL_PASSWORD`.
- Desde el contenedor: `docker compose exec db sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'`

**Resetear** (borra todos los datos y vuelve a ejecutar los scripts de `db/init/`)

```sh
docker compose down -v
docker compose up -d
```

Los scripts de `db/init/` solo corren con el volumen vacío: si los cambias, hay que resetear.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
