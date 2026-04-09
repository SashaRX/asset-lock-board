import { useState, useEffect, useCallback, useRef } from 'react';
import { db, ref, onValue, set, remove, update, get } from './firebase';
import { getUser, initTelegram, haptic, hapticNotify, type AppUser } from './telegram';
import { getIconSrc, getExt } from './icons';

/* ─── Firebase key encoding (dots not allowed in keys) ─── */
const toKey = (s: string) => s.replace(/\./g, '~');
const fromKey = (s: string) => s.replace(/~/g, '.');

/* ─── Types ─── */
interface FileData {
  name: string;
  ownerId: number;
  ownerName: string;
  ownerColor: string;
  watchers: Record<string, { name: string; color: string }>;
  since: number;
}
interface FilesMap { [key: string]: FileData }

const CL = 3;

/* ─── SVG Icons ─── */
function FIcon({ext,size=16}:{ext:string;size?:number}) {
  return <img src={getIconSrc(ext)} alt={ext} width={size} height={size} className="shrink-0 block" />;
}
function Av({user,size=18}:{user:{name:string;color:string};size?:number}) {
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

/* ─── Main App ─── */
export default function App() {
  const [me] = useState<AppUser>(getUser);
  const [files, setFiles] = useState<FilesMap>({});
  const [saved, setSaved] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [notif, setNotif] = useState<string|null>(null);
  const [expanded, setExpanded] = useState<Record<number,boolean>>({});
  const tRef = useRef<ReturnType<typeof setTimeout>>();

  const flash = useCallback((m: string) => {
    setNotif(m); clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setNotif(null), 2500);
  }, []);

  /* ─── Firebase listeners ─── */
  useEffect(() => {
    initTelegram();
    const filesRef = ref(db, 'files');
    const savedRef = ref(db, 'saved');

    const unsubFiles = onValue(filesRef, snap => {
      const data = snap.val() || {};
      setFiles(data as FilesMap);
    });

    const unsubSaved = onValue(savedRef, snap => {
      const data = snap.val() || {};
      setSaved(Object.values(data) as string[]);
    });

    return () => { unsubFiles(); unsubSaved(); };
  }, []);

  /* ─── Actions (write to Firebase) ─── */
  const addFiles = async (names: string[]) => {
    const updates: Record<string, any> = {};
    let locked: string[] = [], taken: string[] = [];

    for (const n of names) {
      const k = toKey(n);
      // Save to saved list
      updates[`saved/${k}`] = n;

      const existing = files[k];
      if (existing) {
        if (existing.ownerId !== me.id) {
          // File locked — subscribe as watcher
          updates[`files/${k}/watchers/${me.id}`] = { name: me.name, color: me.color };
          locked.push(n);
        }
      } else {
        // File free — take it
        updates[`files/${k}`] = {
          name: n,
          ownerId: me.id,
          ownerName: me.name,
          ownerColor: me.color,
          watchers: {},
          since: Date.now(),
        };
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

  const submit = () => {
    const fi = input.split(/[,;\n]+/).map(s => s.trim()).filter(s => s && s.includes('.'));
    const all = [...new Set([...fi, ...sel])];
    if (all.length) addFiles(all);
  };

  const freeFile = async (n: string) => {
    const k = toKey(n);
    const f = files[k];
    if (!f) return;
    // Notify watchers will happen via bot webhook
    await remove(ref(db, `files/${k}`));
    flash(n + ' free');
    hapticNotify('success');
  };

  const freeAll = async () => {
    const updates: Record<string, null> = {};
    Object.entries(files).forEach(([k, f]) => {
      if (f.ownerId === me.id) updates[`files/${k}`] = null;
    });
    await update(ref(db), updates);
    flash('All freed');
    hapticNotify('success');
  };

  const toggleWatch = async (n: string) => {
    const k = toKey(n);
    const f = files[k];
    if (!f || f.ownerId === me.id) return;
    const watcherRef = ref(db, `files/${k}/watchers/${me.id}`);
    if (f.watchers?.[me.id]) {
      await remove(watcherRef);
    } else {
      await set(watcherRef, { name: me.name, color: me.color });
    }
    haptic('light');
  };

  const isW = (k: string) => !!files[k]?.watchers?.[me.id];
  const togSel = (n: string) => setSel(p => { const s = new Set(p); s.has(n) ? s.delete(n) : s.add(n); return s; });
  const rmSaved = async (n: string) => {
    await remove(ref(db, `saved/${toKey(n)}`));
    setSel(p => { const s = new Set(p); s.delete(n); return s; });
  };
  const togExp = (id: number) => setExpanded(p => ({...p, [id]: !p[id]}));

  /* ─── Computed ─── */
  const entries = Object.entries(files);
  const mine = entries.filter(([,f]) => f.ownerId === me.id);
  const ghosts = entries.filter(([,f]) => f.ownerId !== me.id && !!f.watchers?.[me.id]);
  const others = entries.filter(([,f]) => f.ownerId !== me.id);
  const typed = input.split(/[,;\n]+/).map(s => s.trim()).filter(s => s && s.includes('.'));
  const hasAny = typed.length > 0 || sel.size > 0;

  // Group others by owner
  const grouped: Record<number, { owner: { id: number; name: string; color: string }; files: [string, FileData][] }> = {};
  others.forEach(([k, f]) => {
    const id = f.ownerId;
    if (!grouped[id]) grouped[id] = { owner: { id, name: f.ownerName, color: f.ownerColor }, files: [] };
    grouped[id].files.push([k, f]);
  });
  const groups = Object.values(grouped).sort((a, b) => b.files.length - a.files.length);

  const rowStyle = "grid items-center";
  const hoverClass = "hover:bg-[#383838]";

  return (
    <div className="min-h-screen max-w-[460px] mx-auto relative" style={{background:"#282828",fontFamily:"Inter,'Segoe UI',system-ui,sans-serif"}}>
      {/* Header */}
      <div className="flex items-center gap-1 px-1.5" style={{height:22,background:"#191919",borderBottom:"1px solid #232323"}}>
        <LkIco size={11}/><span className="flex-1 font-semibold" style={{fontSize:11,color:"#D2D2D2"}}>Asset Lock Board</span>
        <span style={{fontSize:9,color:"#7A7A7A",background:"#3F3F3F",padding:"0 4px",borderRadius:3,lineHeight:"14px"}}>{entries.length}</span>
      </div>

      {notif && <div style={{background:"#2D5A3D",color:"#A8E6A1",fontSize:10,padding:"2px 6px",textAlign:"center"}}>{notif}</div>}

      <div style={{background:"#303030"}}>
        {entries.length === 0 && <div style={{padding:16,textAlign:"center",color:"#585858",fontSize:11}}>No active files</div>}

        {/* YOUR FILES */}
        {(mine.length > 0 || ghosts.length > 0) && <>
          <div className="flex items-center justify-between" style={{padding:"4px 6px 2px",background:"#282828"}}>
            <span style={{fontSize:9,fontWeight:600,color:"#7A7A7A",textTransform:"uppercase",letterSpacing:".04em"}}>
              Your files ({mine.length}){ghosts.length > 0 && <span style={{color:"#E8A04C"}}> +{ghosts.length}</span>}
            </span>
            {mine.length > 1 && <button onClick={freeAll} style={{height:14,padding:"0 5px",borderRadius:3,border:"1px solid #303030",background:"#585858",color:"#EEE",fontSize:9,cursor:"pointer",lineHeight:"12px"}}>Free All</button>}
          </div>
          {mine.map(([k,f],i) => <div key={k} className={`${rowStyle} ${hoverClass}`} style={{gridTemplateColumns:"18px 1fr 20px 32px 42px",height:18,padding:"0 6px",columnGap:3,background:i%2?"#383838":"transparent"}}>
            <FIcon ext={getExt(f.name)} size={16}/><span className="truncate" style={{fontSize:11,color:"#EEE"}}>{f.name}</span>
            <div className="flex justify-center">{Object.keys(f.watchers||{}).length > 0 && <BellIco active size={13}/>}</div>
            <span style={{fontSize:9,color:"#7A7A7A",textAlign:"right"}}>{fmt(f.since)}</span>
            <button onClick={() => freeFile(f.name)} style={{height:14,borderRadius:3,border:"1px solid #303030",background:"#585858",color:"#EEE",fontSize:9,cursor:"pointer",padding:0}}>Free</button>
          </div>)}
          {ghosts.map(([k,f],i) => <div key={k} className={rowStyle} style={{gridTemplateColumns:"14px 18px 1fr 20px 18px 38px",height:18,padding:"0 6px",columnGap:3,opacity:.45,background:(mine.length+i)%2?"#383838":"transparent"}}>
            <LkIco size={11}/><FIcon ext={getExt(f.name)} size={16}/><span className="truncate" style={{fontSize:11,color:"#EEE"}}>{f.name}</span>
            <div className="flex justify-center"><BellIco active onClick={() => toggleWatch(f.name)} size={13}/></div>
            <Av user={{name:f.ownerName,color:f.ownerColor}} size={15}/><span className="truncate" style={{fontSize:10,color:f.ownerColor,fontWeight:600}}>{f.ownerName}</span>
          </div>)}
        </>}

        {/* + button */}
        <div className="flex justify-end" style={{padding:"4px 6px"}}>
          <div onClick={() => { setAddOpen(!addOpen); haptic('light'); }} className="flex items-center gap-0.5 cursor-pointer" style={{height:18,padding:"0 5px",background:"#383838",border:"1px solid #303030",borderRadius:3,color:"#D2D2D2",fontSize:12,lineHeight:1}}>+<span style={{fontSize:8,marginTop:1}}>{addOpen?"▲":"▼"}</span></div>
        </div>

        {/* Inline add panel */}
        {addOpen && <div style={{padding:"4px 6px",background:"#353535",borderTop:"1px solid #282828",borderBottom:"1px solid #282828"}}>
          <textarea rows={2} placeholder="Level_05.unity, Rock.prefab" value={input} onChange={e => setInput(e.target.value)} style={{width:"100%",boxSizing:"border-box",padding:"4px 6px",background:"#3F3F3F",border:"1px solid #232323",borderRadius:3,color:"#D2D2D2",fontSize:11,fontFamily:"Consolas,monospace",resize:"none",outline:"none",lineHeight:"16px"}}/>
          {typed.length > 0 && <div style={{marginTop:2}}>{typed.map((n,i) => {
            const k = toKey(n); const b = files[k] && files[k].ownerId !== me.id; const m = files[k] && files[k].ownerId === me.id;
            return <div key={i} className="flex items-center gap-1" style={{height:18}}><FIcon ext={getExt(n)} size={14}/><span className="flex-1" style={{fontSize:11,color:b?"#E8A04C":m?"#58B258":"#D2D2D2"}}>{n}</span>{b && <><BellIco active size={12}/><span style={{fontSize:9,color:"#E8A04C",fontWeight:600}}>{files[k].ownerName}</span></>}{m && <span style={{fontSize:9,color:"#58B258"}}>yours</span>}</div>;
          })}</div>}
          <div style={{fontSize:9,fontWeight:600,color:"#7A7A7A",textTransform:"uppercase",marginTop:4,marginBottom:2}}>Saved</div>
          <div className="flex flex-wrap gap-0.5">{saved.map(n => {
            const k = toKey(n); const act = files[k]; const im = act && act.ownerId === me.id; const on = sel.has(n);
            return <div key={n} onClick={() => togSel(n)} className="flex items-center gap-1 cursor-pointer" style={{padding:"2px 4px",background:on?"#46607C":"#3F3F3F",borderRadius:3,border:`1px solid ${on?"#7BAEFA":"transparent"}`,opacity:im?.5:1}}>
              <FIcon ext={getExt(n)} size={13}/><span style={{fontSize:10,color:"#D2D2D2"}}>{n.replace(/\.[^.]+$/,"")}</span><span style={{fontSize:9,color:"#7A7A7A"}}>.{getExt(n)}</span>
              {act && !im && <LkIco size={9}/>}{on && <span style={{fontSize:9,color:"#7BAEFA",fontWeight:700}}>✓</span>}
              <button onClick={e => { e.stopPropagation(); rmSaved(n); }} style={{background:"none",border:"none",color:"#585858",fontSize:11,cursor:"pointer",padding:"0 1px",lineHeight:1}}>×</button>
            </div>;
          })}</div>
          {hasAny && <button onClick={submit} style={{width:"100%",height:22,borderRadius:3,border:"1px solid #303030",background:"#46607C",color:"#EEE",fontSize:11,fontWeight:600,cursor:"pointer",marginTop:4}}>Busy ({[...new Set([...typed,...sel])].length})</button>}
        </div>}

        {/* LOCKED */}
        {groups.length > 0 && <div className="flex items-center" style={{padding:"6px 6px 2px"}}><span style={{fontSize:9,fontWeight:600,color:"#7A7A7A",textTransform:"uppercase",letterSpacing:".04em"}}>Locked ({others.length})</span></div>}
        {groups.map(g => {
          const uid = g.owner.id; const isExp = !!expanded[uid];
          const vis = isExp ? g.files : g.files.slice(0, CL);
          const more = g.files.length > CL;
          return <div key={uid} style={{borderTop:"1px solid #3C3C3C",marginTop:2}}>
            <div className={`flex items-center gap-1.5 cursor-pointer ${hoverClass}`} style={{padding:"4px 6px",background:"#282828"}} onClick={() => more && togExp(uid)}>
              <span style={{fontSize:10,color:"#7A7A7A"}}>{g.files.length}</span>
              {more && <Chev open={isExp}/>}
              <div className="flex-1"/>
              <span className="font-semibold" style={{fontSize:11,color:g.owner.color}}>{g.owner.name}</span>
              <Av user={g.owner} size={18}/>
            </div>
            {vis.map(([k,f],i) => <div key={k} className={`${rowStyle} ${hoverClass}`} style={{gridTemplateColumns:"13px 16px 1fr 20px",height:18,padding:"0 4px 0 14px",columnGap:3,background:i%2?"#383838":"transparent"}}>
              <LkIco size={11}/><FIcon ext={getExt(f.name)} size={14}/><span className="truncate" style={{fontSize:11,color:"#D2D2D2"}}>{f.name}</span>
              <div className="flex justify-center"><BellIco active={isW(k)} onClick={() => toggleWatch(f.name)} size={13}/></div>
            </div>)}
            {more && !isExp && <div className="cursor-pointer" style={{padding:"1px 14px 3px",fontSize:10,color:"#7BAEFA",background:"#282828"}} onClick={() => togExp(uid)}>+ {g.files.length - CL} more</div>}
          </div>;
        })}
      </div>
    </div>
  );
}
