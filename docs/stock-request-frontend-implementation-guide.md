# Stock Request Frontend Implementation Guide

## Backend Complete ✅ - Frontend Ready to Implement

All backend APIs, schema changes, and business logic for the enterprise stock request fulfillment redesign are complete and functional.

## Backend APIs Available

### 1. Enhanced Detail API
**GET** `/api/v1/stock-requests/:id?fromLocationId=:locId`

Returns:
```typescript
{
  items: [{
    id, requestedQty, fulfilledQty, cancelledQty,
    remainingQty, // computed
    lineStatus, // PENDING/PARTIAL/FULFILLED/OVER_FULFILLED/CANCELLED/EXTRA
    lineKind, // REQUESTED/EXTRA
    // ...existing fields
  }],
  availableLotsByVariant: {
    [variantId]: [{
      lotId, lotCode, mfgDate, expDate,
      onHandQty, reservedQty, effectiveAvailable,
      isExpired, isNearExpiry, isRecalled, isQcHeld,
      fefoRank
    }]
  },
  aggregateStockByVariant: { [variantId]: effectiveQty },
  maxDispatchableByVariant: { [variantId]: maxQty },
  lineWarnings: {
    [itemId]: [{ code, message, severity }]
  },
  summary: {
    totalRequestedQty,
    totalFulfilledQty,
    totalCancelledQty,
    totalRemainingQty,
    totalMaxDispatchable,
    linesByStatus: { PENDING: 3, PARTIAL: 1, ... }
  }
}
```

### 2. Line Cancellation API
**PATCH** `/api/v1/stock-requests/:id/items/:itemId/cancel`

Body: `{ cancelledQty: number, reason?: string }`

### 3. Line Restore API
**PATCH** `/api/v1/stock-requests/:id/items/:itemId/restore`

### 4. Allocation Preview API
**POST** `/api/v1/stock-requests/:id/allocation-preview`

Body:
```json
{
  "fromLocationId": 1,
  "items": [{ "stockRequestItemId": 10, "fulfillQty": 7 }]
}
```

Returns lot-by-lot allocation preview with warnings.

### 5. Enhanced Fulfill API
**PATCH** `/api/v1/stock-requests/:id/fulfill`

Body unchanged. Returns enhanced response:
```json
{
  "fulfillment": {
    "acceptedLines": [...],
    "rejectedLines": [...],
    "cancelledLines": [...],
    "warnings": [...]
  }
}
```

## Frontend Implementation Tasks

### File to Update
`D:\BPA_Data\bpa_web\app\owner\(larkon)\inventory\stock-requests\[id]\page.tsx`

### 1. Summary Cards (Top of Page)

Add after status bar, before request info card:

```tsx
{request.summary && (
  <div className="row g-3 mb-3">
    <div className="col-md-3">
      <div className="card radius-12 h-100">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="text-secondary small">Total Requested</span>
          </div>
          <h4 className="mb-0">{request.summary.totalRequestedQty}</h4>
        </div>
      </div>
    </div>
    <div className="col-md-3">
      <div className="card radius-12 h-100 bg-success-subtle">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="text-secondary small">Dispatchable</span>
          </div>
          <h4 className="mb-0">{request.summary.totalMaxDispatchable}</h4>
        </div>
      </div>
    </div>
    <div className="col-md-3">
      <div className="card radius-12 h-100 bg-warning-subtle">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="text-secondary small">Partial/Cancelled</span>
          </div>
          <h4 className="mb-0">
            {(request.summary.linesByStatus?.PARTIAL ?? 0) +
             (request.summary.linesByStatus?.CANCELLED ?? 0)}
          </h4>
        </div>
      </div>
    </div>
    <div className="col-md-3">
      <div className="card radius-12 h-100 bg-primary-subtle">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <span className="text-secondary small">Already Fulfilled</span>
          </div>
          <h4 className="mb-0">{request.summary.totalFulfilledQty}</h4>
        </div>
      </div>
    </div>
  </div>
)}
```

### 2. Line Status Chips

