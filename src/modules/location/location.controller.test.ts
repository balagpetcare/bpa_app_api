jest.mock("./location.service", () => ({
  listDivisions: jest.fn(),
  validateSelection: jest.fn(),
}));

const ctrl = require("./location.controller");
const service = require("./location.service");

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("location.controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns divisions via centralized service", async () => {
    const req: any = { prisma: {}, query: { page: "1", pageSize: "10" } };
    const res = mockRes();
    service.listDivisions.mockResolvedValue({
      data: [{ id: 1, nameEn: "Dhaka", code: "DIV-6" }],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });

    await ctrl.listDivisions(req, res);

    expect(service.listDivisions).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 1, nameEn: "Dhaka", code: "DIV-6" }],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    });
  });

  it("returns 400 when selection validation fails", async () => {
    const req: any = { prisma: {}, body: { divisionId: 10, districtId: 20 } };
    const res = mockRes();
    service.validateSelection.mockResolvedValue({
      ok: false,
      errorCode: "DISTRICT_DIVISION_MISMATCH",
      message: "District does not belong to selected division",
    });

    await ctrl.validateSelection(req, res);

    expect(service.validateSelection).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      ok: false,
      errorCode: "DISTRICT_DIVISION_MISMATCH",
      message: "District does not belong to selected division",
    });
  });
});

