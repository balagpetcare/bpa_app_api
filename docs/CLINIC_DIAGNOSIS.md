# Clinic diagnosis — current state and optional entity

**Status:** Diagnosis is represented in clinical notes (SOAP). A separate Diagnosis entity is optional for reporting/compliance.

## Current representation

- **SOAP notes:** Clinical notes with `noteType = SOAP` store structured content in `contentJson`:
  - `subjective`, `objective`, **`assessment`**, `plan`
  - **Assessment** is used as the diagnosis/impression field in the doctor visit EMR and on the doctor visit page (`app/doctor/(larkon)/visits/[id]`).
- **Display:** The doctor visit EMR page shows "Assessment (diagnosis)" when rendering SOAP notes. No separate diagnosis table or API exists.

## Traceability

- Visit → ClinicalNote (SOAP) → `contentJson.assessment` gives diagnosis text per note.
- For reporting, query `ClinicalNote` where `visitId` and `noteType = 'SOAP'` and use `contentJson->>'assessment'` (or equivalent) for diagnosis text.

## Optional future: Diagnosis entity

If product or compliance requires:

- **Model:** e.g. `Diagnosis` with `visitId`, `code` (e.g. ICD/SNOMED), `name`, `type` (primary/secondary), `notes`, `createdAt`, `createdBy`.
- **API:** CRUD under visit or clinic (e.g. `GET/POST/PATCH/DELETE /visits/:id/diagnoses` or `/clinic/diagnoses`).
- **UI:** Add diagnosis block to visit EMR and doctor visit page; optional picker from catalog.

Until then, diagnosis remains in SOAP assessment only; no schema or API change required.
