# Input Mask Review Report

> Generated: 2026-03-27

This document lists every form input in `src/components/` and `src/app/` that handles phone numbers, CPF, currency, dates, times, or CEP -- and whether it currently has a proper input mask.

---

## Existing mask utilities (`src/lib/utils.ts`)

- `maskCPF(cpf)` -- display-only mask used in `patient-detail-content.tsx` (partially masks digits for privacy). There is **no input mask** helper for CPF.
- `formatCurrency(value)` -- display-only formatter using `Intl.NumberFormat`. There is **no input mask** helper for currency.

---

## 1. Phone number inputs

All phone inputs are plain text `<Input>` or `<input>` elements with no mask applied. Users can type any characters.

| # | File | Line | Field | Component | Current | Mask needed |
|---|------|------|-------|-----------|---------|-------------|
| 1 | `src/components/patients/patient-form.tsx` | 131 | `phone` (primary) | `PatientForm` | Plain `<Input>` with `register('phone')` | `(XX) XXXXX-XXXX` |
| 2 | `src/components/patients/patient-form.tsx` | 143 | `phoneSecondary` | `PatientForm` | Plain `<Input>` with `register('phoneSecondary')` | `(XX) XXXXX-XXXX` |
| 3 | `src/components/settings/clinic-settings-form.tsx` | 125 | `phone` (clinic) | `ClinicSettingsForm` | Plain `<Input>`, placeholder `(11) 99999-9999` but no mask | `(XX) XXXXX-XXXX` |
| 4 | `src/components/booking/booking-page.tsx` | 369 | `phone` (booking) | `BookingPage` | Plain `<input type="tel">`, placeholder `(11) 99999-9999` but no mask | `(XX) XXXXX-XXXX` |

---

## 2. CPF inputs

| # | File | Line | Field | Component | Current | Mask needed |
|---|------|------|-------|-----------|---------|-------------|
| 1 | `src/components/patients/patient-form.tsx` | 149 | `cpf` | `PatientForm` | Plain `<Input>` with placeholder `000.000.000-00` but no mask | `XXX.XXX.XXX-XX` |

Note: `maskCPF()` in `src/lib/utils.ts` is only used for **display** in `patient-detail-content.tsx` (line 95) and it partially redacts digits. It is not an input mask.

---

## 3. Currency / amount inputs

| # | File | Line | Field | Component | Current | Mask needed |
|---|------|------|-------|-----------|---------|-------------|
| 1 | `src/components/financial/payment-form.tsx` | 137 | `totalAmount` | `PaymentForm` | Plain `<Input>` with `R$` prefix rendered as adjacent `<span>`. `handleAmountChange` strips non-numeric chars but does **not** format or auto-position decimals. | Cents-to-integer mask: type `123` -> display `1,23`; type `12345` -> display `123,45`. Format: `R$ X.XXX,XX` |
| 2 | `src/components/settings/procedure-type-form.tsx` | 128 | `defaultPrice` | `ProcedureTypeForm` | Plain `<Input type="text" inputMode="decimal">`, placeholder `0.00` (uses dot, not comma -- inconsistent with pt-BR). No mask. | Cents-to-integer mask with `R$` prefix, using Brazilian format `R$ X.XXX,XX` |

---

## 4. Date inputs

| # | File | Line | Field | Component | Current | Status |
|---|------|------|-------|-----------|---------|--------|
| 1 | `src/components/patients/patient-form.tsx` | 169 | `birthDate` | `PatientForm` | `<Input type="date">` -- browser native date picker | OK -- native date picker is acceptable; consider a `dd/MM/yyyy` mask for consistency if custom picker is added later |
| 2 | `src/components/scheduling/appointment-form.tsx` | 302-307 | `date` | `AppointmentForm` | `<Input type="date">` -- browser native date picker | OK -- native date picker |
| 3 | `src/components/procedures/procedure-form.tsx` | 751-759 | `expirationDate` (product) | `ProcedureForm` | `<Input type="date">` -- browser native date picker | OK -- native date picker |
| 4 | `src/components/procedures/procedure-form.tsx` | 877-882 | `followUpDate` | `ProcedureForm` | `<Input type="date">` with `min` constraint | OK -- native date picker |
| 5 | `src/components/booking/booking-page.tsx` | 288-298 | date selection | `BookingPage` | Uses `<Calendar>` component (date-fns / react-day-picker) | OK -- proper calendar picker |

