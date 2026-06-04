/**
 * Branch inbound controlled receive (inter-branch stock dispatch).
 *
 * **Schema:** Reuses `DispatchReceiveSession` + `DispatchReceiveSessionLine` (linked 1:1 to `StockDispatch`).
 * No separate `BranchReceiveSession` table — avoids duplicating vendor `VendorReceiveSession` patterns.
 *
 * **HTTP:** Prefer RESTful routes on `/api/v1/inventory/dispatches/:id/receive-session` (see `dispatches.routes.ts`).
 * Legacy body: `POST .../receive` with `receiveMode: verify|submit|confirm` remains supported.
 */
export {
  saveDispatchReceiveVerification,
  submitDispatchReceiveSessionForConfirmation,
  confirmDispatchReceiveFromSession,
  cancelDispatchReceiveSession,
} from "../modules/dispatches/dispatches.service";
