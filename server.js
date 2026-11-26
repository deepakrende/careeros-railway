
import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('Missing JWT_SECRET. Add a strong secret in Railway service variables.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL. Add your Railway PostgreSQL connection variable.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true'
    ? { rejectUnauthorized: false }
    : undefined
});

app.use(express.json({ limit: '1mb' }));

// Additive database changes preserve existing users and task records.
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  priority TEXT,
  due_date DATE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  minutes INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_time TIME;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_notified_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NOT NULL DEFAULT 'none';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_days JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_end DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_parent_id TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_occurrence_created BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS task_notifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  UNIQUE(task_id)
);

CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(user_id,due_date,completed);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS learning_user_idx ON learning_topics(user_id);
CREATE INDEX IF NOT EXISTS task_notifications_user_idx ON task_notifications(user_id,created_at DESC);
`;

let dbReady;

async function ensureDb() {
  if (!dbReady) {
    dbReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          category TEXT,
          priority TEXT,
          due_date DATE,
          completed BOOLEAN NOT NULL DEFAULT FALSE,
          minutes INTEGER DEFAULT 30,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS job_applications (
          id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          company TEXT NOT NULL,
          role TEXT NOT NULL,
          status TEXT,
          applied_on DATE,
          location TEXT,
          salary TEXT,
          url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          stack TEXT,
          status TEXT,
          due_date DATE,
          description TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS learning_topics (
          id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          topic TEXT NOT NULL,
          items JSONB NOT NULL DEFAULT '[]'::jsonb,
          progress INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(schema);
    })();
  }

  return dbReady;
}

app.use(async (_req, _res, next) => {
  try {
    await ensureDb();
    next();
  } catch (e) {
    console.error('Database initialization failed:', e);
    next(e);
  }
});

// Authentication middleware
function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({
      error: 'Please sign in to continue.'
    });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      error: 'Your session expired. Please sign in again.'
    });
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    database: Boolean(process.env.DATABASE_URL)
  });
});

// Register
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({
        error: 'Enter a valid email address.'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters.'
      });
    }

    const id = randomUUID();
    const hash = await bcrypt.hash(password, 12);

    const { rows } = await pool.query(
      'INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email',
      [id, email, hash]
    );

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '14d' }
    );

    res.status(201).json({ user, token });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        error: 'An account with this email already exists.'
      });
    }
    next(e);
  }
});

// Login
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const { rows } = await pool.query(
      'SELECT id,email,password_hash FROM users WHERE email=$1',
      [email]
    );

    if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({
        error: 'Incorrect email or password.'
      });
    }

    const user = {
      id: rows[0].id,
      email: rows[0].email
    };

    const token = jwt.sign(user, JWT_SECRET, {
      expiresIn: '14d'
    });

    res.json({ user, token });
  } catch (e) {
    next(e);
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email
    }
  });
});

// Load tasks
app.get('/api/bootstrap', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM tasks
       WHERE user_id=$1
       ORDER BY due_date NULLS LAST,
       start_time NULLS LAST,
       created_at DESC`,
      [req.user.id]
    );

    res.json({ tasks: rows });
  } catch (e) {
    next(e);
  }
});

const taskFields = [
  'title',
  'category',
  'priority',
  'due_date',
  'completed',
  'minutes',
  'start_time',
  'end_time',
  'notes',
  'reminder_time',
  'recurrence_rule',
  'recurrence_days',
  'recurrence_end',
  'recurrence_parent_id'
];

const legacyTables = {
  job_applications: {
    fields: ['company', 'role', 'status', 'applied_on', 'location', 'salary', 'url'],
    required: ['company', 'role']
  },
  projects: {
    fields: ['name', 'stack', 'status', 'due_date', 'description'],
    required: ['name']
  },
  learning_topics: {
    fields: ['topic', 'items', 'progress'],
    required: ['topic']
  }
};

const dateFields = new Set([
  'due_date',
  'applied_on',
  'recurrence_end'
]);

const timeFields = new Set([
  'start_time',
  'end_time',
  'reminder_time'
]);

function cleanValue(key, value) {
  if ((dateFields.has(key) || timeFields.has(key)) && value === '') {
    return null;
  }

  if (
    (key === 'items' || key === 'recurrence_days') &&
    Array.isArray(value)
  ) {
    return JSON.stringify(value);
  }

  return value;
}

// Normalize dates safely before sending them to PostgreSQL.
function normalizeDateValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  let iso = null;

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      iso = value.toISOString().slice(0, 10);
    }
  } else {
    const raw = String(value).trim();
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);

    if (match) {
      iso = match[1];
    }
  }

  if (!iso) return null;

  const [year, month, day] = iso.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return iso;
}

