-- One address, one account.
--
-- Signup checked for a duplicate with a SELECT and then inserted, which is
-- only an agreement between concurrent requests, not a rule. Nothing in the
-- database stopped two of them from both finding nothing and both inserting.
-- That was survivable while accounts were provisioned by hand; with public
-- signup it means two password-bearing rows for the same address, both
-- stamped verified by a single confirmation click (which matches on email),
-- and an arbitrary one of them answering the next login.
--
-- On lower(email) rather than the column: every write path lowercases today,
-- so a plain unique index would be equivalent right now and silently stop
-- being so the first time one forgets.
--
-- Verified before writing this: production holds zero addresses that differ
-- only by case, so the index builds without a cleanup pass.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON floraclin.users (lower(email));
