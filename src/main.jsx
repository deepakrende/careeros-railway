import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Check, CheckCheck, CheckCircle2, Circle, Clock3, ListTodo, Bell, Plus, Search, Settings2, Trash2, Pencil, X, Repeat2, ChevronDown, CalendarClock, Inbox, Sun, Moon, LogOut, AlarmClock, Filter, MoreHorizontal } from 'lucide-react';
import './style.css';

const API='/api';
let authToken=localStorage.getItem('careeros_token');
async function api(path,options={}){
 const response=await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json',...(authToken?{Authorization:`Bearer ${authToken}`}:{ } ),...(options.headers||{})}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(payload.error||'Request failed');
 return payload;
}
const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const timeValue=v=>v?String(v).slice(0,5):'';
const dateLabel=(value,opts={weekday:'short',month:'short',day:'numeric'})=>value?new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString(undefined,opts):'No date';
const priorityOrder={High:0,Medium:1,Low:2};
const categories=['Personal','Learning','Work','Project','Interview prep','Errands','Health','Other'];
const weekDays=[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]];

function App(){
 const [page,setPage]=useState('Today');
 const [tasks,setTasks]=useState([]);
 const [notifications,setNotifications]=useState([]);
 const [user,setUser]=useState(null);
 const [authReady,setAuthReady]=useState(false);
 const [authMode,setAuthMode]=useState('login');
 const [modalOpen,setModalOpen]=useState(false);
 const [editing,setEditing]=useState(null);
 const [query,setQuery]=useState('');
 const [categoryFilter,setCategoryFilter]=useState('All categories');
 const [priorityFilter,setPriorityFilter]=useState('All priorities');
 const [dark,setDark]=useState(true);
 const [notice,setNotice]=useState('');
 const [noticeOpen,setNoticeOpen]=useState(false);
 const [loading,setLoading]=useState(false);
 const [mobileMenu,setMobileMenu]=useState(false);
 const reminderInFlight=useRef(new Set());
 const today=localDate();

 const loadWorkspace=async()=>{
  const [data,noticeData]=await Promise.all([api('/bootstrap'),api('/notifications')]);
  setTasks(data.tasks||[]);setNotifications(noticeData.notifications||[]);
 };
 useEffect(()=>{(async()=>{try{if(authToken){const me=await api('/me');setUser(me.user);await loadWorkspace();}}catch(e){authToken=null;localStorage.removeItem('careeros_token');}finally{setAuthReady(true)}})()},[]);
 const toast=message=>{setNotice(message);window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>setNotice(''),3200)};
 const completed=tasks.filter(t=>t.completed).length;
 const openTasks=tasks.filter(t=>!t.completed);
 const todayTasks=tasks.filter(t=>String(t.due_date||'').slice(0,10)===today);
 const todayDone=todayTasks.filter(t=>t.completed).length;
 const overdue=tasks.filter(t=>!t.completed&&t.due_date&&String(t.due_date).slice(0,10)<today);
 const unread=notifications.filter(n=>!n.read_at).length;
 const visibleTasks=useMemo(()=>{
  let rows=[...tasks];
  if(page==='Today')rows=rows.filter(t=>String(t.due_date||'').slice(0,10)===today);
  if(page==='Upcoming')rows=rows.filter(t=>!t.completed&&t.due_date&&String(t.due_date).slice(0,10)>today);
  if(page==='Completed')rows=rows.filter(t=>t.completed);
  if(page==='Inbox')rows=rows.filter(t=>!t.due_date);
  if(categoryFilter!=='All categories')rows=rows.filter(t=>t.category===categoryFilter);
  if(priorityFilter!=='All priorities')rows=rows.filter(t=>t.priority===priorityFilter);
  if(query.trim())rows=rows.filter(t=>(`${t.title} ${t.notes||''} ${t.category||''}`).toLowerCase().includes(query.toLowerCase()));
  return rows.sort((a,b)=>{
   if(a.completed!==b.completed)return a.completed?1:-1;
   const da=String(a.due_date||'9999-12-31'),db=String(b.due_date||'9999-12-31');if(da!==db)return da.localeCompare(db);
   const ta=timeValue(a.start_time)||'99:99',tb=timeValue(b.start_time)||'99:99';if(ta!==tb)return ta.localeCompare(tb);
   return (priorityOrder[a.priority]??1)-(priorityOrder[b.priority]??1);
  });
 },[tasks,page,today,categoryFilter,priorityFilter,query]);

 // In-app reminders are checked while the signed-in app is open. The server stores each reminder once.
 useEffect(()=>{
  if(!user)return;
  const checkReminders=async()=>{
   const now=new Date();
   for(const task of tasks){
    if(task.completed||!task.reminder_time||!task.due_date||task.reminder_notified_at||reminderInFlight.current.has(task.id))continue;
    const dueAt=new Date(`${String(task.due_date).slice(0,10)}T${timeValue(task.reminder_time)}:00`);
    if(dueAt<=now){
     reminderInFlight.current.add(task.id);
     try{const result=await api(`/tasks/${task.id}/remind`,{method:'POST'});setTasks(old=>old.map(t=>t.id===task.id?{...t,reminder_notified_at:new Date().toISOString()}:t));if(result.created){const n=await api('/notifications');setNotifications(n.notifications||[]);toast(`Reminder: ${task.title}`)}}catch(e){console.error(e)}finally{reminderInFlight.current.delete(task.id)}
    }
   }
  };
  checkReminders();const timer=setInterval(checkReminders,30000);return()=>clearInterval(timer);
 },[user,tasks]);

 const createTask=()=>{setEditing(null);setModalOpen(true)};
 const editTask=task=>{setEditing(task);setModalOpen(true)};
 const saveTask=async item=>{
  setLoading(true);
  try{
   if(editing){const result=await api(`/tasks/${editing.id}`,{method:'PATCH',body:JSON.stringify(item)});setTasks(old=>old.map(t=>t.id===editing.id?result.item:t));toast('Task updated');}
   else{const result=await api('/tasks',{method:'POST',body:JSON.stringify(item)});setTasks(old=>[result.item,...old]);toast('Task added to your list');}
   setModalOpen(false);setEditing(null);
  }catch(e){toast(e.message)}finally{setLoading(false)}
 };
 const toggleTask=async task=>{
  const next=!task.completed;setTasks(old=>old.map(t=>t.id===task.id?{...t,completed:next}:t));
  try{const result=await api(`/tasks/${task.id}`,{method:'PATCH',body:JSON.stringify({completed:next})});setTasks(old=>{let updated=old.map(t=>t.id===task.id?result.item:t);if(result.nextOccurrence&&!updated.some(t=>t.id===result.nextOccurrence.id))updated=[result.nextOccurrence,...updated];return updated});if(result.nextOccurrence)toast('Completed. Your next recurring task was scheduled.');}
  catch(e){setTasks(old=>old.map(t=>t.id===task.id?{...t,completed:!next}:t));toast(e.message)}
 };
 const deleteTask=async task=>{if(!window.confirm(`Delete “${task.title}”?`))return;try{await api(`/tasks/${task.id}`,{method:'DELETE'});setTasks(old=>old.filter(t=>t.id!==task.id));toast('Task deleted');}catch(e){toast(e.message)}};
 const markRead=async n=>{try{const result=await api(`/notifications/${n.id}/read`,{method:'PATCH'});setNotifications(old=>old.map(x=>x.id===n.id?result.notification:x));}catch(e){toast(e.message)}};
 const authenticate=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const result=await api(`/auth/${authMode}`,{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});authToken=result.token;localStorage.setItem('careeros_token',authToken);setUser(result.user);await loadWorkspace();toast(authMode==='register'?'Your account is ready':'Welcome back');}catch(err){toast(err.message)}};
 const logout=()=>{authToken=null;localStorage.removeItem('careeros_token');setUser(null);setTasks([]);setNotifications([]);setPage('Today')};
 if(!authReady)return <div className="loading-screen"><div className="loader-mark">C</div><span>Loading your planner…</span></div>;
 if(!user)return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">C</div><div className="eyebrow">YOUR PERSONAL PLANNING SPACE</div><h1>{authMode==='login'?'Welcome back':'Create your account'}</h1><p>Plan your day, keep tasks moving, and build consistent routines.</p><form onSubmit={authenticate}><label>Email address<input name="email" type="email" required placeholder="you@example.com" autoComplete="email"/></label><label>Password<input name="password" type="password" minLength="8" required placeholder="At least 8 characters" autoComplete={authMode==='login'?'current-password':'new-password'}/></label><button className="primary full" type="submit">{authMode==='login'?'Sign in':'Create account'}</button></form><div className="auth-switch">{authMode==='login'?"Don't have an account?":"Already have an account?"}<button className="link-btn" onClick={()=>setAuthMode(authMode==='login'?'register':'login')}>{authMode==='login'?'Create one':'Sign in'}</button></div></div><div className="auth-caption">CAREEROS · DAILY TASK MANAGER</div></div>;

 const pages=[['Today',CalendarDays],['All tasks',ListTodo],['Upcoming',CalendarClock],['Completed',CheckCheck],['Inbox',Inbox]];
 return <div className={dark?'app-shell dark':'app-shell'}>
  <aside className={`sidebar ${mobileMenu?'show':''}`}>
   <div className="brand-row"><div className="brand-mark">C</div><div><strong>CareerOS</strong><small>DAILY PLANNER</small></div><button className="icon-btn sidebar-close" onClick={()=>setMobileMenu(false)}><X size={18}/></button></div>
   <button className="new-task-btn" onClick={createTask}><Plus size={17}/> Add a task <span>⌘ N</span></button>
   <div className="nav-caption">YOUR PLANNER</div><nav className="side-nav">{pages.map(([label,Icon])=><button key={label} className={`side-link ${page===label?'selected':''}`} onClick={()=>{setPage(label);setMobileMenu(false)}}><Icon size={18}/><span>{label}</span>{label==='Today'&&todayTasks.length>0&&<em>{todayTasks.filter(t=>!t.completed).length}</em>}</button>)}</nav>
   <div className="sidebar-spacer"/><div className="sidebar-bottom"><div className="mini-summary"><div className="mini-summary-top"><span>Today's progress</span><b>{todayTasks.length?Math.round(todayDone/todayTasks.length*100):0}%</b></div><div className="progress-track"><i style={{width:`${todayTasks.length?todayDone/todayTasks.length*100:0}%`}}/></div><small>{todayDone} of {todayTasks.length} tasks completed</small></div><div className="account-row"><div className="avatar">{user.email?.[0]?.toUpperCase()}</div><div className="account-copy"><b>{user.email.split('@')[0]}</b><small>Synced to Railway</small></div><button className="icon-btn" title="Toggle theme" onClick={()=>setDark(!dark)}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button><button className="icon-btn" title="Sign out" onClick={logout}><LogOut size={16}/></button></div></div>
  </aside>
  <main className="main-area">
   <header className="topbar"><button className="icon-btn mobile-toggle" onClick={()=>setMobileMenu(true)}><ListTodo size={20}/></button><div className="breadcrumbs">My planner <span>/</span> <b>{page}</b></div><div className="topbar-actions"><div className="search-field"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tasks…"/><kbd>⌘ K</kbd></div><div className="notification-wrap"><button className={`icon-btn bell-btn ${noticeOpen?'pressed':''}`} onClick={()=>setNoticeOpen(v=>!v)} aria-label="Notifications"><Bell size={18}/>{unread>0&&<i>{unread>9?'9+':unread}</i>}</button>{noticeOpen&&<div className="notification-popover"><div className="popover-head"><b>Notifications</b><span>{unread} unread</span></div>{notifications.length?notifications.map(n=><button key={n.id} className={`notification-item ${n.read_at?'read':''}`} onClick={()=>markRead(n)}><span className="notification-icon"><AlarmClock size={16}/></span><span><b>{n.title}</b><small>Reminder · {dateLabel(n.due_date,{month:'short',day:'numeric'})}</small></span>{!n.read_at&&<i/>}</button>):<div className="notification-empty">No reminders yet. Add a reminder to a task.</div>}</div>}</div><div className="avatar top-avatar">{user.email?.[0]?.toUpperCase()}</div></div></header>
   <section className="page-content">
    <div className="page-heading"><div><div className="eyebrow">{page==='Today'?'YOUR DAY AT A GLANCE':'TASK MANAGEMENT'}</div><h1>{page==='Today'?'Today':page}</h1><p>{page==='Today'?new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}):page==='Upcoming'?'Everything scheduled for the days ahead.':page==='Completed'?'A record of the tasks you have finished.':page==='Inbox'?'Tasks that do not have a scheduled date yet.':'All your tasks, in one place.'}</p></div><button className="primary add-button" onClick={createTask}><Plus size={17}/> New task</button></div>
    <div className="summary-grid"><SummaryCard icon={ListTodo} label="Tasks today" value={todayTasks.length} detail={`${todayTasks.filter(t=>!t.completed).length} still to do`} tone="purple"/><SummaryCard icon={CheckCircle2} label="Completed today" value={todayDone} detail={`${todayTasks.length?Math.round(todayDone/todayTasks.length*100):0}% of today's plan`} tone="green"/><SummaryCard icon={Clock3} label="Open tasks" value={openTasks.length} detail={`${overdue.length} overdue`} tone="orange"/></div>
    <div className="task-toolbar"><div className="task-toolbar-left"><div className="list-title"><h2>{page==='Today'?'Your task list':page==='All tasks'?'All tasks':page==='Upcoming'?'Coming up':page==='Completed'?'Completed tasks':'Unscheduled tasks'}</h2><span>{visibleTasks.length}</span></div><div className="filter-group"><label><Filter size={14}/><select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option>All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)}><option>All priorities</option><option>High</option><option>Medium</option><option>Low</option></select></label></div></div><button className="text-action" onClick={()=>{setCategoryFilter('All categories');setPriorityFilter('All priorities');setQuery('')}}>Clear filters</button></div>
    {visibleTasks.length? <div className="task-list">{visibleTasks.map(task=><TaskRow key={task.id} task={task} onToggle={()=>toggleTask(task)} onEdit={()=>editTask(task)} onDelete={()=>deleteTask(task)}/>)}</div>:<div className="empty-state"><div className="empty-icon"><CheckCheck size={24}/></div><h3>{query||categoryFilter!=='All categories'||priorityFilter!=='All priorities'?'No matching tasks':'Nothing on your list'}</h3><p>{page==='Today'?'Your day is clear. Add a task to make a plan.':'Create a task or adjust your filters to see it here.'}</p><button className="primary" onClick={createTask}><Plus size={16}/> Add your first task</button></div>}
    <div className="planner-footnote"><AlarmClock size={15}/> In-app reminders appear here while CareerOS is open. Recurring tasks schedule their next occurrence when completed.</div>
   </section>
  </main>
  {modalOpen&&<TaskModal key={editing?.id||'new'} task={editing} onClose={()=>{setModalOpen(false);setEditing(null)}} onSave={saveTask} loading={loading}/>}
  {notice&&<div className="toast"><CheckCircle2 size={17}/>{notice}</div>}
 </div>;
}

