/**
 * Facade over transfers.service for warehouse module imports (create / send / receive).
 */
const transfersService = require("../../transfers/transfers.service");

export async function createDraftTransfer(params: Parameters<typeof transfersService.createTransfer>[0]) {
  return transfersService.createTransfer(params);
}

export async function sendTransfer(transferId: number, createdByUserId?: number) {
  return transfersService.sendTransfer(transferId, createdByUserId);
}

export async function receiveTransfer(transferId: number, data: any) {
  return transfersService.receiveTransfer(transferId, data);
}

export const getTransferById = transfersService.getTransferById;
