import { useState, useEffect, useCallback, useRef } from 'react';
import { db, ref, onValue, set, remove, update } from './firebase';
import { getUser, initTelegram, haptic, hapticNotify, loginWithTelegram, loginWithGoogle, loginSimple, linkTelegram, linkGoogle, checkGoogleRedirect, isTgWebApp, logout, type AppUser, type TelegramLoginUser } from './auth';
import { getIconSrc, getExt } from './icons';

/* Unity Editor dark theme palette */
const T = {
  bg: '#282828',       // main background
  bgDark: '#191919',   // header / section headers
  bgMid: '#303030',    // content area
  bgRow: '#383838',    // alternating rows / hover
  bgPanel: '#353535',  // panels
  bgInput: '#3F3F3F',  // inputs / menus
  border: '#232323',   // subtle borders
  borderMid: '#303030',// button borders
  borderLight: '#3C3C3C',
  text: '#D2D2D2',     // primary text
  textBright: '#EEE',  // emphasized text
  textDim: '#7A7A7A',  // secondary text
  textMuted: '#585858', // muted / disabled
  accent: '#7BAEFA',   // selection / links
  accentGreen: '#58B258',
  accentOrange: '#E8A04C',
  accentRed: '#D35555',
  lockRed: '#D32222',
  iconLight: '#C0C0C0',
  font: "Inter,'Segoe UI',system-ui,sans-serif",
  monoFont: "Consolas,monospace",
} as const;

const toKey = (s: string) => String(s).replace(/[.\/]/g, '~');
const toName = (s: string) => { const parts = s.replace(/\\/g, '/').split('/'); return parts[parts.length - 1] || parts[parts.length - 2] || s; };

interface FileData {
  name: string; ownerId: number; ownerName: string; ownerUsername?: string;
  ownerColor: string; watchers: Record<string, { name: string; color: string }>; since: number;
}
interface FilesMap { [key: string]: FileData }
const COLORS = ['#4A90D9','#E8A04C','#B07ACC','#D35555','#5AAFAF','#8BC34A','#FF7043','#AB47BC'];
const CL = 3;

