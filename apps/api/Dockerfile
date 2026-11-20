# syntax=docker/dockerfile:1
# Imagen del API. Se construye desde la raíz del repo, donde viven el lockfile y el workspace:
#   docker build -f apps/api/Dockerfile -t hooklens-api .

FROM node:22-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Corepack instala la versión exacta de pnpm que fija `packageManager` en package.json.
RUN corepack enable
WORKDIR /repo

# Primero solo lo que define las dependencias: si no cambian, Docker reutiliza esta capa
# y un cambio de código no reinstala todo.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @hooklens/api

COPY tsconfig.base.json ./
COPY apps/api apps/api
# `deploy` arma una carpeta autónoma: lo que lista `files` (dist y migraciones) más las
# dependencias de producción, sin las de desarrollo ni el resto del monorepo.
RUN pnpm --filter @hooklens/api build \
  && pnpm --filter @hooklens/api deploy --prod /prod/api

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Los archivos quedan del usuario root y el proceso corre como `node`: si alguien
# compromete el proceso, no puede modificar el código que ejecuta.
COPY --from=build /prod/api ./
USER node
EXPOSE 3001
# Las migraciones corren antes de arrancar (el plan gratis de Render no tiene paso de
# pre-deploy). `exec` deja a Node como PID 1 para que reciba SIGTERM y cierre ordenado.
CMD ["sh", "-c", "node --enable-source-maps dist/db/migrate.js && exec node --enable-source-maps dist/server.js"]
