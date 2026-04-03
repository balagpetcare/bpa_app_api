/**
 * Draft-only mutation rules for prescriptions (finalized/dispensed cannot be PATCHed).
 */
const findUniqueMock = jest.fn();
const deleteManyMock = jest.fn();
const updateMock = jest.fn();

jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {
    prescription: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
    prescriptionItem: {
      deleteMany: deleteManyMock,
    },
  },
}));

jest.mock("./dispenseControl.service", () => ({}));

const { updatePrescription } = require("./prescription.service");

describe("prescription.service updatePrescription (immutability)", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    deleteManyMock.mockReset();
    updateMock.mockReset();
  });

  it("returns null and does not update when status is FINALIZED", async () => {
    findUniqueMock.mockResolvedValue({
      id: 9,
      status: "FINALIZED",
      items: [],
    });
    const r = await updatePrescription(9, { notes: "hack" });
    expect(r).toBeNull();
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("returns null when status is DISPENSED", async () => {
    findUniqueMock.mockResolvedValue({
      id: 10,
      status: "DISPENSED",
      items: [],
    });
    const r = await updatePrescription(10, { notes: "x" });
    expect(r).toBeNull();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
