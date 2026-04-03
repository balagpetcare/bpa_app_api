import { Request, Response } from "express";
import * as service from "./vendorReturn.service";
import prisma from "../../../../infrastructure/db/prismaClient";

async function assertOrgAccess(userId: number, orgId: number): Promise<boolean> {
  const isOwner = await prisma.organization.findFirst({
    where: { id: orgId, ownerUserId: userId },
    select: { id: true },
  });
  if (isOwner) return true;
  const member = await prisma.orgMember.findFirst({
    where: { userId, orgId, status: "ACTIVE" },
    select: { id: true },
  });
  return !!member;
}

export const createVendorReturn = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { orgId, vendorId, locationId, reason, note, creditExpected, referenceNumber, lines } = req.body;
    if (!orgId || !vendorId || !locationId || !reason || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, message: "orgId, vendorId, locationId, reason, lines required" });
    }
    if (!(await assertOrgAccess(userId, parseInt(orgId)))) {
      return res.status(403).json({ success: false, message: "Not authorized for this org" });
    }
    const result = await service.createVendorReturn({
      orgId: parseInt(orgId), vendorId: parseInt(vendorId), locationId: parseInt(locationId),
      reason, note, creditExpected: creditExpected ? Number(creditExpected) : undefined,
      referenceNumber,
      lines: lines.map((l: any) => ({
        variantId: parseInt(l.variantId), lotId: l.lotId ? parseInt(l.lotId) : undefined,
        quantity: parseInt(l.quantity), unitCost: l.unitCost ? Number(l.unitCost) : undefined,
        condition: l.condition, note: l.note,
      })),
      createdByUserId: userId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const listVendorReturns = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const orgId = req.query.orgId as string | undefined;
    const vendorId = req.query.vendorId as string | undefined;
    const status = req.query.status as string | undefined;
    const page = req.query.page as string | undefined;
    const limit = req.query.limit as string | undefined;
    const result = await service.listVendorReturns({
      orgId: orgId ? parseInt(orgId) : undefined,
      vendorId: vendorId ? parseInt(vendorId) : undefined,
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getVendorReturn = async (req: Request, res: Response) => {
  try {
    const id = parseInt((req.params as Record<string, string>).id);
    const result = await service.getVendorReturn(id);
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(e.message.includes("not found") ? 404 : 500).json({ success: false, message: e.message });
  }
};

export const submitVendorReturn = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const pid = parseInt((req.params as Record<string, string>).id);
    const result = await service.submitVendorReturn(pid, userId);
    return res.status(200).json({ success: true, data: result, message: "Return submitted for approval" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const approveVendorReturn = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const pid = parseInt((req.params as Record<string, string>).id);
    const result = await service.approveVendorReturn(pid, userId);
    return res.status(200).json({ success: true, data: result, message: "Return approved and stock deducted" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const dispatchVendorReturn = async (req: Request, res: Response) => {
  try {
    const pid = parseInt((req.params as Record<string, string>).id);
    const result = await service.dispatchVendorReturn(pid);
    return res.status(200).json({ success: true, data: result, message: "Return marked as dispatched" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const markReceivedByVendor = async (req: Request, res: Response) => {
  try {
    const pid = parseInt((req.params as Record<string, string>).id);
    const result = await service.markReceivedByVendor(pid, req.body.referenceNumber);
    return res.status(200).json({ success: true, data: result, message: "Marked as received by vendor" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const markCredited = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { creditReceived } = req.body;
    if (!creditReceived) return res.status(400).json({ success: false, message: "creditReceived required" });
    const pid = parseInt((req.params as Record<string, string>).id);
    const result = await service.markCredited(pid, Number(creditReceived), userId);
    return res.status(200).json({ success: true, data: result, message: "Credit recorded" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const cancelVendorReturn = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const pid = parseInt((req.params as Record<string, string>).id);
    const result = await service.cancelVendorReturn(pid, userId);
    return res.status(200).json({ success: true, data: result, message: "Return cancelled" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
