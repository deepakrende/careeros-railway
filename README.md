# CareerOS – Phase 3: Job Applications & Resume Vault

This update extends the existing CareerOS React/Vite + Express + Railway PostgreSQL application. Existing authentication, task data, and task APIs are retained.

## Files changed
- `server.js`: additive PostgreSQL migrations and authenticated resume/application APIs.
- `src/main.jsx`: Job Applications and Resume Vault screens.
- `src/style.css`: responsive styling for the new screens.
- `.env.example`: documents the Railway Volume setting.

`package.json`, `vite.config.js`, `index.html`, and existing authentication settings do not need to change.

## Railway Volume setup
1. Attach a Railway Volume to the CareerOS application service.
2. Set the mount path to `/data`.
3. Add service variable `FILE_STORAGE_DIR=/data`.
4. Keep the existing `DATABASE_URL` and `JWT_SECRET` unchanged.

Resume PDFs are stored under `/data/resumes`. PostgreSQL stores their metadata and the relationship between each application and the exact resume version submitted. The server uses random stored filenames and authenticated download endpoints. Uploads accept PDF files up to 15 MB.

## Deployment
1. Back up the Railway PostgreSQL database.
2. Replace only the files listed above (keep existing `package.json`, `vite.config.js`, `index.html`, and all other project files).
3. Confirm the Railway Volume is attached at `/data` and `FILE_STORAGE_DIR=/data` is set.
4. Commit and push to GitHub; Railway should redeploy.
5. Check deployment logs, then sign in and test resume upload/download and application create/edit/delete.

All database changes use `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Do not reset or delete the existing database.