All date inputs use either the browser's native `type="date"` picker or a `<Calendar>` component. No manual text-based date entry exists, so no `DD/MM/YYYY` mask is strictly needed at this time.

---

## 5. Time inputs

| # | File | Line | Field | Component | Current | Status |
|---|------|------|-------|-----------|---------|--------|
| 1 | `src/components/scheduling/appointment-form.tsx` | 319-331 | `startTime` | `AppointmentForm` | `<Select>` dropdown with pre-generated 30-min intervals (07:00-20:00) | OK -- no mask needed, select-based |
| 2 | `src/components/scheduling/appointment-form.tsx` | 335-347 | `endTime` | `AppointmentForm` | `<Select>` dropdown with pre-generated intervals | OK -- no mask needed, select-based |
| 3 | `src/components/settings/clinic-settings-form.tsx` | 241 | working hours `start` | `ClinicSettingsForm` | `<Input type="time">` -- browser native time picker | OK -- native time picker |
| 4 | `src/components/settings/clinic-settings-form.tsx` | 249 | working hours `end` | `ClinicSettingsForm` | `<Input type="time">` -- browser native time picker | OK -- native time picker |

All time inputs use either native `type="time"` or `<Select>` dropdowns. No text-based time mask needed.

---

## 6. CEP (zip code) inputs

| # | File | Line | Field | Component | Current | Mask needed |
|---|------|------|-------|-----------|---------|-------------|
| 1 | `src/components/patients/patient-form.tsx` | 269 | `address.zip` | `PatientForm` | Plain `<Input>` with placeholder `00000-000` but no mask | `XXXXX-XXX` |
| 2 | `src/components/settings/clinic-settings-form.tsx` | 206 | `zip` (clinic address) | `ClinicSettingsForm` | Plain `<Input>` with placeholder `00000-000` but no mask | `XXXXX-XXX` |

---

## Summary of inputs needing masks

| Category | Count | Inputs |
|----------|-------|--------|
| Phone | 4 | PatientForm (2), ClinicSettingsForm (1), BookingPage (1) |
| CPF | 1 | PatientForm (1) |
| Currency | 2 | PaymentForm (1), ProcedureTypeForm (1) |
| CEP | 2 | PatientForm (1), ClinicSettingsForm (1) |
| Date | 0 | All use native pickers -- no action needed |
| Time | 0 | All use native pickers or Select -- no action needed |
| **Total needing masks** | **9** | |

---

## Components affected

1. **`PatientForm`** (`src/components/patients/patient-form.tsx`) -- phone (x2), CPF, CEP
2. **`ClinicSettingsForm`** (`src/components/settings/clinic-settings-form.tsx`) -- phone, CEP
3. **`BookingPage`** (`src/components/booking/booking-page.tsx`) -- phone
4. **`PaymentForm`** (`src/components/financial/payment-form.tsx`) -- currency
5. **`ProcedureTypeForm`** (`src/components/settings/procedure-type-form.tsx`) -- currency

---

## Notes

- The `OnboardingWizard` (`src/components/onboarding/onboarding-wizard.tsx`) embeds `ClinicSettingsForm`, so fixing the mask there covers onboarding as well.
- The settings page (`src/app/(platform)/configuracoes/settings-page-client.tsx`) also renders `ClinicSettingsForm` -- same component, same fix.
- `PaymentForm` has a `handleAmountChange` function (line 74) that strips non-numeric chars but does **not** auto-format as currency. It needs a proper cents-to-integer mask.
- `ProcedureTypeForm` uses placeholder `0.00` (dot separator) which is inconsistent with Brazilian formatting (`0,00`). The mask should enforce comma as decimal separator.
- No third-party mask library (e.g., `react-input-mask`, `@react-input/mask`, `imask`) is currently installed in the project.
