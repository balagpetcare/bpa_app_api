# Owner Delegation & Team Management — Data Layer

## Overview

Step 2 of the Owner Delegation & Team Management System. Extends the database with new tables for teams, members, scopes, delegations, and audit logs.

## New Tables

| Table | Purpose |
|-------|---------|
| `owner_teams` | Teams created by an owner |
| `owner_team_members` | Users who are members of a team |
| `owner_permission_scopes` | Reference: products, clinics, inventory, staff, branches, finance_read |
| `owner_delegations` | Scope assignments from owner to delegated user (optionally per org/branch) |
| `owner_overview_logs` | Audit log for delegation actions |

## Migration

**Apply:**
```bash
npx prisma migrate dev --name add_owner_delegation_tables
```

**Or deploy (production):**
```bash
npx prisma migrate deploy
```

## Scope Keys (owner_permission_scopes)

| key | label | isReadOnly |
|-----|-------|------------|
| products | Products | false |
| clinics | Clinics | false |
| inventory | Inventory | false |
| staff | Staff | false |
| branches | Branches | false |
| finance_read | Finance (Read Only) | true |

## Relations

- **OwnerTeam** → User (ownerUserId)
- **OwnerTeamMember** → OwnerTeam, User
- **OwnerDelegation** → User (owner, delegate), Organization?, Branch?, OwnerTeam?
- **OwnerOverviewLog** → User (owner, actor)

## Backward Compatibility

- No existing tables modified
- No existing APIs or logic changed
- All new models are additive