function SummaryCard({icon:Icon,label,value,detail,tone}){return <div className="summary-card"><div className={`summary-icon ${tone}`}><Icon size={18}/></div><div className="summary-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>}
function TaskRow({task,onToggle,onEdit,onDelete}){
 const timeRange=task.start_time?`${timeValue(task.start_time)}${task.end_time?` – ${timeValue(task.end_time)}`:''}`:'';
 const recurrence=task.recurrence_rule&&task.recurrence_rule!=='none';
 return <article className={`task-row ${task.completed?'is-complete':''}`}>
  <button className={`task-check ${task.completed?'checked':''}`} onClick={onToggle} aria-label={task.completed?'Mark incomplete':'Mark complete'}>{task.completed?<Check size={15}/>:null}</button>
  <div className="task-main"><div className="task-title-line"><h3>{task.title}</h3>{task.priority&&<span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>}</div>{task.notes&&<p className="task-notes">{task.notes}</p>}<div className="task-meta"><span className="category-tag">{task.category||'Other'}</span><span><CalendarDays size={13}/>{dateLabel(task.due_date)}</span>{timeRange&&<span><Clock3 size={13}/>{timeRange}</span>}{task.minutes&&<span><Clock3 size={13}/>{task.minutes} min</span>}{task.reminder_time&&!task.reminder_notified_at&&<span className="reminder-tag"><Bell size={12}/>{timeValue(task.reminder_time)}</span>}{recurrence&&<span><Repeat2 size={13}/>{task.recurrence_rule==='weekdays'?'Weekdays':task.recurrence_rule==='custom'?'Custom days':task.recurrence_rule}</span>}</div></div>
  <div className="task-actions"><button className="icon-btn" onClick={onEdit} title="Edit task"><Pencil size={15}/></button><button className="icon-btn danger-hover" onClick={onDelete} title="Delete task"><Trash2 size={15}/></button></div>
 </article>
}
function TaskModal({task,onClose,onSave,loading}){
 const [repeat,setRepeat]=useState(task?.recurrence_rule||'none');
 const [selectedDays,setSelectedDays]=useState(Array.isArray(task?.recurrence_days)?task.recurrence_days.map(Number):[1,2,3,4,5]);
 const [hasReminder,setHasReminder]=useState(Boolean(task?.reminder_time));
 const [error,setError]=useState('');
 const submit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const title=String(f.get('title')||'').trim();if(!title){setError('Enter a task title.');return}if(repeat!=='none'&&!f.get('due_date')){setError('Choose a date for a recurring task.');return}if(repeat==='custom'&&!selectedDays.length){setError('Choose at least one day for a custom repeat.');return}if(f.get('start_time')&&f.get('end_time')&&f.get('end_time')<=f.get('start_time')){setError('End time must be later than start time.');return}
  const item={title,notes:f.get('notes')||'',category:f.get('category'),priority:f.get('priority'),due_date:f.get('due_date')||null,start_time:f.get('start_time')||null,end_time:f.get('end_time')||null,minutes:Number(f.get('minutes')||30),reminder_time:hasReminder?(f.get('reminder_time')||null):null,recurrence_rule:repeat,recurrence_days:repeat==='custom'?selectedDays:[],recurrence_end:f.get('recurrence_end')||null,completed:task?.completed||false};onSave(item);
 };
 return <div className="modal-backdrop" onMouseDown={onClose}><div className="task-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">TASK DETAILS</span><h2>{task?'Edit task':'Create a task'}</h2></div><button className="icon-btn" onClick={onClose}><X size={19}/></button></div><form onSubmit={submit}>
  <label className="field-label">Task name<input name="title" required autoFocus defaultValue={task?.title||''} placeholder="What do you need to get done?"/></label>
  <label className="field-label">Notes <textarea name="notes" rows="2" defaultValue={task?.notes||''} placeholder="Add details or a checklist description…"/></label>
  <div className="form-two"><label className="field-label">Category<select name="category" defaultValue={task?.category||'Personal'}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label className="field-label">Priority<select name="priority" defaultValue={task?.priority||'Medium'}><option>Low</option><option>Medium</option><option>High</option></select></label></div>
  <div className="form-two"><label className="field-label">Date<input type="date" name="due_date" defaultValue={task?(task.due_date?String(task.due_date).slice(0,10):''):localDate()}/></label><label className="field-label">Estimated duration (min)<input type="number" name="minutes" min="1" max="1440" defaultValue={task?.minutes||30}/></label></div>
  <div className="form-two"><label className="field-label">Start time<input type="time" name="start_time" defaultValue={timeValue(task?.start_time)}/></label><label className="field-label">End time<input type="time" name="end_time" defaultValue={timeValue(task?.end_time)}/></label></div>
  <div className="reminder-control"><div><b><Bell size={15}/> In-app reminder</b><small>Show a reminder when the scheduled time arrives while you're using CareerOS.</small></div><button type="button" className={`switch ${hasReminder?'on':''}`} onClick={()=>setHasReminder(v=>!v)} aria-label="Toggle reminder"><i/></button></div>
  {hasReminder&&<label className="field-label">Remind me at<input type="time" name="reminder_time" required defaultValue={timeValue(task?.reminder_time)||'09:00'}/></label>}
  <div className="repeat-section"><label className="field-label">Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option><option value="custom">Custom days</option></select></label>{repeat==='custom'&&<div className="weekday-picker">{weekDays.map(([label,day])=><button type="button" key={day} className={selectedDays.includes(day)?'day-chip active':'day-chip'} onClick={()=>setSelectedDays(old=>old.includes(day)?old.filter(d=>d!==day):[...old,day])}>{label}</button>)}</div>}{repeat!=='none'&&<label className="field-label recurrence-end">Repeat until (optional)<input type="date" name="recurrence_end" defaultValue={String(task?.recurrence_end||'').slice(0,10)}/></label>}</div>
  {error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={loading}>{loading?'Saving…':task?'Save changes':'Add task'}</button></div>
 </form></div></div>
}

createRoot(document.getElementById('root')).render(<App/>);
