# CareerOS — Phase 5: Live Job Discovery

This update builds on the Phase 4 CareerOS project. It adds a curated starter set of public company career feeds, entry-level job matching, duplicate detection, automatic saved listings, job alerts, and an explicit Apply & Track action.

## Files to replace

Replace only these existing files in the CareerOS repository:

- `server.js`
- `src/main.jsx`
- `src/style.css`

Keep `package.json`, lockfile, `vite.config.js`, `index.html`, existing Railway variables, PostgreSQL service, and Railway Volume unchanged. No new npm package or environment variable is required.

## Included starter company sources

The initial source registry includes these public Lever and Greenhouse boards:

- Paytm — Lever (`paytm`)
- Brillio — Lever (`brillio-2`)
- TTEC Digital — Lever (`ttecdigital`)
- Weekday — Lever (`weekdayworks`)
- 6sense — Greenhouse (`6sense`)
- Abnormal — Greenhouse (`abnormal`)
- Acceldata — Greenhouse (`acceldata`)

These are a starter list of India-relevant technology employers with public career-board identifiers. The list is not a promise that each employer currently has a fresher vacancy. Job descriptions and experience requirements are checked at ingestion time. If a board is unavailable or its slug has changed, its source status will show an error in CareerOS; the remaining sources continue independently.

The Greenhouse Job Board API documents public GET access to a company's published jobs. Lever's public Postings API documents retrieving published postings from a company site. CareerOS uses read-only job-listing endpoints and sends candidates to the employer's original application page; it does not submit applications on the user's behalf.

## Your configured preferences

- Roles: Data Analyst, Business Analyst, SQL Developer, Python Developer, Data Engineer, MIS Analyst, Power BI Developer
- Experience: Fresher / 0–1 year
- Locations: Hyderabad, Bengaluru, Pune, Remote
- Salary: Any salary (no salary filter)
- Sources: supported public company feeds in the starter list
- Polling: every 5 minutes, with a PostgreSQL advisory lock to prevent duplicate pollers when Railway runs multiple replicas

Matching is rule-based, not an AI guarantee. It checks role-title terms, selected locations, seniority terms, and explicit years-of-experience wording. Some job descriptions may not state experience clearly; review the employer posting before applying.

## Features

- Discover Jobs sidebar page with target-role and location preferences
- Public Greenhouse and Lever feed polling every five minutes
- Deduplication using normalized application URLs, with a company/title/location fallback
- Automatic saving of jobs matching the signed-in user's preferences
- New-job notifications inside Discover Jobs
- Search, saved-only filter, dismiss, and original employer posting links
- Apply & Track creates a `saved` entry in the existing Job Applications tracker; it does not apply automatically
- Per-source last checked time, listing count, and error status
- User-scoped preferences, saved jobs, and notifications

Naukri, Indeed, and LinkedIn are shown as not connected. CareerOS does not scrape those sites, automate sign-in, or bypass access controls. Add them only if you later obtain authorized feeds or partner/API access.

## Database migration and safety

The update adds tables for discovery preferences, source registry, discovered listings, saved jobs, and job alerts. It uses additive `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and indexes. It does not drop or reset existing users, passwords, tasks, applications, resumes, interviews, or offers.

Take a Railway PostgreSQL backup before deployment. Keep the existing `DATABASE_URL` and `JWT_SECRET` exactly as they are. Keep the Railway Volume mounted at `/data` and `FILE_STORAGE_DIR=/data` for Resume Vault storage.

## Deploy to Railway

1. Back up the existing Railway PostgreSQL database.
2. Extract this ZIP and copy the three files above into the existing repository, preserving the `src/` directory.
3. Do not replace `package.json`, change Railway variables, reset the database, or remove the Volume.
4. Commit and push to GitHub; allow Railway to deploy.
5. Open CareerOS and sign in with the existing account.
6. Select **Discover Jobs** in the sidebar. Your default role and location preferences are preselected.
7. Review the source status cards. Save preferences after changing any role or location selection.
8. Use **Apply & Track** only for a job you decide to pursue. It creates an entry in Job Applications, where you can attach the exact resume version.

Build command: `npm run build`

Start command: `npm start`

## Important operating notes

- Five minutes is the polling interval configured in CareerOS, not a guarantee that an employer updates its board or that a source will always respond. Greenhouse notes that public job-board requests may be rate-limited; failures are recorded per source and retried on the next cycle.
- The scheduler runs in the CareerOS server process. A PostgreSQL advisory lock ensures only one Railway replica polls at a time.
- The Discover Jobs page refreshes its displayed data every minute while open. The server poller continues every five minutes while the service is running.
- Job matching is heuristic. Check the employer's original listing for exact eligibility, location, compensation, and application deadlines.
- No salary range is required; roles with or without published compensation remain eligible.

## API references

- Greenhouse Job Board API: https://docs.greenhouse.io/job-board
- Lever Postings API documentation: https://hire.lever.co/developer/documentation
- Lever Postings API examples: https://github.com/Lever/postings-api
