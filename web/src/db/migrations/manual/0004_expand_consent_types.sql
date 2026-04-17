-- Expand consent_templates.type CHECK constraint to include 4 new clinical TCLE types:
-- limpeza_pele, enzima, skinbooster, microagulhamento
-- See docs/superpowers/specs/2026-04-16-expanded-templates-design.md

ALTER TABLE floraclin.consent_templates DROP CONSTRAINT IF EXISTS consent_templates_type_check;

ALTER TABLE floraclin.consent_templates
  ADD CONSTRAINT consent_templates_type_check
  CHECK (type IN (
    'general',
    'botox',
    'filler',
    'biostimulator',
    'limpeza_pele',
    'enzima',
    'skinbooster',
    'microagulhamento',
    'custom',
    'service_contract'
  ));
