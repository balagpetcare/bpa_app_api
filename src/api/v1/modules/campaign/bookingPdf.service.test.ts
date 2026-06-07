jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("pdfkit", () => jest.fn());
jest.mock("qrcode", () => ({ toBuffer: jest.fn() }));

const { bookingPdfFilename } = require("./bookingPdf.service");

describe("bookingPdf.service", () => {
  it("builds safe PDF filename from booking ref", () => {
    expect(bookingPdfFilename("VAC-ABC123")).toBe("BPA-Vaccination-Booking-VAC-ABC123.pdf");
    expect(bookingPdfFilename("VAC/unsafe")).toBe("BPA-Vaccination-Booking-VACunsafe.pdf");
  });
});