// Calculate the next recurring task date safely.
function nextDateFor(task) {
  const due = normalizeDateValue(task.due_date);

  if (!due) return null;

  const today = new Date().toISOString().slice(0, 10);
  const baseIso = due > today ? due : today;

  const base = new Date(`${baseIso}T12:00:00.000Z`);

  if (Number.isNaN(base.getTime())) return null;

  const rule = task.recurrence_rule || 'none';

  if (rule === 'none') return null;

  const days = Array.isArray(task.recurrence_days)
    ? task.recurrence_days.map(Number)
    : [];

  const baseDay = base.getUTCDay();
  const next = new Date(base);

  for (let i = 0; i < 370; i++) {
    next.setUTCDate(next.getUTCDate() + 1);

    const dow = next.getUTCDay();

    const matches =
      rule === 'daily' ||
      (rule === 'weekdays' && dow >= 1 && dow <= 5) ||
      (rule === 'weekly' && dow === baseDay) ||
      (rule === 'custom' && days.includes(dow));

    if (matches) {
      const iso = next.toISOString().slice(0, 10);
      const recurrenceEnd = normalizeDateValue(task.recurrence_end);

      if (recurrenceEnd && iso > recurrenceEnd) {
        return null;
      }

      return iso;
    }
  }

  return null;
}

// Create task
app.post('/api/tasks', auth, async (req, res, next) => {
  try {
    const data = { ...req.body };

    for (const k of Object.keys(data)) {
      if (!taskFields.includes(k)) delete data[k];
    }

    if (!data.title?.trim()) {
      return res.status(400).json({
        error: 'Task title is required.'
      });
    }

    for (const key of ['due_date', 'recurrence_end']) {
      if (key in data && data[key] !== null && data[key] !== '') {
        const normalized = normalizeDateValue(data[key]);

        if (!normalized) {
          return res.status(400).json({
            error: `${key === 'due_date' ? 'Due date' : 'Recurrence end date'} must be a valid date (YYYY-MM-DD).`
          });
        }

        data[key] = normalized;
      }
    }

    const id = String(data.id || randomUUID());
    delete data.id;

    if (
      data.recurrence_rule &&
      data.recurrence_rule !== 'none' &&
      !data.due_date
    ) {
      return res.status(400).json({
        error: 'Choose a due date for a recurring task.'
      });
    }

    const keys = Object.keys(data);
    const cols = ['id', 'user_id', ...keys];
    const vals = [
      id,
      req.user.id,
      ...keys.map(k => cleanValue(k, data[k]))
    ];

    const placeholders = vals.map((_, i) => `$${i + 1}`);

    const { rows } = await pool.query(
      `INSERT INTO tasks(${cols.join(',')})
       VALUES(${placeholders.join(',')})
       RETURNING *`,
      vals
    );

    res.status(201).json({ item: rows[0] });
  } catch (e) {
    next(e);
  }
});

// Update task and generate next recurring occurrence.
app.patch('/api/tasks/:id', auth, async (req, res, next) => {
  try {
    const data = { ...req.body };

    for (const k of Object.keys(data)) {
      if (
        !taskFields.includes(k) &&
        k !== 'reminder_notified_at' &&
        k !== 'next_occurrence_created'
      ) {
        delete data[k];
      }
    }

    for (const key of ['due_date', 'recurrence_end']) {
      if (key in data && data[key] !== null && data[key] !== '') {
        const normalized = normalizeDateValue(data[key]);

        if (!normalized) {
          return res.status(400).json({
            error: `${key === 'due_date' ? 'Due date' : 'Recurrence end date'} must be a valid date (YYYY-MM-DD).`
          });
        }

        data[key] = normalized;
      }
    }

    const keys = Object.keys(data);

    if (!keys.length) {
      return res.status(400).json({
        error: 'No valid fields supplied.'
      });
    }

    const vals = keys.map(k => cleanValue(k, data[k]));
    const sets = keys.map((k, i) => `${k}=$${i + 1}`);

    vals.push(req.params.id, req.user.id);

    const { rows } = await pool.query(
      `UPDATE tasks
       SET ${sets.join(',')}
       WHERE id=$${keys.length + 1}
       AND user_id=$${keys.length + 2}
       RETURNING *`,
      vals
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Task not found.'
      });
    }

    let nextOccurrence = null;
    const task = rows[0];

    if (
      data.completed === true &&
      task.recurrence_rule !== 'none' &&
      !task.next_occurrence_created
    ) {
      const nextDate = nextDateFor(task);

      await pool.query(
        'UPDATE tasks SET next_occurrence_created=TRUE WHERE id=$1 AND user_id=$2',
        [task.id, req.user.id]
      );

      if (nextDate) {
        const newId = randomUUID();

        const { rows: created } = await pool.query(
          `INSERT INTO tasks(
            id,user_id,title,category,priority,due_date,
            completed,minutes,start_time,end_time,notes,
            reminder_time,recurrence_rule,recurrence_days,
            recurrence_end,recurrence_parent_id
          )
          VALUES(
            $1,$2,$3,$4,$5,$6,FALSE,$7,$8,$9,$10,
            $11,$12,$13,$14,$15
          )
          RETURNING *`,
          [
            newId,
            req.user.id,
            task.title,
            task.category,
            task.priority,
            nextDate,
            task.minutes,
            task.start_time,
            task.end_time,
            task.notes,
            task.reminder_time,
            task.recurrence_rule,
            JSON.stringify(task.recurrence_days || []),
            task.recurrence_end,
            task.recurrence_parent_id || task.id
          ]
        );

        nextOccurrence = created[0];
      }
    }

    res.json({
      item: task,
      nextOccurrence
    });
  } catch (e) {
    next(e);
  }
});

