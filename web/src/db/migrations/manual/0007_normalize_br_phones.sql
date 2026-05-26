-- Normalize Brazilian mobile phone numbers: add 9th digit where missing.
-- Old format: 55 + DDD(2) + 8 digits = 12 digits
-- New format: 55 + DDD(2) + 9 + 8 digits = 13 digits

BEGIN;

-- Step 1: Move messages from old-format conversations to their normalized counterparts
UPDATE floraclin.whatsapp_messages m
SET conversation_id = keep.id
FROM floraclin.whatsapp_conversations old
JOIN floraclin.whatsapp_conversations keep
  ON keep.tenant_id = old.tenant_id
 AND keep.phone_number = '55' || SUBSTRING(old.phone_number FROM 3 FOR 2) || '9' || SUBSTRING(old.phone_number FROM 5)
WHERE m.conversation_id = old.id
  AND old.phone_number ~ '^55\d{2}[6-9]\d{7}$'
  AND LENGTH(old.phone_number) = 12
  AND keep.id != old.id;

-- Step 2: Move queued messages from old-format conversations (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'floraclin' AND table_name = 'whatsapp_queued_messages') THEN
    EXECUTE '
      UPDATE floraclin.whatsapp_queued_messages qm
      SET conversation_id = keep.id
      FROM floraclin.whatsapp_conversations old
      JOIN floraclin.whatsapp_conversations keep
        ON keep.tenant_id = old.tenant_id
       AND keep.phone_number = ''55'' || SUBSTRING(old.phone_number FROM 3 FOR 2) || ''9'' || SUBSTRING(old.phone_number FROM 5)
      WHERE qm.conversation_id = old.id
        AND old.phone_number ~ ''^55\d{2}[6-9]\d{7}$''
        AND LENGTH(old.phone_number) = 12
        AND keep.id != old.id';
  END IF;
END $$;

-- Step 3: Delete old-format conversations that had a normalized counterpart (messages already moved)
DELETE FROM floraclin.whatsapp_conversations old
USING floraclin.whatsapp_conversations keep
WHERE keep.tenant_id = old.tenant_id
  AND keep.phone_number = '55' || SUBSTRING(old.phone_number FROM 3 FOR 2) || '9' || SUBSTRING(old.phone_number FROM 5)
  AND old.phone_number ~ '^55\d{2}[6-9]\d{7}$'
  AND LENGTH(old.phone_number) = 12
  AND keep.id != old.id;

-- Step 4: Normalize remaining old-format conversations (no duplicate existed)
UPDATE floraclin.whatsapp_conversations
SET phone_number = '55' || SUBSTRING(phone_number FROM 3 FOR 2) || '9' || SUBSTRING(phone_number FROM 5)
WHERE phone_number ~ '^55\d{2}[6-9]\d{7}$'
  AND LENGTH(phone_number) = 12;

-- Step 5: Normalize prospect phone numbers
-- Same merge logic: update phone for prospects that don't have a normalized duplicate
UPDATE floraclin.prospects
SET phone = '55' || SUBSTRING(phone FROM 3 FOR 2) || '9' || SUBSTRING(phone FROM 5)
WHERE phone ~ '^55\d{2}[6-9]\d{7}$'
  AND LENGTH(phone) = 12;

COMMIT;
