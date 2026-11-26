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
if (!JWT_SECRET) { console.error('Missing JWT_SECRET. Add a strong secret in Railway service variables.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined });
app.use(express.json({ limit: '1mb' }));

const schema = `
CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, category TEXT, priority TEXT, due_date DATE, completed BOOLEAN NOT NULL DEFAULT FALSE, minutes INTEGER DEFAULT 30, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS job_applications (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, company TEXT NOT NULL, role TEXT NOT NULL, status TEXT, applied_on DATE, location TEXT, salary TEXT, url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, stack TEXT, status TEXT, due_date DATE, description TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS learning_topics (id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, topic TEXT NOT NULL, items JSONB NOT NULL DEFAULT '[]'::jsonb, progress INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON job_applications(user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS learning_user_idx ON learning_topics(user_id);
`;
let dbReady;
async function ensureDb() { if (!dbReady) dbReady = pool.query(schema); return dbReady; }
app.use(async (_req, _res, next) => { try { await ensureDb(); next(); } catch (e) { console.error('Database initialization failed:', e); next(e); } });
function auth(req, res, next) {
 const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
 if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
 try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
app.get('/api/health', (_req,res)=>res.json({ok:true, database: Boolean(process.env.DATABASE_URL)}));
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
const tables={tasks:{fields:['title','category','priority','due_date','completed','minutes'],required:['title']},job_applications:{fields:['company','role','status','applied_on','location','salary','url'],required:['company','role']},projects:{fields:['name','stack','status','due_date','description'],required:['name']},learning_topics:{fields:['topic','items','progress'],required:['topic']}};
const dateFields=new Set(['due_date','applied_on']);
function cleanValue(key,value){ if(dateFields.has(key)&&value==='') return null; if(key==='items' && Array.isArray(value)) return JSON.stringify(value); return value; }
app.get('/api/bootstrap',auth,async(req,res,next)=>{
 try {
  const today=new Date().toISOString().slice(0,10);
  const seeds={
   tasks:[['s1',{title:'Revise Pandas groupby and aggregation',category:'Learning',priority:'High',due_date:today,completed:false,minutes:60}],['s2',{title:'Solve 10 SQL window function questions',category:'Interview prep',priority:'High',due_date:today,completed:false,minutes:45}],['s3',{title:'Build sales dashboard — clean dataset',category:'Projects',priority:'Medium',due_date:today,completed:true,minutes:90}],['s4',{title:'Apply to 3 Data Analyst roles',category:'Job search',priority:'Medium',due_date:today,completed:false,minutes:30}],['s5',{title:'Practice “Tell me about yourself”',category:'Interview prep',priority:'Low',due_date:today,completed:false,minutes:20}]],
   job_applications:[['j1',{company:'Sample Analytics Co.',role:'Junior Data Analyst',status:'Applied',applied_on:today,location:'Hyderabad',salary:'₹4–6 LPA',url:''}],['j2',{company:'DataWorks',role:'Data Analyst Intern',status:'Interview',applied_on:today,location:'Remote',salary:'₹3–5 LPA',url:''}]],
   projects:[['p1',{name:'Retail Sales Analysis',stack:'Python · Pandas · SQL',status:'In progress',due_date:today,description:'Analyze sales trends, top products, and regional performance.'}],['p2',{name:'IPL Match Insights',stack:'Python · Pandas · Matplotlib',status:'Planning',due_date:null,description:'Explore team performance, toss impact, and player statistics.'}]],
   learning_topics:[['l1',{topic:'Python',items:['Core syntax','Functions','Pandas basics'],progress:80}],['l2',{topic:'SQL',items:['Joins','GROUP BY','Window functions'],progress:65}],['l3',{topic:'Excel',items:['Pivot tables','Lookup formulas','Charts'],progress:45}],['l4',{topic:'Power BI',items:['Power Query','Data modeling','DAX'],progress:20}]]
  };
  for(const [table,items] of Object.entries(seeds)) { const count=await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE user_id=$1`,[req.user.id]); if(count.rows[0].n===0){for(const [id,item] of items){const keys=Object.keys(item);const cols=['id','user_id',...keys];const vals=[id,req.user.id,...keys.map(k=>cleanValue(k,item[k]))];const params=vals.map((_,i)=>`$${i+1}`);await pool.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${params.join(',')}) ON CONFLICT(id) DO NOTHING`,vals);}} }
  const [t,j,p,l]=await Promise.all([pool.query('SELECT * FROM tasks WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]),pool.query('SELECT * FROM job_applications WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]),pool.query('SELECT * FROM projects WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id]),pool.query('SELECT * FROM learning_topics WHERE user_id=$1 ORDER BY created_at DESC',[req.user.id])]);
  res.json({tasks:t.rows,jobs:j.rows,projects:p.rows,learning:l.rows});
 }catch(e){next(e)}
});
for(const [table,config] of Object.entries(tables)){
 app.post(`/api/${table}`,auth,async(req,res,next)=>{try{const data={...req.body};for(const k of Object.keys(data))if(!config.fields.includes(k))delete data[k];for(const k of config.required)if(!data[k])return res.status(400).json({error:`${k} is required.`});const id=String(data.id||randomUUID());delete data.id;const keys=Object.keys(data);const cols=['id','user_id',...keys];const vals=[id,req.user.id,...keys.map(k=>cleanValue(k,data[k]))];const placeholders=vals.map((_,i)=>`$${i+1}`);const {rows}=await pool.query(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${placeholders.join(',')}) RETURNING *`,vals);res.status(201).json({item:rows[0]});}catch(e){next(e)}});
 app.patch(`/api/${table}/:id`,auth,async(req,res,next)=>{try{const data={...req.body};for(const k of Object.keys(data))if(!config.fields.includes(k))delete data[k];const keys=Object.keys(data);if(!keys.length)return res.status(400).json({error:'No valid fields supplied.'});const vals=keys.map(k=>cleanValue(k,data[k]));const sets=keys.map((k,i)=>`${k}=$${i+1}`);vals.push(req.params.id,req.user.id);const {rows}=await pool.query(`UPDATE ${table} SET ${sets.join(',')} WHERE id=$${keys.length+1} AND user_id=$${keys.length+2} RETURNING *`,vals);if(!rows[0])return res.status(404).json({error:'Record not found.'});res.json({item:rows[0]});}catch(e){next(e)}});
 app.delete(`/api/${table}/:id`,auth,async(req,res,next)=>{try{const result=await pool.query(`DELETE FROM ${table} WHERE id=$1 AND user_id=$2`,[req.params.id,req.user.id]);if(!result.rowCount)return res.status(404).json({error:'Record not found.'});res.json({ok:true});}catch(e){next(e)}});
}
app.use('/api',(err,req,res,_next)=>{console.error(err);res.status(500).json({error:'Server error. Check the Railway logs and database connection.'})});
const __dirname=path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname,'dist')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'dist','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`CareerOS listening on ${PORT}`));
