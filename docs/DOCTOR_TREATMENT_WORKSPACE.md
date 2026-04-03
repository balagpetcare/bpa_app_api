# Doctor Treatment Workspace — API Summary

**Purpose:** Reference for the visit-centric Doctor Treatment Workspace and its backend APIs. For full release status, QA/deployment checklists, and rollout pack see **DOCTOR_MODULE_RELEASE_STATUS.md**.

**Frontend:** `bpa_web/app/doctor/(larkon)/visits/[id]/page.tsx` (tabbed workspace).

**Entry:** Doctor Dashboard → Appointments → Open appointment → Start Consultation → redirect to `/doctor/visits/[visitId]`. Or "Open Visit" when status is IN_CONSULT.

---

## Doctor visit APIs (all require auth + doctor role)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/doctor/visits/:id` | Get visit (includes vitals, notes, prescriptions, injectionTokens, labRequisitions, treatmentCourses, attachments). |
| POST | `/api/v1/doctor/visits/:id/notes` | Add SOAP/clinical note. Body: `{ noteType?, contentJson: { subjective?, objective?, assessment?, plan? } }`. |
| POST | `/api/v1/doctor/visits/:id/vitals` | Add vital record. Body: `{ weightKg?, tempC?, heartRate?, respRate?, notes? }`. |
| GET | `/api/v1/doctor/visits/:id/billing-summary` | Read-only billing summary for visit. |
| GET | `/api/v1/doctor/visits/:id/completion-eligibility` | Eligibility for completion (eligible, unmet, canOverride). |
| PATCH | `/api/v1/doctor/visits/:id/complete` | Complete visit (status COMPLETED, completedAt; linked appointment set COMPLETED). Body: `{}` or `{ overrideReason?: string }`. |
| POST | `/api/v1/doctor/visits/:id/follow-up` | Set follow-up. Body: `{ followUpDate, followUpNotes?, createAppointment? }`. |
| POST | `/api/v1/doctor/visits/:id/lab-requisitions` | Create lab requisition. Body: `{ testsJson, notes? }`. |
| POST | `/api/v1/doctor/visits/:id/prescriptions` | Create prescription. Body: `{ notes?, items: [{ medicineName, dosage, frequency, duration, instructions? }] }`. |
| POST | `/api/v1/doctor/visits/:id/attachments` | Add attachment. Body: `{ fileUrl, fileName?, fileType?, note? }`. |
| POST | `/api/v1/doctor/prescriptions/:prescriptionId/finalize` | Finalize a DRAFT prescription (own prescriptions only). |
| GET | `/api/v1/doctor/productivity` | Productivity for date. Query: `?date=YYYY-MM-DD`. Returns visitsCompleted, prescriptionsWritten, testOrdersCreated. |

**Permission:** All visit endpoints ensure `visit.doctorId` is in the current user's doctor branch member IDs.

---

## Workspace tabs

- **History** — ClinicalHistoryTimeline (previous visits, vaccinations) via `GET /api/v1/doctor/patients/:petId/history`.
- **Vitals** — List + add vitals.
- **SOAP** — List notes + structured S/O/A/P form; load consultation templates by branch.
- **Tests** — List lab requisitions + create (testsJson array).
- **Prescription** — List prescriptions + create + finalize.
- **Plan** — Treatment courses for visit (read-only).
- **Billing** — Billing summary (read-only).
- **Token** — Injection tokens for visit (read-only).
- **Follow-up** — Set follow-up date/notes, optional create appointment.
- **Attachments** — List + add (fileUrl).
- **Complete** — Complete visit button.
