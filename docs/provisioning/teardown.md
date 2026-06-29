# Teardown

Destroys the environment created by [`first-deploy.md`](./first-deploy.md). **Irreversible.** Back up data before you start.

---

## 1. Back up data

```bash
# All app-level schemas
pg_dump "<direct_url>" \
  --schema=core --schema=shared_catalog \
  -f /tmp/farmacore-app.dump --format=custom

# Each tenant schema
for slug in $(psql "<direct_url>" -At -c "SELECT schema_name FROM core.tenant WHERE slug <> 'system'"); do
  pg_dump "<direct_url>" --schema="$slug" -f "/tmp/${slug}.dump" --format=custom
done

# Upload to R2 (or S3) for archival
aws s3 cp /tmp/farmacore-app.dump s3://<bucket>/backups/$(date +%F)/ \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

---

## 2. Drain CloudAMQP queues

Inspect DLQs first — anything left there is unprocessed work:

```bash
TOKEN="<system admin access token>"
for step in sync-base-product sync-base-product-stock sync-offer-books-info \
            import-competitor-products \
            calc-base-product-metrics update-base-product-properties; do
  echo "--- $step ---"
  curl -sH "Authorization: Bearer $TOKEN" \
    "https://farmacore-api.fly.dev/admin/dlq/$step?limit=100" | jq length
done
```

If anything is in a DLQ you care about, replay (`POST /admin/dlq/:step/replay`) or capture the bodies before destroying the broker.

---

## 3. Destroy Fly apps

```bash
fly apps destroy farmacore-worker --yes
fly apps destroy farmacore-api --yes
```

---

## 4. Destroy Neon project

```bash
neonctl projects delete --project-id <project_id>
```

---

## 5. Destroy CloudAMQP instance

```bash
cloudamqp instance delete <instance_id>
```

---

## 6. R2 — do NOT delete the bucket

The bucket is shared with the prototype. Revoke the new app's scoped API token instead:

```
Cloudflare dashboard → R2 → Manage R2 API Tokens → Revoke <token>
```

Optionally delete this app's key prefix:

```bash
aws s3 rm s3://<bucket>/farmacore-prod/ --recursive \
  --endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

---

## 7. Remove GitHub secrets

Repo → Settings → Secrets and variables → Actions → remove:

- `FLY_API_TOKEN`
- `NEON_PROJECT_ID` (if PR-preview workflow was configured)
- `NEON_API_KEY` (if PR-preview workflow was configured)
