/**
 * Server-side booking confirmation PDF (pdfkit + qrcode).
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import prisma from "../../../../infrastructure/db/prismaClient";
import { ClaimErrors } from "./campaign.errors";
import { formatCampaignTimeLabel } from "./slot.schedule";
import { generateVerificationCode } from "./qr.service";
import { normalizePhone } from "./campaign.utils";

const PDF_RATE_WINDOW_MS = 15 * 60 * 1000;
const PDF_RATE_MAX = 10;
const pdfAttempts = new Map<string, { count: number; resetAt: number }>();

const GUEST_NAME = /^guest$/i;

export type BookingPdfAccessInput = {
  bookingRef: string;
  verificationCode?: string;
  ownerUserId?: number;
  clientKey?: string;
};

export type BookingPdfPayload = {
  bookingRef: string;
  verificationCode: string;
  campaignName: string;
  customerName: string;
  customerPhone: string;
  pets: Array<{
    name: string;
    species: string;
    breed: string;
    gender: string;
  }>;
  locationLabel: string;
  venueName: string | null;
  scheduleLabel: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paymentAmount: string | null;
  verifyUrl: string;
  generatedAt: string;
};

function assertPdfRateLimit(key: string) {
  const now = Date.now();
  const entry = pdfAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    pdfAttempts.set(key, { count: 1, resetAt: now + PDF_RATE_WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > PDF_RATE_MAX) {
    throw ClaimErrors.RATE_LIMIT();
  }
}

function normalizeCode(code: string): string {
  return code.replace(/-/g, "").trim().toUpperCase();
}

function formatGender(gender: string | null | undefined): string {
  if (!gender) return "—";
  const g = gender.toUpperCase();
  if (g === "MALE") return "Male";
  if (g === "FEMALE") return "Female";
  if (g === "UNKNOWN") return "Unknown";
  return gender;
}

function formatPaymentStatus(status: string): string {
  const s = status.toUpperCase();
  if (s === "COMPLETED") return "Paid";
  if (s === "NOT_REQUIRED") return "Not required";
  if (s === "PENDING") return "Pending";
  if (s === "FAILED") return "Failed";
  if (s === "REFUNDED") return "Refunded";
  return status;
}

function formatPaymentMethod(method: string | null | undefined): string | null {
  if (!method) return null;
  const u = method.trim().toUpperCase();
  if (u === "BKASH") return "bKash";
  if (u === "NAGAD") return "Nagad";
  if (u === "CARD") return "Card";
  return method;
}

function buildVerifyUrl(bookingRef: string): string {
  const base =
    process.env.CAMPAIGN_LANDING_URL ||
    process.env.CAMPAIGN_BASE_URL ||
    "https://vaccination.bangladeshpetassociation.com";
  const origin = base.replace(/\/+$/, "");
  return `${origin}/verify/certificate?ref=${encodeURIComponent(bookingRef)}`;
}

function buildScheduleLabel(booking: {
  bookingDate: Date;
  bookingMode: string;
  status: string;
  slot: { startTime: string; endTime: string; sessionName?: string | null } | null;
  location: { name: string } | null;
  bookingArea: string | null;
  coverageZoneName: string | null;
}): string {
  const pending =
    booking.bookingMode === "ZONE_INTEREST" && booking.status === "PENDING_ASSIGNMENT";
  if (pending) {
    return "Will be sent via SMS";
  }
  const date = booking.bookingDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  if (booking.slot?.startTime) {
    const start = formatCampaignTimeLabel(booking.slot.startTime);
    const end = formatCampaignTimeLabel(booking.slot.endTime);
    const session = booking.slot.sessionName?.trim();
    return session ? `${date} · ${session} · ${start}–${end}` : `${date} · ${start}–${end}`;
  }
  if (booking.location?.name) {
    return `${date} · ${booking.location.name}`;
  }
  return date;
}

export async function loadBookingPdfPayload(
  input: BookingPdfAccessInput
): Promise<BookingPdfPayload> {
  const ref = input.bookingRef.trim().toUpperCase();
  const rateKey = `${ref}:${input.clientKey ?? "unknown"}`;
  assertPdfRateLimit(rateKey);

  const booking = await prisma.campaignBooking.findUnique({
    where: { bookingRef: ref },
    include: {
      campaign: { select: { name: true } },
      location: { select: { name: true } },
      slot: { select: { startTime: true, endTime: true, sessionName: true } },
      checkoutSession: { select: { paymentMethod: true, amount: true } },
      pets: {
        include: {
          animalType: { select: { name: true } },
          breed: { select: { name: true } },
        },
      },
    },
  });

  if (!booking) {
    throw ClaimErrors.INVALID();
  }

  const expectedCode = normalizeCode(generateVerificationCode(booking.qrToken));
  const providedCode = input.verificationCode
    ? normalizeCode(input.verificationCode)
    : "";

  const ownerMatch =
    input.ownerUserId != null &&
    booking.ownerUserId != null &&
    booking.ownerUserId === input.ownerUserId;

  if (!ownerMatch && (!providedCode || expectedCode !== providedCode)) {
    throw ClaimErrors.INVALID();
  }

  const verificationCode = generateVerificationCode(booking.qrToken);
  const ownerName = booking.ownerName?.trim() || "";
  const customerName =
    !ownerName || GUEST_NAME.test(ownerName)
      ? normalizePhone(booking.ownerPhone)
      : ownerName;

  const paidAmount =
    booking.paidAmount != null
      ? Number(booking.paidAmount)
      : booking.checkoutSession?.amount != null
        ? Number(booking.checkoutSession.amount)
        : null;

  const locationLabel =
    booking.bookingArea?.trim() ||
    booking.coverageZoneName?.trim() ||
    booking.location?.name ||
    "—";

  return {
    bookingRef: booking.bookingRef,
    verificationCode,
    campaignName: booking.campaign.name,
    customerName,
    customerPhone: normalizePhone(booking.ownerPhone),
    pets: booking.pets.map((p) => ({
      name: p.name,
      species: p.animalType?.name ?? "Cat",
      breed: p.breed?.name ?? "—",
      gender: formatGender(p.gender),
    })),
    locationLabel,
    venueName: booking.location?.name ?? null,
    scheduleLabel: buildScheduleLabel(booking),
    paymentStatus: formatPaymentStatus(booking.paymentStatus),
    paymentMethod: formatPaymentMethod(booking.checkoutSession?.paymentMethod),
    paymentAmount:
      paidAmount != null && paidAmount > 0 ? `৳${paidAmount.toLocaleString("en-BD")}` : null,
    verifyUrl: buildVerifyUrl(booking.bookingRef),
    generatedAt: new Date().toISOString(),
  };
}

function drawSectionTitle(doc: InstanceType<typeof PDFDocument>, title: string) {
  doc.moveDown(0.6);
  doc.fontSize(11).fillColor("#00695C").font("Helvetica-Bold").text(title);
  doc.moveDown(0.2);
  doc.font("Helvetica").fillColor("#263238").fontSize(10);
}

function drawRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string) {
  if (!value || value === "—") return;
  doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
  doc.font("Helvetica").text(value);
}

function drawBpaLogo(doc: InstanceType<typeof PDFDocument>, x: number, y: number) {
  doc.save();
  doc.roundedRect(x, y, 48, 48, 6).fill("#00695C");
  doc.fillColor("#F4B942").fontSize(14).font("Helvetica-Bold");
  doc.text("BPA", x, y + 16, { width: 48, align: "center" });
  doc.restore();
  doc.fillColor("#263238");
}

export async function generateBookingConfirmationPdfBuffer(
  payload: BookingPdfPayload
): Promise<Buffer> {
  const qrPng = await QRCode.toBuffer(payload.verifyUrl, {
    type: "png",
    margin: 1,
    width: 140,
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawBpaLogo(doc, 48, 48);
    doc.fontSize(18).fillColor("#00695C").font("Helvetica-Bold");
    doc.text("Bangladesh Pet Association (BPA)", 110, 52);
    doc.fontSize(12).fillColor("#546e7a").font("Helvetica");
    doc.text("Vaccination Booking Confirmation", 110, 78);

    drawSectionTitle(doc, "Campaign");
    drawRow(doc, "Campaign", payload.campaignName);

    drawSectionTitle(doc, "Booking");
    drawRow(doc, "Booking ID", payload.bookingRef);
    drawRow(doc, "Verification Code", payload.verificationCode);

    drawSectionTitle(doc, "Customer");
    drawRow(doc, "Name", payload.customerName);
    drawRow(doc, "Mobile", payload.customerPhone);

    drawSectionTitle(doc, "Pet(s)");
    if (payload.pets.length === 0) {
      doc.text("No pets recorded");
    } else {
      payload.pets.forEach((p, i) => {
        doc.moveDown(0.15);
        doc.font("Helvetica-Bold").text(`Pet ${i + 1}: ${p.name}`);
        doc.font("Helvetica");
        doc.text(`Species: ${p.species} · Breed: ${p.breed} · Gender: ${p.gender}`);
      });
    }

    drawSectionTitle(doc, "Vaccination");
    drawRow(doc, "Campaign", payload.campaignName);
    drawRow(doc, "Location", payload.locationLabel);
    if (payload.venueName && payload.venueName !== payload.locationLabel) {
      drawRow(doc, "Venue", payload.venueName);
    }
    drawRow(doc, "Date / Time", payload.scheduleLabel);

    drawSectionTitle(doc, "Payment");
    drawRow(doc, "Status", payload.paymentStatus);
    if (payload.paymentMethod) drawRow(doc, "Method", payload.paymentMethod);
    if (payload.paymentAmount) drawRow(doc, "Amount", payload.paymentAmount);

    const qrY = doc.y + 12;
    doc.image(qrPng, 48, qrY, { width: 100 });
    doc.fontSize(8).fillColor("#546e7a");
    doc.text("Scan to verify", 48, qrY + 108, { width: 100, align: "center" });

    const footerY = 720;
    doc.fontSize(8).fillColor("#78909c");
    doc.text("Generated by BPA Vaccination System", 48, footerY, { align: "center", width: 500 });
    doc.text(payload.verifyUrl, 48, footerY + 12, { align: "center", width: 500, link: payload.verifyUrl });
    doc.text(`Generated: ${new Date(payload.generatedAt).toLocaleString("en-GB")}`, 48, footerY + 28, {
      align: "center",
      width: 500,
    });
    doc.text("Official BPA Vaccination Campaign 2026", 48, footerY + 42, { align: "center", width: 500 });

    doc.end();
  });
}

export function bookingPdfFilename(bookingRef: string): string {
  const safe = bookingRef.replace(/[^A-Za-z0-9-]/g, "");
  return `BPA-Vaccination-Booking-${safe || "booking"}.pdf`;
}

export async function getBookingConfirmationPdf(
  input: BookingPdfAccessInput
): Promise<{ buffer: Buffer; filename: string }> {
  const payload = await loadBookingPdfPayload(input);
  const buffer = await generateBookingConfirmationPdfBuffer(payload);
  return { buffer, filename: bookingPdfFilename(payload.bookingRef) };
}
