# Farmacore

Multi-tenant NestJS backend. See [`arc/`](./arc/) for architecture and [`plans/`](./plans/) for execution. The previous implementation lives in [`legacy-app/`](./legacy-app/) and is the source material being refactored into `src/`.

## Quickstart

```bash
npm install
cp .env.example .env
docker compose up -d        # postgres on :5433, rabbitmq on :5673 / mgmt :15673
npm run start:dev           # API

# in another shell:
npm run build && WORKER_MODE=1 node dist/main.js   # worker
```

Health check: `curl http://localhost:3000/health`.

> Local docker-compose uses non-default host ports (postgres `:5433`, rabbitmq `:5673`/`:15673`) to coexist with other dev stacks. `.env.example` is wired to match.

## Scripts

- `npm run start:dev` — API in watch mode
- `npm run build` — compile to `dist/`
- `npm test` — unit tests
- `node dist/main.js` — production API entry
- `WORKER_MODE=1 node dist/main.js` — production worker entry
