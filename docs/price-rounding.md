# Price rounding — config model

Per-tenant price-rounding configuration, modeled after the A7/pricy-shelf
system: a **price band** owns a set of **decimal buckets**. Given a price,
you find the band whose `[price_min, price_max]` contains it, then the bucket
whose `[decimal_min, decimal_max]` contains the price's decimal part, and snap
the decimal to `round_to`.

Today this is **store-and-read-back config only** — the API persists and serves
the rules; no code applies them to a price yet (the rounding engine is deferred,
see [Deferred](#deferred-rounding-engine)).

## Schema (`core`)

Two tables, control-plane config keyed by `tenant_id`, both soft-deletable via
`BaseEntity` (`id`, `created_at`, `updated_at`, `deleted_at`).

### `core.price_rounding_range` — the price band (parent)

| column | type | notes |
|---|---|---|
| `tenant_id` | `uuid` | FK → `core.tenant(id)` `ON DELETE CASCADE`; indexed |
| `price_min` | `numeric(10,2)` | lower bound of the band (inclusive) |
| `price_max` | `numeric(10,2)` | upper bound of the band (inclusive) |

### `core.price_rounding_rule` — the decimal bucket (child)

| column | type | notes |
|---|---|---|
| `tenant_id` | `uuid` | FK → `core.tenant(id)` `ON DELETE CASCADE` |
| `range_id` | `uuid` | FK → `core.price_rounding_range(id)` `ON DELETE CASCADE`; indexed |
| `decimal_min` | `numeric(4,2)` | lower bound of the decimal part (inclusive) |
| `decimal_max` | `numeric(4,2)` | upper bound of the decimal part (inclusive) |
| `round_to` | `numeric(4,2)` | decimal the price snaps to when it matches |

Deleting a band cascades to its buckets. Deleting a tenant cascades to both.

> Migration `1700000000036-reshape-price-rounding-to-price-band` drops and
> recreates the prior `price_rounding_rule(name/enabled/priority)` +
> `price_rounding_decimal_range` tables, which had no price-band concept. The
> feature was unreleased (0 rows in any tenant), so it is a clean reshape, not a
> data migration.

## API

`@Controller('configurations/price-rounding')` — all routes require an
authenticated tenant; writes require `ADMIN`. A "range" in the API is one price
band plus its decimal buckets (`rules`).

| method | path | role | body |
|---|---|---|---|
| `GET` | `/configurations/price-rounding` | any | — (lists bands, each with its rules) |
| `GET` | `/configurations/price-rounding/:id` | any | — |
| `POST` | `/configurations/price-rounding` | admin | `CreatePriceRoundingRangeDto` |
| `PATCH` | `/configurations/price-rounding/:id` | admin | `UpdatePriceRoundingRangeDto` |
| `DELETE` | `/configurations/price-rounding/:id` | admin | — |

Writes replace the band's buckets wholesale (the `rules` array on create/update
is the full new set). Numeric columns come back from Postgres as strings and are
coerced to numbers at the response boundary.

### Payload

```jsonc
// POST /configurations/price-rounding
{
  "priceMin": 10.00,
  "priceMax": 50.00,
  "rules": [
    { "decimalMin": 0.00, "decimalMax": 0.49, "roundTo": 0.49 },
    { "decimalMin": 0.50, "decimalMax": 0.99, "roundTo": 0.99 }
  ]
}
```

### Validation

- **Bounds (DTO):** `priceMin`/`priceMax` ∈ `[0, 99999999.99]`,
  `decimalMin`/`decimalMax`/`roundTo` ∈ `[0, 99.99]` — mirrors the column
  precision so an out-of-range value returns **400**, not a Postgres overflow 500.
- **Ordering (service):** `priceMin ≤ priceMax` and, per bucket,
  `decimalMin ≤ decimalMax`. Violations return 400.

## Deferred: rounding engine

The algorithm that consumes this config (`applyPriceRounding` in pricy-shelf:
find band → extract decimal → find bucket → snap to `round_to`, with an optional
min-price floor that bumps to the next integer) was **not ported** — nothing in
farmacore reads these rules yet, so it would be dead code.

When the engine lands, add these validations (latent gaps with no effect until a
consumer exists):

1. Reject **overlapping** decimal buckets within a band.
2. Constrain `round_to` to `[decimal_min, decimal_max]`.
3. Tighten the decimal bounds to the semantic range `[0, 1)` (a price's decimal
   part is never ≥ 1; the current `[0, 99.99]` only guards the column).
4. Reject sub-cent inputs (or `@IsNumber({ maxDecimalPlaces: 2 })`) so values are
   not silently rounded by `numeric(4,2)` on insert.
5. Add a DB `CHECK (price_min <= price_max)` if any non-service writer appears.

## Relationship to offer book / price offer

Independent. The offer book (`offer_book.target_price` = `precoOferta`) and the
price-offer write-back (`POST /webapi/api/oferta`) already match the A7/pricy-shelf
semantics and are unaffected by this config.
