import prisma from "../../../../infrastructure/db/prismaClient";
import { listBranchInboundQueue } from "../../services/branchInboundQueue.service";
import {
  getAllowedBranchIdsForInboundReceive,
  getOrgIdForInboundUser,
} from "../../services/inboundReceiveBranchAccess.service";

exports.getInboundQueue = async (req: any, res: any) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const branchId = parseInt(req.params.branchId, 10);
    if (!branchId) return res.status(400).json({ success: false, message: "branchId required" });
    const allowed = await getAllowedBranchIdsForInboundReceive(userId);
    if (!allowed.includes(branchId)) {
      return res.status(403).json({ success: false, message: "Branch not accessible" });
    }
    const orgId = await getOrgIdForInboundUser(userId);
    if (!orgId) return res.status(403).json({ success: false, message: "Organization context required" });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { id: true } });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
    const items = await listBranchInboundQueue(branchId, orgId);
    return res.status(200).json({ success: true, data: { items } });
  } catch (e: any) {
    console.error("staffBranchQueues.getInboundQueue", e);
    return res.status(500).json({ success: false, message: e?.message ?? "Failed to load inbound queue" });
  }
};
