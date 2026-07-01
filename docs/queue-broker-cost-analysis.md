# Queue broker — cost/benefit analysis (CloudAMQP vs Fly.io self-hosted)

**Date:** 2026-06-29  
**Context:** Production runs on Fly.io (`gru`) + CloudAMQP **LavinMQ** (shared free plan). The monthly message quota was exceeded and the instance was blocked until the next reset or an upgrade.

This document compares **upgrading CloudAMQP** vs **running the broker on Fly.io** alongside `farmacore-api` and `farmacore-worker`, with estimated costs and the marginal cost of each new tenant.

---

## 1. Current setup (baseline)

| Component | Detail |
|---|---|
| Broker | CloudAMQP **Loyal Lemming** (LavinMQ, shared, **free**) |
| Free quota | **2 M messages/month**, 40 connections, 200 queues |
| Prod apps | `farmacore-api` (1× shared-cpu-1x, 1 GB, `gru`) + `farmacore-worker` (1× shared-cpu-2x, 2 GB, `gru`) |
| Client | NestJS + `@golevelup/nestjs-rabbitmq`, topology declared at boot in `QueueModule` |
| Observability | `QueueMetricsPoller` polls CloudAMQP management API when `CLOUDAMQP_API_*` is set |

Original architecture docs assumed **Tough Tiger** (RabbitMQ, $19/mo, 10 M msgs). Production validated on **LavinMQ** instead ([validation report](./validation-report-2026-06-08.md)).

---

## 2. How CloudAMQP bills messages

CloudAMQP counts **each publish and each consume** as one billable message. A message that is published once and consumed once consumes **2 units** of the monthly quota.

Retries and DLQ routing add extra publishes/consumes. Farmacore currently **does not retry** failed steps — failures go straight to DLQ (`RetryService`), which keeps retry overhead low.

**Implication:** internal “~105 k messages per pipeline run” estimates must be **doubled** (~210 k billable/month-day per tenant) when comparing to CloudAMQP quotas.

