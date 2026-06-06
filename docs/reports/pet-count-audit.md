# Pet Count Audit

**Generated:** 2026-06-06T22:23:55.570Z

## Summary

| Metric | Count |
|--------|-------|
| Total bookings | 4 |
| Bookings with `petCount = 0` | 0 |

## Policy

- New bookings reject `petCount < 1` at validation and service layers.
- Existing zero-count rows are **not deleted** automatically.

## Zero pet count rows

_None found._
