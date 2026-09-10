import '@testing-library/jest-dom/vitest'

// Query modules encrypt stored OAuth tokens on write, so every test that
// exercises one needs a key. Tests that care about a missing or malformed key
// override this and put it back themselves.
process.env.TOKEN_ENCRYPTION_KEY ??= '0'.repeat(64)
