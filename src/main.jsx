import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './theme.css';

const post=async(path,body,raw=false)=>{const r=await fetch(path,{method:'POST',headers:raw?{'Content-Type':'application/octet-stream'}:{'Content-Type':'application/json'},body:raw?body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error||'Request gagal');return j};
function Shell({user,kicker,title,lead,children}){
 const logout=async()=>{try{await post('/auth/logout',{})}catch(_){}location.replace('/')};
 return <div className="shell"><div className="strip"><div className="stripL"><span className="dot"/>HELLENS CLIPPER · AI VIDEO CLIPPER</div>
  <div className="stripR"><span title={user.email}>{user.name.toUpperCase()} · {user.role.toUpperCase()}</span><a href="/studio">← KE STUDIO</a><button type="button" onClick={logout}>KELUAR</button></div></div>
  <main className="mainpad"><div className="topbar"><div><div className="viewkick">{kicker}</div><h1>{title}</h1></div>{lead&&<div className="lead">{lead}</div>}</div>{children}</main></div>}
function Password(){
 const [f,setF]=useState({current:'',next:''}),[msg,setMsg]=useState(null),[busy,setBusy]=useState(false);
 const submit=async e=>{e.preventDefault();setBusy(true);setMsg(null);try{await post('/auth/password',f);setF({current:'',next:''});setMsg({ok:true,text:'Password diganti'})}catch(x){setMsg({ok:false,text:x.message})}finally{setBusy(false)}};
 return <section className="panel"><div className="panelHead"><div><small>KEAMANAN</small><h2>Ganti password</h2></div></div>
  <form className="pwForm" onSubmit={submit}><label>Password saat ini<input type="password" autoComplete="current-password" required value={f.current} onChange={e=>setF({...f,current:e.target.value})}/></label>
   <label>Password baru (min. 8 karakter)<input type="password" autoComplete="new-password" minLength={8} required value={f.next} onChange={e=>setF({...f,next:e.target.value})}/></label>
   <button className="createBtn" disabled={busy}>{busy?'Menyimpan…':'Ganti password'}</button><p role="status" className={msg?.ok?'ok':'authErr'}>{msg?.text}</p></form></section>}
function Plans({user,copy={}}){
 const [plans,setPlans]=useState(null);
 useEffect(()=>{fetch('/auth/plans').then(r=>r.json()).then(x=>setPlans(x.plans)).catch(()=>setPlans({}))},[]);
 const cap=user.limits.clipsPerMonth,pct=cap?Math.min(100,user.usage.clips/cap*100):0;
 return <section className="panel plansPanel"><div className="panelHead"><div><small>PLAN & KUOTA · {user.usage.month}</small><h2>Plan {user.limits.name}</h2></div></div>
  <div className="meter" role="progressbar" aria-valuenow={user.usage.clips} aria-valuemax={cap||undefined}><i style={{width:pct+'%'}}/></div><small>{user.usage.clips} dari {cap??'tanpa batas'} klip terpakai bulan ini</small>
  <div className="planGrid">{Object.entries(plans||{}).map(([id,p])=><article key={id} className={id===user.plan?'current':''}><b>{p.name}</b><small>{copy[id]?.tagline}</small><span>{copy[id]?.price}</span><span>{p.clipsPerMonth??'Tanpa batas'} klip/bulan</span><span>Resolusi hingga {p.maxResolution}</span><span>{p.clipsPerJob} klip per proses</span>{(copy[id]?.features||[]).map(f=><span key={f}>✓ {f}</span>)}{id===user.plan?<em>Plan aktif</em>:<small>Upgrade: hubungi admin</small>}</article>)}</div></section>}
function AccountPage({user:u0}){
 const [user,setUser]=useState(u0),[copy,setCopy]=useState({});
 useEffect(()=>{fetch('/auth/me').then(r=>r.ok?r.json():{}).then(x=>x.user&&setUser(x.user));fetch('/auth/content').then(r=>r.json()).then(x=>setCopy(x.content?.plan_copy||{})).catch(()=>{})},[]);
 return <Shell user={user} kicker="AKUN // PLAN & KEAMANAN" title="Akun" lead={user.email}><div className="stack">
  <section className="panel"><div className="panelHead"><div><small>PROFIL</small><h2>{user.name}</h2></div></div><p className="hint">{user.email} · role {user.role} · plan {user.limits.name}</p></section>
  <Plans user={user} copy={copy}/><Password/></div></Shell>}
function Admin({user}){
 const [d,setD]=useState(null),[err,setErr]=useState(''),[tab,setTab]=useState('users');
 const get=p=>fetch('/auth/admin/'+p).then(r=>r.json());
 const load=()=>Promise.all([get('users'),get('stats'),get('audit')]).then(([u,st,a])=>{if(u.error)throw Error(u.error);setD({users:u.users,st,audit:a.audit,more:a.more});setErr('')}).catch(e=>setErr(e.message));
 useEffect(()=>{load()},[]);
 const setStatus=async(x,disabled)=>{if(disabled&&!confirm(`Nonaktifkan ${x.email}? User langsung keluar dari semua perangkat.`))return;try{await post('/auth/admin/user-status',{userId:x.id,disabled});await load()}catch(e){setErr(e.message)}};
 const more=async()=>{try{const a=await get('audit?before='+d.audit[d.audit.length-1].id);setD({...d,audit:[...d.audit,...a.audit],more:a.more})}catch(e){setErr(e.message)}};
 const change=async(kind,id,val)=>{try{await post('/auth/admin/'+kind,{userId:id,[kind]:val});await load()}catch(e){setErr(e.message)}};
 if(!d)return <Shell user={user} kicker="ADMIN // KONTROL" title="Admin">{err?<p className="authErr" role="alert">{err}</p>:<p className="hint">Memuat…</p>}</Shell>;
 const max=Math.max(1,...d.st.months.map(m=>m.clips));
 return <Shell user={user} kicker="ADMIN // KONTROL" title="Admin" lead="Pengguna, plan, kuota, audit, dan konten."><div className="adminPage">
  {err&&<p className="authErr" role="alert">{err}</p>}
  <div className="tabs" role="tablist">{[['users','User & statistik'],['cms','CMS']].map(([k,l])=><button key={k} role="tab" aria-selected={tab===k} className={tab===k?'selected':''} onClick={()=>setTab(k)}>{l}</button>)}</div>
  {tab==='cms'?<Cms setErr={setErr}/>:<>
  <div className="statRow"><div className="panel"><small>Total user</small><strong>{d.st.users}</strong></div><div className="panel"><small>Klip bulan ini</small><strong>{d.st.clipsThisMonth}</strong></div>{['free','pro','enterprise'].map(p=><div className="panel" key={p}><small>Plan {p}</small><strong>{d.st.byPlan[p]||0}</strong></div>)}</div>
  <section className="panel"><h2>Pemakaian 6 bulan terakhir</h2><div className="bars">{d.st.months.length?d.st.months.map(m=><div key={m.month}><i style={{height:Math.max(4,m.clips/max*100)+'%'}}/><b>{m.clips}</b><small>{m.month}</small></div>):<small>Belum ada pemakaian.</small>}</div></section>
  <section className="panel"><h2>User</h2><div className="tableWrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Plan</th><th>Klip bulan ini</th><th>Status</th></tr></thead><tbody>{d.users.map(x=><tr key={x.id} className={x.disabled?'off':''}><td>{x.name}</td><td>{x.email}</td>
   <td><select aria-label={'Role '+x.email} value={x.role} disabled={user.role!=='owner'||x.id===user.id} onChange={e=>change('role',x.id,e.target.value)}>{['owner','admin','member'].map(r=><option key={r}>{r}</option>)}</select></td>
   <td><select aria-label={'Plan '+x.email} value={x.plan} onChange={e=>change('plan',x.id,e.target.value)}>{['free','pro','enterprise'].map(r=><option key={r}>{r}</option>)}</select></td><td>{x.clips}</td><td>{x.disabled?'Nonaktif':'Aktif'} {x.id!==user.id&&<button className="pill planPill" onClick={()=>setStatus(x,!x.disabled)}>{x.disabled?'Aktifkan':'Nonaktifkan'}</button>}</td></tr>)}</tbody></table></div></section>
  <section className="panel"><h2>Audit log</h2><div className="tableWrap"><table><thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Target</th><th>Detail</th></tr></thead><tbody>{d.audit.map(a=><tr key={a.id}><td>{new Date(a.at).toLocaleString('id-ID')}</td><td>{a.actor}</td><td>{a.action}</td><td>{a.target}</td><td>{a.detail}</td></tr>)}</tbody></table></div>{d.more&&<button className="pill planPill" onClick={more}>Muat lebih banyak</button>}</section></>}</div></Shell>}
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
 return <div className="authWrap"><form className="panel authCard" onSubmit={submit}><div className="brand"><div className="logo"><img src="/brand/logo-mark.svg" alt=""/></div><div><b>HELLENS</b><b>CLIPPER</b></div></div><h2>{mode==='login'?'Masuk':'Buat akun'}</h2>{mode==='register'&&inp('name','Nama')}{inp('email','Email','email')}{inp('password','Password (min. 8 karakter)','password')}{err&&<p className="authErr" role="alert">{err}</p>}<button className="createBtn" disabled={busy}>{busy?'Memproses…':mode==='login'?'Masuk':'Daftar'}</button><button type="button" className="authSwitch" onClick={()=>{setMode(mode==='login'?'register':'login');setErr('')}}>{mode==='login'?'Belum punya akun? Daftar':'Sudah punya akun? Masuk'}</button></form></div>}
function Root(){
 const [user,setUser]=useState(undefined),[route,setRoute]=useState(location.hash);
 useEffect(()=>{fetch('/auth/me').then(r=>r.ok?r.json():{}).then(x=>setUser(x.user||null)).catch(()=>setUser(null))},[]);
 useEffect(()=>{const f=()=>setRoute(location.hash);addEventListener('hashchange',f);return()=>removeEventListener('hashchange',f)},[]);
 const isAdmin=user&&['owner','admin'].includes(user.role);
 const show=route==='#/akun'||(route==='#/admin'&&isAdmin);
 // Everything except the account/admin pages is the studio (the original UI at /studio).
 useEffect(()=>{if(user&&!show)location.replace('/studio')},[user,show]);
 if(user===undefined)return null;
 if(!user)return <Login onAuth={u=>{setUser(u);if(!/^#\/(admin|akun)$/.test(location.hash))location.replace('/studio')}}/>;
 if(route==='#/admin'&&isAdmin)return <Admin user={user}/>;
 return route==='#/akun'?<AccountPage user={user}/>:null}
createRoot(document.getElementById('root')).render(<Root/>);
