# Changelog

All notable changes to this project are documented in this file.

## [0.1.2.0] - 2026-07-13

### Changed

- Daily competitor scraping now skips (EAN, origin) pairs already confirmed as not sold on that origin, removing most redundant scrape work. A small random sample of not-found pairs is re-checked each run, so a product a competitor starts selling later (or one hidden by a bad sweep) is rediscovered within a few weeks rather than blacklisted forever.

### For contributors

- The competitor `found` flag moved from a `metadata` jsonb key to a first-class boolean column on `shared_catalog.product`. The migration is split on purpose: 044 adds the column with a brief metadata-only lock, and 045 backfills only the not-found subset in its own transaction, so no ACCESS EXCLUSIVE lock is held across a table rewrite of the hot table. The skip runs in the batch step, not the dispatcher, keeping the dispatch fan-in counter deterministic across restarts. Unit tests cover the skip filter and the all-skipped no-op.

## [0.1.1.0] - 2026-07-11

### Added

- Offer-book rules marked to run on specific weekdays now execute automatically once per day, within business hours (07:00–21:00 São Paulo time), through the same safe execution path as a manual run.

### For contributors

- A dedicated scheduling cron selects eligible rules by local weekday and de-duplicates on the São Paulo civil day; unit and end-to-end tests cover selection, conflict skipping, the business-hour window, and same-day de-duplication.

## [0.1.0.0] - 2026-07-11

### Added

- Operators can execute saved offer-book rules asynchronously and immediately receive a report identifier for tracking.
- Execution history and report details are available through paginated APIs, with filters for rule, offer book, execution type, outcome, product name, and São Paulo civil dates.

### Changed

- Offer prices are applied to A7 in bounded worker batches and mirrored locally with accurate success, partial-success, failure, and no-change outcomes.

### For contributors

- Expanded unit and end-to-end coverage for campaign validity, concurrent delivery, partial batches, recovery after mirror failure, report precision, and local-day filtering.

### Fixed

- Frozen prices and A7 package targets now travel together in a durable ledger, preventing product synchronization or message redelivery from changing an in-flight write.
- ERP acceptance is checkpointed before the local mirror, so recovery resumes the same report without sending an accepted price twice.
- Running rules cannot be deleted or executed concurrently; stale runs safely resume under report ownership and an advisory lock.
- Report-bound execution cannot be launched through the generic admin pipeline trigger, and duplicate consumer deliveries are routed to the dead-letter exchange without a requeue loop.

## [0.0.1.0] - 2026-07-10

### Added

- Complete API reference covering the 90 HTTP endpoints, including authentication, roles, modules, request examples, responses, errors, and operational recipes.

### Changed

- Updated the Postman collection to mirror every current API endpoint, with current variables, request bodies, and endpoint descriptions.
- Linked the main setup and Postman guides to the API reference so developers can find endpoint-level documentation quickly.
