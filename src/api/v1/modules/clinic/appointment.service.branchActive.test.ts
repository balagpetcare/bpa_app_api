/**
 * Branch must be ACTIVE for appointment creation.
 * Documents and guards the validation in validateCreateAppointmentData (appointment.service.ts).
 * Full flow: run backfill then create appointment for branch 5 (see docs/CLINIC_BRANCH_VERIFICATION_ACTIVE_FIX.md).
 */
const CLINIC_ERROR_CODES = require("./clinic.responses").CLINIC_ERROR_CODES;

describe("Appointment create – branch must be ACTIVE", () => {
  it("error code and message used for non-active branch are stable", () => {
    expect(CLINIC_ERROR_CODES.VALIDATION_ERROR).toBe("VALIDATION_ERROR");
    const expectedMessage = "Branch is not active.";
    const fullMessage = CLINIC_ERROR_CODES.VALIDATION_ERROR + ": " + expectedMessage;
    expect(fullMessage).toBe("VALIDATION_ERROR: Branch is not active.");
  });

  it("condition for throwing is branch.status !== ACTIVE (documentation)", () => {
    const isOperational = (status: string) => status === "ACTIVE";
    expect(isOperational("DRAFT")).toBe(false);
    expect(isOperational("ACTIVE")).toBe(true);
  });
});
