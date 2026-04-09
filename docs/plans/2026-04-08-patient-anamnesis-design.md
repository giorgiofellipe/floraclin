# Patient Self-Service Anamnesis

## Overview

Allow patients to fill their own anamnesis form via a tokenized link sent by the receptionist. No login required.

## Flow

1. Receptionist opens patient detail → clicks "Enviar Anamnese" button
2. System generates a token (UUID) tied to the patient, expires in 2 hours
3. URL: `https://floraclin.com.br/a/{token}`
4. URL copied to clipboard + shown in dialog. Receptionist sends via WhatsApp.
5. Patient opens link on phone → full anamnesis form (standalone page, no login)
6. Patient fills and submits → saved to same `anamnesis` table
7. Token consumed (single-use) or expires after 2h

## Database

New table `anamnesis_tokens` in `floraclinSchema`:
- `id` uuid PK
- `token` uuid UNIQUE
- `patientId` uuid FK → patients.id
- `tenantId` uuid FK → tenants.id
- `expiresAt` timestamp (created_at + 2h)
- `usedAt` timestamp (nullable — set on submit)
- `createdAt` timestamp
- `createdBy` uuid FK → users.id (the receptionist/practitioner who generated it)

## API Routes

- `POST /api/patients/{id}/anamnesis-link` — auth required. Generates token, returns URL.
- `GET /api/anamnesis/token/{token}` — public. Validates token (not expired, not used). Returns patient first name + anamnesis template questions.
- `PUT /api/anamnesis/token/{token}` — public. Validates token, saves anamnesis responses, marks token as used.

## Pages

- `/a/{token}` — public standalone page
  - No sidebar, no header, no login
  - FloraClin logo at top
  - "Olá, {firstName}! Preencha o formulário abaixo."
  - Full anamnesis form (same component as internal, but read from template)
  - Submit button → success screen "Obrigado! Seus dados foram recebidos."
  - Mobile-first design

## UI Changes

- Patient detail page: add "Enviar Anamnese" button (clipboard icon + text)
- On click: generates link, shows dialog with URL + "Copiar" button
- Button visible to: owner, practitioner, receptionist

## Security

- Token is a UUID (unguessable)
- 2-hour expiry
- Single-use (usedAt set on submit, subsequent attempts rejected)
- No patient data exposed except first name
- Public page — no auth required
- Middleware must allow `/a/*` path

## TODO (future)

- Notification system: notify practitioner when patient completes anamnesis
