# CareerOS — Data Analytics Career Task Manager

CareerOS is a full-stack career workspace for Data Analytics job preparation. It runs entirely on Railway: the React/Vite frontend and Express API are served by one Railway web service, and PostgreSQL is provided by a Railway database service. **There is no Supabase dependency.**

## Included features

- Overview dashboard with task completion, application pipeline, active projects and study activity
- Task creation, completion, priority, due dates, categories and estimated time
- Learning tracker for Python, SQL, Excel and Power BI; progress changes are saved to PostgreSQL
- Job application tracker with company, role, status, location, salary and job URL
- Portfolio project tracker
- Calendar, productivity insights, search and filters
- Responsive layout and light/dark theme
- Email/password registration and login; passwords are bcrypt-hashed
- JWT authentication and per-user data ownership
- Railway PostgreSQL persistence for tasks, applications, projects and learning topics

## Deploy on Railway

### 1. Create a GitHub repository

Upload the contents of this folder to the root of a GitHub repository. `package.json` and `server.js` must be at the repository root.

### 2. Create a Railway PostgreSQL database

1. In Railway, create a new project.
2. Choose **Add Service → Database → PostgreSQL**.
3. Wait until the database is ready.

### 3. Deploy the app service

1. In the same Railway project, choose **Add Service → GitHub Repo**.
2. Select your CareerOS repository.
3. In the app service settings, use the repository root as the root directory.
4. Set the build command to `npm run build`.
5. Set the start command to `npm start`.

The start command launches Express, which serves the built React frontend and the `/api` endpoints from the same domain.

### 4. Add Railway variables

In the **app service → Variables**, add:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=replace-this-with-a-long-random-secret
```

If your PostgreSQL service has a different name, replace `Postgres` in the variable reference with that service's exact name. Generate a unique, unpredictable JWT secret (at least 32 random characters). Do not commit `.env` or secrets to GitHub.

Railway provides `PORT` automatically. The app creates the required tables and indexes on startup, so you do not need to run a separate SQL file.

### 5. Generate a public domain

In the app service **Settings → Networking → Public Networking**, generate a domain. Open it and register an account. Your data is saved in Railway PostgreSQL and is isolated by account.

## Local development

Requirements: Node.js 18+ and a PostgreSQL database.

1. Install dependencies: `npm install`
2. Set `DATABASE_URL` and `JWT_SECRET` in your shell or `.env` file (use a dotenv runner if desired; the production server reads environment variables directly).
3. Start the API: `npm start`
4. In a second terminal, start Vite: `npm run dev`

Vite proxies `/api` requests to `http://localhost:3000` during development. Build the frontend with `npm run build`.

## Security and operations

- Passwords are stored as bcrypt hashes, never as plaintext.
- API requests require a signed JWT after login.
- Every data query is scoped to the authenticated user's ID.
- Keep `DATABASE_URL` and `JWT_SECRET` private. Never expose them as `VITE_` variables.
- Back up your Railway PostgreSQL database periodically.
- The initial sample tasks, applications, projects and learning topics are inserted once for each new account. They can be deleted or replaced in the app.

## Health check

`GET /api/health` returns a small health response. Railway's deployment logs show the Express startup message and any database initialization errors.