function FIcon({ext,size=16}:{ext:string;size?:number}) {
  return <img src={getIconSrc(ext)} alt={ext} width={size} height={size} className="shrink-0 block" />;
}
function Av({user,size=18}:{user:{name:string;color:string;photo?:string};size?:number}) {
  const [imgOk, setImgOk] = useState(true);
  if (user.photo && imgOk) return <img src={user.photo} alt={user.name[0]} width={size} height={size} onError={()=>setImgOk(false)} className="shrink-0 block rounded-full" style={{width:size,height:size,objectFit:'cover'}}/>;
  return <span className="shrink-0 inline-flex items-center justify-center rounded-full font-bold text-white" style={{width:size,height:size,background:user.color,fontSize:size*.55}}>{user.name[0]}</span>;
}
function LkIco({size=13}:{size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" className="shrink-0 block"><rect x="2" y="7" width="12" height="8" rx="1.5" fill="#D32222" opacity=".85"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#D32222" strokeWidth="1.5" strokeLinecap="round" opacity=".85"/></svg>;
}
function BellIco({active,onClick,size=15}:{active:boolean;onClick?:()=>void;size?:number}) {
  return <svg width={size} height={size} viewBox="0 0 16 16" onClick={e=>{e.stopPropagation();onClick?.();}} className="shrink-0 block transition-opacity" style={{opacity:active?.95:.18,cursor:onClick?"pointer":"default"}}><path d="M8 1.5A4 4 0 0 0 4 5.5v2.5L2.5 10.5h11L12 8V5.5A4 4 0 0 0 8 1.5z" fill={active?"#E8A04C":"#D2D2D2"}/><ellipse cx="8" cy="13" rx="1.5" ry="1" fill={active?"#E8A04C":"#D2D2D2"}/></svg>;
}
function Chev({open}:{open:boolean}) {
  return <svg width={10} height={10} viewBox="0 0 16 16" className="shrink-0" style={{transform:open?"rotate(180deg)":"",transition:"transform .15s"}}><path d="M4 6l4 4 4-4" fill="none" stroke="#7A7A7A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function fmt(ts:number){const d=new Date(ts);return d.getHours().toString().padStart(2,"0")+":"+d.getMinutes().toString().padStart(2,"0");}
function dn(name:string,username?:string){return username?`@${username}`:name;}

const TEAM_PASS = 'alb2025'; // change and redeploy to update

function LoginScreen({onLogin}:{onLogin:(u:AppUser)=>void}) {
  const wRef = useRef<HTMLDivElement>(null);
  const [gLoading, setGLoading] = useState(false);
  const [simpleName, setSimpleName] = useState('');
  const [passOk, setPassOk] = useState(() => localStorage.getItem('alb_pass') === TEAM_PASS);
  const [passInput, setPassInput] = useState('');
  const [passErr, setPassErr] = useState(false);
  useEffect(() => {
    (window as any).onTelegramAuth = (tgUser: TelegramLoginUser) => onLogin(loginWithTelegram(tgUser));
    if (wRef.current && !wRef.current.querySelector('script')) {
      const s = document.createElement('script');
      s.src = 'https://telegram.org/js/telegram-widget.js?22';
      s.setAttribute('data-telegram-login', 'asset_lock_board_bot');
      s.setAttribute('data-size', 'medium');
      s.setAttribute('data-onauth', 'onTelegramAuth(user)');
      s.setAttribute('data-request-access', 'write');
      s.async = true;
      wRef.current.appendChild(s);
    }
  }, [onLogin]);
  const handleGoogle = async () => {
    setGLoading(true);
    try { const u = await loginWithGoogle(); if (u) onLogin(u); } catch(e) { console.error(e); setGLoading(false); }
  };
  const checkPass = () => {
    if (passInput === TEAM_PASS) { localStorage.setItem('alb_pass', TEAM_PASS); setPassOk(true); setPassErr(false); }
    else setPassErr(true);
  };
  const handleSimple = () => {
    const name = simpleName.trim();
    if (name.length < 2 || !/^[\p{L}\s\-'.]+$/u.test(name)) return;
    onLogin(loginSimple(name));
  };
  const inTg = isTgWebApp();
  return (
    <div style={{minHeight:'100vh',background:'#282828',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:"Inter,'Segoe UI',system-ui,sans-serif",gap:12}}>
      <svg width={40} height={40} viewBox="0 0 32 32"><rect x="4" y="6" width="16" height="20" rx="2" fill="#4A90D9" opacity=".35"/><rect x="8" y="3" width="16" height="20" rx="2" fill="#4A90D9" opacity=".6"/><rect x="12" y="0" width="16" height="20" rx="2" fill="#4A90D9"/><rect x="17" y="8" width="6" height="5" rx="1" fill="#282828"/><path d="M19 8V6.5a1.5 1.5 0 013 0V8" fill="none" stroke="#282828" strokeWidth="1.2" strokeLinecap="round"/></svg>
      <div style={{fontSize:16,color:'#D2D2D2',fontWeight:600,marginBottom:4}}>Asset Lock Board</div>
      {!passOk?<>
        <div style={{display:'flex',gap:6,width:250}}>
          <input value={passInput} onChange={e=>{setPassInput(e.target.value);setPassErr(false);}} onKeyDown={e=>{if(e.key==='Enter')checkPass();}} placeholder="Team password" type="password" style={{flex:1,height:36,borderRadius:6,border:`1px solid ${passErr?'#D35555':'#505050'}`,background:'#3F3F3F',color:'#EEE',fontSize:14,padding:'0 10px',outline:'none'}}/>
          <button onClick={checkPass} style={{height:36,borderRadius:6,border:'none',background:'#4A90D9',color:'#fff',fontSize:13,fontWeight:600,padding:'0 16px',cursor:'pointer'}}>&rarr;</button>
        </div>
        {passErr&&<div style={{fontSize:11,color:'#D35555',marginTop:2}}>Wrong password</div>}
      </>:<>
      <div style={{display:'flex',gap:6,width:250}}>
        <input value={simpleName} onChange={e=>setSimpleName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSimple();}} placeholder="Your name" style={{flex:1,height:36,borderRadius:6,border:'1px solid #505050',background:'#3F3F3F',color:'#EEE',fontSize:14,padding:'0 10px',outline:'none'}}/>
        <button onClick={handleSimple} disabled={simpleName.trim().length<2||!/^[\p{L}\s\-'.]+$/u.test(simpleName.trim())} style={{height:36,borderRadius:6,border:'none',background:simpleName.trim().length>=2?'#4A90D9':'#3F3F3F',color:simpleName.trim().length>=2?'#fff':'#585858',fontSize:13,fontWeight:600,padding:'0 16px',cursor:simpleName.trim().length>=2?'pointer':'default'}}>Enter</button>
      </div>
      {!inTg && <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,marginTop:12}}>
        <div style={{display:'flex',alignItems:'center',gap:8,width:250}}><div style={{flex:1,borderTop:'1px solid #3F3F3F'}}/><span style={{fontSize:9,color:'#585858',whiteSpace:'nowrap'}}>or connect for notifications</span><div style={{flex:1,borderTop:'1px solid #3F3F3F'}}/></div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button onClick={handleGoogle} disabled={gLoading} style={{display:'flex',alignItems:'center',gap:6,height:32,borderRadius:16,border:'none',background:'#3F3F3F',color:'#AAA',fontSize:12,cursor:gLoading?'wait':'pointer',padding:'0 12px'}}>
            <svg width={14} height={14} viewBox="0 0 48 48"><path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#888"/></svg>
            Google
          </button>
          <div ref={wRef} style={{transform:'scale(0.85)',transformOrigin:'center'}}/>
        </div>
      </div>}
      {inTg && <div ref={wRef}/>}
      </>}
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<AppUser | null>(getUser);
  const [files, setFiles] = useState<FilesMap>({});
  const [saved, setSaved] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [notif, setNotif] = useState<string|null>(null);
  const [expanded, setExpanded] = useState<Record<number,boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const [notifyPref, setNotifyPref] = useState<'both'|'browser'|'telegram'|'off'>(() => (localStorage.getItem('alb_notify') as any) || 'both');
  const tRef = useRef<ReturnType<typeof setTimeout>>();
  const prevFilesRef = useRef<FilesMap>({});
  const browserNotify = notifyPref === 'both' || notifyPref === 'browser';

  /* All hooks BEFORE conditional return */
  useEffect(() => {
    if (browserNotify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }, [browserNotify]);

  useEffect(() => {
    if (!me) { checkGoogleRedirect().then(u => { if (u) setMe(u); }); }
  }, []);

  const flash = useCallback((m: string) => {
    setNotif(m); clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setNotif(null), 2500);
  }, []);

  useEffect(() => {
    if (!me) return;
    initTelegram();
    const unsubFiles = onValue(ref(db, 'files'), snap => {
      const cur = (snap.val() || {}) as FilesMap;
      setFiles(cur);
      const prev = prevFilesRef.current;
      if (browserNotify && 'Notification' in window && Notification.permission === 'granted' && Object.keys(prev).length > 0) {
        const lines: string[] = [];
        for (const [k, p] of Object.entries(prev)) {
          if (!cur[k] && p.watchers?.[me.id]) lines.push('\u{1F513} ' + p.name + ' свободен');
        }
        for (const [k, c] of Object.entries(cur)) {
          if (c.ownerId === me.id && prev[k]) {
            for (const w of Object.keys(c.watchers || {})) {
              if (!prev[k]?.watchers?.[w]) lines.push('\u{1F514} ' + (c.watchers[w]?.name || '?') + ' ожидает ' + c.name);
            }
          }
        }
        if (lines.length) new Notification('Asset Lock Board', { body: lines.join('\n'), icon: '/asset-lock-board/icon.svg' });
      }
      prevFilesRef.current = cur;
    });
    const unsubSaved = onValue(ref(db, 'saved'), snap => setSaved(Object.values(snap.val() || {}) as string[]));
    return () => { unsubFiles(); unsubSaved(); };
  }, [me]);

  /* Save user profile for Unity lookup + fetch photo from bot */
  useEffect(() => {
    if (!me) return;
    const userRef = ref(db, `users/${me.id}`);
    // Write name/username/color but never overwrite photo (bot manages it)
    const profileData: Record<string, string> = { name: me.name, username: me.username || '', color: me.color };
    // Use update instead of set to preserve existing photo from bot
    update(ref(db), Object.fromEntries(Object.entries(profileData).map(([k, v]) => [`users/${me.id}/${k}`, v])));
    // Read back (bot may have saved a working photo URL)
    const unsub = onValue(userRef, snap => {
      const data = snap.val();
      console.log('[ALB] Firebase user profile:', JSON.stringify(data));
      if (data?.photo && data.photo !== me.photo) {
        console.log('[ALB] Got photo from bot:', data.photo);
        const updated = { ...me, photo: data.photo };
        setMe(updated);
        localStorage.setItem('alb_user', JSON.stringify(updated));
      }
    });
    return () => unsub();
  }, [me?.id]);

  if (!me) return <LoginScreen onLogin={setMe} />;

  /* Actions (not hooks, safe after conditional) */
  const addFiles = async (names: string[]) => {
    const updates: Record<string, any> = {};
    let locked: string[] = [], taken: string[] = [];
    for (const raw of names) {
      const n = toName(raw);
      const k = toKey(n);
      updates[`saved/${k}`] = n;
      const existing = files[k];
      if (existing) {
        if (existing.ownerId !== me.id) {
          updates[`files/${k}/watchers/${me.id}`] = { name: me.name, color: me.color };
          locked.push(n);
        }
      } else {
        updates[`files/${k}`] = { name: n, ownerId: me.id, ownerName: me.name, ownerUsername: me.username || '', ownerColor: me.color, watchers: {}, since: Date.now() };
        taken.push(n);
      }
    }
    await update(ref(db), updates);
    setSel(new Set()); setInput('');
    const msgs: string[] = [];
    if (taken.length) msgs.push('Busy: ' + taken.join(', '));
    if (locked.length) msgs.push('Watching: ' + locked.join(', '));
    if (msgs.length) { flash(msgs.join(' | ')); haptic(taken.length ? 'medium' : 'light'); }
    setAddOpen(false);
  };

  const submit = () => { const fi = input.split(/[,;\n]+/).map(s=>toName(s.trim())).filter(s=>s); const all = [...new Set([...fi,...sel])]; if (all.length) addFiles(all); };
  const freeFile = async (n:string) => { const k=toKey(n); if(!files[k])return; await remove(ref(db,`files/${k}`)); flash(n+' free'); hapticNotify('success'); };
  const freeAll = async () => { const u:Record<string,null>={}; Object.entries(files).forEach(([k,f])=>{if(f.ownerId===me.id)u[`files/${k}`]=null;}); await update(ref(db),u); flash('All freed'); hapticNotify('success'); };
  const toggleWatch = async (n:string) => { const k=toKey(n);const f=files[k]; if(!f||f.ownerId===me.id)return; const wr=ref(db,`files/${k}/watchers/${me.id}`); if(f.watchers?.[me.id])await remove(wr); else await set(wr,{name:me.name,color:me.color}); haptic('light'); };
  const isW = (k:string) => !!files[k]?.watchers?.[me.id];
  const togSel = (n:string) => setSel(p=>{const s=new Set(p);s.has(n)?s.delete(n):s.add(n);return s;});
  const rmSaved = async (n:string) => { await remove(ref(db,`saved/${toKey(n)}`)); setSel(p=>{const s=new Set(p);s.delete(n);return s;}); };
  const togExp = (id:number) => setExpanded(p=>({...p,[id]:!p[id]}));

  const togglePip = async () => {
    if (pipWin) { pipWin.close(); setPipWin(null); return; }
    if (!('documentPictureInPicture' in window)) return;
    const pip = await (window as any).documentPictureInPicture.requestWindow({ width: 340, height: 480 });
    const style = pip.document.createElement('style');
    style.textContent = 'html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#282828}';
    pip.document.head.appendChild(style);
    const iframe = pip.document.createElement('iframe');
    iframe.src = window.location.href;
    iframe.style.cssText = 'width:100%;height:100%;border:none;display:block;';
    pip.document.body.appendChild(iframe);
    pip.addEventListener('pagehide', () => setPipWin(null));
    setPipWin(pip);
  };

  const entries = Object.entries(files);
  const mine = entries.filter(([,f])=>f.ownerId===me.id);
  const ghosts = entries.filter(([,f])=>f.ownerId!==me.id&&!!f.watchers?.[me.id]);
  const others = entries.filter(([,f])=>f.ownerId!==me.id);
  const typed = input.split(/[,;\n]+/).map(s=>toName(s.trim())).filter(s=>s);
  const hasAny = typed.length>0||sel.size>0;

  const grouped:Record<number,{owner:{id:number;name:string;username?:string;color:string};files:[string,FileData][]}> = {};
  others.forEach(([k,f])=>{const id=f.ownerId;if(!grouped[id])grouped[id]={owner:{id,name:f.ownerName,username:f.ownerUsername,color:f.ownerColor},files:[]};grouped[id].files.push([k,f]);});
  const groups = Object.values(grouped).sort((a,b)=>b.files.length-a.files.length);
  const rowStyle="grid items-center",hoverClass="hover:bg-[#383838]";

  return (
    <div className="min-h-screen relative" style={{background:"#282828",fontFamily:"Inter,'Segoe UI',system-ui,sans-serif"}}>
      <div className="flex items-center gap-1.5" style={{height:'env(titlebar-area-height, 32px)',background:"#191919",borderBottom:"1px solid #232323",WebkitAppRegion:'drag' as any,appRegion:'drag' as any,position:'fixed',top:'env(titlebar-area-y, 0)',left:'env(titlebar-area-x, 0)',width:'env(titlebar-area-width, 100%)',zIndex:30,paddingLeft:8,paddingRight:8,boxSizing:'border-box'}}>
        <LkIco size={13}/><span className="flex-1 font-semibold truncate" style={{fontSize:12,color:"#D2D2D2",minWidth:0}}>Lock Board</span>
        <span style={{fontSize:9,color:"#7A7A7A",background:"#3F3F3F",padding:"1px 5px",borderRadius:3,lineHeight:"16px",WebkitAppRegion:'no-drag' as any}}>{entries.length}</span>
        {'documentPictureInPicture' in window && <svg onClick={togglePip} width={18} height={18} viewBox="0 0 16 16" className="shrink-0 cursor-pointer" style={{WebkitAppRegion:'no-drag' as any}} title="Pin on top"><rect x="1" y="5" width="10" height="10" rx="1.5" fill="none" stroke={pipWin?"#7BAEFA":"#C0C0C0"} strokeWidth="1.3"/><path d={`M7 9L14 2M14 2H10M14 2v4`} fill="none" stroke={pipWin?"#7BAEFA":"#C0C0C0"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
        <div className="relative" style={{WebkitAppRegion:'no-drag' as any,zIndex:50}}>
          <div onClick={()=>{if(!menuOpen){setEditName(me.name);setEditColor(me.color);}setMenuOpen(!menuOpen);}} className="flex items-center gap-1.5 cursor-pointer" style={{padding:"2px 6px",borderRadius:4,height:24,background:menuOpen?"#3F3F3F":"transparent"}}>
            <Av user={me} size={20}/><span style={{fontSize:11,color:"#D2D2D2",maxWidth:90}} className="truncate">{dn(me.name,me.username)}</span>
            <svg width={8} height={8} viewBox="0 0 16 16" style={{transform:menuOpen?"rotate(180deg)":"",transition:"transform .15s"}}><path d="M3 5h10L8 11z" fill="#7A7A7A"/></svg>
          </div>
          {menuOpen&&<><div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0}}/><div style={{position:"absolute",right:0,top:28,background:"#3F3F3F",border:"1px solid #505050",borderRadius:6,padding:4,zIndex:1,minWidth:140,boxShadow:"0 6px 16px rgba(0,0,0,.5)"}}>
            <div style={{padding:"6px 10px",borderBottom:"1px solid #505050",marginBottom:2}}>
              <div className="flex items-center gap-2" style={{marginBottom:4}}>
                <div onClick={()=>{const c=COLORS;const i=(c.indexOf(editColor)+1)%c.length;setEditColor(c[i]);}} className="cursor-pointer shrink-0"><Av user={{name:editName||me.name,color:editColor,photo:me.photo}} size={28}/></div>
                <input value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}} style={{flex:1,background:'#353535',border:'1px solid #505050',borderRadius:3,color:'#EEE',fontSize:11,outline:'none',padding:'3px 6px'}}/>
              </div>
              {!me.photo&&<div className="flex gap-1 flex-wrap" style={{marginBottom:4}}>{COLORS.map(c=><div key={c} onClick={()=>setEditColor(c)} className="cursor-pointer" style={{width:14,height:14,borderRadius:7,background:c,border:editColor===c?'2px solid #EEE':'2px solid transparent'}}/>)}</div>}
              {(editName.trim()!==me.name||editColor!==me.color)&&editName.trim().length>=2&&/^[\p{L}\s\-'.]+$/u.test(editName.trim())&&<button onClick={async()=>{const n=editName.trim();const u={...me,name:n,color:editColor};setMe(u);localStorage.setItem('alb_user',JSON.stringify(u));const ups:Record<string,any>={[`users/${me.id}/name`]:n,[`users/${me.id}/color`]:editColor};Object.entries(files).forEach(([k,f])=>{if(f.ownerId===me.id){ups[`files/${k}/ownerName`]=n;ups[`files/${k}/ownerColor`]=editColor;}});await update(ref(db),ups);}} style={{width:'100%',height:20,borderRadius:3,border:'none',background:'#4A90D9',color:'#fff',fontSize:10,fontWeight:600,cursor:'pointer',marginBottom:2}}>Save</button>}
              {me.username&&<div style={{fontSize:10,color:"#7A7A7A"}}>@{me.username}</div>}
            </div>
            <div style={{padding:"4px 10px",fontSize:10,color:"#7A7A7A",marginBottom:2}}>Notifications</div>
            {(['both','browser','telegram','off'] as const).map(p=><div key={p} onClick={()=>{setNotifyPref(p);localStorage.setItem('alb_notify',p);update(ref(db),{[`users/${me.id}/notifyPref`]:p});}} className="cursor-pointer flex items-center gap-2" style={{padding:"4px 10px",fontSize:11,color:notifyPref===p?"#7BAEFA":"#D2D2D2",borderRadius:3,background:notifyPref===p?"#46607C":"transparent"}} onMouseEnter={e=>{if(notifyPref!==p)e.currentTarget.style.background="#4A4A4A"}} onMouseLeave={e=>{if(notifyPref!==p)e.currentTarget.style.background="transparent"}}><span style={{width:14,textAlign:'center'}}>{notifyPref===p?'●':'○'}</span>{{both:'Browser + Telegram',browser:'Browser only',telegram:'Telegram only',off:'Off'}[p]}</div>)}
            <div style={{borderTop:"1px solid #505050",marginTop:4,paddingTop:4}}/>
            {me.id>1e12&&<>
              <div style={{padding:"4px 10px",fontSize:10,color:"#7A7A7A",marginBottom:2}}>Connect account</div>
              <div onClick={async()=>{const u=await linkGoogle(me);if(u)setMe(u);}} className="cursor-pointer flex items-center gap-2" style={{padding:"4px 10px",fontSize:11,color:"#D2D2D2",borderRadius:3}} onMouseEnter={e=>e.currentTarget.style.background="#4A4A4A"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <svg width={12} height={12} viewBox="0 0 48 48"><path d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#888"/></svg>
                Google
              </div>
              <div onClick={()=>window.open(`https://t.me/asset_lock_board_bot?start=link_${me.id}`,'_blank')} className="cursor-pointer flex items-center gap-2" style={{padding:"4px 10px",fontSize:11,color:"#D2D2D2",borderRadius:3}} onMouseEnter={e=>e.currentTarget.style.background="#4A4A4A"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <svg width={12} height={12} viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.66-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.42-.88.03-.24.37-.49 1.02-.74 3.98-1.73 6.63-2.87 7.97-3.44 3.8-1.58 4.59-1.86 5.1-1.87.11 0 .37.03.54.17.14.12.18.28.2.47-.01.06.01.24 0 .38z" fill="#888"/></svg>
                Telegram
              </div>
              <div style={{borderTop:"1px solid #505050",marginTop:4,paddingTop:4}}/>
            </>}
            <div onClick={()=>{logout();setMe(null);setMenuOpen(false);}} className="cursor-pointer" style={{padding:"6px 10px",fontSize:11,color:"#D35555",borderRadius:4}} onMouseEnter={e=>(e.currentTarget.style.background="#4A4A4A")} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>Log out</div>
          </div></>}
        </div>
      </div>
      {notif&&<div style={{background:"#2D5A3D",color:"#A8E6A1",fontSize:10,padding:"2px 6px",textAlign:"center"}}>{notif}</div>}
      <div style={{paddingTop:'env(titlebar-area-height, 32px)'}}>
      <div style={{background:"#303030"}}>
        {entries.length===0&&<div style={{padding:16,textAlign:"center",color:"#585858",fontSize:11}}>No active files</div>}
        {(mine.length>0||ghosts.length>0)&&<>
          <div className="flex items-center justify-between" style={{padding:"4px 6px 2px",background:"#282828"}}>
            <span style={{fontSize:9,fontWeight:600,color:"#7A7A7A",textTransform:"uppercase",letterSpacing:".04em"}}>Your files ({mine.length}){ghosts.length>0&&<span style={{color:"#E8A04C"}}> +{ghosts.length}</span>}</span>
            {mine.length>1&&<button onClick={freeAll} style={{height:14,padding:"0 5px",borderRadius:3,border:"1px solid #303030",background:"#585858",color:"#EEE",fontSize:9,cursor:"pointer",lineHeight:"12px"}}>Free All</button>}
          </div>
          {mine.map(([k,f],i)=><div key={k} className={`${rowStyle} ${hoverClass}`} style={{gridTemplateColumns:"18px 1fr 20px 32px 42px",height:18,padding:"0 6px",columnGap:3,background:i%2?"#383838":"transparent"}}>
            <FIcon ext={getExt(f.name)} size={16}/><span className="truncate" style={{fontSize:11,color:"#EEE"}}>{f.name}</span>
            <div className="flex justify-center">{Object.keys(f.watchers||{}).length>0&&<BellIco active size={13}/>}</div>
            <span style={{fontSize:9,color:"#7A7A7A",textAlign:"right"}}>{fmt(f.since)}</span>
            <button onClick={()=>freeFile(f.name)} style={{height:14,borderRadius:3,border:"1px solid #303030",background:"#585858",color:"#EEE",fontSize:9,cursor:"pointer",padding:0}}>Free</button>
          </div>)}
          {ghosts.map(([k,f],i)=><div key={k} className={rowStyle} style={{gridTemplateColumns:"14px 18px 1fr 20px 18px 38px",height:18,padding:"0 6px",columnGap:3,opacity:.45,background:(mine.length+i)%2?"#383838":"transparent"}}>
            <LkIco size={11}/><FIcon ext={getExt(f.name)} size={16}/><span className="truncate" style={{fontSize:11,color:"#EEE"}}>{f.name}</span>
            <div className="flex justify-center"><BellIco active onClick={()=>toggleWatch(f.name)} size={13}/></div>
            <Av user={{name:f.ownerName,color:f.ownerColor}} size={15}/><span className="truncate" style={{fontSize:10,color:f.ownerColor,fontWeight:600}}>{dn(f.ownerName,f.ownerUsername)}</span>
          </div>)}
        </>}
        <div className="flex justify-end" style={{padding:"4px 6px"}}>
          <div onClick={()=>{setAddOpen(!addOpen);haptic('light');}} className="flex items-center cursor-pointer" style={{padding:"2px"}}><svg width={22} height={22} viewBox="0 0 16 16" style={{display:'block'}}><path d="M8 3v10M3 8h10" stroke="#C0C0C0" strokeWidth="2" strokeLinecap="round"/><path d="M11 12l2.5 3 2.5-3z" fill="#C0C0C0"/></svg></div>
        </div>
        {addOpen&&<div style={{padding:"4px 6px",background:"#353535",borderTop:"1px solid #282828",borderBottom:"1px solid #282828"}}>
          <textarea rows={2} placeholder="Level_05.unity, Rock.prefab" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}}} style={{width:"100%",boxSizing:"border-box",padding:"4px 6px",background:"#3F3F3F",border:"1px solid #232323",borderRadius:3,color:"#D2D2D2",fontSize:11,fontFamily:"Consolas,monospace",resize:"none",outline:"none",lineHeight:"16px"}}/>
          {typed.length>0&&<div style={{marginTop:2}}>{typed.map((n,i)=>{const k=toKey(n);const b=files[k]&&files[k].ownerId!==me.id;const m=files[k]&&files[k].ownerId===me.id;return<div key={i} className="flex items-center gap-1" style={{height:18}}><FIcon ext={getExt(n)} size={14}/><span className="flex-1" style={{fontSize:11,color:b?"#E8A04C":m?"#58B258":"#D2D2D2"}}>{n}</span>{b&&<><BellIco active size={12}/><span style={{fontSize:9,color:"#E8A04C",fontWeight:600}}>{dn(files[k].ownerName,files[k].ownerUsername)}</span></>}{m&&<span style={{fontSize:9,color:"#58B258"}}>yours</span>}</div>;})}</div>}
          <div style={{fontSize:9,fontWeight:600,color:"#7A7A7A",textTransform:"uppercase",marginTop:4,marginBottom:2}}>Saved</div>
          <div className="flex flex-wrap gap-0.5">{saved.map(n=>{const k=toKey(n);const act=files[k];const im=act&&act.ownerId===me.id;const on=sel.has(n);return<div key={n} onClick={()=>togSel(n)} className="flex items-center gap-1 cursor-pointer" style={{padding:"2px 4px",background:on?"#46607C":"#3F3F3F",borderRadius:3,border:`1px solid ${on?"#7BAEFA":"transparent"}`,opacity:im?.5:1}}><FIcon ext={getExt(n)} size={13}/><span style={{fontSize:10,color:"#D2D2D2"}}>{n.replace(/\.[^.]+$/,"")}</span><span style={{fontSize:9,color:"#7A7A7A"}}>.{getExt(n)}</span>{act&&!im&&<LkIco size={9}/>}{on&&<span style={{fontSize:9,color:"#7BAEFA",fontWeight:700}}>✓</span>}<button onClick={e=>{e.stopPropagation();rmSaved(n);}} style={{background:"none",border:"none",color:"#585858",fontSize:11,cursor:"pointer",padding:"0 1px",lineHeight:1}}>×</button></div>;})}</div>
          {hasAny&&<button onClick={submit} style={{width:"100%",height:26,borderRadius:4,border:"1px solid #303030",background:"#46607C",color:"#EEE",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4}}>🔒 Busy ({[...new Set([...typed,...sel])].length})</button>}
        </div>}
        {groups.length>0&&<div className="flex items-center" style={{padding:"6px 6px 2px"}}><span style={{fontSize:9,fontWeight:600,color:"#7A7A7A",textTransform:"uppercase",letterSpacing:".04em"}}>Locked ({others.length})</span></div>}
        {groups.map(g=>{const uid=g.owner.id;const isExp=!!expanded[uid];const vis=isExp?g.files:g.files.slice(0,CL);const more=g.files.length>CL;return<div key={uid} style={{borderTop:"1px solid #3C3C3C",marginTop:2}}>
          <div className={`flex items-center gap-1.5 cursor-pointer ${hoverClass}`} style={{padding:"4px 6px",background:"#282828"}} onClick={()=>more&&togExp(uid)}>
            <span style={{fontSize:10,color:"#7A7A7A"}}>{g.files.length}</span>{more&&<Chev open={isExp}/>}<div className="flex-1"/>
            <span className="font-semibold" style={{fontSize:11,color:g.owner.color}}>{dn(g.owner.name,g.owner.username)}</span><Av user={g.owner} size={18}/>
          </div>
          {vis.map(([k,f],i)=><div key={k} className={`${rowStyle} ${hoverClass}`} style={{gridTemplateColumns:"13px 16px 1fr 20px",height:18,padding:"0 4px 0 14px",columnGap:3,background:i%2?"#383838":"transparent"}}>
            <LkIco size={11}/><FIcon ext={getExt(f.name)} size={14}/><span className="truncate" style={{fontSize:11,color:"#D2D2D2"}}>{f.name}</span>
            <div className="flex justify-center"><BellIco active={isW(k)} onClick={()=>toggleWatch(f.name)} size={13}/></div>
          </div>)}
          {more&&!isExp&&<div className="cursor-pointer" style={{padding:"1px 14px 3px",fontSize:10,color:"#7BAEFA",background:"#282828"}} onClick={()=>togExp(uid)}>+ {g.files.length-CL} more</div>}
        </div>;})}
      </div>
    </div>
    </div>
  );
}
