# CareerOS — Phase 1 & Phase 2

CareerOS is a personal productivity workspace built with React, Vite, Express, and Railway PostgreSQL.

## Included in this update

### Phase 1 — Foundation
- Existing email/password registration and login retained; JWT secret and password hashes are unchanged.
- Additive per-user preferences table for display name, target role, location, timezone, theme, week start day, and daily completion goal.
- Settings page to edit profile and planner preferences.
- Dark/light theme preference stored in PostgreSQL and synchronized across signed-in devices.
- Timezone validation using IANA timezone names.
- Task activity audit events for task creation, updates, status changes, and deletion.
- Optional Railway Volume mount initialization through `FILE_STORAGE_DIR`, prepared for resume/document uploads in a later phase.

### Phase 2 — Daily Productivity
- Daily task dashboard and completion progress.
- Overdue, upcoming, completed, inbox, and all-task views.
- To Do, In Progress, and Completed task statuses.
- Create, edit, reschedule, and delete tasks.
- Weekly planner with configurable Monday/Sunday week start.
- In-app reminder centre and notification history.
- Recurring tasks and next-occurrence generation.
- Completion history, streaks, and productivity reports.
- Timezone-aware day boundaries and reminder scheduling.
- Personal daily completion goal.
- Responsive layout and persisted dark/light appearance.

## Architecture

- Frontend: React 18 + Vite
- Backend: Node.js + Express
- Database: Railway PostgreSQL
- Authentication: existing bcrypt password hashes + JWT bearer tokens
- Persistent file storage: Railway Volume mounted at `/data` (reserved for resume/document uploads in Phase 3)

The app is served by one Railway service. Express serves the built `dist` directory and the `/api` routes.

## Railway environment variables

Required on the app service:

- `DATABASE_URL`: Railway PostgreSQL connection string or Railway reference such as `${{Postgres.DATABASE_URL}}` (use your actual database service name).
- `JWT_SECRET`: existing private JWT signing secret. Keep the existing value; do not rotate it during this deployment.

Optional:

- `PGSSL=true` only if your PostgreSQL connection requires it.
- `FILE_STORAGE_DIR=/data` after attaching a Railway Volume mounted at `/data`.

## Railway Volume setup

1. Open the CareerOS app service in Railway.
2. Add a Volume to that service.
3. Set its mount path to `/data`.
4. Add the service variable `FILE_STORAGE_DIR=/data`.
5. Redeploy the service.
6. Check `/api/health`; `fileStorageConfigured` should be `true`.

This phase only prepares and verifies the persistent mount directory. Resume and document upload endpoints are deliberately part of the later Resume Vault phase; no files are written in this phase.

## Build and deploy

- Build command: `npm run build`
- Start command: `npm start`
- The Express server listens on Railway's `PORT`.

Deploy by replacing only the files listed in the update package, committing, and pushing to the connected GitHub repository. Railway should then build and deploy automatically.

## Data preservation

The server performs additive, idempotent startup migrations using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. This update does not drop, truncate, or recreate users, tasks, notifications, job applications, projects, or learning records. Existing authentication routes, password hashes, JWT format, and tokens are retained.

A PostgreSQL backup before deploying schema changes is still recommended. Never delete the existing Railway PostgreSQL service or volume as part of this update.

## Local development

```bash
npm install
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET in .env
npm run dev
```

In a second terminal, run `npm start` for the API. Vite proxies `/api` to `http://localhost:3000` during local development.
