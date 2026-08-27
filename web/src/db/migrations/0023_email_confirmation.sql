-- Public self-serve signup: email confirmation replaces the manual approval gate.
--
-- 1. Backfill existing accounts.
--
-- Every current user got in through the manual approval gate this change
-- removes, so a human already vetted each one. Leaving them null would make
-- the new confirmation gate redirect every existing customer to
-- /confirm-email permanently: they have no confirmation email to click,
-- because none was ever sent. At time of writing that is 12 of 13 users,
-- spanning 5 clinics on active or trialing subscriptions.
UPDATE floraclin.users SET email_verified = now() WHERE email_verified IS NULL;

-- 2. Durable resend throttling.
--
-- The resend endpoint sends email to an address supplied by an
-- unauthenticated caller, so it needs a cooldown. An in-memory limiter does
-- not survive Vercel running several instances; each would grant its own
-- quota.
--
-- Nullable on purpose. NextAuth's Resend provider writes this same table for
-- magic links, and a NOT NULL column would break those inserts.
ALTER TABLE floraclin.verification_tokens
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