// Delete task
app.delete('/api/tasks/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM tasks WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: 'Task not found.'
      });
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Create an in-app notification for a task.
app.post('/api/tasks/:id/remind', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,title,due_date,reminder_time
       FROM tasks
       WHERE id=$1 AND user_id=$2 AND completed=FALSE`,
      [req.params.id, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Task not found.'
      });
    }

    const task = rows[0];

    const result = await pool.query(
      `INSERT INTO task_notifications(
        id,user_id,task_id,title,due_date
      )
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(task_id) DO NOTHING
      RETURNING *`,
      [
        randomUUID(),
        req.user.id,
        task.id,
        task.title,
        task.due_date
      ]
    );

    if (result.rowCount) {
      await pool.query(
        'UPDATE tasks SET reminder_notified_at=NOW() WHERE id=$1 AND user_id=$2',
        [task.id, req.user.id]
      );
    }

    res.json({
      created: result.rowCount > 0,
      notification: result.rows[0] || null
    });
  } catch (e) {
    next(e);
  }
});

// Load notifications
app.get('/api/notifications', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM task_notifications
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({ notifications: rows });
  } catch (e) {
    next(e);
  }
});

// Mark notification as read
app.patch('/api/notifications/:id/read', auth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE task_notifications
       SET read_at=NOW()
       WHERE id=$1 AND user_id=$2
       RETURNING *`,
      [req.params.id, req.user.id]
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: 'Notification not found.'
      });
    }

    res.json({ notification: rows[0] });
  } catch (e) {
    next(e);
  }
});

// Backward-compatible endpoints for existing projects, jobs and learning data.
for (const [table, config] of Object.entries(legacyTables)) {
  app.post(`/api/${table}`, auth, async (req, res, next) => {
    try {
      const data = { ...req.body };

      for (const k of Object.keys(data)) {
        if (!config.fields.includes(k)) delete data[k];
      }

      for (const k of config.required) {
        if (!data[k]) {
          return res.status(400).json({
            error: `${k} is required.`
          });
        }
      }

      const id = String(data.id || randomUUID());
      delete data.id;

      const keys = Object.keys(data);
      const cols = ['id', 'user_id', ...keys];

      const vals = [
        id,
        req.user.id,
        ...keys.map(k => cleanValue(k, data[k]))
      ];

      const params = vals.map((_, i) => `$${i + 1}`);

      const { rows } = await pool.query(
        `INSERT INTO ${table}(${cols.join(',')})
         VALUES(${params.join(',')})
         RETURNING *`,
        vals
      );

      res.status(201).json({ item: rows[0] });
    } catch (e) {
      next(e);
    }
  });

  app.patch(`/api/${table}/:id`, auth, async (req, res, next) => {
    try {
      const data = { ...req.body };

      for (const k of Object.keys(data)) {
        if (!config.fields.includes(k)) delete data[k];
      }

      const keys = Object.keys(data);

      if (!keys.length) {
        return res.status(400).json({
          error: 'No valid fields supplied.'
        });
      }

      const vals = keys.map(k => cleanValue(k, data[k]));
      const sets = keys.map((k, i) => `${k}=$${i + 1}`);

      vals.push(req.params.id, req.user.id);

      const { rows } = await pool.query(
        `UPDATE ${table}
         SET ${sets.join(',')}
         WHERE id=$${keys.length + 1}
         AND user_id=$${keys.length + 2}
         RETURNING *`,
        vals
      );

      if (!rows[0]) {
        return res.status(404).json({
          error: 'Record not found.'
        });
      }

      res.json({ item: rows[0] });
    } catch (e) {
      next(e);
    }
  });

  app.delete(`/api/${table}/:id`, auth, async (req, res, next) => {
    try {
      const result = await pool.query(
        `DELETE FROM ${table}
         WHERE id=$1 AND user_id=$2`,
        [req.params.id, req.user.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Record not found.'
        });
      }

      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
}

// API error handler
app.use('/api', (err, req, res, _next) => {
  console.error(err);

  res.status(500).json({
    error: 'Server error. Check the Railway logs and database connection.'
  });
});

// Serve frontend
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CareerOS daily task manager listening on ${PORT}`);
});
