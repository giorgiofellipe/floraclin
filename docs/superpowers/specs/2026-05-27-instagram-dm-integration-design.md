# Instagram Direct Messages Integration — Design

**Status:** Design ready for implementation
**Author:** brainstormed with user 2026-05-27
**Mirrors:** existing WhatsApp integration in this repo

## Goal

Add Instagram Direct Messages as a second messaging channel alongside WhatsApp, with the same CRM value-adds (prospect auto-creation, AI classification, procedure-interest tagging, value auto-set). Ship as a parallel `/instagram` page — not a unified inbox.

## Scope decisions

These were chosen explicitly during brainstorming (not negotiable for v1):

- **Inbox model.** Separate `/instagram` page parallel to `/whatsapp`. No unified inbox.
- **API.** Instagram Graph API via Facebook Page (Page Access Token), not the newer Instagram Login API. Reasons: every comparable CRM uses this path, our existing Meta App and `META_APP_SECRET` infrastructure carries over, broader feature coverage (`HUMAN_AGENT` tag, story replies, reactions).
- **Window model.** Match Instagram's native rules: 24h standard messaging window after any inbound, then a 7-day human-agent window using the `HUMAN_AGENT` message tag, then hard block. No template-approval queue.
- **Contact linking.** Prospect auto-created from inbound (source `'instagram'`), keyed by IGSID. Patient linking is manual via a "Link to patient" dialog. No automatic handle-to-patient-name matching (false-positive risk in a medical context).
- **Templates.** Tenant-defined "saved replies" with variable placeholders. No Meta approval flow — Instagram doesn't require it.
- **Classification.** Identical to WhatsApp: extract intent/sentiment/procedure interest, set `prospect.value` from matched procedures' default prices, novo-stage only, +60s timestamp boundary.
- **Onboarding.** Manual paste of Page Access Token + IG Business Account ID + Page ID in settings. OAuth via Facebook Login deferred to a follow-up project (requires Meta App Review).
- **Inbound message types in v1.** Text, media (image/video/audio), story replies, reactions. Story mentions and shared posts/reels deferred.

## Out of scope

- Unified inbox across WhatsApp + Instagram (separate-now-unify-later was deliberately rejected; "Separate, parallel" is the v1 promise).
- Story mentions, shared posts/reels.
- Automatic prospect deduplication across channels (a person who messages on both WA and IG becomes two prospects in v1; manual merge UI is a future concern).
- Facebook Login OAuth onboarding (deferred — requires Meta App Review).
- Ice-breakers and persistent menu (saved replies cover the common case).

## Database schema

All additions to `web/src/db/schema.ts`, alongside existing WhatsApp tables.

### `instagramConversations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenantId` | uuid fk (indexed) | |
| `igsid` | text NOT NULL | Instagram-scoped user ID, the messaging identifier |
| `igHandle` | text | `@username`, may be null for private profiles |
| `igProfileName` | text | Display name from profile fetch |
| `igProfilePictureUrl` | text | Cached URL |
| `prospectId` | uuid fk | Auto-set on first inbound |
| `patientId` | uuid fk | Manual link only |
| `lastMessageAt` | timestamptz | |
| `lastInboundAt` | timestamptz | Drives 24h / 7-day window logic |
| `unreadCount` | int default 0 | |
| `status` | text | Same enum as `whatsappConversations.status` |
| `createdAt`, `updatedAt` | timestamptz | |

Unique constraint: `(tenantId, igsid)`.

