import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CalendarDays, Check, CheckCheck, CheckCircle2, Clock3, ListTodo, Bell, Plus, Search, Trash2, Pencil, X, Repeat2, CalendarClock, Inbox, Sun, Moon, LogOut, AlarmClock, Filter, ChevronLeft, ChevronRight, Flame, BarChart3, AlertCircle, Settings, UserRound, Save, Target } from 'lucide-react';
import './style.css';

const API='/api';
let authToken=localStorage.getItem('careeros_token');
async function api(path,options={}){
 const response=await fetch(`${API}${path}`,{...options,headers:{'Content-Type':'application/json',...(authToken?{Authorization:`Bearer ${authToken}`}:{ }),...(options.headers||{})}});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(payload.error||'Request failed');
 return payload;
}
const browserTimezone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata';
const safeTimezone=value=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value}).format(new Date());return value}catch{return 'Asia/Kolkata'}};
const localDate=(d=new Date(),tz=browserTimezone())=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${v.year}-${v.month}-${v.day}`};
const timeValue=v=>v?String(v).slice(0,5):'';
const dateLabel=(value,opts={weekday:'short',month:'short',day:'numeric'})=>value?new Date(`${String(value).slice(0,10)}T12:00:00Z`).toLocaleDateString(undefined,{...opts,timeZone:'UTC'}):'No date';
const priorityOrder={High:0,Medium:1,Low:2};
const categories=['Personal','Learning','Work','Project','Interview prep','Errands','Health','Other'];
const weekDays=[['Sun',0],['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6]];
const statusOf=t=>t.status||(t.completed?'completed':'todo');
const startOfWeek=(date,startsOn='monday')=>{const d=new Date(`${date}T12:00:00Z`);const day=d.getUTCDay();const offset=startsOn==='sunday'?day:(day+6)%7;d.setUTCDate(d.getUTCDate()-offset);return d};
const addDays=(date,n)=>{const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
function zonedDateTime(date,time,tz){const [y,m,d]=date.split('-').map(Number);const [hh,mm]=time.split(':').map(Number);const target=Date.UTC(y,m-1,d,hh,mm,0);let guess=target;for(let i=0;i<3;i++){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess));const v=Object.fromEntries(parts.map(x=>[x.type,x.value]));const represented=Date.UTC(Number(v.year),Number(v.month)-1,Number(v.day),Number(v.hour),Number(v.minute));guess+=target-represented;}return new Date(guess)}

function App(){
 const [page,setPage]=useState('Today');
 const [tasks,setTasks]=useState([]);
 const [notifications,setNotifications]=useState([]);
 const [activity,setActivity]=useState([]);
 const [user,setUser]=useState(null);
 const [preferences,setPreferences]=useState({display_name:'',target_role:'',location:'',timezone:'Asia/Kolkata',theme:localStorage.getItem('careeros_theme')||'dark',week_starts_on:'monday',daily_task_goal:5});
 const [settingsSaving,setSettingsSaving]=useState(false);
 const [authReady,setAuthReady]=useState(false);
 const [authMode,setAuthMode]=useState('login');
 const [modalOpen,setModalOpen]=useState(false);
 const [editing,setEditing]=useState(null);
 const [query,setQuery]=useState('');
 const [categoryFilter,setCategoryFilter]=useState('All categories');
 const [priorityFilter,setPriorityFilter]=useState('All priorities');
 const [dark,setDark]=useState(localStorage.getItem('careeros_theme')!=='light');
 const [notice,setNotice]=useState('');
 const [loading,setLoading]=useState(false);
 const [mobileMenu,setMobileMenu]=useState(false);
 const [weekOffset,setWeekOffset]=useState(0);
 const [newTaskDate,setNewTaskDate]=useState(null);
 const reminderInFlight=useRef(new Set());
 const timezone=safeTimezone(preferences.timezone||'Asia/Kolkata');
 const today=localDate(new Date(),timezone);

 const loadWorkspace=async()=>{
  const [data,noticeData,prefsData]=await Promise.all([api('/bootstrap'),api('/notifications'),api('/preferences')]);
  const prefs=prefsData.preferences||{};setPreferences(old=>({...old,...prefs}));setDark(prefs.theme==='light'?false:true);localStorage.setItem('careeros_theme',prefs.theme||'dark');
  const productivity=await api(`/productivity?timezone=${encodeURIComponent(prefs.timezone||'Asia/Kolkata')}`);
  setTasks(data.tasks||[]);setNotifications(noticeData.notifications||[]);setActivity(productivity.daily||[]);
 };
 useEffect(()=>{(async()=>{try{if(authToken){const me=await api('/me');setUser(me.user);await loadWorkspace();}}catch(e){authToken=null;localStorage.removeItem('careeros_token');}finally{setAuthReady(true)}})()},[]);
 const toast=message=>{setNotice(message);window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>setNotice(''),3200)};
 const completed=tasks.filter(t=>statusOf(t)==='completed').length;
 const openTasks=tasks.filter(t=>statusOf(t)!=='completed');
 const todayTasks=tasks.filter(t=>String(t.due_date||'').slice(0,10)===today);
 const todayDone=todayTasks.filter(t=>statusOf(t)==='completed').length;
 const todayProgress=todayTasks.length?Math.round(todayDone/todayTasks.length*100):0;
 const overdue=tasks.filter(t=>statusOf(t)!=='completed'&&t.due_date&&String(t.due_date).slice(0,10)<today);
 const unread=notifications.filter(n=>!n.read_at).length;
 const upcomingReminders=tasks.filter(t=>statusOf(t)!=='completed'&&t.reminder_time&&t.due_date&&!t.reminder_notified_at).sort((a,b)=>`${String(a.due_date).slice(0,10)} ${timeValue(a.reminder_time)}`.localeCompare(`${String(b.due_date).slice(0,10)} ${timeValue(b.reminder_time)}`));
 const pages=[['Today',CalendarDays],['Weekly planner',CalendarDays],['All tasks',ListTodo],['Upcoming',CalendarClock],['Overdue',AlertCircle],['Completed',CheckCheck],['Reminder Centre',Bell],['Reports',BarChart3],['Inbox',Inbox],['Settings',Settings]];
 const visibleTasks=useMemo(()=>{
  let rows=[...tasks];
  if(page==='Today')rows=rows.filter(t=>String(t.due_date||'').slice(0,10)===today);
  if(page==='Upcoming')rows=rows.filter(t=>statusOf(t)!=='completed'&&t.due_date&&String(t.due_date).slice(0,10)>today);
  if(page==='Completed')rows=rows.filter(t=>statusOf(t)==='completed');
  if(page==='Inbox')rows=rows.filter(t=>!t.due_date);
  if(page==='Overdue')rows=rows.filter(t=>statusOf(t)!=='completed'&&t.due_date&&String(t.due_date).slice(0,10)<today);
  if(categoryFilter!=='All categories')rows=rows.filter(t=>t.category===categoryFilter);
  if(priorityFilter!=='All priorities')rows=rows.filter(t=>t.priority===priorityFilter);
  if(query.trim())rows=rows.filter(t=>(`${t.title} ${t.notes||''} ${t.category||''}`).toLowerCase().includes(query.toLowerCase()));
  return rows.sort((a,b)=>{if(statusOf(a)==='completed'&&statusOf(b)!=='completed')return 1;if(statusOf(a)!=='completed'&&statusOf(b)==='completed')return -1;const da=String(a.due_date||'9999-12-31'),db=String(b.due_date||'9999-12-31');if(da!==db)return da.localeCompare(db);const ta=timeValue(a.start_time)||'99:99',tb=timeValue(b.start_time)||'99:99';if(ta!==tb)return ta.localeCompare(tb);return(priorityOrder[a.priority]??1)-(priorityOrder[b.priority]??1)});
 },[tasks,page,today,categoryFilter,priorityFilter,query]);

 // Reminders are generated in-app while the signed-in app is open; the API deduplicates them.
 useEffect(()=>{
  if(!user)return;
  const checkReminders=async()=>{const now=new Date();for(const task of tasks){if(statusOf(task)==='completed'||!task.reminder_time||!task.due_date||task.reminder_notified_at||reminderInFlight.current.has(task.id))continue;const dueAt=zonedDateTime(String(task.due_date).slice(0,10),timeValue(task.reminder_time),timezone);if(dueAt<=now){reminderInFlight.current.add(task.id);try{const result=await api(`/tasks/${task.id}/remind`,{method:'POST'});if(result.created){setTasks(old=>old.map(t=>t.id===task.id?{...t,reminder_notified_at:new Date().toISOString()}:t));const n=await api('/notifications');setNotifications(n.notifications||[]);toast(`Reminder: ${task.title}`)}}catch(e){console.error(e)}finally{reminderInFlight.current.delete(task.id)}}}};
  checkReminders();const timer=setInterval(checkReminders,30000);return()=>clearInterval(timer);
 },[user,tasks,timezone]);

 const createTask=()=>{setEditing(null);setNewTaskDate(null);setModalOpen(true)};
 const createTaskForDate=date=>{setEditing(null);setNewTaskDate(date);setModalOpen(true)};
 const editTask=task=>{setEditing(task);setModalOpen(true)};
 const saveTask=async item=>{setLoading(true);try{if(editing){const result=await api(`/tasks/${editing.id}`,{method:'PATCH',body:JSON.stringify({...item,activity_date:today})});setTasks(old=>old.map(t=>t.id===editing.id?result.item:t));if(result.nextOccurrence)setTasks(old=>old.some(t=>t.id===result.nextOccurrence.id)?old:[result.nextOccurrence,...old]);toast('Task updated');}else{const result=await api('/tasks',{method:'POST',body:JSON.stringify({...item,activity_date:today})});setTasks(old=>[result.item,...old]);toast('Task added to your list');}setModalOpen(false);setEditing(null);setNewTaskDate(null);await refreshActivity();}catch(e){toast(e.message)}finally{setLoading(false)}};
 const refreshActivity=async()=>{try{const result=await api(`/productivity?timezone=${encodeURIComponent(timezone)}`);setActivity(result.daily||[])}catch(e){console.error(e)}};
 const changeStatus=async(task,nextStatus)=>{const previous=statusOf(task);if(previous===nextStatus)return;setTasks(old=>old.map(t=>t.id===task.id?{...t,status:nextStatus,completed:nextStatus==='completed'}:t));try{const result=await api(`/tasks/${task.id}`,{method:'PATCH',body:JSON.stringify({status:nextStatus,activity_date:today})});setTasks(old=>{let updated=old.map(t=>t.id===task.id?result.item:t);if(result.nextOccurrence&&!updated.some(t=>t.id===result.nextOccurrence.id))updated=[result.nextOccurrence,...updated];return updated});if(result.nextOccurrence)toast('Completed. Your next recurring task was scheduled.');await refreshActivity();}catch(e){setTasks(old=>old.map(t=>t.id===task.id?{...t,status:previous,completed:previous==='completed'}:t));toast(e.message)}};
 const toggleTask=task=>changeStatus(task,statusOf(task)==='completed'?'todo':'completed');
 const deleteTask=async task=>{if(!window.confirm(`Delete “${task.title}”?`))return;try{await api(`/tasks/${task.id}`,{method:'DELETE'});setTasks(old=>old.filter(t=>t.id!==task.id));toast('Task deleted')}catch(e){toast(e.message)}};
 const markRead=async n=>{try{const result=await api(`/notifications/${n.id}/read`,{method:'PATCH'});setNotifications(old=>old.map(x=>x.id===n.id?result.notification:x))}catch(e){toast(e.message)}};
 const authenticate=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const result=await api(`/auth/${authMode}`,{method:'POST',body:JSON.stringify({email:f.get('email'),password:f.get('password')})});authToken=result.token;localStorage.setItem('careeros_token',authToken);setUser(result.user);await loadWorkspace();toast(authMode==='register'?'Your account is ready':'Welcome back')}catch(err){toast(err.message)}};
 const logout=()=>{authToken=null;localStorage.removeItem('careeros_token');setUser(null);setTasks([]);setNotifications([]);setActivity([]);setPage('Today')};
 const toggleTheme=async()=>{const next=dark?'light':'dark';setDark(next==='dark');setPreferences(old=>({...old,theme:next}));localStorage.setItem('careeros_theme',next);try{await api('/preferences',{method:'PATCH',body:JSON.stringify({theme:next})})}catch(e){toast(`Theme changed locally. ${e.message}`)}};
 const saveSettings=async e=>{e.preventDefault();setSettingsSaving(true);try{const payload={display_name:preferences.display_name,target_role:preferences.target_role,location:preferences.location,timezone:preferences.timezone,theme:preferences.theme,week_starts_on:preferences.week_starts_on,daily_task_goal:Number(preferences.daily_task_goal)};const result=await api('/preferences',{method:'PATCH',body:JSON.stringify(payload)});setPreferences(old=>({...old,...result.preferences}));setDark(result.preferences.theme==='dark');localStorage.setItem('careeros_theme',result.preferences.theme);toast('Your profile and planner settings were saved');}catch(e){toast(e.message)}finally{setSettingsSaving(false)}};
 const updatePreference=(key,value)=>setPreferences(old=>({...old,[key]:value}));

 const activityMap=Object.fromEntries(activity.map(x=>[String(x.date).slice(0,10),Number(x.completed)]));
 const streak=(()=>{let cursor=activityMap[today]?today:addDays(today,-1);if(!activityMap[cursor])return 0;let count=0;for(let i=0;i<366;i++){if(!activityMap[cursor])break;count++;cursor=addDays(cursor,-1)}return count})();
 const bestStreak=(()=>{let best=0,run=0,prev=null;for(const row of activity){const d=String(row.date).slice(0,10);if(prev&&addDays(prev,1)===d)run++;else run=1;best=Math.max(best,run);prev=d}return best})();
 const last7=Array.from({length:7},(_,i)=>{const date=addDays(today,i-6);return{date,count:activityMap[date]||0,label:new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined,{weekday:'short',timeZone:'UTC'})}});
 const totalLogged=activity.reduce((sum,x)=>sum+Number(x.completed),0);
 const monthTotal=activity.filter(x=>String(x.date).startsWith(today.slice(0,7))).reduce((sum,x)=>sum+Number(x.completed),0);
 const weekStart=startOfWeek(today,preferences.week_starts_on);weekStart.setUTCDate(weekStart.getUTCDate()+weekOffset*7);const weekDates=Array.from({length:7},(_,i)=>addDays(weekStart.toISOString().slice(0,10),i));

 if(!authReady)return <div className="loading-screen"><div className="loader-mark">C</div><span>Loading your planner…</span></div>;
 if(!user)return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">C</div><div className="eyebrow">YOUR PERSONAL PLANNING SPACE</div><h1>{authMode==='login'?'Welcome back':'Create your account'}</h1><p>Plan your day, keep tasks moving, and build consistent routines.</p><form onSubmit={authenticate}><label>Email address<input name="email" type="email" required placeholder="you@example.com" autoComplete="email"/></label><label>Password<input name="password" type="password" minLength="8" required placeholder="At least 8 characters" autoComplete={authMode==='login'?'current-password':'new-password'}/></label><button className="primary full" type="submit">{authMode==='login'?'Sign in':'Create account'}</button></form><div className="auth-switch">{authMode==='login'?"Don't have an account?":"Already have an account?"}<button className="link-btn" onClick={()=>setAuthMode(authMode==='login'?'register':'login')}>{authMode==='login'?'Create one':'Sign in'}</button></div></div><div className="auth-caption">CAREEROS · PERSONAL PRODUCTIVITY</div></div>;

 return <div className={dark?'app-shell dark':'app-shell'}>
  <aside className={`sidebar ${mobileMenu?'show':''}`}>
   <div className="brand-row"><div className="brand-mark">C</div><div><strong>CareerOS</strong><small>PERSONAL WORKSPACE</small></div><button className="icon-btn sidebar-close" onClick={()=>setMobileMenu(false)}><X size={18}/></button></div>
   <button className="new-task-btn" onClick={createTask}><Plus size={17}/> Add a task <span>⌘ N</span></button>
   <div className="nav-caption">WORKSPACE</div><nav className="side-nav">{pages.map(([label,Icon])=><button key={label} className={`side-link ${page===label?'selected':''}`} onClick={()=>{setPage(label);setMobileMenu(false)}}><Icon size={17}/><span>{label}</span>{label==='Today'&&todayTasks.length>0&&<em>{todayTasks.filter(t=>statusOf(t)!=='completed').length}</em>}{label==='Overdue'&&overdue.length>0&&<em className="overdue-count">{overdue.length}</em>}{label==='Reminder Centre'&&unread>0&&<em>{unread}</em>}</button>)}</nav>
   <div className="sidebar-spacer"/><div className="mini-summary"><div className="mini-summary-top"><span>Today's progress</span><b>{todayProgress}%</b></div><div className="progress-track"><i style={{width:`${todayProgress}%`}}/></div><small>{todayDone} of {todayTasks.length} tasks completed</small></div>
   <div className="account-row"><div className="avatar">{(preferences.display_name||user.email)?.[0]?.toUpperCase()}</div><div className="account-copy"><b>{preferences.display_name||user.email}</b><small>{preferences.target_role||'Personal workspace'}</small></div><button className="icon-btn" title="Toggle theme" onClick={toggleTheme}>{dark?<Sun size={16}/>:<Moon size={16}/>}</button><button className="icon-btn" title="Sign out" onClick={logout}><LogOut size={16}/></button></div>
  </aside>
  <main className="main-area">
   <header className="topbar"><div className="breadcrumbs"><button className="icon-btn mobile-toggle" onClick={()=>setMobileMenu(true)}><ListTodo size={18}/></button>Workspace <span>/</span> <b>{page}</b></div><div className="topbar-actions"><label className="search-field"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tasks…"/><kbd>⌘ K</kbd></label><button className="icon-btn theme-top" title="Toggle dark mode" onClick={toggleTheme}>{dark?<Sun size={17}/>:<Moon size={17}/>}</button><button className="icon-btn bell-btn" title="Reminder Centre" onClick={()=>setPage('Reminder Centre')}><Bell size={17}/>{unread>0&&<i>{unread}</i>}</button><div className="avatar top-avatar">{(preferences.display_name||user.email)?.[0]?.toUpperCase()}</div></div></header>
   <section className="page-content">
    <div className="page-heading"><div><div className="eyebrow">{page==='Today'?'YOUR DAY AT A GLANCE':page==='Reports'?'YOUR CONSISTENCY, OVER TIME':'TASK MANAGEMENT'}</div><h1>{page==='Today'?'Today':page}</h1><p>{page==='Today'?dateLabel(today,{weekday:'long',month:'long',day:'numeric',year:'numeric'}):page==='Settings'?'Manage your profile, timezone, appearance and planner preferences.':page==='Weekly planner'?'Plan and manage your tasks across the week.':page==='Overdue'?'Tasks that have passed their due date and are still open.':page==='Reminder Centre'?'Upcoming and previously triggered in-app reminders.':page==='Reports'?'A simple view of your completed work and daily streaks.':page==='Upcoming'?'Everything scheduled for the days ahead.':page==='Completed'?'A record of the tasks you have finished.':page==='Inbox'?'Tasks that do not have a scheduled date yet.':'All your tasks, in one place.'}</p></div>{!['Reports','Reminder Centre','Settings'].includes(page)&&<button className="primary add-button" onClick={createTask}><Plus size={17}/> New task</button>}</div>

    {page==='Today'&&<>
     <div className="today-progress-panel"><div className="progress-panel-copy"><span className="eyebrow">DAILY PROGRESS</span><h2>{todayProgress===100&&todayTasks.length?'All done. Great work!':todayTasks.length?`${todayDone} of ${todayTasks.length} tasks completed`:'Your plan starts here'}</h2><p>{todayTasks.length?`${todayTasks.length-todayDone} tasks remaining for today.`:'Add tasks to create a plan for your day.'}</p><span className="goal-chip"><Target size={13}/> Daily goal: {todayDone}/{preferences.daily_task_goal} completed</span></div><div className="progress-ring" style={{'--progress':`${todayProgress*3.6}deg`}}><div><strong>{todayProgress}%</strong><small>complete</small></div></div></div>
     <div className="summary-grid"><SummaryCard icon={ListTodo} label="Tasks today" value={todayTasks.length} detail={`${todayTasks.filter(t=>statusOf(t)!=='completed').length} still open`} tone="purple"/><SummaryCard icon={CheckCircle2} label="Completed today" value={todayDone} detail={`${todayProgress}% of today's plan`} tone="green"/><SummaryCard icon={AlertCircle} label="Overdue tasks" value={overdue.length} detail="Need your attention" tone="orange"/></div>
    </>}

    {page==='Weekly planner'&&<><div className="week-toolbar"><button className="secondary" onClick={()=>setWeekOffset(v=>v-1)}><ChevronLeft size={15}/> Previous</button><b>{dateLabel(weekDates[0],{month:'long',day:'numeric'})} – {dateLabel(weekDates[6],{month:'long',day:'numeric',year:'numeric'})}</b><div><button className="secondary" onClick={()=>setWeekOffset(0)}>This week</button><button className="secondary" onClick={()=>setWeekOffset(v=>v+1)}>Next <ChevronRight size={15}/></button></div></div><div className="week-grid">{weekDates.map(date=>{const dayTasks=tasks.filter(t=>String(t.due_date||'').slice(0,10)===date).sort((a,b)=>(timeValue(a.start_time)||'99:99').localeCompare(timeValue(b.start_time)||'99:99'));return <div className={`week-day ${date===today?'is-today':''}`} key={date}><div className="week-day-head"><span>{new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined,{weekday:'short',timeZone:'UTC'})}</span><b>{new Date(`${date}T12:00:00Z`).getUTCDate()}</b></div>{dayTasks.length?dayTasks.map(t=><button key={t.id} className={`week-task ${statusOf(t)==='completed'?'done':''}`} onClick={()=>editTask(t)}><i className={`priority-dot ${String(t.priority||'medium').toLowerCase()}`}/><span>{t.title}</span>{t.start_time&&<small>{timeValue(t.start_time)}</small>}</button>):<div className="week-empty">No tasks</div>}<button className="week-add" onClick={()=>createTaskForDate(date)}><Plus size={13}/> Add</button></div>})}</div></>}

    {page==='Reminder Centre'&&<div className="reminder-page"><div className="reminder-page-head"><div><h2>Reminder Centre</h2><p>{upcomingReminders.length} upcoming · {unread} unread notifications</p></div><span className="notification-count"><Bell size={15}/>{notifications.length}</span></div>{upcomingReminders.length>0&&<div className="upcoming-reminder-section"><h3>Upcoming reminders</h3>{upcomingReminders.map(t=><button key={t.id} className="upcoming-reminder" onClick={()=>editTask(t)}><span className="notification-icon"><AlarmClock size={15}/></span><span><b>{t.title}</b><small>{dateLabel(t.due_date)} · {timeValue(t.reminder_time)}</small></span><Pencil size={14}/></button>)}</div>}<div className="notification-history-heading">Notification history</div>{notifications.length?notifications.map(n=><button key={n.id} className={`history-notification ${n.read_at?'read':''}`} onClick={()=>markRead(n)}><span className="notification-icon"><Bell size={16}/></span><span className="history-copy"><b>{n.title}</b><small>{n.due_date?dateLabel(n.due_date,{weekday:'short',month:'short',day:'numeric'}):'Task reminder'} · {new Date(n.created_at).toLocaleString()}</small></span>{!n.read_at&&<i className="unread-dot"/>}</button>):<div className="empty-state"><div className="empty-icon"><Bell size={23}/></div><h3>No reminders yet</h3><p>Set a reminder on a task. It will appear here when its time arrives while CareerOS is open.</p></div>}<p className="planner-footnote"><AlarmClock size={15}/> In-app reminders are checked while you are signed in and CareerOS is open.</p></div>}

    {page==='Reports'&&<><div className="report-stats"><SummaryCard icon={CheckCheck} label="Completions recorded" value={totalLogged} detail="Since this update was installed" tone="green"/><SummaryCard icon={Flame} label="Current streak" value={`${streak} days`} detail="Consecutive days with completions" tone="orange"/><SummaryCard icon={BarChart3} label="This month" value={monthTotal} detail="Tasks completed this month" tone="purple"/><SummaryCard icon={BarChart3} label="Best streak" value={`${bestStreak} days`} detail="Your longest completion streak" tone="purple"/></div><div className="report-card"><div className="report-card-head"><div><h2>Last 7 days</h2><p>Tasks completed each day</p></div><span className="report-total">{last7.reduce((s,x)=>s+x.count,0)} completed</span></div><div className="bar-chart">{last7.map(day=><div className="bar-column" key={day.date}><b>{day.count}</b><div className="bar-track"><i style={{height:`${Math.max(5,day.count/Math.max(1,...last7.map(x=>x.count))*100)}%`}}/></div><small>{day.label}</small></div>)}</div></div><div className="report-note"><Flame size={17}/><span>Streaks and reports count task completions recorded after this update is deployed. Older completed tasks remain saved, but their exact completion dates were not previously tracked.</span></div></>}

    {page==='Settings'&&<form className="settings-layout" onSubmit={saveSettings}>
     <section className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><UserRound size={18}/></span><div><h2>Personal profile</h2><p>Details used across your CareerOS workspace.</p></div></div>
      <label className="field-label">Display name<input value={preferences.display_name} onChange={e=>updatePreference('display_name',e.target.value)} maxLength={120} placeholder="Your name"/></label>
      <label className="field-label">Target role<input value={preferences.target_role} onChange={e=>updatePreference('target_role',e.target.value)} maxLength={120} placeholder="e.g. Data Analyst"/></label>
      <label className="field-label">Location<input value={preferences.location} onChange={e=>updatePreference('location',e.target.value)} maxLength={120} placeholder="e.g. Hyderabad, India"/></label>
      <label className="field-label">Account email<input value={user.email||''} readOnly disabled/></label>
     </section>
     <section className="settings-card"><div className="settings-card-heading"><span className="settings-icon"><Settings size={18}/></span><div><h2>Planner preferences</h2><p>Choose how dates and your weekly plan are organized.</p></div></div>
      <label className="field-label">Timezone<input value={preferences.timezone} onChange={e=>updatePreference('timezone',e.target.value)} list="timezone-options" placeholder="Asia/Kolkata"/><datalist id="timezone-options"><option value={browserTimezone()}/><option value="Asia/Kolkata"/><option value="Asia/Dubai"/><option value="Europe/London"/><option value="America/New_York"/><option value="America/Los_Angeles"/></datalist><small className="field-hint">Use an IANA timezone such as Asia/Kolkata. Your daily progress and reminders use this timezone.</small></label>
      <label className="field-label">Week starts on<select value={preferences.week_starts_on} onChange={e=>updatePreference('week_starts_on',e.target.value)}><option value="monday">Monday</option><option value="sunday">Sunday</option></select></label>
      <label className="field-label">Daily completion goal<input type="number" min="1" max="30" value={preferences.daily_task_goal} onChange={e=>updatePreference('daily_task_goal',e.target.value)}/><small className="field-hint">A personal target of 1–30 completed tasks per day.</small></label>
      <div className="field-label">Appearance<div className="theme-choice"><button type="button" className={preferences.theme==='light'?'theme-choice-btn active':'theme-choice-btn'} onClick={()=>{updatePreference('theme','light');setDark(false)}}><Sun size={16}/> Light</button><button type="button" className={preferences.theme==='dark'?'theme-choice-btn active':'theme-choice-btn'} onClick={()=>{updatePreference('theme','dark');setDark(true)}}><Moon size={16}/> Dark</button></div></div>
     </section>
     <div className="settings-save-row"><span>Your preferences are saved to your account and sync across devices.</span><button className="primary" type="submit" disabled={settingsSaving}><Save size={16}/>{settingsSaving?'Saving…':'Save settings'}</button></div>
    </form>}

    {!['Weekly planner','Reminder Centre','Reports','Settings'].includes(page)&&<>
     <div className="task-toolbar"><div className="task-toolbar-left"><div className="list-title"><h2>{page==='Today'?'Your task list':page==='All tasks'?'All tasks':page==='Upcoming'?'Coming up':page==='Overdue'?'Overdue tasks':page==='Completed'?'Completed tasks':'Unscheduled tasks'}</h2><span>{visibleTasks.length}</span></div><div className="filter-group"><label><Filter size={14}/><select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option>All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label><select value={priorityFilter} onChange={e=>setPriorityFilter(e.target.value)}><option>All priorities</option><option>High</option><option>Medium</option><option>Low</option></select></label></div></div><button className="text-action" onClick={()=>{setCategoryFilter('All categories');setPriorityFilter('All priorities');setQuery('')}}>Clear filters</button></div>
     {visibleTasks.length?<div className="task-list">{visibleTasks.map(task=><TaskRow key={task.id} task={task} onStatus={status=>changeStatus(task,status)} onEdit={()=>editTask(task)} onDelete={()=>deleteTask(task)}/>)}</div>:<div className="empty-state"><div className="empty-icon"><CheckCheck size={24}/></div><h3>{query||categoryFilter!=='All categories'||priorityFilter!=='All priorities'?'No matching tasks':'Nothing on your list'}</h3><p>{page==='Today'?'Your day is clear. Add a task to make a plan.':page==='Overdue'?'You have no overdue tasks. Nice work!':'Create a task or adjust your filters to see it here.'}</p><button className="primary" onClick={createTask}><Plus size={16}/> Add a task</button></div>}
     <div className="planner-footnote"><AlarmClock size={15}/> Recurring tasks schedule their next occurrence when completed. In-app reminders appear while CareerOS is open.</div>
    </>}
   </section>
  </main>
  {modalOpen&&<TaskModal key={editing?.id||'new'} task={editing} initialDate={newTaskDate} today={today} onClose={()=>{setModalOpen(false);setEditing(null);setNewTaskDate(null)}} onSave={saveTask} loading={loading}/>}
  {notice&&<div className="toast"><CheckCircle2 size={17}/>{notice}</div>}
 </div>;

}

