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

## 200% text reflow follow-up (2026-11-09)

Instrumented the local Next.js app against the isolated PR164 QA database. The 7px page overflow was the shared header avatar/actions reaching x=326.89 at 320px; the statement cards independently clipped dates (128px content in 87px cells), amounts (156px in 87px), and the duplicate action (257px wide). The header title now shrinks/wraps, mobile cards stack date/amount, and actions wrap at full card width with 44px minimum targets. Account/import wrapping from PR166 is retained with PR164's min-h-11.

The browser regression script is `web/scripts/check-reconciliation-reflow.mjs`. It fails against the old cards (see [regression-before.log](reflow/regression-before.log)) and passes all six combinations of 320/375/1280px and 100%/200% root font size, including a large debit and suspected duplicate. It asserts reconciliation overflow, card cell/button clipping and header action bounds; it separately records document width to expose unrelated app-shell failures.

These fresh captures are **fixture rendering**: the real authenticated local app and CSS, with synthetic statement responses intercepted in Playwright; no production writes. The disposable app overlays PR166 cc464bb9's unrelated finance files to match Quinn's combined QA target. Those files are not included in this branch. Cookie and install prompts were dismissed for the check.

- [320px / 200% text](reflow/fixture-320-200.png)
- [375px / 200% text](reflow/fixture-375-200.png)
- [320px / normal text](reflow/fixture-320-100.png)
- [Desktop / normal text](reflow/fixture-1280-100.png)
- [Raw measurements](reflow/measurements.json)

The integrated document widths are exactly 320, 375 and 1280 respectively at both text scales; no reconciliation cells or buttons clip. The existing reconciliation component suite passed 14/14. Full pre-push checks and Quinn's independent focused retest are separate gates.