### `instagramMessages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `conversationId` | uuid fk (indexed) | |
| `metaMessageId` | text UNIQUE | `mid` from webhook; dedupe key |
| `direction` | text | `'inbound' \| 'outbound'` |
| `messageType` | text | `'text' \| 'image' \| 'video' \| 'audio' \| 'file' \| 'story_reply' \| 'reaction' \| 'unsupported'` |
| `body` | text | |
| `mediaUrl`, `mediaType`, `mediaFilename` | text | Nullable, populated for media types |
| `storyMediaUrl`, `storyId` | text | Nullable, populated for `story_reply` |
| `reactionEmoji`, `reactsToMessageId` | text/fk | Nullable, populated for `reaction` |
| `deliveryStatus` | text | `'sent' \| 'delivered' \| 'read' \| 'failed'` |
| `messageTag` | text | `'HUMAN_AGENT'` if sent in the 24h–168h window |
| `errorCode` | text | Meta error code on send failure |
| `timestamp` | timestamptz | From Meta payload — sort by this, not `createdAt` |
| `createdAt` | timestamptz | |

Index: `(conversationId, timestamp)`.

Single-table design (nullable columns for story/reaction fields) is intentional — story replies and reactions are rare enough that a polymorphic table would be over-engineering.

### `instagramSavedReplies`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenantId` | uuid fk | |
| `name` | text | User-facing label |
| `body` | text | Message body with `{{variable}}` placeholders |
| `variableKeys` | text[] | Extracted from body on save |
| `purposeKey` | text | Nullable; used for future automation hooks |
| `archivedAt` | timestamptz | Soft-delete |
| `createdAt`, `updatedAt` | timestamptz | |

Unique constraint: `(tenantId, name)` where `archivedAt IS NULL`.

### Modifications to existing tables

- `prospects`:
  - `igsid` text (nullable, indexed)
  - `igHandle` text (nullable)
- `sseEvents`:
  - `channel` text NOT NULL DEFAULT `'whatsapp'` — discriminator so the shared event table can carry both channels' events. The default backfills cleanly for existing rows.

### Not introduced

