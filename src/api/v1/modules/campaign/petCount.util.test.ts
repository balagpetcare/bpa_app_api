import { assertMinimumPetCount, MIN_PET_COUNT, PET_COUNT_REQUIRED_MESSAGE } from "./petCount.util";
import { ValidationErrors } from "./campaign.errors";

describe("petCount.util", () => {
  it("accepts pet count >= 1", () => {
    expect(() => assertMinimumPetCount(1)).not.toThrow();
    expect(() => assertMinimumPetCount(3)).not.toThrow();
  });

  it("rejects zero and negative counts", () => {
    expect(() => assertMinimumPetCount(0)).toThrow(PET_COUNT_REQUIRED_MESSAGE);
    expect(() => assertMinimumPetCount(-1)).toThrow(PET_COUNT_REQUIRED_MESSAGE);
  });

  it("uses HTTP 400 via ValidationErrors", () => {
    try {
      assertMinimumPetCount(0);
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationErrors.INVALID_INPUT("x").constructor);
      expect((err as { statusCode?: number }).statusCode).toBe(400);
      expect((err as Error).message).toBe(PET_COUNT_REQUIRED_MESSAGE);
    }
  });

  it("exports MIN_PET_COUNT as 1", () => {
    expect(MIN_PET_COUNT).toBe(1);
  });
});
