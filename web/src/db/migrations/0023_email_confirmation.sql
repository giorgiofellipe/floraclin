-- Public self-serve signup: email confirmation replaces the manual approval gate.
--
-- APPLY THIS BEFORE DEPLOYING THE CODE. Migrations in this repo are run by
-- hand: there is no db:migrate script, it is not in the build, and it is not
-- in CI. If the app ships first, every existing user still has
-- email_verified NULL, the JWT stamps emailVerified false on their next
-- sign-in, and the new gate parks all of them on /confirm-email with no
-- confirmation email to click.
--
-- Verify before deploying:
--   SELECT count(*) FROM floraclin.users WHERE email_verified IS NULL;  -- must be 0
--
-- 1. Backfill existing accounts.
--
-- Every current user got in through the manual approval gate this change
-- removes, so a human already vetted each one. Leaving them null would make
-- the new confirmation gate redirect every existing customer to
-- /confirm-email permanently: they have no confirmation email to click,
-- because none was ever sent. At time of writing that is 12 of 13 users,
-- spanning 5 clinics on active or trialing subscriptions.
-- Scoped to accounts that predate this migration. The unconditional form was
-- safe exactly once: rerun after the feature ships and it would confirm every
-- genuine unconfirmed signup sitting in the table, including any address
-- someone registered that they do not own, making the password they set on it
-- immediately usable. `created_at` is the cutoff because it is the only thing
-- that distinguishes a legacy account from a new one.
UPDATE floraclin.users
   SET email_verified = now()
 WHERE email_verified IS NULL
   AND created_at < '2026-08-31T00:00:00Z';

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

-- 3. One confirmation token per address, enforced by the database.
--
-- The resend endpoint throttles by conditionally updating this row, but the
-- old issue-then-delete-then-insert left a window where a second caller saw
-- no row, found nothing to throttle against, and sent a second email. An
-- upsert closes that, and an upsert needs a unique target.
--
-- Partial on purpose. NextAuth's Resend provider writes magic-link tokens to
-- this same table keyed by the bare address, and may legitimately hold more
-- than one at a time; constraining every identifier would break it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_tokens_confirm_identifier
  ON floraclin.verification_tokens (identifier)
  WHERE identifier LIKE 'confirm:%';
