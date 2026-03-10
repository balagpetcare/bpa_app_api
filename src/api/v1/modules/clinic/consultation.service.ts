/**
 * Consultation workflow: templates (disease-specific SOAP), advice/diet, discharge notes.
 */
const prisma = require("../../../../infrastructure/db/prismaClient").default ?? require("../../../../infrastructure/db/prismaClient");
const emrService = require("./emr.service");

async function listTemplates(branchId: number): Promise<any[]> {
  return prisma.consultationTemplate.findMany({
    where: { branchId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

async function getTemplate(branchId: number, templateId: number): Promise<any | null> {
  return prisma.consultationTemplate.findFirst({
    where: { id: templateId, branchId },
  });
}

async function createTemplate(
  branchId: number,
  orgId: number,
  data: { name: string; description?: string; contentJson: any; isDefault?: boolean }
): Promise<any> {
  return prisma.consultationTemplate.create({
    data: {
      orgId,
      branchId,
      name: data.name.trim(),
      description: data.description?.trim() || null,
      contentJson: data.contentJson ?? {},
      isDefault: data.isDefault ?? false,
    },
  });
}

async function updateTemplate(
  branchId: number,
  templateId: number,
  data: { name?: string; description?: string; contentJson?: any; isDefault?: boolean }
): Promise<any | null> {
  const existing = await prisma.consultationTemplate.findFirst({
    where: { id: templateId, branchId },
  });
  if (!existing) return null;

  const updatePayload: any = {};
  if (data.name !== undefined) updatePayload.name = data.name.trim();
  if (data.description !== undefined) updatePayload.description = data.description?.trim() || null;
  if (data.contentJson !== undefined) updatePayload.contentJson = data.contentJson;
  if (data.isDefault !== undefined) updatePayload.isDefault = data.isDefault;

  return prisma.consultationTemplate.update({
    where: { id: templateId },
    data: updatePayload,
  });
}

/**
 * Apply a template to a visit: add a SOAP clinical note with the template's contentJson.
 */
async function applyTemplateToVisit(
  visitId: number,
  branchId: number,
  templateId: number,
  createdByMemberId: number
): Promise<any | null> {
  const template = await prisma.consultationTemplate.findFirst({
    where: { id: templateId, branchId },
  });
  if (!template) return null;

  return emrService.addClinicalNote(visitId, branchId, {
    noteType: "SOAP",
    contentJson: template.contentJson,
    createdById: createdByMemberId,
  });
}

/**
 * Add discharge summary note to a visit.
 */
async function addDischargeNote(
  visitId: number,
  branchId: number,
  data: { contentJson: { summary?: string; advice?: string; followUp?: string }; createdByMemberId: number }
): Promise<any | null> {
  return emrService.addClinicalNote(visitId, branchId, {
    noteType: "DISCHARGE",
    contentJson: data.contentJson ?? {},
    createdById: data.createdByMemberId,
  });
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  applyTemplateToVisit,
  addDischargeNote,
};
