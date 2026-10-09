import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './styles.css';
import './refinement.css';

const post=async(path,body,raw=false)=>{const r=await fetch(path,{method:'POST',headers:raw?{'Content-Type':'application/octet-stream'}:{'Content-Type':'application/json'},body:raw?body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request gagal');return j};
const RES_ORDER=['360p','480p','720p','1080p','1440p','4k'];
function App({user,onLogout,refresh,onAdmin}){
 const [url,setUrl]=useState(''),[file,setFile]=useState(null),[source,setSource]=useState(''),[aspect,setAspect]=useState('9:16'),[fill,setFill]=useState('crop'),[res,setRes]=useState(()=>RES_ORDER.indexOf('1080p')<=RES_ORDER.indexOf(user.limits.maxResolution)?'1080p':user.limits.maxResolution),[providers,setProviders]=useState([]),[provider,setProvider]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[clips,setClips]=useState([]),[showPlans,setShowPlans]=useState(false),[cms,setCms]=useState(null),[hookStyle,setHookStyle]=useState(''),[view,setView]=useState('studio');
 useEffect(()=>{fetch('/auth/content').then(r=>r.json()).then(x=>{setCms(x.content);setHookStyle(Object.keys(x.content.hook_styles)[0])}).catch(()=>{})},[]);
 const loadProviders=()=>fetch('/providers').then(r=>r.json()).then(x=>{setProviders(x.providers||[]);setProvider(p=>x.providers?.includes(p)?p:x.providers?.[0]||'')});
 useEffect(()=>{loadProviders()},[]);
 const upload=async f=>{setFile(f);setStatus('Mengunggah video…');try{const x=await post('/upload',f,true);setSource(x.id);setStatus('Video siap dianalisis')}catch(e){setStatus(e.message)}};
 const run=async()=>{if(!url&&!source)return setStatus('Masukkan URL YouTube atau pilih video');if(!provider){setView('settings');return}setBusy(true);setClips([]);setStatus('AI sedang menganalisis video…');try{const j=await post('/auto',{url,id:source,aspect,fill,resolution:res,provider,preset:'karaoke',wordByWord:true,captionPosition:'bottom',captionSize:'medium',hook:true,hookStyle,motion:true});let done=false;while(!done){await new Promise(r=>setTimeout(r,1800));const s=await (await fetch('/auto/'+j.jobId)).json();setStatus(s.step||'Memproses…');setClips(s.clips||[]);done=s.status==='done'||s.status==='error';if(s.status==='error')throw Error(s.error)}setStatus('Selesai — klip siap diunduh')}catch(e){setStatus('Gagal: '+e.message)}finally{setBusy(false);refresh()}};
 const lim=user.limits,used=user.usage.clips,locked=x=>RES_ORDER.indexOf(x)>RES_ORDER.indexOf(lim.maxResolution);
 return <div className="app"><aside><div className="brand"><div className="logo">✦</div><div><b>HELLENS</b><b>CLIPPER</b><small>AI VIDEO CLIPPER</small></div></div><nav><button className={view==='studio'?'active':''} onClick={()=>setView('studio')}>⌁ <span>Dashboard</span></button><button className={view==='history'?'active':''} onClick={()=>setView('history')}>▦ <span>History</span></button><button className={view==='settings'?'active':''} onClick={()=>setView('settings')}>⚙ <span>Pengaturan</span></button></nav><div className="upgrade"><b>Upgrade ✦</b><small>Resolusi lebih tinggi & kuota lebih besar</small><button onClick={()=>{setView('studio');setShowPlans(true)}}>Lihat plan</button></div></aside><main><header><div><span className="eyebrow">WORKSPACE / AUTO-CLIP</span><h1>Overview</h1><p>AI picks the strongest moments from your video.</p></div><div className="headerActions"><button className="pill planPill" onClick={()=>setShowPlans(!showPlans)} aria-expanded={showPlans}>{lim.name} · {used}/{lim.clipsPerMonth??"∞"} klip</button>{onAdmin&&<button className="pill planPill" onClick={onAdmin}>Admin</button>}<button className="avatar" title={`${user.name} (${user.role}) — klik untuk keluar`} onClick={onLogout}>{user.name[0].toUpperCase()}</button></div></header>{view==='settings'?<Settings onChange={loadProviders}/>:view==='history'?<History/>:<>{showPlans&&<Plans user={user} copy={cms?.plan_copy}/>}<section className="summary"><div><small>AI pipeline</small><strong>Ready to create</strong><span>Analyze · caption · export</span></div><div><small>Output format</small><strong>{aspect}</strong><span>Vertical short</span></div><div><small>Resolution</small><strong>{res}</strong><span>Optimized render</span></div></section><div className="workspace"><section className="panel create"><div className="panelHead"><div><small>CREATE SHORTS</small><h2>Turn one video into a set of clips.</h2></div><span className="step">01</span></div><div className="source"><label>Video source</label><div className="sourceRow"><input value={url} onChange={e=>{setUrl(e.target.value);setSource('')}} placeholder="Paste a YouTube link…"/><label className="file"><input type="file" accept="video/*" onChange={e=>upload(e.target.files[0])}/>{file?'Video selected':'Choose file'}</label></div><small>{status||'AI will find the best moments automatically.'}</small></div><div className="controls"><Choice title="Aspect ratio" items={['9:16','3:4','1:1','16:9']} value={aspect} set={setAspect}/><Choice title="Frame" items={['crop','fit']} value={fill} set={setFill}/><Choice title="Resolution" items={['720p','1080p','1440p','4k']} value={res} set={setRes} locked={locked}/>{cms&&<Choice title="Hook style" items={Object.keys(cms.hook_styles)} value={hookStyle} set={setHookStyle} label={x=>cms.hook_styles[x].label}/>}<div className="control"><label>AI provider</label><select value={provider} onChange={e=>setProvider(e.target.value)}>{providers.length?providers.map(x=><option key={x}>{x}</option>):<option>Set API key</option>}</select></div></div><button className="createBtn" onClick={run} disabled={busy}>{busy?'Analyzing video…':'Create clips with AI'} <span>↗</span></button></section><aside className="sidePanel"><small>MISSION</small><h3>Ready to create</h3><div className="mission"><span>Selection</span><b>AI automatic</b><span>Captions</span><b>Karaoke · per word</b><span>Hook</span><b>3 seconds</b></div><button onClick={run} disabled={busy}>{busy?'Processing…':'Create shorts'} <span>↗</span></button></aside></div><section className="results panel"><div className="panelHead"><div><small>RECENT OUTPUT</small><h2>{clips.length?`${clips.length} clips ready`:'Your generated clips'}</h2></div><span className="step">02</span></div>{clips.length?<div className="clipGrid">{clips.map((c,i)=><article key={c.key||i}><div className="thumb">{c.url&&<video src={c.url} controls/>}</div><b>{c.title||`AI clip ${i+1}`}</b><small>{c.score?`Score ${c.score}`:'Ready to post'}</small><a href={c.url} download>Download ↗</a></article>)}</div>:<div className="empty">Generated clips will appear here after analysis.</div>}</section></>}</main></div>}
const NAMES={gemini:'Gemini',openai:'OpenAI',claude:'Claude',groq:'Groq',mistral:'Mistral',deepseek:'DeepSeek'};
function Settings({onChange}){
 const [k,setK]=useState(null),[val,setVal]=useState({}),[msg,setMsg]=useState({});
 const load=()=>fetch('/keys').then(r=>r.json()).then(setK);
 useEffect(()=>{load()},[]);
 if(!k)return null;
 const note=(id,text,ok=true)=>setMsg(m=>({...m,[id]:{text,ok}}));
 const test=async id=>{note(id,'Menguji…');try{const r=await post('/keys/test',{provider:id,key:val[id]||''});note(id,r.ok?'Key valid':'Gagal: '+r.error,!!r.ok)}catch(e){note(id,e.message,false)}};
 const save=async(id,key)=>{try{await post('/keys',{provider:id,key});setVal({...val,[id]:''});note(id,key?'Tersimpan':'Dihapus');await load();onChange()}catch(e){note(id,e.message,false)}};
 return <section className="panel settings"><div className="panelHead"><div><small>PENGATURAN</small><h2>API key AI</h2></div></div>
  <p className="hint">Key disimpan lokal di komputer ini dan hanya dikirim ke provider yang kamu pilih. Isi minimal satu untuk memakai analisis AI.</p>
  <div className="keyList">{k.all.map(id=>{const env=k.env.includes(id),isSet=k.set.includes(id),v=(val[id]||'').trim();return <div className="keyRow" key={id}><b>{NAMES[id]||id}</b><span className={isSet?'ok':''}>{env?'Dari environment':isSet?'Tersimpan':'Belum diatur'}</span>
   <input type="password" autoComplete="off" aria-label={'API key '+id} placeholder={isSet?'Isi untuk mengganti':'Tempel API key'} value={val[id]||''} onChange={e=>setVal({...val,[id]:e.target.value})}/>
   <button onClick={()=>test(id)} disabled={!isSet&&!v}>Uji</button><button onClick={()=>save(id,v)} disabled={!v}>Simpan</button><button onClick={()=>save(id,'')} disabled={!isSet||env}>Hapus</button>
   <small role="status" className={msg[id]?.ok?'ok':'bad'}>{msg[id]?.text}</small></div>})}</div></section>}
function History(){
 const [h,setH]=useState(null),[err,setErr]=useState('');
 const load=()=>fetch('/history').then(r=>r.json()).then(x=>setH(x.history||[])).catch(e=>setErr(e.message));
 useEffect(()=>{load()},[]);
 const del=async c=>{if(!confirm(`Hapus klip "${c.title||c.key}"? File video ikut terhapus.`))return;try{const r=await fetch('/history/'+encodeURIComponent(c.key),{method:'DELETE'});if(!r.ok)throw Error((await r.json()).error||'Gagal menghapus');setErr('');await load()}catch(e){setErr(e.message)}};
 const copy=c=>navigator.clipboard?.writeText([c.description,(c.hashtags||[]).join(' ')].filter(Boolean).join('\n\n'));
 if(!h)return null;
 return <section className="panel historyPanel"><div className="panelHead"><div><small>RIWAYAT</small><h2>{h.length} klip</h2></div></div>{err&&<p className="authErr" role="alert">{err}</p>}
  {h.length?<div className="clipGrid">{h.map(c=><article key={c.key}><div className="thumb"><video src={c.url} controls preload="metadata"/></div><b>{c.title||c.key}</b><small>{[c.grade&&`Grade ${c.grade}`,c.score!=null&&`Skor ${c.score}`,c.mode,c.resolution,new Date(c.time).toLocaleDateString('id-ID')].filter(Boolean).join(' · ')}</small>{c.description&&<p className="desc">{c.description}</p>}{c.hashtags?.length>0&&<small>{c.hashtags.join(' ')}</small>}
   <div className="clipActions"><a href={c.url} download>Unduh ↗</a>{(c.description||c.hashtags?.length>0)&&<button onClick={()=>copy(c)}>Salin caption</button>}<button onClick={()=>del(c)}>Hapus</button></div></article>)}</div>:<div className="empty">Belum ada klip. Buat klip dari Dashboard.</div>}</section>}
function Choice({title,items,value,set,locked=()=>false,label=x=>x}){return <div className="control"><label>{title}</label><div className="choices">{items.map(x=><button className={x===value?'selected':''} disabled={locked(x)} title={locked(x)?'Butuh plan lebih tinggi':undefined} onClick={()=>set(x)} key={x}>{label(x)}{locked(x)&&' 🔒'}</button>)}</div></div>}
function Plans({user,copy={}}){
 const [plans,setPlans]=useState(null);
 useEffect(()=>{fetch('/auth/plans').then(r=>r.json()).then(x=>setPlans(x.plans)).catch(()=>setPlans({}))},[]);
 const cap=user.limits.clipsPerMonth,pct=cap?Math.min(100,user.usage.clips/cap*100):0;
 return <section className="panel plansPanel"><div className="panelHead"><div><small>PLAN & KUOTA · {user.usage.month}</small><h2>Plan {user.limits.name}</h2></div></div>
  <div className="meter" role="progressbar" aria-valuenow={user.usage.clips} aria-valuemax={cap||undefined}><i style={{width:pct+'%'}}/></div><small>{user.usage.clips} dari {cap??'tanpa batas'} klip terpakai bulan ini</small>
  <div className="planGrid">{Object.entries(plans||{}).map(([id,p])=><article key={id} className={id===user.plan?'current':''}><b>{p.name}</b><small>{copy[id]?.tagline}</small><span>{copy[id]?.price}</span><span>{p.clipsPerMonth??'Tanpa batas'} klip/bulan</span><span>Resolusi hingga {p.maxResolution}</span><span>{p.clipsPerJob} klip per proses</span>{(copy[id]?.features||[]).map(f=><span key={f}>✓ {f}</span>)}{id===user.plan?<em>Plan aktif</em>:<small>Upgrade: hubungi admin</small>}</article>)}</div></section>}
function Admin({user,onBack}){
 const [d,setD]=useState(null),[err,setErr]=useState(''),[tab,setTab]=useState('users');
 const get=p=>fetch('/auth/admin/'+p).then(r=>r.json());
 const load=()=>Promise.all([get('users'),get('stats'),get('audit')]).then(([u,st,a])=>{if(u.error)throw Error(u.error);setD({users:u.users,st,audit:a.audit});setErr('')}).catch(e=>setErr(e.message));
 useEffect(()=>{load()},[]);
 const change=async(kind,id,val)=>{try{await post('/auth/admin/'+kind,{userId:id,[kind]:val});await load()}catch(e){setErr(e.message)}};
 if(!d)return <div className="adminPage">{err?<p className="authErr" role="alert">{err}</p>:'Memuat…'}</div>;
 const max=Math.max(1,...d.st.months.map(m=>m.clips));
 return <div className="adminPage"><header className="adminHead"><div><span className="eyebrow">ADMIN</span><h1>Dashboard admin</h1></div><button className="pill planPill" onClick={onBack}>← Kembali</button></header>
  {err&&<p className="authErr" role="alert">{err}</p>}
  <div className="tabs" role="tablist">{[['users','User & statistik'],['cms','CMS']].map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'selected':''} onClick={()=>setTab(k)}>{l}</button>)}</div>
  {tab==='cms'?<Cms setErr={setErr}/>:<>
  <div className="statRow"><div className="panel"><small>Total user</small><strong>{d.st.users}</strong></div><div className="panel"><small>Klip bulan ini</small><strong>{d.st.clipsThisMonth}</strong></div>{['free','pro','enterprise'].map(p=><div className="panel" key={p}><small>Plan {p}</small><strong>{d.st.byPlan[p]||0}</strong></div>)}</div>
  <section className="panel"><h2>Pemakaian 6 bulan terakhir</h2><div className="bars">{d.st.months.length?d.st.months.map(m=><div key={m.month}><i style={{height:Math.max(4,m.clips/max*100)+'%'}}/><b>{m.clips}</b><small>{m.month}</small></div>):<small>Belum ada pemakaian.</small>}</div></section>
  <section className="panel"><h2>User</h2><div className="tableWrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Plan</th><th>Klip bulan ini</th></tr></thead><tbody>{d.users.map(x=><tr key={x.id}><td>{x.name}</td><td>{x.email}</td>
   <td><select aria-label={'Role '+x.email} value={x.role} disabled={user.role!=='owner'||x.id===user.id} onChange={e=>change('role',x.id,e.target.value)}>{['owner','admin','member'].map(r=><option key={r}>{r}</option>)}</select></td>
   <td><select aria-label={'Plan '+x.email} value={x.plan} onChange={e=>change('plan',x.id,e.target.value)}>{['free','pro','enterprise'].map(r=><option key={r}>{r}</option>)}</select></td><td>{x.clips}</td></tr>)}</tbody></table></div></section>
  <section className="panel"><h2>Audit log</h2><div className="tableWrap"><table><thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Target</th><th>Detail</th></tr></thead><tbody>{d.audit.map(a=><tr key={a.id}><td>{new Date(a.at).toLocaleString('id-ID')}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.target}</td><td>{a.detail}</td></tr>)}</tbody></table></div></section></>}</div>}
