import {
  formatCampaignTimeLabel,
  inferSessionDisplayName,
  resolveSessionName,
  shouldIncludeDateForRepeat,
  validateSlotSchedule,
} from "./slot.schedule";

describe("slot.schedule", () => {
  it("formats 09:00 as 12-hour AM label", () => {
    expect(formatCampaignTimeLabel("09:00")).toMatch(/9:00\s*AM/i);
    expect(formatCampaignTimeLabel("14:30")).toMatch(/2:30\s*PM/i);
  });

  it("infers session name from start hour", () => {
    expect(inferSessionDisplayName("09:00")).toBe("Morning Session");
    expect(inferSessionDisplayName("14:00")).toBe("Afternoon Session");
    expect(inferSessionDisplayName("18:00")).toBe("Evening Session");
  });

  it("prefers stored session name", () => {
    expect(resolveSessionName("Special Vaccination Session", "09:00")).toBe(
      "Special Vaccination Session"
    );
  });

  it("validates schedule rules", () => {
    expect(() =>
      validateSlotSchedule({
        startTime: "10:00",
        endTime: "09:00",
        capacity: 10,
      })
    ).toThrow(/End time/);

    expect(() =>
      validateSlotSchedule({
        startTime: "09:00",
        endTime: "10:00",
        capacity: 0,
      })
    ).toThrow(/Capacity/);

    expect(() =>
      validateSlotSchedule({
        startTime: "09:00",
        endTime: "10:00",
        capacity: 50,
        checkInStartTime: "09:30",
      })
    ).toThrow(/Check-in/);

    expect(() =>
      validateSlotSchedule({
        startTime: "09:00",
        endTime: "10:00",
        capacity: 50,
        bookingCutoffTime: "10:30",
      })
    ).toThrow(/cutoff/);
  });

  it("repeat weekdays skips Sunday", () => {
    const sunday = new Date("2026-06-07T12:00:00");
    const monday = new Date("2026-06-08T12:00:00");
    expect(shouldIncludeDateForRepeat(sunday, "WEEKDAYS")).toBe(false);
    expect(shouldIncludeDateForRepeat(monday, "WEEKDAYS")).toBe(true);
  });
});
