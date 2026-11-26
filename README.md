# CareerOS — Daily Task Manager

A daily task manager built with React, Vite, Express, and Railway PostgreSQL.

## Features

- Email/password registration and login (existing JWT authentication retained).
- Daily task list with Today, All tasks, Upcoming, Completed, and Inbox views.
- Create, edit, complete, and delete tasks.
- Task category, priority, due date, start/end time, estimated duration, and notes.
- In-app reminders shown in the notification centre while the user has CareerOS open.
- Recurring tasks: every day, weekdays, weekly, or selected weekdays; optional repeat-until date.
- When a recurring task is completed, the next occurrence is automatically created.
- Search and category/priority filters.
- Responsive layout and light/dark appearance switch.
- All task data and notifications are stored in Railway PostgreSQL.

## Railway deployment

The application serves the built frontend and API from one Railway service.

### Required variables on the app service

- `DATABASE_URL`: Railway PostgreSQL connection string or Railway reference such as `${{Postgres.DATABASE_URL}}` (replace `Postgres` with the exact database service name).
- `JWT_SECRET`: a private random secret with at least 32 characters.

Optional:
- `PGSSL=true` only if your database connection requires SSL settings beyond Railway's normal connection URL.

### Build and start

- Build command: `npm run build`
- Start command: `npm start`

The Express server listens on Railway's `PORT` and serves the built `dist` directory.

## Database migration and data preservation

On startup, the server runs idempotent `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements. The migration adds scheduling, reminder, recurrence, and notification fields/tables to the existing schema. It does not drop, truncate, or recreate existing user accounts or task records. Existing JWT authentication and password hashes are retained.

New task fields:
- `start_time`, `end_time`, `notes`
- `reminder_time`, `reminder_notified_at`
- `recurrence_rule`, `recurrence_days`, `recurrence_end`, `recurrence_parent_id`, `next_occurrence_created`

A new `task_notifications` table stores in-app reminder notifications. Existing job application, project, and learning tables are left intact for backward compatibility, but the interface is now focused on daily task management.

## Reminder behaviour

In-app reminders are checked by the browser every 30 seconds while the user is signed in and the app is open. They are saved to PostgreSQL and shown in the notification bell. Since the selected reminder type is in-app only, reminders are not delivered when the browser/app is closed, and there are no email, SMS, or push notifications.

## Local development

```bash
npm install
cp .env.example .env
# Set DATABASE_URL and JWT_SECRET in .env
npm run dev
```

In a second terminal run `npm start` (or `npm run server`) for the API. Vite proxies `/api` to `http://localhost:3000` during development.