- No `instagramQueuedMessages` — IG uses the `HUMAN_AGENT` tag, no queue needed.
- No shared `messagingAutomations` table — automations stay separate per channel for now (`whatsappAutomations` is unchanged; `instagramAutomations` is deferred to a v2 since v1 doesn't ship automations).

## Webhook

**Endpoint:** `web/src/app/api/webhooks/instagram/route.ts`.

**GET** — Meta hub-challenge verification. Reads `process.env.INSTAGRAM_VERIFY_TOKEN` (separate from `WHATSAPP_VERIFY_TOKEN` so the two channels can be configured independently in the Meta dashboard).

**POST** —

1. Read raw body, verify `X-Hub-Signature-256` against `META_APP_SECRET` using `verifyWebhookSignature()` (moved out of `web/src/lib/whatsapp.ts` to `web/src/lib/meta-webhook.ts` and shared).
2. Parse payload as `{ object: 'instagram', entry: [{ id, time, messaging: [...] }] }`.
3. For each entry, look up tenant by `entry.id == tenant.settings.instagram_business_account_id`. If not found, log and respond 200 — we don't want Meta to retry misconfigured subscriptions forever.
4. For each messaging event, dispatch by type:
   - `message` (with text, attachments, or `reply_to.story`) → upsert conversation, insert message, run prospect lifecycle, fire-and-forget classification, emit SSE.
   - `reaction` → if `reactsToMessageId` resolves, upsert reaction row; if not, log and drop.
   - `read` → set `deliveryStatus: 'read'` on the most recent outbound up to that watermark; emit SSE `status_update`.
   - `delivery` → set `deliveryStatus: 'delivered'` similarly.
5. Always respond 200 unless signature verification failed (401) or DB write failed (500 — Meta retries, webhook is idempotent via `metaMessageId` unique constraint).

**Profile enrichment:** on first inbound from an IGSID, fire-and-forget `GET /{igsid}?fields=name,username,profile_pic`. Populates `igHandle`, `igProfileName`, `igProfilePictureUrl`. Failure (private profile, 400) → leave fields null; UI shows "Usuário do Instagram".

**Prospect lifecycle:** identical rules to WhatsApp, extracted into a shared helper `web/src/lib/messaging/find-or-create-prospect.ts`. If no prospect or existing prospect is in `'convertido'` / `'perdido'`, create a new one with `source: 'instagram'`, `stage: 'novo'`, and IG identity fields.

**Classification:** the fire-and-forget block currently inline in the WhatsApp webhook (~lines 248–305) moves to `web/src/lib/messaging/classify-prospect-from-inbound.ts`. Both webhooks call it with `{ tenantId, prospectId, recentInboundBodies, classificationBoundary }`. No behavioral change to classification.

**SSE:** events written to the shared `sseEvents` table with `channel: 'instagram'`. New stream endpoint `/api/instagram/stream` filters by channel.

## API routes

All under `web/src/app/api/instagram/**`, mirroring `/api/whatsapp/**`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/conversations` | List, paginated (default 20), filters: all/unread/prospects/patients, search by handle or display name |
| POST | `/conversations` | Start outbound to a known IGSID + saved reply. Rejects unknown IGSIDs (IG doesn't allow messaging users who haven't messaged us first) |
| GET | `/conversations/[id]/messages` | Paginated history, reverse chrono, default 50 |
| POST | `/conversations/[id]/messages` | Send text or media. Window logic (see below) |
| PATCH | `/conversations/[id]` | Actions: `mark_read`, `link_patient` (body: `{ patientId }`), `unlink_patient` |
| GET | `/saved-replies` | List active saved replies |
| POST | `/saved-replies` | Create |
| PATCH | `/saved-replies/[id]` | Edit |
| DELETE | `/saved-replies/[id]` | Archive (soft delete) |
| GET | `/stream` | SSE |

**Access control:** every route checks `tenant.settings.instagram_enabled === true` AND user role in `tenant.settings.instagram_allowed_roles` (defaults `['owner']`). Same pattern as WhatsApp.

### Send-message window logic

```ts
const hoursSinceInbound = lastInboundAt
  ? (Date.now() - lastInboundAt.getTime()) / 3_600_000
  : Infinity

if (hoursSinceInbound <= 24) {
  // standard window — plain text/media
  await sendTextMessage(tenantId, igsid, body)
  // record messageTag: null
} else if (hoursSinceInbound <= 24 * 7) {
  // human-agent window — tagged
  await sendTextMessage(tenantId, igsid, body, { tag: 'HUMAN_AGENT' })
  // record messageTag: 'HUMAN_AGENT'
} else {
  return Response.json(
    { error: 'outside_messaging_window', lastInboundAt },
    { status: 422 }
  )
}
```

The 7-day cap is Meta-enforced. UI surfaces it as: "Última mensagem do contato há mais de 7 dias — não é possível responder por DM. Tente entrar em contato por outro canal."

Outbound also transitions the prospect from `'novo'` → `'contatado'` if applicable (same rule as WhatsApp).

## Meta Graph API client

**New file:** `web/src/lib/instagram.ts`, paralleling `web/src/lib/whatsapp.ts`.

```ts
getCredentials(tenantId): { pageId, igBusinessAccountId, pageAccessToken }
sendTextMessage(tenantId, igsid, body, opts?: { tag?: 'HUMAN_AGENT' }): { metaMessageId }
sendMediaMessage(tenantId, igsid, mediaType, mediaUrl, opts?: { tag? }): { metaMessageId }
getUserProfile(tenantId, igsid): { name?, username?, profile_pic? }
downloadAndStoreMedia(tenantId, attachmentUrl, filename): string // Supabase public URL
verifyCredentials(pageId, token): { ok: boolean, igBusinessAccountId?: string }
```

Differences from `whatsapp.ts`:

- All sends go through `POST https://graph.facebook.com/v21.0/me/messages` using the Page Access Token (not WABA-scoped endpoint).
- No `sendTemplateMessage` — saved replies are plain text with client-side variable substitution.
- Outbound media: clinic uploads to Supabase storage first; we pass the public URL to IG (IG does not have an upload endpoint).
- Inbound media: webhook gives a 24h-expiring CDN URL — we download to Supabase immediately (same pattern as `downloadAndStoreMedia` in `whatsapp.ts`).
- `verifyCredentials` calls `GET /me/accounts` and confirms the linked Page exposes `instagram_business_account` matching the stored ID.

## Shared helpers (extracted from WhatsApp)

1. `web/src/lib/meta-webhook.ts` — `verifyWebhookSignature(rawBody, signatureHeader, appSecret)`. Both webhooks import.
2. `web/src/lib/messaging/find-or-create-prospect.ts` — encapsulates the "novo / terminal → new prospect" rule. Accepts a `channelIdentity` discriminated union: `{ kind: 'phone', value }` or `{ kind: 'igsid', value, handle?, displayName? }`.
3. `web/src/lib/messaging/classify-prospect-from-inbound.ts` — the existing fire-and-forget classification block, extracted verbatim. Used by both webhooks.

Existing WhatsApp code refactors to call these helpers; behavior must be unchanged. The webhook route files themselves stay separate — no polymorphic dispatcher.

## UI

### Page

`web/src/app/(platform)/instagram/page.tsx` — two-column layout (list + chat), `?conversa=<id>` deep link support, matches `/whatsapp` page shape.

### Components

Under `web/src/components/instagram/`:

- **`conversation-list.tsx`** — filter chips (Todas/Não lidas/Prospects/Pacientes), search by handle/display name, channel-tag icon visible per row for consistency.
- **`chat-panel.tsx`** — header shows profile pic, `@handle`, linked-patient indicator or "Link to patient" CTA. Window-state banner above composer:
  - `≤ 24h since last inbound`: "Janela padrão aberta — Xh restantes"
  - `24h < t ≤ 168h`: "Janela de agente humano — X dias restantes"
  - `> 168h`: "Fora da janela de 7 dias" + composer disabled
- **`message-bubble.tsx`** — text, media, story_reply (story thumbnail above the reply), reaction (small emoji badge attached to the reacted message, not its own bubble), delivery status indicators.
- **`saved-reply-picker.tsx`** — dropdown above composer; selecting a reply with variables opens a fill modal; final body lands in the composer (doesn't auto-send).
- **`start-conversation-dialog.tsx`** — pick a known IGSID. Filters to IGSIDs that have messaged the clinic before; explains the constraint if the user tries to message an unknown handle.
- **`link-patient-dialog.tsx`** — search patients by name/phone, link to the current conversation.
- **`instagram-settings-form.tsx`** — settings panel form: enabled toggle, allowed roles, Page ID, IG Business Account ID, Page Access Token (password input), "Test connection" button, read-only webhook URL.
- **`instagram-saved-replies-list.tsx`**, **`instagram-saved-reply-editor.tsx`** — CRUD UI in settings; variable placeholders auto-extracted from body.

### Hooks

`web/src/hooks/use-instagram-sse.ts` — mirrors `use-whatsapp-sse.ts`, connects to `/api/instagram/stream`.

### Navigation and CRM integration

- Platform sidebar gets an "Instagram" item, gated on `instagram_enabled` + role membership.
- Prospect detail and patient detail pages: when an Instagram conversation exists (via `prospect.igsid` → `instagramConversations`), show an "Abrir no Instagram" deep-link button alongside the existing WhatsApp button. Both can appear together.

## Error handling

| Scenario | Behavior |
|---|---|
| Webhook: unknown tenant | Log + 200. Meta won't retry forever for misconfigured subscriptions. |
| Webhook: signature mismatch | 401. Log IP + truncated signature. |
| Webhook: malformed payload | 200 + log. Same retry-avoidance reasoning. |
| Webhook: DB write failure | 500. Meta retries; dedup via `metaMessageId` makes retry safe. |
| Webhook: profile fetch fails | Silent. Conversation created with null profile fields. |
| Send: token expired/invalid (code 190) | Surface in UI: "Conexão com Instagram expirada — reconecte nas configurações". Don't auto-disable `instagram_enabled`. |
| Send: outside 7-day window | 422 server-side; UI disables composer with explanatory text. |
| Send: media too large / unsupported | Surface Meta's error text verbatim. |
| Send: rate limit (4 or 17) | Exponential backoff, retry ≤ 3×, then surface to UI. |
| User blocked the clinic | Surface error code, disable composer for that conversation. |

## Race conditions

- **Out-of-order events:** sort messages by Meta `timestamp`, not `createdAt`. Read/delivery receipts arriving before the message: drop and log (loss rate negligible). Reactions for unknown `metaMessageId`: drop and log.
- **Concurrent `mark_read`:** SSE pushes the update to all sessions. Second writer sees `unreadCount: 0` and renders fine.
- **Duplicate webhook delivery:** unique constraint on `metaMessageId` handles it; we swallow the violation and 200.

## Testing

Vitest unit tests (run by `pnpm --filter @floraclin/web test:run`):

- `lib/instagram.ts`: token resolution, send-text URL/payload shape, `HUMAN_AGENT` tag application, profile fetch fallback on 400.
- `lib/messaging/find-or-create-prospect.ts`: terminal stages re-create, novo reuses, channel-identity discriminator works for both `phone` and `igsid` kinds.
- `lib/messaging/classify-prospect-from-inbound.ts`: +60s timestamp boundary, novo-stage gate, procedure auto-match against tenant's `procedureTypes`.
- Webhook payload parsing: one fixture-driven test per event type (text, image, video, audio, story_reply, reaction, read, delivery).
- Send route: window-math at boundaries (24h, 24h+1s, 168h, 168h+1s) using `vi.useFakeTimers()`.

Integration tests against local Docker Postgres (per the user's `no-e2e-supabase` rule):

- Inbound webhook → prospect created → SSE event emitted.
- Inbound from terminal-stage prospect → new prospect created.
- Outbound inside 24h → no tag.
- Outbound in 24h–168h window → `HUMAN_AGENT` tag stored on message row.
- Outbound past 168h → 422.
- Saved-reply variable substitution end-to-end.
- `mark_read` action zeros `unreadCount`.

UI: smoke renders only — matches the existing WhatsApp UI testing strategy in this repo.

## Migrations

Single additive Drizzle migration:

- New tables: `instagramConversations`, `instagramMessages`, `instagramSavedReplies`.
- New columns: `prospects.igsid`, `prospects.igHandle`, `sseEvents.channel` (default `'whatsapp'`).
- No data backfill needed beyond the `channel` default.

All new tenant settings keys (`instagram_enabled`, `instagram_allowed_roles`, `instagram_page_id`, `instagram_business_account_id`, `instagram_page_access_token`) are read with safe defaults — existing tenants without them stay healthy.

## Rollout

1. Ship migration + code with `instagram_enabled: false` default.
2. Per-clinic enablement: clinic pastes credentials → we test connection → flip `instagram_enabled`.
3. No need for a global feature flag; the per-tenant gate handles staged rollout naturally.

## Environment variables

| Var | Purpose |
|---|---|
| `INSTAGRAM_VERIFY_TOKEN` | Hub-challenge token for IG webhook GET |
| `META_APP_SECRET` | Existing; reused for IG webhook signature verification |

Per-tenant credentials live in `tenants.settings` JSONB — not env vars.

## Open questions

None. The decisions captured under "Scope decisions" are explicit and the surface is fully specified for v1.

## Future work (explicitly deferred)

- Facebook Login OAuth onboarding (requires Meta App Review).
- Story mentions and shared posts/reels.
- Cross-channel prospect deduplication and manual merge UI.
- Unified `/messages` inbox spanning WhatsApp + Instagram.
- Instagram automations (parallel to `whatsappAutomations`).
- Ice-breakers and persistent menu.
