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
app.listen(PORT,'0.0.0.0',()=>console.log(`CareerOS daily task manager listening on ${PORT}`));