function Cms({setErr}){
 const [c,setC]=useState(null),[msg,setMsg]=useState('');
 useEffect(()=>{fetch('/auth/content').then(r=>r.json()).then(x=>setC(x.content))},[]);
 if(!c)return null;
 const save=async(key,value)=>{try{const x=await post('/auth/admin/content',{key,value});setC(x.content);setErr('');setMsg(value===null?'Dikembalikan ke default':'Tersimpan')}catch(e){setErr(e.message);setMsg('')}};
 const hs=c.hook_styles,setHs=(id,patch)=>setC({...c,hook_styles:{...hs,[id]:{...hs[id],...patch}}});
 const addHs=()=>{let n=1;while(hs['gaya-'+n])n++;setC({...c,hook_styles:{...hs,['gaya-'+n]:{label:'Gaya baru',bg:'#FF542B',color:'#FFFFFF',rounded:false}}})};
 const delHs=id=>{const {[id]:_,...rest}=hs;setC({...c,hook_styles:rest})};
 const setCp=(id,hl)=>setC({...c,caption_presets:{...c.caption_presets,[id]:{hl}}});
 const setPc=(id,patch)=>setC({...c,plan_copy:{...c.plan_copy,[id]:{...c.plan_copy[id],...patch}}});
 const Actions=({k})=><div className="cmsActions"><button className="pill planPill" onClick={()=>save(k,c[k])}>Simpan</button><button className="pill planPill" onClick={()=>save(k,null)}>Reset default</button></div>;
 return <><p role="status" className="cmsMsg">{msg}</p>
  <section className="panel"><h2>Gaya hook</h2><div className="tableWrap"><table><thead><tr><th>ID</th><th>Label</th><th>Latar</th><th>Teks</th><th>Rounded</th><th></th></tr></thead><tbody>{Object.entries(hs).map(([id,x])=><tr key={id}><td>{id}</td>
   <td><input aria-label={'Label '+id} value={x.label} onChange={e=>setHs(id,{label:e.target.value})}/></td>
   <td><input type="color" aria-label={'Warna latar '+id} value={x.bg} onChange={e=>setHs(id,{bg:e.target.value})}/></td>
   <td><input type="color" aria-label={'Warna teks '+id} value={x.color} onChange={e=>setHs(id,{color:e.target.value})}/></td>
   <td><input type="checkbox" aria-label={'Rounded '+id} checked={x.rounded} onChange={e=>setHs(id,{rounded:e.target.checked})}/></td>
   <td><button className="pill planPill" disabled={Object.keys(hs).length<2} onClick={()=>delHs(id)}>Hapus</button></td></tr>)}</tbody></table></div>
   <button className="pill planPill" onClick={addHs}>+ Tambah gaya</button><Actions k="hook_styles"/></section>
  <section className="panel"><h2>Warna highlight caption</h2><div className="cmsGrid">{Object.entries(c.caption_presets).map(([id,x])=><label key={id}>{id}<input type="color" value={x.hl} onChange={e=>setCp(id,e.target.value)}/></label>)}</div><Actions k="caption_presets"/></section>
  <section className="panel"><h2>Teks halaman plan</h2><div className="cmsGrid">{Object.entries(c.plan_copy).map(([id,x])=><div key={id} className="cmsPlan"><b>{id}</b>
   <label>Harga<input value={x.price} onChange={e=>setPc(id,{price:e.target.value})}/></label>
   <label>Tagline<input value={x.tagline} onChange={e=>setPc(id,{tagline:e.target.value})}/></label>
   <label>Fitur (satu per baris)<textarea rows={4} value={x.features.join('\n')} onChange={e=>setPc(id,{features:e.target.value.split('\n')})}/></label></div>)}</div><Actions k="plan_copy"/></section></>}