Sources: [CloudAMQP FAQ (LavinMQ)](https://www.cloudamqp.com/docs/faq-lavinmq.html), [Plans & Pricing](https://www.cloudamqp.com/plans.html).

---

## 3. Workload model

### 3.1 Daily pipeline (per tenant, per day)

Assumptions aligned with production code:

- **~35 000 products/EANs** per tenant (ERP import universe).
- DB-bound steps use **batch size 500** → `ceil(35 000 / 500) = 70` batch messages per step.
- **Scrapers** (`import-competitor-products`): **1 AMQP message per EAN per enabled origin** (see `ImportCompetitorProductsDispatchConsumer`). Stock is scraped inline in the same step (separate `import-competitor-stock` queues are **not** in the current topology).
- Pipeline cron: **once per tenant per day** (`DailyPipelineCron`, 00:00 UTC).
- `import-competitor-stock` as a standalone step: **not deployed** in current `PER_ORIGIN_STEPS`; numbers below exclude it.

| Step | Messages per run (publish side) |
|---|---|
| `pipeline.start` | 1 |
| `sync-offer-books-info` | 1 |
| `sync-base-product` (dispatch + 70 batches) | 71 |
| `sync-base-product-stock` (dispatch + 70 batches) | 71 |
| `import-competitor-products` dispatch | 1 |
| `import-competitor-products` per-origin scrapes | **35 000 × N<sub>origins</sub>** |
| `calc-base-product-metrics` (dispatch + 70 batches) | 71 |
| `update-base-product-properties` (dispatch + 4 passes × 70 batches) | 281 |
| Join / outbox chain boundaries | ~10–15 |
| **Subtotal (non-scraper)** | **~500** |
| **Subtotal (scraper-heavy)** | **~500 + 35 000 × N<sub>origins</sub>** |

**N<sub>origins</sub>** = origins enabled in `tenant_competitor_origin` for that tenant (not all 9 configured origins are necessarily enabled). Code supports up to **9** scrape origins (`PER_ORIGIN_STEPS` in `src/queue/constants.ts`).

#### Billable volume (publish + consume)

| Scenario | Msgs/run (×2) | Per day | Per month (30 d) |
|---|---|---|---|
| **3 origins** (legacy default: Drogal, Drogasil, Michelassi) | ~211 k | ~211 k | **~6.3 M** |
| **5 origins** | ~351 k | ~351 k | **~10.5 M** |
| **9 origins** (all configured) | ~631 k | ~631 k | **~18.9 M** |
| **DB-only** (no scrapers enabled) | ~1 k | ~1 k | **~0.03 M** |

The **2 M free quota** is exhausted by roughly **one tenant with 3 scrape origins running ~6 days/month**, or **one full month with a single tenant on 3 origins** — which matches the observed overage.

### 3.2 Non-daily events

| Event | When | Approx. messages (publish side) | Billable/month (×2) |
|---|---|---|---|
| **`apply-price`** (mass ERP push) | On demand (`POST /pricing/apply`) | 1 dispatch + `ceil(items / 50)` batches. Full catalog ≈ **701** | **~1.4 k per full run** |
| **`migrate-tenant`** | Each deploy (`release_command`) | 1 per tenant | negligible (tens/month) |
| **Manual `pipeline/start`** | Operator / debugging | Same as daily run | adds full run cost |
| **DLQ traffic** | Failed scrapes / batches | 1 publish to DLX + optional admin replay | usually ≪ 1% of pipeline |
| **Extra pipeline runs** | Re-runs, testing | Full run per trigger | linear |

Scrapers dominate. **`apply-price`** is significant only when applying prices to tens of thousands of SKUs in one shot; typical partial applies are small.

### 3.3 Queue / connection footprint (both alternatives)

- **~34 queues** today (16 step queues + 16 DLQs + `pipeline.start` + `migrate-tenant`) — well under shared-plan limits (200–1 000).
- **Connections:** API + worker, typically **2 AMQP connections** (multi-channel). Free plan allows 40; paid shared plans allow 100–200.

---

## 4. Alternative A — Upgrade CloudAMQP (managed)

### 4.1 Relevant plans (June 2026)

| Plan | Broker | Price/mo | Msg quota/mo | Connections | Notes |
|---|---|---|---|---|---|
| Loyal Lemming | LavinMQ shared | **$0** | 2 M | 40 | **Current — insufficient** |
| Elegant Ermine | LavinMQ shared | **$19** | **20 M** | 200 | **Best upgrade path (stay on LavinMQ)** |
| Tough Tiger | RabbitMQ shared | **$19** | 10 M | 100 | Half the quota for same price; requires broker change |
| Passionate Puffin (1 node) | LavinMQ **dedicated** | **$49** | No monthly cap (throughput-based) | 5 000 | Next step when shared quota is tight |
| Sassy Squirrel (1 node) | RabbitMQ dedicated | **$50** | No monthly cap | 1 500 | RabbitMQ dedicated minimum |

Dedicated plans include SLA (99.95%), alarms, diagnostics, and no noisy-neighbor risk from other vhosts.

### 4.2 Pros

- **Immediate unblock** — change plan in console, no deploy.
- **Zero migration** — same `AMQP_URL`, same LavinMQ, `QueueModule` topology unchanged.
- **Existing integrations** — `QueueMetricsPoller`, DLQ admin API, CloudAMQP alarms keep working.
- **No ops** — patches, uptime, disk, memory policies handled by vendor.
- **Predictable tier pricing** — $19/mo flat until quota or connection limits force next tier.

### 4.3 Cons

- **Linear quota growth with tenants** — each tenant with 3 scrape origins adds **~6.3 M billable msgs/month**; cost jumps in steps ($19 → $49 → …), not smoothly.
- **Shared plans** (Lemming/Ermine) — multi-tenant broker; another customer’s misbehaviour can affect latency (rare but possible).
- **Region** — provisioning docs used `us-east-1`; workers are in **`gru`**. Cross-region AMQP adds ~100–150 ms RTT vs co-located broker (usually acceptable for batch/scrape workloads, not ideal).
- **Account block** — exceeding quota blocks publishing until upgrade or monthly reset (already experienced).

### 4.4 Estimated monthly cost (CloudAMQP only)

| Production shape | Est. billable msgs/mo | Recommended plan | Broker cost/mo |
|---|---|---|---|
| 1 tenant, 3 origins | ~6.3 M | Elegant Ermine | **$19** |
| 1 tenant, 9 origins | ~19 M | Elegant Ermine (tight) | **$19** |
| 2 tenants, 3 origins each | ~12.6 M | Elegant Ermine | **$19** |
| 3 tenants, 3 origins each | ~18.9 M | Elegant Ermine (at limit) | **$19** |
| 4 tenants, 3 origins each | ~25 M | Passionate Puffin dedicated | **$49** |
| 10 tenants, 3 origins each | ~63 M | Passionate Puffin or higher dedicated | **$49+** |

Add ~**5–10%** headroom for manual re-runs, deploy migrations, and `apply-price` bursts.

### 4.5 Marginal cost per new tenant (CloudAMQP)

| Enabled scrape origins | Added billable msgs/mo | Effect on plan |
|---|---|---|
| 3 origins | **~+6.3 M** | Stays $19 until ~3 tenants; 4th tenant likely needs **$49** tier |
| 5 origins | **~+10.5 M** | 2 tenants ≈ 21 M → need **$49** tier |
| 9 origins | **~+18.9 M** | 2 tenants ≈ 38 M → need **$49** tier immediately |

**Rule of thumb:** with the current **1 message per EAN per origin** design, budget **~$6–7 of effective quota per tenant-month** (3 origins) on the $19 plan, or plan for **$49/mo around the 3rd–4th tenant** (3 origins each).

---

## 5. Alternative B — Self-hosted broker on Fly.io

Run **RabbitMQ** (or LavinMQ) as a third Fly app in **`gru`**, same org as API/worker. The codebase already supports any AMQP 0.9.1 broker; local dev uses `docker compose` RabbitMQ.

### 5.1 Suggested sizing

| Profile | Fly VM (`gru`) | Volume | Est. cost/mo | Fits |
|---|---|---|---|---|
| **Minimal** | shared-cpu-1x, 1 GB | 5 GB | **~$10–11** | 1–2 tenants, light DLQ backlog |
| **Recommended** | shared-cpu-2x, 2 GB | 10 GB | **~$20–22** | 3–5 tenants, nightly scrape peaks |
| **HA (manual cluster)** | 2× shared-cpu-2x, 2 GB + volumes | 10 GB each | **~$40–45** | Production HA; significant ops burden |

Fly `gru` reference pricing (always-on): shared-cpu-1x 1 GB ≈ **$9.20/mo**, shared-cpu-2x 2 GB ≈ **$18.40/mo**, volumes **$0.15/GB/mo** ([Fly pricing](https://fly.io/docs/about/pricing/)).

RabbitMQ with **persistent messages** (`persistent: true` everywhere) spills to disk under load; 2 GB RAM is a safer floor when queues can hold tens of thousands of small JSON messages during scrape peaks.

### 5.2 Implementation outline

1. New app `farmacore-broker` (or similar) in `gru`, no public HTTP.
2. Official `rabbitmq:3.13-management-alpine` (or LavinMQ if preferred).
3. **Fly volume** for `/var/lib/rabbitmq` (Mnesia + message store).
4. **Flycast / private network** — expose AMQP only on `.internal`; API/worker get `AMQP_URL=amqps://…@farmacore-broker.internal`.
5. Point `CLOUDAMQP_API_URL` (or rename env) at the management plugin for `QueueMetricsPoller`.
6. Backups: Fly volume snapshots + documented restore runbook.
7. Monitoring: memory/disk alarms, queue depth (already partially wired via OTel poller).

**Migration effort:** ~0.5–1 day for a minimal single-node setup + secret rotation on both Fly apps; +1–2 days for backup/restore drill and runbook.

### 5.3 Pros

- **No per-message billing** — cost is flat regardless of tenant count (until the VM is saturated).
- **Co-located with workers** in `gru` — lower latency, simpler networking story for Brazil.
- **Break-even vs CloudAMQP** around **3–4 tenants** (3 origins each) when shared Elegant Ermine would force **$49/mo**.
- **Full control** — policies, memory limits, queue TTLs, plugins.

### 5.4 Cons

- **You own ops** — upgrades, OOM kills, disk full, certificate rotation, incident response.
- **Single-node = SPOF** — Fly machine restart or deploy misstep pauses the whole pipeline; `QueueModule` uses `wait: false` so API stays up, but work stalls.
- **HA is non-trivial** — RabbitMQ clustering on Fly requires 3 nodes, quorum queues, and careful networking; not worth it until revenue justifies it.
- **Capacity planning** — scrape-heavy nights push **~200 k+ small messages** through the broker per tenant; memory and disk must be watched.
- **Lost managed features** — CloudAMQP alarms/diagnostics unless reimplemented; no vendor SLA.

### 5.5 Estimated monthly cost (Fly broker only)

| Profile | Monthly |
|---|---|
| Minimal (1 GB + 5 GB vol) | **~$10–11** |
| Recommended (2 GB + 10 GB vol) | **~$20–22** |
| HA pair | **~$40–45** |

This is **independent of tenant count** until CPU/RAM/disk saturation (~5+ tenants on recommended profile, depending on concurrent scrape prefetch).

### 5.6 Marginal cost per new tenant (Fly self-hosted)

| Added tenants | Broker $/mo | Notes |
|---|---|---|
| +1 … +3 (3 origins) | **$0** | Same VM |
| +4 … +6 | **$0–18** | May need RAM bump (1 GB → 2 GB) or second worker machine, not necessarily a second broker |
| +10+ | **+$18–25** | Likely upgrade VM or split scrape/work broker (advanced) |

Effective marginal broker cost per tenant **→ $0** for the first several tenants, vs **~$6.3 M quota units** on CloudAMQP.

---

## 6. Side-by-side summary

| Criterion | CloudAMQP Elegant Ermine ($19) | Fly self-hosted (~$20) |
|---|---|---|
| **Upfront effort** | Minutes (plan change) | ~1–2 days (deploy + drill) |
| **1 tenant, 3 origins** | **$19/mo** | **~$20/mo** |
| **3 tenants, 3 origins** | **$19/mo** (near limit) | **~$20/mo** |
| **4 tenants, 3 origins** | **$49/mo** (dedicated) | **~$20/mo** |
| **10 tenants, 3 origins** | **$49+/mo** | **~$20–40/mo** |
| **Ops burden** | Low | Medium–high |
| **SLA / support** | Shared (limited) / dedicated (99.95%) | Fly VM SLA only; broker is yours |
| **Latency vs `gru` workers** | Depends on CloudAMQP region | Best (same region) |
| **Quota / blocking risk** | Yes — hard monthly cap on shared | No — limited by RAM/disk |
| **Existing tooling** | Works today | Minor env changes for mgmt API |

---

## 7. Cost × benefit recommendation

### Short term (unblock now)

**Upgrade to CloudAMQP Elegant Ermine ($19/mo, LavinMQ, 20 M msgs).**

- Same broker family as production today.
- Do **not** downgrade to Tough Tiger (RabbitMQ) for the same price — **half the message quota**.
- 20 M covers **~3 tenants with 3 scrape origins** or **~1 tenant with 9 origins**, plus headroom for re-runs and `apply-price`.

### Medium term (revisit when scaling tenants)

**Consider Fly self-hosted when any of these is true:**

- **≥ 4 production tenants** with daily scrapes (CloudAMQP jumps to **$49+**).
- Billable traffic consistently **> 18 M/month** on shared LavinMQ.
- **Latency or region** becomes a bottleneck (move broker to `gru`).
- Team is willing to own **~2–4 h/quarter** broker maintenance (upgrades, snapshot restore test).

At current scale (1–2 tenants), **managed $19/mo wins on ops** for roughly the same money as self-hosted.

### Long term optimization (either broker)

The dominant cost driver is **1 AMQP message per EAN per scrape origin** (~105 k publishes × N<sub>origins</sub> per tenant per day). Batching scrapes (e.g. 10–20 EANs per message, as in legacy) would cut billable volume **10–20×** and delay any broker tier upgrade. That is a **code change** with prefetch/rate-limit implications — separate from the hosting decision.

---

## 8. Decision checklist

- [ ] Count **active tenants** and **enabled scrape origins** per tenant (`tenant_competitor_origin`).
- [ ] Confirm CloudAMQP **region** and current **month-to-date message count** in the dashboard.
- [ ] Estimate **non-daily** load: scheduled `apply-price`, manual pipeline re-runs.
- [ ] If staying on CloudAMQP: upgrade to **Elegant Ermine**; set quota alarm at 80%.
- [ ] If moving to Fly: provision broker app, migrate `AMQP_URL`, run one full pipeline E2E, document restore from volume snapshot.
- [ ] Re-evaluate at **tenant #3** or **18 M msgs/month**, whichever comes first.

---

## 9. References

- **Implementation plan (Fly self-hosted):** [`plans/11-fly-queue-broker.md`](../plans/11-fly-queue-broker.md)
- Architecture cost baseline: `arc/00-architecture.md` §8
- Pipeline message topology: `plans/notes/pipeline-throughput.md`, `src/queue/constants.ts`
- Prod validation (LavinMQ): `docs/validation-report-2026-06-08.md`
- CloudAMQP plans: https://www.cloudamqp.com/plans.html
- Fly.io pricing: https://fly.io/docs/about/pricing/