Add helper function:
```tsx
function getLineStatusBadge(item: any) {
  const status = item.lineStatus;
  const classes: Record<string, string> = {
    PENDING: 'bg-secondary',
    PARTIAL: 'bg-warning',
    FULFILLED: 'bg-success',
    OVER_FULFILLED: 'bg-info',
    CANCELLED: 'bg-danger',
    EXTRA: 'bg-primary',
  };
  return (
    <span className={`badge ${classes[status] || 'bg-light text-dark'}`}>
      {status}
    </span>
  );
}
```

Add to fulfillment grid for each row:
```tsx
<td>{getLineStatusBadge(row)}</td>
```

### 3. Expandable Lot Detail Rows

Add state:
```tsx
const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
```

In fulfillment grid, add expandable row logic:
```tsx
{requestedRows.map((row: any) => (
  <React.Fragment key={row.id}>
    <tr>
      {/* existing columns */}
      <td>
        <button
          className="btn btn-sm btn-link"
          onClick={() => {
            const newSet = new Set(expandedRows);
            if (newSet.has(row.id)) newSet.delete(row.id);
            else newSet.add(row.id);
            setExpandedRows(newSet);
          }}
        >
          {expandedRows.has(row.id) ? '▼' : '▶'}
          {(lotsByVariant[row.variantId] ?? []).length} lots
        </button>
      </td>
    </tr>
    {expandedRows.has(row.id) && (
      <tr>
        <td colSpan={8} className="bg-light">
          <div className="p-3">
            <strong>Available Lots (FEFO order):</strong>
            <table className="table table-sm mt-2">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Lot Code</th>
                  <th>Expiry</th>
                  <th>Available</th>
                  <th>Reserved</th>
                  <th>Effective</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(lotsByVariant[row.variantId] ?? []).map((lot: any) => (
                  <tr key={lot.lotId}>
                    <td>{lot.fefoRank}</td>
                    <td>{lot.lotCode}</td>
                    <td>{new Date(lot.expDate).toLocaleDateString()}</td>
                    <td>{lot.onHandQty}</td>
                    <td>{lot.reservedQty}</td>
                    <td className="fw-bold">{lot.effectiveAvailable}</td>
                    <td>
                      {lot.isExpired && <span className="badge bg-danger">Expired</span>}
                      {lot.isNearExpiry && <span className="badge bg-warning">Near Expiry</span>}
                      {lot.isRecalled && <span className="badge bg-danger">Recalled</span>}
                      {lot.isQcHeld && <span className="badge bg-warning">QC Hold</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    )}
  </React.Fragment>
))}
```

### 4. Line Cancel/Restore Actions

Add state:
```tsx
const [cancellingLineId, setCancellingLineId] = useState<number | null>(null);
const [cancelQty, setCancelQty] = useState<number>(0);
const [cancelReason, setCancelReason] = useState("");
```

Add handlers:
```tsx
const handleCancelLine = async (itemId: number, qty: number) => {
  try {
    await ownerPatch(`/api/v1/stock-requests/${request.id}/items/${itemId}/cancel`, {
      cancelledQty: qty,
      reason: cancelReason || undefined,
    });
    setSuccess("Line cancelled");
    setCancellingLineId(null);
    await loadDetailWithLots(String(fromLocationId));
  } catch (e: any) {
    setError(e?.message ?? "Failed to cancel line");
  }
};

const handleRestoreLine = async (itemId: number) => {
  try {
    await ownerPatch(`/api/v1/stock-requests/${request.id}/items/${itemId}/restore`, {});
    setSuccess("Line restored");
    await loadDetailWithLots(String(fromLocationId));
  } catch (e: any) {
    setError(e?.message ?? "Failed to restore line");
  }
};
```

