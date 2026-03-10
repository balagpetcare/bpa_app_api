# Staff Clinic Appointments

Staff appointment list, create, and actions for branch clinic. Single source of truth: `/api/v1/clinic/branches/:branchId/...`.

## UI

- **Page:** `/staff/branch/[branchId]/clinic/appointments`
- **List:** By date (required), optional status filter. Uses Clinic V2 list API.
- **Actions (when `clinic.appointments.manage`):** Check-in, No-show, Cancel (with optional reason), Reschedule (modal: date + slot + optional doctor).
- **Create:** "New appointment" opens a modal: owner lookup (phone/email), optional pet, doctor, service, date, time slot (from slots API), notes.

## API endpoints used

| Action        | Method + path                                              |
|---------------|------------------------------------------------------------|
| List          | GET `.../appointments?date=&status=&limit=&offset=`         |
| Single        | GET `.../appointments/:appointmentId`                      |
| Create        | POST `.../appointments`                                   |
| Check-in      | POST `.../appointments/:id/check-in`                      |
| Cancel        | POST `.../appointments/:id/cancel` (body: `reason?`)      |
| Reschedule    | POST `.../appointments/:id/reschedule` (body: times + doctor?) |
| No-show       | POST `.../appointments/:id/no-show`                        |
| Slots         | GET `.../slots?date=&doctorId=&serviceId=`                 |
| Doctors       | GET `.../doctors`                                         |
| Services      | GET `.../services`                                        |

List supports filters `date`, `doctorId`, `status` and pagination `limit`, `offset` for scalability.

## Permissions

- `clinic.appointments.read` — view list and details.
- `clinic.appointments.manage` — create, check-in, cancel, reschedule, no-show.

## Status flow

BOOKED → CONFIRMED → CHECKED_IN → IN_QUEUE → CALLED → IN_CONSULT → COMPLETED.  
Terminal: CANCELLED, NO_SHOW.
