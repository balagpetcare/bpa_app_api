# BPA Permissions Standard

Permission keys use:
- `domain.action` or `domain.resource.action`

Examples:
- `orders.read`, `orders.write`
- `inventory.read`, `inventory.adjust`
- `clinic.appointments.read`, `clinic.patients.read`
- `staff.read`, `staff.write`

## MVP role mapping (server-side)
- OWNER / ORG_ADMIN: org + branch + staff + wallet + reports
- BRANCH_MANAGER: orders + inventory + staff (branch)
- BRANCH_STAFF / SELLER: orders + inventory read
