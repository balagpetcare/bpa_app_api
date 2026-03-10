/**
 * Vaccination & preventive care: record vaccination, booster schedule, certificate (QR), deworming.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const { randomUUID } = require("crypto");

function generateCertificateToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase();
}

async function listByPet(petId: number): Promise<any[]> {
  return prisma.vaccination.findMany({
    where: { petId },
    include: { vaccineType: true },
    orderBy: { administeredAt: "desc" },
  });
}

async function getNextDueByPet(petId: number): Promise<{ vaccination: any; nextDue: Date }[]> {
  const vaccinations = await prisma.vaccination.findMany({
    where: { petId, nextDueDate: { not: null, gte: new Date() } },
    include: { vaccineType: true },
    orderBy: { nextDueDate: "asc" },
  });
  return vaccinations.map((v) => ({ vaccination: v, nextDue: v.nextDueDate }));
}

async function recordVaccination(data: {
  petId: number;
  vaccineTypeId: number;
  administeredAt?: Date;
  nextDueDate?: Date;
  batchNumber?: string;
  manufacturer?: string;
  vetClinic?: string;
  notes?: string;
}): Promise<any> {
  const vaccineType = await prisma.vaccineType.findUnique({ where: { id: data.vaccineTypeId } });
  const nextDue = data.nextDueDate ?? (vaccineType ? new Date(Date.now() + vaccineType.defaultIntervalDays * 86400000) : null);
  const certToken = generateCertificateToken();
  return prisma.vaccination.create({
    data: {
      petId: data.petId,
      vaccineTypeId: data.vaccineTypeId,
      administeredAt: data.administeredAt ?? new Date(),
      nextDueDate: nextDue,
      batchNumber: data.batchNumber ?? null,
      manufacturer: data.manufacturer ?? null,
      vetClinic: data.vetClinic ?? null,
      certificateToken: certToken,
      notes: data.notes ?? null,
    },
    include: { vaccineType: true },
  });
}

async function getByCertificateToken(token: string): Promise<any | null> {
  return prisma.vaccination.findUnique({
    where: { certificateToken: token },
    include: { pet: { include: { animalType: true } }, vaccineType: true },
  });
}

async function listDewormingByPet(petId: number): Promise<any[]> {
  return prisma.dewormingRecord.findMany({
    where: { petId },
    orderBy: { administeredAt: "desc" },
  });
}

async function recordDeworming(data: { petId: number; medicationName: string; dosage?: string; weightAtTime?: number; nextDueDate?: Date; notes?: string }): Promise<any> {
  return prisma.dewormingRecord.create({
    data: {
      petId: data.petId,
      medicationName: data.medicationName,
      dosage: data.dosage ?? null,
      weightAtTime: data.weightAtTime ?? null,
      nextDueDate: data.nextDueDate ?? null,
      notes: data.notes ?? null,
    },
  });
}

module.exports = {
  listByPet,
  getNextDueByPet,
  recordVaccination,
  getByCertificateToken,
  listDewormingByPet,
  recordDeworming,
};
