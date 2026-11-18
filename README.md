# HookLens

Inspector y depurador de webhooks que no depende de ningún proveedor: genera una URL única, recibe cualquier request HTTP,
la guarda tal cual llegó y permite inspeccionarla en vivo, compararla y reenviarla.

> En construcción. La documentación completa (GIF, arquitectura y decisiones técnicas) llega el día 10.

## Desarrollo local

Requisitos: Node ≥ 22.12, pnpm 12 y Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # Postgres 17 en Docker (crea hooklens y hooklens_test)
pnpm db:migrate
pnpm dev          # API en :3001, web en :5173
```

```bash
curl localhost:3001/health   # {"status":"ok","db":"up"}
pnpm test                    # tests de integración contra hooklens_test
pnpm typecheck && pnpm lint
```

## Estructura

```
apps/api   Fastify + Drizzle + PostgreSQL
apps/web   React + Vite + Tailwind
```
