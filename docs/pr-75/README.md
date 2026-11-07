# Reconciliation suggestions review

The matcher ranks exact available cents, BR calendar-day distance and informative description tokens. Scores are ranking heuristics, never probabilities. A unique high-confidence result may be initially selected; every allocation still needs explicit confirmation and server balance validation under locks.

## Screenshots

Captured 2026-11-07 from the actual reconciliation components and application CSS in a local Vite harness, with synthetic query fixtures. This checks component layout and interaction; it is not an authenticated end-to-end app session.

- [375px suggestion](375/2-suggestion.png)
- [375px split allocation](375/3-two-selected.png)
- [375px empty results](375/4-empty.png)
- [375px import warning](375/5-ofx.png)
- [375px keyboard focus](375/6-keyboard-focus.png)
- [Desktop dialog](1280/dialog.png)

The capture script checked 320px and 375px: no page/dialog overflow, at least 44px action targets, trapped keyboard focus, fixed header/footer and a scrolling body. Raw measurements are in `measurements.json`.

## Verification scope

Deterministic scorer tests cover normalized payer identity, generic PIX descriptions, ties, runner-up margin, reversal/partial/duplicate safety and ranking beyond 50 entries. UI tests cover one-time initialization, preserving manual choices, split and partial allocations, stale balances and failed queries. Database tests cover isolation, truncation, manual searches beyond 45 days, BR midnight and allocation races. CI repeats the reconciliation database suite on a BR host using a separate disposable database, alongside the default UTC run.

Test stability changes are isolated in their own commit: cold module imports complete before timed tests/fake timers, fiscal dependencies are mocked in batch-payment tests, chat scroll assertions wait for effects, and Google Calendar loads its scoped client instead of every Google API declaration. Assertions and timeouts are preserved.

Human review and Giorgio's feedback on the responsive layout are required before merge.