function Login({onAuth}){
 const [mode,setMode]=useState('login'),[f,setF]=useState({name:'',email:'',password:''}),[err,setErr]=useState(''),[busy,setBusy]=useState(false);
 const submit=async e=>{e.preventDefault();setBusy(true);setErr('');try{onAuth((await post('/auth/'+mode,f)).user)}catch(x){setErr(x.message)}finally{setBusy(false)}};
 const inp=(k,label,type='text')=><label>{label}<input type={type} required value={f[k]} onChange={e=>setF({...f,[k]:e.target.value})} autoComplete={k==='password'?(mode==='login'?'current-password':'new-password'):k}/></label>;
 return <div className="authWrap"><form className="panel authCard" onSubmit={submit}><div className="brand"><div className="logo">✦</div><div><b>HELLENS</b><b>CLIPPER</b></div></div><h2>{mode==='login'?'Masuk':'Buat akun'}</h2>{mode==='register'&&inp('name','Nama')}{inp('email','Email','email')}{inp('password','Password (min. 8 karakter)','password')}{err&&<p className="authErr" role="alert">{err}</p>}<button className="createBtn" disabled={busy}>{busy?'Memproses…':mode==='login'?'Masuk':'Daftar'}</button><button type="button" className="authSwitch" onClick={()=>{setMode(mode==='login'?'register':'login');setErr('')}}>{mode==='login'?'Belum punya akun? Daftar':'Sudah punya akun? Masuk'}</button></form></div>}
function Root(){
 const [user,setUser]=useState(undefined),[page,setPage]=useState('studio');
 useEffect(()=>{fetch('/auth/me').then(r=>r.ok?r.json():{}).then(x=>setUser(x.user||null)).catch(()=>setUser(null))},[]);
 if(user===undefined)return null;
 const refresh=()=>fetch('/auth/me').then(r=>r.ok?r.json():{}).then(x=>x.user&&setUser(x.user)).catch(()=>{});
 if(user&&page==='admin')return <Admin user={user} onBack={()=>setPage('studio')}/>;
 return user?<App user={user} refresh={refresh} onAdmin={['owner','admin'].includes(user.role)?()=>setPage('admin'):undefined} onLogout={async()=>{await post('/auth/logout',{});setUser(null)}}/>:<Login onAuth={setUser}/>}
createRoot(document.getElementById('root')).render(<Root/>);
