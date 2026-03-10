/**
 * Notifications & reminders: appointment, vaccine due, follow-up, lab ready.
 * Queue-based; delivery channels (in-app, SMS, push) pluggable.
 */
const REMINDER_TYPES = [
  "APPOINTMENT_REMINDER",
  "VACCINE_DUE",
  "FOLLOW_UP",
  "LAB_REPORT_READY",
  "POST_PROCEDURE_CARE",
];

async function queueReminder(type, payload) {
  // TODO: insert into NotificationQueue; cron job processes and sends via channel
  return;
}

async function getPendingReminders(branchId, limit) {
  return [];
}

module.exports = { REMINDER_TYPES, queueReminder, getPendingReminders };
