import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 3000;
const FILE_STORAGE_DIR = process.env.FILE_STORAGE_DIR || '/data';
const RESUME_DIR = path.join(FILE_STORAGE_DIR, 'resumes');
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('Missing JWT_SECRET. Add a strong secret in Railway service variables.'); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error('Missing DATABASE_URL. Add your Railway PostgreSQL connection variable.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
app.use(express.json({ limit: '1mb' }));

// All changes are additive so existing users, credentials, and task records remain intact.
const schema = `
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, priority TEXT, due_date DATE, completed BOOLEAN NOT NULL DEFAULT FALSE, minutes INTEGER DEFAULT 30, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'todo';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
UPDATE tasks SET status = CASE WHEN completed THEN 'completed' ELSE 'todo' END WHERE status IS NULL OR (completed = TRUE AND status = 'todo');
UPDATE tasks SET completed = (status = 'completed') WHERE completed IS DISTINCT FROM (status = 'completed');
CREATE TABLE IF NOT EXISTS resumes (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 original_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'application/pdf',
 size_bytes BIGINT NOT NULL, target_role TEXT, version_label TEXT NOT NULL, notes TEXT,
 archived BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS job_id TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS job_type TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS experience_level TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS job_description TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS recruiter_name TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS recruiter_email TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS resume_id UUID REFERENCES resumes(id) ON DELETE SET NULL;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS job_applications_user_applied_idx ON job_applications(user_id, applied_on DESC);
CREATE INDEX IF NOT EXISTS job_applications_user_status_idx ON job_applications(user_id, status);
CREATE TABLE IF NOT EXISTS interviews (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
 round_type TEXT NOT NULL DEFAULT 'Technical', interview_date DATE NOT NULL, interview_time TIME,
 duration_minutes INTEGER NOT NULL DEFAULT 60, meeting_link TEXT, interviewer_name TEXT,
 status TEXT NOT NULL DEFAULT 'scheduled', preparation_notes TEXT, questions TEXT, feedback TEXT,
 result TEXT, reminder_time TIME, linked_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interviews_user_date_idx ON interviews(user_id, interview_date, interview_time);
CREATE INDEX IF NOT EXISTS interviews_application_idx ON interviews(user_id, application_id);
CREATE TABLE IF NOT EXISTS job_offers (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 application_id TEXT NOT NULL UNIQUE REFERENCES job_applications(id) ON DELETE CASCADE,
 salary TEXT, currency TEXT NOT NULL DEFAULT 'INR', joining_date DATE, response_deadline DATE,
 status TEXT NOT NULL DEFAULT 'received', offer_notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS job_offers_user_idx ON job_offers(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS job_discovery_preferences (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 roles JSONB NOT NULL DEFAULT '["Data Analyst","Business Analyst","SQL Developer","Python Developer","Data Engineer","MIS Analyst","Power BI Developer"]'::jsonb,
 locations JSONB NOT NULL DEFAULT '["Hyderabad","Bengaluru","Pune","Remote"]'::jsonb,
 experience_level TEXT NOT NULL DEFAULT 'Fresher / 0–1 year',
 frequency_minutes INTEGER NOT NULL DEFAULT 5,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS job_sources (
 id TEXT PRIMARY KEY, company_name TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('greenhouse','lever')),
 board_slug TEXT NOT NULL, career_url TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE,
 last_checked_at TIMESTAMPTZ, last_error TEXT, jobs_found INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(provider,board_slug)
);
CREATE TABLE IF NOT EXISTS discovered_jobs (
 id UUID PRIMARY KEY, source_id TEXT NOT NULL REFERENCES job_sources(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL, location TEXT,
 description TEXT, apply_url TEXT NOT NULL, canonical_url TEXT, workplace_type TEXT, is_open BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMPTZ,
 first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(source_id,external_id)
);
ALTER TABLE discovered_jobs ADD COLUMN IF NOT EXISTS canonical_url TEXT;
ALTER TABLE discovered_jobs ADD COLUMN IF NOT EXISTS is_open BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS discovered_jobs_canonical_url_idx ON discovered_jobs(canonical_url);
CREATE INDEX IF NOT EXISTS discovered_jobs_seen_idx ON discovered_jobs(last_seen_at DESC);
CREATE TABLE IF NOT EXISTS user_saved_jobs (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 job_id UUID NOT NULL REFERENCES discovered_jobs(id) ON DELETE CASCADE,
 saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), auto_saved BOOLEAN NOT NULL DEFAULT FALSE,
 dismissed_at TIMESTAMPTZ, tracked_application_id TEXT REFERENCES job_applications(id) ON DELETE SET NULL,
 PRIMARY KEY(user_id,job_id)
);
CREATE INDEX IF NOT EXISTS user_saved_jobs_user_idx ON user_saved_jobs(user_id,saved_at DESC);
CREATE TABLE IF NOT EXISTS job_discovery_notifications (
 id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 job_id UUID NOT NULL REFERENCES discovered_jobs(id) ON DELETE CASCADE,
 title TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ,
 UNIQUE(user_id,job_id)
);
CREATE INDEX IF NOT EXISTS job_discovery_notifications_user_idx ON job_discovery_notifications(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS task_notifications (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, due_date DATE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ, UNIQUE(task_id));
CREATE TABLE IF NOT EXISTS task_completion_events (id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, activity_date DATE NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(user_id, task_id, activity_date));
CREATE INDEX IF NOT EXISTS task_completion_user_date_idx ON task_completion_events(user_id, activity_date DESC);
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id);
CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(user_id,due_date,completed);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(user_id,status,due_date);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS learning_user_idx ON learning_topics(user_id);
CREATE INDEX IF NOT EXISTS task_notifications_user_idx ON task_notifications(user_id,created_at DESC);
`;
let dbReady;
async function ensureDb() {
 if (!dbReady) dbReady = (async()=>{
  // Preserve the older CareerOS tables for backward compatibility with existing data.
  await pool.query(`
   CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, priority TEXT, due_date DATE, completed BOOLEAN NOT NULL DEFAULT FALSE, minutes INTEGER DEFAULT 30, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   CREATE TABLE IF NOT EXISTS job_applications (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT, applied_on DATE, location TEXT, salary TEXT, url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, stack TEXT, status TEXT, due_date DATE, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
   CREATE TABLE IF NOT EXISTS learning_topics (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic TEXT NOT NULL, items JSONB NOT NULL DEFAULT '[]'::jsonb, progress INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  `);
  await pool.query(schema);
  await fs.mkdir(RESUME_DIR, { recursive: true });
 })();
 return dbReady;
}
app.use(async (_req, _res, next) => { try { await ensureDb(); next(); } catch (e) { console.error('Database initialization failed:', e); next(e); } });
function auth(req, res, next) {
 const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
 if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
 try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
app.get('/api/health', (_req,res)=>res.json({ok:true, database:Boolean(process.env.DATABASE_URL), fileStorageConfigured:Boolean(process.env.FILE_STORAGE_DIR)}));
app.post('/api/auth/register', async (req,res,next)=>{
 try { const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
  if (password.length<8) return res.status(400).json({error:'Password must be at least 8 characters.'});
  const id=randomUUID(), hash=await bcrypt.hash(password,12);
  const {rows}=await pool.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email',[id,email,hash]);
  const user=rows[0], token=jwt.sign({id:user.id,email:user.email},JWT_SECRET,{expiresIn:'14d'});
  res.status(201).json({user,token});
 } catch(e) { if(e.code==='23505') return res.status(409).json({error:'An account with this email already exists.'}); next(e); }
});
app.post('/api/auth/login', async(req,res,next)=>{
 try { const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  const {rows}=await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1',[email]);
  if(!rows[0] || !(await bcrypt.compare(password,rows[0].password_hash))) return res.status(401).json({error:'Incorrect email or password.'});
  const user={id:rows[0].id,email:rows[0].email}, token=jwt.sign(user,JWT_SECRET,{expiresIn:'14d'}); res.json({user,token});
 } catch(e){next(e)}
});
app.get('/api/me',auth,(req,res)=>res.json({user:{id:req.user.id,email:req.user.email}}));

// Job-search workspace: resume PDFs live on the Railway Volume, metadata stays in PostgreSQL.
app.get('/api/resumes', auth, async (req,res,next)=>{
 try { const {rows}=await pool.query('SELECT id,original_name,size_bytes,target_role,version_label,notes,archived,created_at FROM resumes WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]); res.json({resumes:rows}); }
 catch(e){next(e)}
});
app.post('/api/resumes/upload', auth, express.raw({type:'application/pdf',limit:'15mb'}), async (req,res,next)=>{
 let storedName;
 try {
  const decodeHeader=v=>{try{return decodeURIComponent(String(v||''))}catch{return String(v||'')}};
  const originalName=decodeHeader(req.headers['x-file-name']||'resume.pdf').replace(/[\\/\\0-\\r\\n]/g,'_').slice(0,180);
  const versionLabel=decodeHeader(req.headers['x-version-label']||'Resume').trim().slice(0,80)||'Resume';
  const targetRole=decodeHeader(req.headers['x-target-role']||'').trim().slice(0,120)||null;
  const notes=decodeHeader(req.headers['x-notes']||'').trim().slice(0,2000)||null;
  if(!Buffer.isBuffer(req.body)||req.body.length<8||req.body.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'Upload a valid PDF resume.'});
  storedName=`${randomUUID()}.pdf`;
  await fs.mkdir(RESUME_DIR,{recursive:true});
  await fs.writeFile(path.join(RESUME_DIR,storedName),req.body,{flag:'wx'});
  const {rows}=await pool.query(`INSERT INTO resumes(id,user_id,original_name,stored_name,mime_type,size_bytes,target_role,version_label,notes) VALUES($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8) RETURNING id,original_name,size_bytes,target_role,version_label,notes,archived,created_at`,[randomUUID(),req.user.id,originalName,storedName,req.body.length,targetRole,versionLabel,notes]);
  res.status(201).json({resume:rows[0]});
 } catch(e){ if(storedName)await fs.unlink(path.join(RESUME_DIR,storedName)).catch(()=>{}); if(e.status===413)return res.status(413).json({error:'PDF must be 15 MB or smaller.'}); next(e); }
});
app.get('/api/resumes/:id/download', auth, async(req,res,next)=>{
 try { const {rows}=await pool.query('SELECT original_name,stored_name FROM resumes WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]); if(!rows[0])return res.status(404).json({error:'Resume not found.'});
  const filePath=path.join(RESUME_DIR,rows[0].stored_name); await fs.access(filePath);
  res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${rows[0].original_name.replace(/["\\r\\n]/g,'_')}"`);res.sendFile(filePath);
 }catch(e){if(e.code==='ENOENT')return res.status(404).json({error:'Resume file is missing from storage.'});next(e)}
});
app.patch('/api/resumes/:id', auth, async(req,res,next)=>{
 try {const allowed=['version_label','target_role','notes','archived'];const data={};for(const k of allowed)if(k in req.body)data[k]=req.body[k];if(!Object.keys(data).length)return res.status(400).json({error:'No valid resume fields supplied.'});
  const keys=Object.keys(data),vals=keys.map(k=>data[k]),sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);
  const {rows}=await pool.query(`UPDATE resumes SET ${sets.join(',')} WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING id,original_name,size_bytes,target_role,version_label,notes,archived,created_at`,vals);if(!rows[0])return res.status(404).json({error:'Resume not found.'});res.json({resume:rows[0]});
 }catch(e){next(e)}
});
app.delete('/api/resumes/:id', auth, async(req,res,next)=>{
 try {const {rows}=await pool.query('DELETE FROM resumes WHERE id=$1 AND user_id=$2 RETURNING stored_name',[req.params.id,req.user.id]);if(!rows[0])return res.status(404).json({error:'Resume not found.'});await fs.unlink(path.join(RESUME_DIR,rows[0].stored_name)).catch(()=>{});res.json({ok:true});}
 catch(e){next(e)}
});
app.get('/api/job-applications', auth, async(req,res,next)=>{
 try {const {rows}=await pool.query(`SELECT j.*,r.version_label AS resume_version,r.original_name AS resume_filename FROM job_applications j LEFT JOIN resumes r ON r.id=j.resume_id AND r.user_id=j.user_id WHERE j.user_id=$1 ORDER BY j.applied_on DESC NULLS LAST,j.created_at DESC`,[req.user.id]);res.json({applications:rows});}
 catch(e){next(e)}
});
const applicationFields=['company','role','status','applied_on','location','salary','url','job_id','job_type','experience_level','source','job_description','recruiter_name','recruiter_email','notes','resume_id'];
const applicationStatuses=['saved','applied','assessment','interview_scheduled','interview_completed','hr_discussion','offer','rejected','withdrawn'];
app.post('/api/job-applications', auth, async(req,res,next)=>{
 try {const data={};for(const k of applicationFields)if(k in req.body)data[k]=req.body[k];
  data.company=String(data.company||'').trim();data.role=String(data.role||'').trim();if(!data.company||!data.role)return res.status(400).json({error:'Company and job role are required.'});
  data.status=data.status||'saved';if(!applicationStatuses.includes(data.status))return res.status(400).json({error:'Choose a valid application status.'});
  if(data.resume_id){const r=await pool.query('SELECT id FROM resumes WHERE id=$1 AND user_id=$2',[data.resume_id,req.user.id]);if(!r.rowCount)return res.status(400).json({error:'Selected resume does not belong to your account.'});}
  const id=randomUUID(),keys=Object.keys(data),cols=['id','user_id',...keys],vals=[id,req.user.id,...keys.map(k=>cleanValue(k,data[k]))],ph=vals.map((_,i)=>`$${i+1}`);
  const {rows}=await pool.query(`INSERT INTO job_applications(${cols.join(',')}) VALUES(${ph.join(',')}) RETURNING *`,vals);res.status(201).json({application:rows[0]});
 }catch(e){next(e)}
});
app.patch('/api/job-applications/:id', auth, async(req,res,next)=>{
 try {const data={};for(const k of applicationFields)if(k in req.body)data[k]=req.body[k];if(!Object.keys(data).length)return res.status(400).json({error:'No valid application fields supplied.'});
  if(data.status&&!applicationStatuses.includes(data.status))return res.status(400).json({error:'Choose a valid application status.'});
  if(data.resume_id){const r=await pool.query('SELECT id FROM resumes WHERE id=$1 AND user_id=$2',[data.resume_id,req.user.id]);if(!r.rowCount)return res.status(400).json({error:'Selected resume does not belong to your account.'});}
  const keys=Object.keys(data),vals=keys.map(k=>cleanValue(k,data[k])),sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);
  const {rows}=await pool.query(`UPDATE job_applications SET ${sets.join(',')},updated_at=NOW() WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING *`,vals);if(!rows[0])return res.status(404).json({error:'Application not found.'});res.json({application:rows[0]});
 }catch(e){next(e)}
});
app.delete('/api/job-applications/:id', auth, async(req,res,next)=>{
 try {const r=await pool.query('DELETE FROM job_applications WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Application not found.'});res.json({ok:true});}
 catch(e){next(e)}
});

// Phase 4: interview rounds, preparation records and job offers.
app.get('/api/interviews',auth,async(req,res,next)=>{
 try {const {rows}=await pool.query(`SELECT i.*,j.company,j.role,j.resume_id,r.version_label AS resume_version,r.original_name AS resume_filename FROM interviews i JOIN job_applications j ON j.id=i.application_id AND j.user_id=i.user_id LEFT JOIN resumes r ON r.id=j.resume_id AND r.user_id=j.user_id WHERE i.user_id=$1 ORDER BY i.interview_date ASC,i.interview_time ASC NULLS LAST`,[req.user.id]);res.json({interviews:rows});}catch(e){next(e)}
});
const interviewFields=['application_id','round_type','interview_date','interview_time','duration_minutes','meeting_link','interviewer_name','status','preparation_notes','questions','feedback','result','reminder_time'];
const interviewStatuses=['scheduled','completed','cancelled','rescheduled','awaiting_feedback'];
app.post('/api/interviews',auth,async(req,res,next)=>{
 const client=await pool.connect();
 try {const data={};for(const k of interviewFields)if(k in req.body)data[k]=req.body[k];
  if(!data.application_id||!data.interview_date||!data.round_type)return res.status(400).json({error:'Choose a job application, interview date and round type.'});
  const appRow=await client.query('SELECT company,role FROM job_applications WHERE id=$1 AND user_id=$2',[data.application_id,req.user.id]);if(!appRow.rowCount)return res.status(400).json({error:'Selected job application was not found.'});
  data.status=data.status||'scheduled';if(!interviewStatuses.includes(data.status))return res.status(400).json({error:'Choose a valid interview status.'});
  await client.query('BEGIN');const id=randomUUID(),taskId=randomUUID();
  const taskTitle=`Interview: ${appRow.rows[0].company} — ${appRow.rows[0].role} (${data.round_type})`;
  await client.query(`INSERT INTO tasks(id,user_id,title,category,priority,due_date,start_time,minutes,reminder_time,notes,status,completed) VALUES($1,$2,$3,'Interview prep','High',$4,$5,$6,$7,$8,'todo',FALSE)`,[taskId,req.user.id,taskTitle,data.interview_date,data.interview_time||null,Number(data.duration_minutes)||60,data.reminder_time||null,data.preparation_notes||'']);
  const keys=Object.keys(data),cols=['id','user_id','linked_task_id',...keys],vals=[id,req.user.id,taskId,...keys.map(k=>cleanValue(k,data[k]))],ph=vals.map((_,i)=>`$${i+1}`);
  const {rows}=await client.query(`INSERT INTO interviews(${cols.join(',')}) VALUES(${ph.join(',')}) RETURNING *`,vals);await client.query('COMMIT');res.status(201).json({interview:rows[0]});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});
app.patch('/api/interviews/:id',auth,async(req,res,next)=>{
 const client=await pool.connect();try{const data={};for(const k of interviewFields)if(k in req.body)data[k]=req.body[k];if(data.status&&!interviewStatuses.includes(data.status))return res.status(400).json({error:'Choose a valid interview status.'});
  await client.query('BEGIN');const existing=await client.query('SELECT * FROM interviews WHERE id=$1 AND user_id=$2 FOR UPDATE',[req.params.id,req.user.id]);if(!existing.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Interview not found.'})}
  if(data.application_id){const valid=await client.query('SELECT id FROM job_applications WHERE id=$1 AND user_id=$2',[data.application_id,req.user.id]);if(!valid.rowCount){await client.query('ROLLBACK');return res.status(400).json({error:'Selected application was not found.'})}}
  const keys=Object.keys(data);let rows=[existing.rows[0]];if(keys.length){const vals=keys.map(k=>cleanValue(k,data[k])),sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);({rows}=await client.query(`UPDATE interviews SET ${sets.join(',')},updated_at=NOW() WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING *`,vals));}
  const iv=rows[0];if(iv.linked_task_id){const appRow=await client.query('SELECT company,role FROM job_applications WHERE id=$1 AND user_id=$2',[iv.application_id,req.user.id]);const title=`Interview: ${appRow.rows[0]?.company||'Company'} — ${appRow.rows[0]?.role||'Role'} (${iv.round_type})`;await client.query(`UPDATE tasks SET title=$1,due_date=$2,start_time=$3,minutes=$4,reminder_time=$5,notes=$6,status=$7,completed=$8 WHERE id=$9 AND user_id=$10`,[title,iv.interview_date,iv.interview_time,iv.duration_minutes,iv.reminder_time,iv.preparation_notes,iv.status==='completed'?'completed':'todo',iv.status==='completed',iv.linked_task_id,req.user.id]);}
  await client.query('COMMIT');res.json({interview:iv});
 }catch(e){await client.query('ROLLBACK').catch(()=>{});next(e)}finally{client.release()}
});
app.delete('/api/interviews/:id',auth,async(req,res,next)=>{try{const {rows}=await pool.query('DELETE FROM interviews WHERE id=$1 AND user_id=$2 RETURNING linked_task_id',[req.params.id,req.user.id]);if(!rows[0])return res.status(404).json({error:'Interview not found.'});if(rows[0].linked_task_id)await pool.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2',[rows[0].linked_task_id,req.user.id]);res.json({ok:true});}catch(e){next(e)}});
app.get('/api/offers',auth,async(req,res,next)=>{try{const {rows}=await pool.query(`SELECT o.*,j.company,j.role FROM job_offers o JOIN job_applications j ON j.id=o.application_id AND j.user_id=o.user_id WHERE o.user_id=$1 ORDER BY o.created_at DESC`,[req.user.id]);res.json({offers:rows});}catch(e){next(e)}});
const offerFields=['application_id','salary','currency','joining_date','response_deadline','status','offer_notes'];
app.post('/api/offers',auth,async(req,res,next)=>{try{const data={};for(const k of offerFields)if(k in req.body)data[k]=req.body[k];if(!data.application_id)return res.status(400).json({error:'Select a job application.'});const valid=await pool.query('SELECT id FROM job_applications WHERE id=$1 AND user_id=$2',[data.application_id,req.user.id]);if(!valid.rowCount)return res.status(400).json({error:'Selected application was not found.'});const id=randomUUID(),keys=Object.keys(data),cols=['id','user_id',...keys],vals=[id,req.user.id,...keys.map(k=>cleanValue(k,data[k]))],ph=vals.map((_,i)=>`$${i+1}`);const {rows}=await pool.query(`INSERT INTO job_offers(${cols.join(',')}) VALUES(${ph.join(',')}) ON CONFLICT(application_id) DO UPDATE SET salary=EXCLUDED.salary,currency=EXCLUDED.currency,joining_date=EXCLUDED.joining_date,response_deadline=EXCLUDED.response_deadline,status=EXCLUDED.status,offer_notes=EXCLUDED.offer_notes,updated_at=NOW() RETURNING *`,vals);res.status(201).json({offer:rows[0]});}catch(e){next(e)}});
app.patch('/api/offers/:id',auth,async(req,res,next)=>{try{const data={};for(const k of offerFields)if(k in req.body)data[k]=req.body[k];const keys=Object.keys(data);if(!keys.length)return res.status(400).json({error:'No offer fields supplied.'});const vals=keys.map(k=>cleanValue(k,data[k])),sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);const {rows}=await pool.query(`UPDATE job_offers SET ${sets.join(',')},updated_at=NOW() WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING *`,vals);if(!rows[0])return res.status(404).json({error:'Offer not found.'});res.json({offer:rows[0]});}catch(e){next(e)}});


const starterJobSources = [
 {id:'lever-paytm',company_name:'Paytm',provider:'lever',board_slug:'paytm',career_url:'https://jobs.lever.co/paytm'},
 {id:'lever-brillio',company_name:'Brillio',provider:'lever',board_slug:'brillio-2',career_url:'https://jobs.lever.co/brillio-2'},
 {id:'lever-ttec',company_name:'TTEC Digital',provider:'lever',board_slug:'ttecdigital',career_url:'https://jobs.lever.co/ttecdigital'},
 {id:'lever-weekday',company_name:'Weekday',provider:'lever',board_slug:'weekdayworks',career_url:'https://jobs.lever.co/weekdayworks'},
 {id:'greenhouse-6sense',company_name:'6sense',provider:'greenhouse',board_slug:'6sense',career_url:'https://boards.greenhouse.io/6sense'},
 {id:'greenhouse-abnormal',company_name:'Abnormal',provider:'greenhouse',board_slug:'abnormal',career_url:'https://boards.greenhouse.io/abnormal'},
 {id:'greenhouse-acceldata',company_name:'Acceldata',provider:'greenhouse',board_slug:'acceldata',career_url:'https://boards.greenhouse.io/acceldata'}
];
async function ensureJobSources(){
 for(const s of starterJobSources) await pool.query(`INSERT INTO job_sources(id,company_name,provider,board_slug,career_url) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,board_slug) DO NOTHING`,[s.id,s.company_name,s.provider,s.board_slug,s.career_url]);
}
const defaultDiscoveryPrefs={roles:['Data Analyst','Business Analyst','SQL Developer','Python Developer','Data Engineer','MIS Analyst','Power BI Developer'],locations:['Hyderabad','Bengaluru','Pune','Remote'],experience_level:'Fresher / 0–1 year',frequency_minutes:5};
function jobMatches(job,prefs){
 const title=String(job.title||'').toLowerCase(), body=String(job.description||'').toLowerCase(), loc=String(job.location||'').toLowerCase();
 const roleTerms={
  'Data Analyst':['data analyst','analytics analyst','business intelligence analyst','reporting analyst'],
  'Business Analyst':['business analyst','business systems analyst'],
  'SQL Developer':['sql developer','database developer','sql analyst'],
  'Python Developer':['python developer','python engineer'],
  'Data Engineer':['data engineer','analytics engineer'],
  'MIS Analyst':['mis analyst','mis executive','reporting executive'],
  'Power BI Developer':['power bi','bi developer','business intelligence developer']
 };
 const roleHit=(prefs.roles||defaultDiscoveryPrefs.roles).some(role=>(roleTerms[role]||[role.toLowerCase()]).some(term=>title.includes(term)));
 if(!roleHit)return false;
 const locations=prefs.locations||defaultDiscoveryPrefs.locations;
 if(locations.length&&!locations.some(x=>{const v=x.toLowerCase();return v==='remote'?(loc.includes('remote')||String(job.workplace_type||'').toLowerCase().includes('remote')):loc.includes(v)||((v==='bengaluru')&&loc.includes('bangalore'))}))return false;
 const combined=`${title} ${body}`;
 if(/\b(senior|sr\.?|lead|principal|staff|manager|director|architect|head of)\b/i.test(title))return false;
 const explicitYears=[...combined.matchAll(/(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:relevant\s+)?experience/gi)].map(m=>Number(m[1]));
 if(explicitYears.some(n=>n>1))return false;
 if(/\b(2\s*[-–]\s*\d+|minimum\s+2|at least 2)\s*(?:years?|yrs?)\b/i.test(body))return false;
 return true;
}
function canonicalJobUrl(value,job){try{const u=new URL(value);u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k)||['source','ref','referrer','gh_src'].includes(k.toLowerCase()))u.searchParams.delete(k);u.hostname=u.hostname.toLowerCase();u.pathname=u.pathname.replace(/\/$/,'');return u.toString().toLowerCase()}catch{return `fingerprint:${[job.company,job.title,job.location].map(x=>String(x||'').trim().toLowerCase()).join('|')}`}}
function normalizeJob(source,item){
 const loc=source.provider==='greenhouse'?(item.location?.name||''):(item.categories?.location||'');
 const desc=source.provider==='greenhouse'?(item.content||''):(item.descriptionPlain||item.description||'');
 const url=source.provider==='greenhouse'?(item.absolute_url||''):(item.hostedUrl||item.applyUrl||'');
 return {external_id:String(item.id||''),title:String(item.title||'').trim(),company:source.company_name,location:String(loc||'Not specified'),description:String(desc||'').replace(/<[^>]*>/g,' ').slice(0,30000),apply_url:url,workplace_type:item.workplaceType||''};
}
let jobPollInFlight=false;
async function pollJobSources(){
 if(jobPollInFlight)return;jobPollInFlight=true;let pollLockClient=null;
 try{
  await ensureDb();pollLockClient=await pool.connect();const lock=await pollLockClient.query("SELECT pg_try_advisory_lock(hashtext('careeros_job_discovery_poller')) AS locked");if(!lock.rows[0].locked){pollLockClient.release();pollLockClient=null;return;}await ensureJobSources();
  const {rows:sources}=await pool.query('SELECT * FROM job_sources WHERE active=TRUE ORDER BY company_name');
  for(const source of sources){
   try{
    const endpoint=source.provider==='greenhouse'?`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board_slug)}/jobs?content=true`:`https://api.lever.co/v0/postings/${encodeURIComponent(source.board_slug)}?mode=json`;
    const response=await fetch(endpoint,{headers:{'Accept':'application/json','User-Agent':'CareerOS Job Discovery/1.0'},signal:AbortSignal.timeout(18000)});
    if(!response.ok)throw new Error(`Source returned HTTP ${response.status}`);
    const payload=await response.json();if(source.provider==='greenhouse'&&!Array.isArray(payload.jobs))throw new Error('Unexpected Greenhouse response format');if(source.provider==='lever'&&!Array.isArray(payload))throw new Error('Unexpected Lever response format');const items=source.provider==='greenhouse'?payload.jobs:payload;let found=0;await pool.query('UPDATE discovered_jobs SET is_open=FALSE WHERE source_id=$1',[source.id]);
    for(const item of items){const job=normalizeJob(source,item);if(!job.external_id||!job.title||!job.apply_url)continue;found++;
     const canonical=canonicalJobUrl(job.apply_url,job);const {rows}=await pool.query(`INSERT INTO discovered_jobs(id,source_id,external_id,title,company,location,description,apply_url,canonical_url,workplace_type,is_open,updated_at,last_seen_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,NOW()) ON CONFLICT(canonical_url) DO UPDATE SET title=EXCLUDED.title,location=EXCLUDED.location,description=EXCLUDED.description,apply_url=EXCLUDED.apply_url,workplace_type=EXCLUDED.workplace_type,is_open=TRUE,updated_at=EXCLUDED.updated_at,last_seen_at=NOW() RETURNING id`,[randomUUID(),source.id,job.external_id,job.title,job.company,job.location,job.description,job.apply_url,canonical,job.workplace_type,item.updatedAt||item.updated_at||null]);
     const savedJobId=rows[0]?.id;if(!savedJobId)continue;
     const {rows:users}=await pool.query('SELECT user_id,roles,locations,experience_level,frequency_minutes FROM job_discovery_preferences');
     for(const pref of users){if(!jobMatches(job,pref))continue;
      const prior=await pool.query('SELECT saved_at FROM user_saved_jobs WHERE user_id=$1 AND job_id=$2',[pref.user_id,savedJobId]);
      await pool.query(`INSERT INTO user_saved_jobs(user_id,job_id,auto_saved) VALUES($1,$2,TRUE) ON CONFLICT(user_id,job_id) DO NOTHING`,[pref.user_id,savedJobId]);
      if(!prior.rowCount)await pool.query('INSERT INTO job_discovery_notifications(id,user_id,job_id,title) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,job_id) DO NOTHING',[randomUUID(),pref.user_id,savedJobId,`${job.title} at ${job.company}`]);
     }
    }
    await pool.query('UPDATE job_sources SET last_checked_at=NOW(),last_error=NULL,jobs_found=$2 WHERE id=$1',[source.id,found]);
   }catch(error){await pool.query('UPDATE job_sources SET last_checked_at=NOW(),last_error=$2 WHERE id=$1',[source.id,String(error.message||error).slice(0,500)]);console.error(`Job source ${source.id}:`,error.message)}
  }
 }catch(error){console.error('Job discovery polling failed:',error)}finally{if(pollLockClient){try{await pollLockClient.query("SELECT pg_advisory_unlock(hashtext('careeros_job_discovery_poller'))")}catch{}pollLockClient.release()}jobPollInFlight=false}
}
app.get('/api/discover-jobs',auth,async(req,res,next)=>{
 try{await pool.query(`INSERT INTO job_discovery_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING`,[req.user.id]);void pollJobSources();const savedOnly=req.query.saved==='true';const {rows}=await pool.query(`SELECT j.*,s.provider,s.career_url,us.saved_at,us.auto_saved,us.dismissed_at,us.tracked_application_id,
 EXISTS(SELECT 1 FROM job_applications a WHERE a.user_id=$1 AND a.job_id=j.source_id||':'||j.external_id) AS tracked
 FROM discovered_jobs j JOIN job_sources s ON s.id=j.source_id LEFT JOIN user_saved_jobs us ON us.job_id=j.id AND us.user_id=$1
 WHERE j.is_open=TRUE AND j.last_seen_at>NOW()-INTERVAL '45 days' AND us.user_id=$1 AND ($2::boolean=FALSE OR us.saved_at IS NOT NULL) AND (us.dismissed_at IS NULL)
 ORDER BY j.first_seen_at DESC LIMIT 250`,[req.user.id,savedOnly]);
 const sources=await pool.query('SELECT id,company_name,provider,career_url,last_checked_at,last_error,jobs_found FROM job_sources ORDER BY company_name');
 const prefs=await pool.query('SELECT roles,locations,experience_level,frequency_minutes FROM job_discovery_preferences WHERE user_id=$1',[req.user.id]);
 const notifications=await pool.query('SELECT COUNT(*)::int AS unread FROM job_discovery_notifications WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);
 res.json({jobs:rows,sources:sources.rows,preferences:prefs.rows[0]||defaultDiscoveryPrefs,unread:notifications.rows[0].unread});
 }catch(e){next(e)}
});
app.put('/api/discover-jobs/preferences',auth,async(req,res,next)=>{
 try{const roles=Array.isArray(req.body.roles)?req.body.roles.filter(x=>defaultDiscoveryPrefs.roles.includes(x)):defaultDiscoveryPrefs.roles;const locations=Array.isArray(req.body.locations)?req.body.locations.filter(x=>defaultDiscoveryPrefs.locations.includes(x)):defaultDiscoveryPrefs.locations;const {rows}=await pool.query(`INSERT INTO job_discovery_preferences(user_id,roles,locations,experience_level,frequency_minutes) VALUES($1,$2,$3,'Fresher / 0–1 year',5) ON CONFLICT(user_id) DO UPDATE SET roles=EXCLUDED.roles,locations=EXCLUDED.locations,updated_at=NOW() RETURNING roles,locations,experience_level,frequency_minutes`,[req.user.id,JSON.stringify(roles),JSON.stringify(locations)]);res.json({preferences:rows[0]});void pollJobSources();}catch(e){next(e)}
});
app.post('/api/discover-jobs/:id/save',auth,async(req,res,next)=>{try{const exists=await pool.query('SELECT id FROM discovered_jobs WHERE id=$1',[req.params.id]);if(!exists.rowCount)return res.status(404).json({error:'Job listing not found.'});await pool.query('INSERT INTO user_saved_jobs(user_id,job_id,auto_saved) VALUES($1,$2,FALSE) ON CONFLICT(user_id,job_id) DO UPDATE SET dismissed_at=NULL',[req.user.id,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
app.post('/api/discover-jobs/:id/dismiss',auth,async(req,res,next)=>{try{await pool.query('INSERT INTO user_saved_jobs(user_id,job_id,dismissed_at) VALUES($1,$2,NOW()) ON CONFLICT(user_id,job_id) DO UPDATE SET dismissed_at=NOW()',[req.user.id,req.params.id]);res.json({ok:true})}catch(e){next(e)}});
app.post('/api/discover-jobs/:id/track',auth,async(req,res,next)=>{
 try{const {rows}=await pool.query('SELECT j.*,s.provider FROM discovered_jobs j JOIN job_sources s ON s.id=j.source_id WHERE j.id=$1',[req.params.id]);if(!rows[0])return res.status(404).json({error:'Job listing not found.'});const j=rows[0],jobId=`${j.source_id}:${j.external_id}`;let application=await pool.query('SELECT * FROM job_applications WHERE user_id=$1 AND job_id=$2',[req.user.id,jobId]);const alreadyTracked=Boolean(application.rowCount);
  if(!application.rowCount){const id=randomUUID();application=await pool.query(`INSERT INTO job_applications(id,user_id,company,role,status,location,url,job_id,source,experience_level,job_description) VALUES($1,$2,$3,$4,'saved',$5,$6,$7,$8,'Fresher / 0–1 year',$9) RETURNING *`,[id,req.user.id,j.company,j.title,j.location,j.apply_url,jobId,j.provider,j.description]);}
  await pool.query('INSERT INTO user_saved_jobs(user_id,job_id,tracked_application_id) VALUES($1,$2,$3) ON CONFLICT(user_id,job_id) DO UPDATE SET tracked_application_id=EXCLUDED.tracked_application_id',[req.user.id,j.id,application.rows[0].id]);res.status(201).json({application:application.rows[0],alreadyTracked});
 }catch(e){next(e)}
});
app.get('/api/discover-jobs/notifications',auth,async(req,res,next)=>{try{const {rows}=await pool.query('SELECT * FROM job_discovery_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id]);res.json({notifications:rows})}catch(e){next(e)}});
app.patch('/api/discover-jobs/notifications/:id/read',auth,async(req,res,next)=>{try{const {rows}=await pool.query('UPDATE job_discovery_notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *',[req.params.id,req.user.id]);if(!rows[0])return res.status(404).json({error:'Notification not found.'});res.json({notification:rows[0]})}catch(e){next(e)}});

app.get('/api/bootstrap',auth,async(req,res,next)=>{
 try { const {rows}=await pool.query('SELECT * FROM tasks WHERE user_id=$1 ORDER BY due_date NULLS LAST, start_time NULLS LAST, created_at DESC',[req.user.id]); res.json({tasks:rows}); }
 catch(e){next(e)}
});
const taskFields=['title','category','priority','due_date','completed','status','minutes','start_time','end_time','notes','reminder_time','recurrence_rule','recurrence_days','recurrence_end','recurrence_parent_id'];
const legacyTables={job_applications:{fields:['company','role','status','applied_on','location','salary','url'],required:['company','role']},projects:{fields:['name','stack','status','due_date','description'],required:['name']},learning_topics:{fields:['topic','items','progress'],required:['topic']}};
const dateFields=new Set(['due_date','applied_on','recurrence_end']);
const timeFields=new Set(['start_time','end_time','reminder_time']);
function cleanValue(key,value){ if((dateFields.has(key)||timeFields.has(key))&&value==='') return null; if((key==='items'||key==='recurrence_days')&&Array.isArray(value)) return JSON.stringify(value); return value; }

function normalizeDateValue(value) {
 if (value === null || value === undefined || value === '') return null;
 let iso = null;
 if (value instanceof Date) {
  if (!Number.isNaN(value.getTime())) iso = value.toISOString().slice(0, 10);
 } else {
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (match) iso = match[1];
 }
 if (!iso) return null;
 const [year, month, day] = iso.split('-').map(Number);
 const check = new Date(Date.UTC(year, month - 1, day));
 if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
 return iso;
}
function nextDateFor(task) {
 const due = normalizeDateValue(task.due_date);
 if (!due) return null;
 const today = new Date().toISOString().slice(0, 10);
 const baseIso = due > today ? due : today;
 const base = new Date(`${baseIso}T12:00:00.000Z`);
 if (Number.isNaN(base.getTime())) return null;
 const rule = task.recurrence_rule || 'none';
 if (rule === 'none') return null;
 const days = Array.isArray(task.recurrence_days) ? task.recurrence_days.map(Number) : [];
 const baseDay = base.getUTCDay();
 const next = new Date(base);
 for (let i = 0; i < 370; i++) {
  next.setUTCDate(next.getUTCDate() + 1);
  const dow = next.getUTCDay();
  const matches = rule === 'daily'
   || (rule === 'weekdays' && dow >= 1 && dow <= 5)
   || (rule === 'weekly' && dow === baseDay)
   || (rule === 'custom' && days.includes(dow));
  if (matches) {
   const iso = next.toISOString().slice(0, 10);
   const recurrenceEnd = normalizeDateValue(task.recurrence_end);
   if (recurrenceEnd && iso > recurrenceEnd) return null;
   return iso;
  }
 }
 return null;
}
app.post('/api/tasks',auth,async(req,res,next)=>{
 try {
  const data={...req.body};
  for(const k of Object.keys(data))if(!taskFields.includes(k))delete data[k];
  if(!String(data.title||'').trim())return res.status(400).json({error:'Task title is required.'});
  for (const key of ['due_date','recurrence_end']) {
   if (key in data && data[key] !== null && data[key] !== '') {
    const normalized=normalizeDateValue(data[key]);
    if(!normalized)return res.status(400).json({error:`${key==='due_date'?'Due date':'Recurrence end date'} must be a valid date (YYYY-MM-DD).`});
    data[key]=normalized;
   }
  }
  const status=data.status|| (data.completed===true?'completed':'todo');
  if(!['todo','in_progress','completed'].includes(status))return res.status(400).json({error:'Choose a valid task status.'});
  data.status=status;data.completed=status==='completed';
  if(data.recurrence_rule && data.recurrence_rule!=='none'&&!data.due_date)return res.status(400).json({error:'Choose a due date for a recurring task.'});
  const id=String(data.id||randomUUID());delete data.id;
  const completedAt=data.completed?new Date().toISOString():null;
  const keys=Object.keys(data);const cols=['id','user_id',...keys,'completed_at'];
  const vals=[id,req.user.id,...keys.map(k=>cleanValue(k,data[k])),completedAt];
  const placeholders=vals.map((_,i)=>`$${i+1}`);
  const {rows}=await pool.query(`INSERT INTO tasks(${cols.join(',')}) VALUES(${placeholders.join(',')}) RETURNING *`,vals);
  if(data.completed){const activityDate=normalizeDateValue(req.body.activity_date)||new Date().toISOString().slice(0,10);await pool.query('INSERT INTO task_completion_events(id,user_id,task_id,activity_date) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),req.user.id,id,activityDate]);}
  res.status(201).json({item:rows[0]});
 }catch(e){next(e)}
});
app.patch('/api/tasks/:id',auth,async(req,res,next)=>{
 try {
  const existingResult=await pool.query('SELECT * FROM tasks WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
  const existing=existingResult.rows[0];if(!existing)return res.status(404).json({error:'Task not found.'});
  const data={...req.body};const activityDate=normalizeDateValue(data.activity_date);delete data.activity_date;
  for(const k of Object.keys(data))if(!taskFields.includes(k))delete data[k];
  for (const key of ['due_date','recurrence_end']) {
   if (key in data && data[key] !== null && data[key] !== '') {
    const normalized=normalizeDateValue(data[key]);
    if(!normalized)return res.status(400).json({error:`${key==='due_date'?'Due date':'Recurrence end date'} must be a valid date (YYYY-MM-DD).`});
    data[key]=normalized;
   }
  }
  const requestedStatus=data.status || (Object.prototype.hasOwnProperty.call(data,'completed')?(data.completed?'completed':'todo'):(existing.status||(existing.completed?'completed':'todo')));
  if(!['todo','in_progress','completed'].includes(requestedStatus))return res.status(400).json({error:'Choose a valid task status.'});
  data.status=requestedStatus;data.completed=requestedStatus==='completed';
  const newlyCompleted=data.completed&&!existing.completed;
  data.completed_at=data.completed?(existing.completed_at||new Date().toISOString()):null;
  const reminderChanged=('due_date' in data && String(data.due_date||'')!==String(existing.due_date||'').slice(0,10))||('reminder_time' in data && String(data.reminder_time||'')!==String(existing.reminder_time||''));
  const keys=Object.keys(data);if(!keys.length)return res.status(400).json({error:'No valid fields supplied.'});
  const vals=keys.map(k=>cleanValue(k,data[k]));const sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);
  const {rows}=await pool.query(`UPDATE tasks SET ${sets.join(',')} WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING *`,vals);
  const task=rows[0];
  if(reminderChanged){await pool.query('UPDATE tasks SET reminder_notified_at=NULL WHERE id=$1 AND user_id=$2',[task.id,req.user.id]);await pool.query('DELETE FROM task_notifications WHERE task_id=$1 AND user_id=$2',[task.id,req.user.id]);task.reminder_notified_at=null;}
  if(newlyCompleted){const day=activityDate||new Date().toISOString().slice(0,10);await pool.query('INSERT INTO task_completion_events(id,user_id,task_id,activity_date) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[randomUUID(),req.user.id,task.id,day]);}
  let nextOccurrence=null;
  if(newlyCompleted && task.recurrence_rule!=='none' && !task.next_occurrence_created){
   const nextDate=nextDateFor(task);
   await pool.query('UPDATE tasks SET next_occurrence_created=TRUE WHERE id=$1 AND user_id=$2',[task.id,req.user.id]);
   if(nextDate){const newId=randomUUID();const {rows:created}=await pool.query(`INSERT INTO tasks(id,user_id,title,category,priority,due_date,completed,minutes,start_time,end_time,notes,reminder_time,recurrence_rule,recurrence_days,recurrence_end,recurrence_parent_id,status) VALUES($1,$2,$3,$4,$5,$6,FALSE,$7,$8,$9,$10,$11,$12,$13,$14,$15,'todo') RETURNING *`,[newId,req.user.id,task.title,task.category,task.priority,nextDate,task.minutes,task.start_time,task.end_time,task.notes,task.reminder_time,task.recurrence_rule,JSON.stringify(task.recurrence_days||[]),task.recurrence_end,task.recurrence_parent_id||task.id]);nextOccurrence=created[0];}
  }
  res.json({item:task,nextOccurrence});
 }catch(e){next(e)}
});
app.delete('/api/tasks/:id',auth,async(req,res,next)=>{try{const result=await pool.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!result.rowCount)return res.status(404).json({error:'Task not found.'});res.json({ok:true});}catch(e){next(e)}});
app.post('/api/tasks/:id/remind',auth,async(req,res,next)=>{
 try { const {rows}=await pool.query('SELECT id,title,due_date,reminder_time FROM tasks WHERE id=$1 AND user_id=$2 AND completed=FALSE',[req.params.id,req.user.id]);if(!rows[0])return res.status(404).json({error:'Task not found.'});
  const t=rows[0];const result=await pool.query('INSERT INTO task_notifications(id,user_id,task_id,title,due_date) VALUES($1,$2,$3,$4,$5) ON CONFLICT(task_id) DO NOTHING RETURNING *',[randomUUID(),req.user.id,t.id,t.title,t.due_date]);
  await pool.query('UPDATE tasks SET reminder_notified_at=COALESCE(reminder_notified_at,NOW()) WHERE id=$1 AND user_id=$2',[t.id,req.user.id]);
  res.json({created:result.rowCount>0,notification:result.rows[0]||null});
 }catch(e){next(e)}
});
app.get('/api/productivity',auth,async(req,res,next)=>{try{const {rows}=await pool.query(`SELECT activity_date::text AS date, COUNT(*)::int AS completed FROM task_completion_events WHERE user_id=$1 AND activity_date >= CURRENT_DATE - INTERVAL '365 days' GROUP BY activity_date ORDER BY activity_date`,[req.user.id]);res.json({daily:rows});}catch(e){next(e)}});
app.get('/api/notifications',auth,async(req,res,next)=>{try{const {rows}=await pool.query('SELECT * FROM task_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',[req.user.id]);res.json({notifications:rows});}catch(e){next(e)}});
app.patch('/api/notifications/:id/read',auth,async(req,res,next)=>{try{const {rows}=await pool.query('UPDATE task_notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *',[req.params.id,req.user.id]);if(!rows[0])return res.status(404).json({error:'Notification not found.'});res.json({notification:rows[0]});}catch(e){next(e)}});
for(const [table,config] of Object.entries(legacyTables)){
 app.post(`/api/${table}`,auth,async(req,res,next)=>{try{const data={...req.body};for(const k of Object.keys(data))if(!config.fields.includes(k))delete data[k];for(const k of config.required)if(!data[k])return res.status(400).json({error:`${k} is required.`});const id=String(data.id||randomUUID());delete data.id;const keys=Object.keys(data);const cols=['id','user_id',...keys];const vals=[id,req.user.id,...keys.map(k=>cleanValue(k,data[k]))];const params=vals.map((_,i)=>`$${i+1}`);const {rows}=await pool.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${params.join(',')}) RETURNING *`,vals);res.status(201).json({item:rows[0]});}catch(e){next(e)}});
 app.patch(`/api/${table}/:id`,auth,async(req,res,next)=>{try{const data={...req.body};for(const k of Object.keys(data))if(!config.fields.includes(k))delete data[k];const keys=Object.keys(data);if(!keys.length)return res.status(400).json({error:'No valid fields supplied.'});const vals=keys.map(k=>cleanValue(k,data[k]));const sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);const {rows}=await pool.query(`UPDATE ${table} SET ${sets.join(',')} WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING *`,vals);if(!rows[0])return res.status(404).json({error:'Record not found.'});res.json({item:rows[0]});}catch(e){next(e)}});
 app.delete(`/api/${table}/:id`,auth,async(req,res,next)=>{try{const result=await pool.query(`DELETE FROM ${table} WHERE id=$1 AND user_id=$2`,[req.params.id,req.user.id]);if(!result.rowCount)return res.status(404).json({error:'Record not found.'});res.json({ok:true});}catch(e){next(e)}});
}
app.use('/api',(err,req,res,_next)=>{console.error(err);res.status(500).json({error:'Server error. Check the Railway logs and database connection.'})});
const __dirname=path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname,'dist')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'dist','index.html')));
app.listen(PORT,'0.0.0.0',()=>{console.log(`CareerOS daily task manager listening on ${PORT}`);setTimeout(()=>pollJobSources(),12000);setInterval(()=>pollJobSources(),5*60*1000);});