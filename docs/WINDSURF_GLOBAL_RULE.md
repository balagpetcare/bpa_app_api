GLOBAL WORKSPACE RULE — BPA/WPA SYSTEM

This rule applies to all future tasks in this workspace unless explicitly overridden by the user.

1. PLAN-FIRST DEVELOPMENT POLICY
Before implementing any architecture change, workflow change, or multi-file modification:
- First analyze the problem.
- Check whether an existing plan already exists.
- If needed, propose or update a plan before implementation.
Implementation should follow the sequence:
ANALYZE → PLAN → IMPLEMENT.

2. DOCUMENTATION LOCATION POLICY
All planning, architecture, analysis, audit, design, QA, workflow, security, release, and documentation files must be stored ONLY inside the /docs directory.

Never place planning or documentation files in:
- the repository root
- source folders
- module directories

3. DOCUMENT REUSE POLICY
Before creating any new documentation file:
- Inspect the /docs folder.
- Search for an existing relevant document.
- If a related plan already exists, read it first.
- Summarize the current state and extend or update that document instead of creating duplicates.

Prefer updating existing documentation over creating new files.

4. DOCUMENT CREATION RULE
If a new document is necessary:
- Create it inside /docs only.
- Use clear enterprise-style filenames.

Example naming patterns:
CLINIC_APPOINTMENT_PRICING_PLAN.md
CLINIC_SURGERY_WORKFLOW.md
CLINIC_MEDICINE_CONTROL_QA.md
SECURITY_AUDIT_CHECKLIST.md
ARCHITECTURE_REVIEW.md

5. IMPLEMENTATION GOVERNANCE
Before modifying core modules:
- Inspect related documentation inside /docs.
- Check for architecture conflicts.
- Respect the existing system architecture.

Key architecture principles in this project:
- Modular design
- Loosely coupled services
- Branch-level isolation
- Organization-level isolation
- Role-based permissions (RBAC)

6. DUPLICATION AVOIDANCE
Do not create duplicate planning files for the same module.

Instead:
- Update existing documents
- Extend previous plans
- Maintain a single source of truth.

7. REPORTING RULE
Whenever documentation is created or updated:
- Clearly mention the exact file path inside /docs.

Example:
Updated: /docs/CLINIC_APPOINTMENT_PRICING_PLAN.md

8. SAFE CODE MODIFICATION
When editing code:
- Avoid breaking existing modules.
- Prefer minimal, targeted changes.
- Maintain compatibility with the existing architecture.

9. ENTERPRISE DEVELOPMENT STANDARD
Follow enterprise development practices:
- clear module boundaries
- service layer separation
- secure API handling
- validation and error handling
- maintainable code structure

10. TASK COMPLETION SUMMARY
At the end of a task:
- Summarize changes made
- Mention modified files
- Mention documentation updated in /docs