function SummaryCard({icon:Icon,label,value,detail,tone}){return <div className="summary-card"><div className={`summary-icon ${tone}`}><Icon size={18}/></div><div className="summary-copy"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div></div>}
function TaskRow({task,onStatus,onEdit,onDelete}){
 const status=statusOf(task);const timeRange=task.start_time?`${timeValue(task.start_time)}${task.end_time?` – ${timeValue(task.end_time)}`:''}`:'';const recurrence=task.recurrence_rule&&task.recurrence_rule!=='none';
 return <article className={`task-row ${status==='completed'?'is-complete':''}`}>
  <button className={`task-check ${status==='completed'?'checked':''}`} onClick={()=>onStatus(status==='completed'?'todo':'completed')} aria-label={status==='completed'?'Mark incomplete':'Mark complete'}>{status==='completed'?<Check size={15}/>:null}</button>
  <div className="task-main"><div className="task-title-line"><h3>{task.title}</h3>{task.priority&&<span className={`priority ${task.priority.toLowerCase()}`}>{task.priority}</span>}</div>{task.notes&&<p className="task-notes">{task.notes}</p>}<div className="task-meta"><span className="category-tag">{task.category||'Other'}</span><span><CalendarDays size={13}/>{dateLabel(task.due_date)}</span>{timeRange&&<span><Clock3 size={13}/>{timeRange}</span>}{task.minutes&&<span><Clock3 size={13}/>{task.minutes} min</span>}{task.reminder_time&&!task.reminder_notified_at&&<span className="reminder-tag"><Bell size={12}/>{timeValue(task.reminder_time)}</span>}{recurrence&&<span><Repeat2 size={13}/>{task.recurrence_rule==='weekdays'?'Weekdays':task.recurrence_rule==='custom'?'Custom days':task.recurrence_rule}</span>}</div></div>
  <div className="task-actions"><select className={`status-select status-${status}`} value={status} onChange={e=>onStatus(e.target.value)} aria-label="Task status"><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="completed">Completed</option></select><button className="icon-btn" onClick={onEdit} title="Edit and reschedule"><Pencil size={15}/></button><button className="icon-btn danger-hover" onClick={onDelete} title="Delete task"><Trash2 size={15}/></button></div>
 </article>
}
function TaskModal({task,initialDate,today,onClose,onSave,loading}){
 const [repeat,setRepeat]=useState(task?.recurrence_rule||'none');const [selectedDays,setSelectedDays]=useState(Array.isArray(task?.recurrence_days)?task.recurrence_days.map(Number):[1,2,3,4,5]);const [hasReminder,setHasReminder]=useState(Boolean(task?.reminder_time));const [error,setError]=useState('');
 const submit=e=>{e.preventDefault();const f=new FormData(e.currentTarget);const title=String(f.get('title')||'').trim();if(!title){setError('Enter a task title.');return}if(repeat!=='none'&&!f.get('due_date')){setError('Choose a date for a recurring task.');return}if(repeat==='custom'&&!selectedDays.length){setError('Choose at least one day for a custom repeat.');return}if(f.get('start_time')&&f.get('end_time')&&f.get('end_time')<=f.get('start_time')){setError('End time must be later than start time.');return}
  const status=f.get('status')||statusOf(task||{});const item={title,notes:f.get('notes')||'',category:f.get('category'),priority:f.get('priority'),status,completed:status==='completed',due_date:f.get('due_date')||null,start_time:f.get('start_time')||null,end_time:f.get('end_time')||null,minutes:Number(f.get('minutes')||30),reminder_time:hasReminder?(f.get('reminder_time')||null):null,recurrence_rule:repeat,recurrence_days:repeat==='custom'?selectedDays:[],recurrence_end:f.get('recurrence_end')||null};onSave(item);
 };
 return <div className="modal-backdrop" onMouseDown={onClose}><div className="task-modal" onMouseDown={e=>e.stopPropagation()}><div className="modal-header"><div><span className="eyebrow">TASK DETAILS</span><h2>{task?'Edit and reschedule':'Create a task'}</h2></div><button className="icon-btn" onClick={onClose}><X size={19}/></button></div><form onSubmit={submit}>
  <label className="field-label">Task name<input name="title" required autoFocus defaultValue={task?.title||''} placeholder="What do you need to get done?"/></label>
  <label className="field-label">Notes <textarea name="notes" rows="2" defaultValue={task?.notes||''} placeholder="Add details or a checklist description…"/></label>
  <div className="form-two"><label className="field-label">Category<select name="category" defaultValue={task?.category||'Personal'}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><label className="field-label">Priority<select name="priority" defaultValue={task?.priority||'Medium'}><option>Low</option><option>Medium</option><option>High</option></select></label></div>
  <div className="form-two"><label className="field-label">Due date<input type="date" name="due_date" defaultValue={task?(task.due_date?String(task.due_date).slice(0,10):''):(initialDate||today)}/></label><label className="field-label">Estimated duration (min)<input type="number" name="minutes" min="1" max="1440" defaultValue={task?.minutes||30}/></label></div>
  <div className="form-two"><label className="field-label">Start time<input type="time" name="start_time" defaultValue={timeValue(task?.start_time)}/></label><label className="field-label">End time<input type="time" name="end_time" defaultValue={timeValue(task?.end_time)}/></label></div>
  {task&&<label className="field-label">Status<select name="status" defaultValue={statusOf(task)}><option value="todo">To Do</option><option value="in_progress">In Progress</option><option value="completed">Completed</option></select></label>}
  <div className="reminder-control"><div><b><Bell size={15}/> In-app reminder</b><small>Show a reminder when the scheduled time arrives while CareerOS is open.</small></div><button type="button" className={`switch ${hasReminder?'on':''}`} onClick={()=>setHasReminder(v=>!v)} aria-label="Toggle reminder"><i/></button></div>
  {hasReminder&&<label className="field-label">Remind me at<input type="time" name="reminder_time" required defaultValue={timeValue(task?.reminder_time)||'09:00'}/></label>}
  <div className="repeat-section"><label className="field-label">Repeat<select value={repeat} onChange={e=>setRepeat(e.target.value)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option><option value="custom">Custom days</option></select></label>{repeat==='custom'&&<div className="weekday-picker">{weekDays.map(([label,day])=><button type="button" key={day} className={selectedDays.includes(day)?'day-chip active':'day-chip'} onClick={()=>setSelectedDays(old=>old.includes(day)?old.filter(d=>d!==day):[...old,day])}>{label}</button>)}</div>}{repeat!=='none'&&<label className="field-label recurrence-end">Repeat until (optional)<input type="date" name="recurrence_end" defaultValue={String(task?.recurrence_end||'').slice(0,10)}/></label>}</div>
  {error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={loading}>{loading?'Saving…':task?'Save changes':'Add task'}</button></div>
 </form></div></div>
}

createRoot(document.getElementById('root')).render(<App/>);