Add action column to grid:
```tsx
<td>
  {row.cancelledQty > 0 ? (
    <button className="btn btn-sm btn-success" onClick={() => handleRestoreLine(row.id)}>
      Restore
    </button>
  ) : (
    <button className="btn btn-sm btn-outline-danger" onClick={() => {
      setCancellingLineId(row.id);
      setCancelQty(row.remainingQty || 0);
    }}>
      Cancel
    </button>
  )}
</td>

{/* Cancel Modal */}
{cancellingLineId === row.id && (
  <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
    <div className="modal-dialog">
      <div className="modal-content">
        <div className="modal-header">
          <h5>Cancel Line</h5>
          <button className="btn-close" onClick={() => setCancellingLineId(null)} />
        </div>
        <div className="modal-body">
          <div className="mb-3">
            <label className="form-label">Cancel Quantity</label>
            <input
              type="number"
              className="form-control"
              value={cancelQty}
              onChange={(e) => setCancelQty(Number(e.target.value))}
              max={row.remainingQty}
            />
          </div>
          <div className="mb-3">
            <label className="form-label">Reason (optional)</label>
            <textarea
              className="form-control"
              rows={3}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={() => setCancellingLineId(null)}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleCancelLine(row.id, cancelQty)}
          >
            Confirm Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
)}
```

### 5. Structured Warning Display

Replace raw validation dumps:
```tsx
{fulfillmentWarnings.length > 0 && (
  <div className="alert alert-warning radius-12">
    <div className="fw-semibold mb-2">⚠️ Fulfillment Warnings</div>
    {fulfillmentWarnings.map((w, i) => {
      const variant = requestedRows.find((r: any) => r.variantId === w.variantId);
      return (
        <div key={i} className="mb-1">
          <span className="badge bg-warning text-dark me-2">{w.code}</span>
          {variant && <strong>{variant.variant?.title ?? variant.variantId}:</strong>}
          {' '}{w.message}
        </div>
      );
    })}
  </div>
)}

{fulfillmentLineErrors.length > 0 && (
  <div className="alert alert-danger radius-12">
    <div className="fw-semibold mb-2">❌ Line Errors (Blocked)</div>
    {fulfillmentLineErrors.map((err, i) => {
      const variant = requestedRows.find((r: any) => r.variantId === err.variantId);
      return (
        <div key={i} className="mb-1">
          <span className="badge bg-danger me-2">{err.code}</span>
          {variant && <strong>{variant.variant?.title ?? variant.variantId}:</strong>}
          {' '}{err.message}
          {err.availableQty != null && (
            <span className="text-muted ms-2">
              (Available: {err.availableQty}, Requested: {err.fulfillQty})
            </span>
          )}
        </div>
      );
    })}
  </div>
)}

{/* Line-specific warnings from detail API */}
{request.lineWarnings && Object.keys(request.lineWarnings).length > 0 && (
  <div className="alert alert-info radius-12">
    <div className="fw-semibold mb-2">ℹ️ Stock Availability Notices</div>
    {Object.entries(request.lineWarnings).map(([itemId, warnings]: [string, any]) => {
      const item = requestedRows.find((r: any) => r.id === Number(itemId));
      return (
        <div key={itemId} className="mb-2">
          <strong>{item?.variant?.title ?? item?.variantId}:</strong>
          <ul className="mb-0 ps-3">
            {warnings.map((w: any, i: number) => (
              <li key={i} className={w.severity === 'RED' ? 'text-danger' : w.severity === 'AMBER' ? 'text-warning' : ''}>
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      );
    })}
  </div>
)}
```

## Testing Checklist

1. ✅ Backend APIs return correct data structure
2. ⏳ Summary cards display correct totals
3. ⏳ Line status chips show correct colors
4. ⏳ Expandable lot rows show all lot details
5. ⏳ Cancel line sets cancelledQty correctly
6. ⏳ Restore line clears cancellation
7. ⏳ Warnings display with semantic formatting
8. ⏳ Multi-wave dispatch works (FULFILLED_PARTIAL -> dispatch again)
9. ⏳ FEFO allocation excludes expired lots
10. ⏳ reservedQty subtracted from availability

## Next Steps

1. Complete frontend UI implementation per this guide
2. Test all user flows end-to-end
3. Run database migration to apply schema changes
4. Deploy and smoke test in staging environment

---

**Backend Status**: ✅ Complete and Ready
**Frontend Status**: 📋 Implementation Guide Provided
**Database**: ⚠️ Migration Pending (`npx prisma migrate dev`)
