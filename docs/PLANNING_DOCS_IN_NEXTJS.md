# Planning Docs in Next.js Admin

**Purpose:** The full planning documentation is connected to the Next.js admin panel so admins can browse and read it from the web app. ডকুমেন্টগুলো মূল ফোল্ডার থেকে আলাদা রাখার জন্য `docs` ফোল্ডার ব্যবহার করা হয়।

## Backend (API)

- **GET /api/v1/docs/list** – Returns list of doc slugs and titles.
- **GET /api/v1/docs/:slug** – Returns raw markdown content for a doc (slug = filename without `.md`).
- **ডক ফোল্ডার:** API সব প্ল্যানিং ডক `backend-api/docs/` থেকে পড়ে (মূল ফাইলগুলোর সাথে মিশে না যায়)।

Slug is sanitized (alphanumeric, underscore, hyphen, dot only) to prevent path traversal.

## Next.js (bpa_web)

- **Admin → Planning & Docs** – New sidebar section "Planning & Docs" with link to `/admin/docs`.
- **/admin/docs** – Lists all planning docs (from API). Each row has a "View" link.
- **/admin/docs/[slug]** – Viewer page that fetches doc content from API and displays it (plain text / pre for now).

## Apply steps

1. **Backend:** সব প্ল্যানিং ডক `backend-api/docs/` ফোল্ডারে রাখুন; API এখান থেকে পড়ে।
2. **bpa_web:** Ensure `NEXT_PUBLIC_API_BASE_URL` points to the API (e.g. `http://localhost:3000`). No new dependency.
3. Log in as admin, open sidebar → **Planning & Docs** → **Planning & Docs**, then open any document.

## Adding new docs

1. Add the `.md` file under `backend-api/docs/`.
2. (Optional) Add a display title in `docs.controller.ts` → `DOC_TITLES` so the list shows a friendly name.
