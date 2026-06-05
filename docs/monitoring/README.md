# BPA Monitoring & Operations

**Status:** Planning only — see approval gate in strategy doc.

## Primary document

[**Enterprise Monitoring & Failover Strategy**](../architecture/enterprise-monitoring-failover-strategy.md)

Covers:

- Uptime checks (synthetic HTTPS probes)
- Health endpoints (as-built + proposed)
- Alert severity, escalation, and kill switches
- Backup strategy (PostgreSQL, Redis, object storage)
- Failover per component (landing, vaccination, API, database)
- Recovery procedures
- Deployment rollback procedures

## Related runbooks

| Document | Use when |
|----------|----------|
| [`DISASTER-RECOVERY-PLAYBOOK.md`](../../DISASTER-RECOVERY-PLAYBOOK.md) | Data loss, restore drills, incident workflow |
| [`docs/vaccination-campaign-2026/05-ROLLBACK-PLAN.md`](../vaccination-campaign-2026/05-ROLLBACK-PLAN.md) | Deploy rollback triggers by layer |
| [`docs/nginx-production-deployment.md`](../nginx-production-deployment.md) | Edge / TLS / upstream issues |

## Quick reference — proposed public health URLs

| Service | Liveness | Readiness (proposed) |
|---------|----------|----------------------|
| API | `GET /health` ✅ | `GET /health/ready` 📋 |
| Landing | — | `GET /health` 📋 |
| Vaccination | — | `GET /health` 📋 |

📋 = planned, not implemented until approved.
