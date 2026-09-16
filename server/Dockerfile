# Dev image: installs once at build time; compose.yaml bind-mounts the
# source over this so edits on the host take effect without rebuilding the
# image. node_modules stays out of that mount (see the anonymous volume on
# the service) so the container's own install — built for its OS/arch, which
# matters once native deps like a password hasher show up in a later task —
# is never shadowed by the host's.
#
# Runs "dev:docker" (nodemon --legacy-watch), not the bare "dev" (tsx watch):
# a Windows-host bind mount doesn't deliver the native filesystem events tsx
# relies on, so edits on the host never trigger a restart. Polling (nodemon's
# legacy-watch) checks file mtimes instead, which works through any mount.
# Bare local dev outside Docker (`npm run dev`, no mount in the way) keeps
# using tsx watch — faster, and native events work fine there.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The process runs without root (the image's own "node" user). It only
# writes uploaded images (T-13), under /data/uploads: the directory is
# created here owned by node, and Docker copies that ownership into a new
# named volume the first time it is mounted there (compose.yaml).
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node

EXPOSE 3001

CMD ["npm", "run", "dev:docker"]
