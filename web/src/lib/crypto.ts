/**
 * Symmetric encryption for OAuth credentials stored in Postgres.
 *
 * `meta_connections.access_token` holds a long-lived Meta token with
 * `ads_management` and `business_management`; `calendar_connections` holds a
 * Google access/refresh pair. A leaked backup or a read-only database
 * compromise would otherwise hand over usable credentials for every connected
 * clinic.
 *
 * Only `@/db/queries/meta-connections`, `@/db/queries/calendar` and
 * `@/lib/google-calendar` speak this format. Everything above them keeps
 * handling plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'
const KEY_HEX_LENGTH = 64
const IV_BYTES = 12
const TAG_BYTES = 16

/**
 * `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 *
 * The version prefix is what lets the format change later: a reader can tell
 * which scheme produced a value before trying to undo it.
 *
 * The lengths are pinned so the check cannot mistake a plaintext token for an
 * encrypted one. base64url of 12 bytes is 16 characters, of 16 bytes is 22.
 */
const ENCRYPTED_FORMAT = new RegExp(
  `^${VERSION}\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]*$`,
)

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY

  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Stored OAuth tokens cannot be read or written without it. Generate one with `openssl rand -hex 32`.',
    )
  }

  if (raw.length !== KEY_HEX_LENGTH || !/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be ${KEY_HEX_LENGTH} hexadecimal characters (32 bytes); got ${raw.length} characters.`,
    )
  }

  return Buffer.from(raw, 'hex')
}

/** Whether a stored value was produced by {@link encryptSecret}. */
export function isEncryptedSecret(stored: string): boolean {
  return ENCRYPTED_FORMAT.test(stored)
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * A value that is not in the encrypted format is returned unchanged.
 *
 * Rows written before encryption shipped are plaintext, and this code reaches
 * production before the backfill does. Without the pass-through, every
 * existing connection would break the moment it deploys.
 */
export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) return stored

  const [, iv, tag, ciphertext] = stored.split('.')

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url').subarray(0, TAG_BYTES))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** The backfill's per-value step. Idempotent, so a re-run is a no-op. */
export function encryptIfPlaintext(stored: string): string {
  return isEncryptedSecret(stored) ? stored : encryptSecret(stored)
}
