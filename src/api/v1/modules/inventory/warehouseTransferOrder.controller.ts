import { Request, Response } from "express";
import * as service from "./warehouseTransferOrder.service";

/**
 * Check if legacy WTO creation is blocked.
 * Set process.env.BLOCK_LEGACY_TRANSFERS=true to block new WarehouseTransferOrder creation.
 */
function isLegacyWTOBlocked(): boolean {
  return process.env.BLOCK_LEGACY_TRANSFERS === "true";
}

/**
 * @deprecated Use StockDispatch flow instead.
 * Create warehouse transfer order.
 *
 * MIGRATION: Use StockRequest → AllocationPlan → PickList → StockDispatch flow.
 */
export const createWTO = async (req: Request, res: Response) => {
  try {
    // Block new WTO creation if env flag is set
    if (isLegacyWTOBlocked()) {
      console.warn("[BLOCKED] WarehouseTransferOrder creation blocked. Use StockDispatch flow instead.");
      return res.status(400).json({
        success: false,
        message: "Legacy WarehouseTransferOrder creation is disabled. Please use the Stock Request → Dispatch flow instead.",
        code: "LEGACY_TRANSFER_BLOCKED",
        migrationHint: "Create a Stock Request, then use Allocation → Pick → Dispatch flow.",
      });
    }

    console.warn("[DEPRECATED] createWTO called. Use StockDispatch flow instead. User:", (req as any).user?.id);

    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { orgId, fromLocationId, toLocationId, note, lines } = req.body;
    if (!orgId || !fromLocationId || !toLocationId || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, message: "orgId, fromLocationId, toLocationId, lines required" });
    }
    const result = await service.createWTO({
      orgId: parseInt(orgId),
      fromLocationId: parseInt(fromLocationId),
      toLocationId: parseInt(toLocationId),
      note,
      lines: lines.map((l: any) => ({
        variantId: parseInt(l.variantId),
        lotId: l.lotId ? parseInt(l.lotId) : undefined,
        requestedQty: parseInt(l.requestedQty),
        note: l.note,
      })),
      createdByUserId: userId,
    });
    return res.status(201).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const listWTO = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, string>;
    const result = await service.listWTO({
      orgId: q.orgId ? parseInt(q.orgId) : undefined,
      fromLocationId: q.fromLocationId ? parseInt(q.fromLocationId) : undefined,
      toLocationId: q.toLocationId ? parseInt(q.toLocationId) : undefined,
      status: q.status,
      page: q.page ? parseInt(q.page) : 1,
      limit: q.limit ? parseInt(q.limit) : 20,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getWTO = async (req: Request, res: Response) => {
  try {
    const result = await service.getWTO(parseInt((req.params as Record<string,string>).id));
    return res.status(200).json({ success: true, data: result });
  } catch (e: any) {
    return res.status(e.message.includes("not found") ? 404 : 500).json({ success: false, message: e.message });
  }
};

export const approveWTO = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const result = await service.approveWTO(parseInt((req.params as Record<string,string>).id), userId);
    return res.status(200).json({ success: true, data: result, message: "Transfer order approved" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const pickWTO = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { pickedLines } = req.body;
    if (!Array.isArray(pickedLines)) {
      return res.status(400).json({ success: false, message: "pickedLines array required" });
    }
    const result = await service.pickWTO(parseInt((req.params as Record<string,string>).id), pickedLines, userId);
    return res.status(200).json({ success: true, data: result, message: "Lines updated with picked quantities" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const dispatchWTO = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const result = await service.dispatchWTO(parseInt((req.params as Record<string,string>).id), userId);
    return res.status(200).json({ success: true, data: result, message: "Transfer dispatched, stock deducted" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const receiveWTO = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    const { receivedLines } = req.body;
    if (!Array.isArray(receivedLines)) {
      return res.status(400).json({ success: false, message: "receivedLines array required" });
    }
    const result = await service.receiveWTO(parseInt((req.params as Record<string,string>).id), receivedLines, userId);
    return res.status(200).json({ success: true, data: result, message: "Transfer received, stock added to destination" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};

export const closeWTO = async (req: Request, res: Response) => {
  try {
    const result = await service.closeWTO(parseInt((req.params as Record<string,string>).id));
    return res.status(200).json({ success: true, data: result, message: "Transfer order closed" });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
};
