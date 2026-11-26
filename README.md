# CareerOS Phase 4 — Interview Management

This update builds on the Phase 3 CareerOS project. It adds interview scheduling, interview preparation records, interview feedback, an interview question log, automatic planner task linkage, and offer tracking.

## Files to replace

- `server.js`
- `src/main.jsx`
- `src/style.css`

No dependency changes are required. Keep the existing `package.json`, `vite.config.js`, `index.html`, Railway variables, PostgreSQL service, and Railway Volume.

## Features

### Interview management
- Link each interview to an existing job application.
- Record round type, date, time, duration, meeting URL, interviewer, status, preparation notes, questions, feedback and result/next steps.
- Edit, reschedule, complete, cancel, and delete interviews.
- Interview records display the company, role and resume version linked to the job application.
- Creating an interview automatically creates a matching task in the existing CareerOS planner, including the selected reminder time.
- Editing an interview updates its linked planner task; deleting the interview removes that linked task.

### Offer tracker
- Record one offer per job application.
- Store compensation, currency, joining date, response deadline, offer status and notes.
- Update offer details later.

## Database migration

The server adds `interviews` and `job_offers` tables and indexes using `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. Existing user, task, application and resume rows are not dropped or reset.

Take a Railway PostgreSQL backup before deploying, as with any production schema change.

## Deploy to Railway

1. Back up the existing Railway PostgreSQL database.
2. Extract this ZIP and copy the three files above into the existing project, preserving `src/` paths.
3. Do not overwrite `package.json` or change `DATABASE_URL` / `JWT_SECRET`.
4. Keep the existing Railway Volume mounted at `/data` and `FILE_STORAGE_DIR=/data` for the Phase 3 Resume Vault.
5. Commit and push to GitHub; allow Railway to deploy.
6. Check the deployment logs and open CareerOS.

Build command: `npm run build`

Start command: `npm start`

## Post-deploy checks

- Sign in with the existing account.
- Open Interviews from the sidebar.
- Schedule an interview linked to a job application.
- Confirm the interview appears in Interviews and as a task in Today / Weekly Planner.
- Edit the interview date/time and confirm the planner task updates.
- Mark the interview completed and add questions/feedback.
- Record an offer for an application and refresh to confirm persistence.

## Notes

- Interview reminders use the existing in-app task reminder system. The user must be signed in with CareerOS open for in-app reminders to be checked.
- Meeting links are ordinary external links; CareerOS does not host video calls.
- Offer records are linked to applications and are user-scoped through the existing authentication middleware.
