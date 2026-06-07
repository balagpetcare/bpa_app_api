jest.mock("../../../../infrastructure/db/prismaClient", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("pdfkit", () => jest.fn());
jest.mock("qrcode", () => ({ toBuffer: jest.fn() }));

const {
  bookingPdfFilename,
  buildBookingPdfQrPayload,
} = require("./bookingPdf.service");

describe("bookingPdf.service", () => {
  it("builds safe PDF filename from booking ref", () => {
    expect(bookingPdfFilename("VAC-ABC123")).toBe("BPA-Booking-VAC-ABC123.pdf");
    expect(bookingPdfFilename("VAC-68PRKA")).toBe("BPA-Booking-VAC-68PRKA.pdf");
    expect(bookingPdfFilename("VAC/unsafe")).toBe("BPA-Booking-VACunsafe.pdf");
  });

  it("builds QR payload with booking id, code, and verify URL", () => {
    const url = "https://vaccination.bangladeshpetassociation.com/verify/certificate?ref=VAC-68PRKA&code=ABCD-1234";
    const payload = buildBookingPdfQrPayload("VAC-68PRKA", "ABCD-1234", url);
    expect(payload).toContain("VAC-68PRKA");
    expect(payload).toContain("ABCD-1234");
    expect(payload).toContain(url);
  });
});
