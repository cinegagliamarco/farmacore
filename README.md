# Farmacore

Multi-tenant NestJS backend. See [`arc/`](./arc/) for architecture and [`plans/`](./plans/) for execution. The previous implementation lives in [`legacy-app/`](./legacy-app/) and is the source material being refactored into `src/`.

> **New here? Start with [`TUTORIAL.md`](./TUTORIAL.md)** — covers local setup, the API surface with curl examples, running tests, deploying to Fly.io, and where every console lives.
>
> Looking for a specific endpoint? [`docs/api-reference.md`](./docs/api-reference.md) documents all 94 API endpoints (auth, roles, modules, bodies, errors), all covered by the [Postman collection](./postman/farmacore.postman_collection.json).

## Quickstart

```bash
npm install
cp .env.example .env
docker compose up -d        # postgres on :5433, rabbitmq on :5673 / mgmt :15673
npm run start:dev           # API (main.http)

# in another shell:
npm run start:worker:dev    # worker (main.worker)
```

Health check: `curl http://localhost:3000/health`.

> Local docker-compose uses non-default host ports (postgres `:5433`, rabbitmq `:5673`/`:15673`) to coexist with other dev stacks. `.env.example` is wired to match.

## Scripts

- `npm run start:dev` — API in watch mode (`main.http`)
- `npm run start:worker:dev` — worker in watch mode (`main.worker`)
- `npm run build` — compile to `dist/`
- `npm test` — unit tests
- `npm run test:e2e` — e2e tests (requires running postgres)
- `node dist/main.http.js` — production API entry
- `node dist/main.worker.js` — production worker entry

The Docker image's default `CMD` is `node dist/main.http.js`. The worker Fly app overrides `CMD` to `node dist/main.worker.js`.
