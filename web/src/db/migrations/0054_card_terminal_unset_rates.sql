-- A terminal saved from the first card sale knows only that sale's rate. An
-- unknown rate is null (debit_rate here, a null entry in credit_rates), and the
-- next sale on it asks for it. Relaxing a constraint: safe before the deploy.
ALTER TABLE "floraclin"."card_terminals" ALTER COLUMN "debit_rate" DROP NOT NULL;
