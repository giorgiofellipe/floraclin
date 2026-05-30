import { describe } from 'vitest'

// TODO: integration tests deferred — see J2/J3 for coverage.
//
// Per RA-11 of docs/plans/2026-05-29-evolucoes-cook.md, this file may either
// seed real tenant/user/patient rows or be dropped in favor of J2 (service-
// layer mocked tests in web/src/lib/__tests__/patient-evolutions.test.ts) and
// J3 (component tests). We chose the drop path because:
//
//   1. There is no reusable test seed helper for tenant + user + patient in
//      web/src/db/queries/__tests__/. The only other DB-gated integration
//      test (procedure-sessions.test.ts) inserts raw UUIDs without seeding
//      parents, which would fail FK constraints on a clean test DB — not a
//      pattern worth replicating.
//   2. The regressions RA-11 calls out (cross-patient note isolation in
//      listRevisions, tenant+patient+id scoping in getNoteLockedForUpdate,
//      and feed ordering in getPatientEvolutionFeed) are exercised at the
//      service layer by J2 with focused mocks and end-to-end by J3 at the
//      component layer.
//   3. A multi-table seed for tenants → users → patients (plus
//      procedure_records / procedure_types / procedure_sessions to cover the
//      session side of the feed) would be brittle setup whose value over the
//      J2/J3 coverage is marginal.
//
// If we later add a shared db-test seed helper (e.g. a `seedTenantUserPatient`
// fixture), revisit and re-enable an integration test here, gated by
// `RUN_DB_TESTS=1` to keep CI green by default.
describe.skip('patient-evolutions queries (integration deferred — see J2/J3)', () => {})
