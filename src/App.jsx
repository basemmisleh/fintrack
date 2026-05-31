import { useState, useEffect, useCallback } from "react";
import { usePlaidLink } from "react-plaid-link";
import { storage } from "./storage.js";

const FUNC_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

const DEFAULT_CATS = [
  { id:"housing",   label:"Housing",        color:"#185FA5", bg:"#E6F1FB" },
  { id:"groceries", label:"Groceries",      color:"#3B6D11", bg:"#EAF3DE" },
  { id:"dining",    label:"Dining Out",     color:"#854F0B", bg:"#FAEEDA" },
  { id:"transport", label:"Transportation", color:"#993C1D", bg:"#FAECE7" },
  { id:"entertain", label:"Entertainment",  color:"#993556", bg:"#FBEAF0" },
  { id:"subs",      label:"Subscriptions",  color:"#6366F1", bg:"#EEF2FF" },
  { id:"hustle",    label:"Side Hustle",    color:"#5F5E5A", bg:"#F1EFE8" },
  { id:"savings",   label:"Savings",        color:"#0F6E56", bg:"#E1F5EE" },
  { id:"roth",      label:"Roth IRA",       color:"#854F0B", bg:"#FAEEDA" },
  { id:"split",     label:"Shared / Split", color:"#1565C0", bg:"#E3F2FD" },
  { id:"other",     label:"Other",          color:"#444441", bg:"#F1EFE8" },
];

const MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULLMONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const now   = new Date();
const CUR_M = now.getMonth();
const CUR_Y = now.getFullYear();

const DEFAULT_JOB_START   = "2026-07-20";
const DEFAULT_FIRST_CHECK = "";
const DEFAULT_PAY_CYCLE   = 14;

const c2   = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const c0   = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:0}).format(n||0);
const pct  = (n,d=1) => `${((n||0)*100).toFixed(d)}%`;
const mkKey   = (y,m) => `${y}-${String(m).padStart(2,"0")}`;
const fmtD    = d => { try { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch(e){ return d; }};
const fmtFull = d => { try { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}); } catch(e){ return d; }};
const autoBg  = color => color+"22";

const catColor = (cats,id) => cats.find(c=>c.id===id)?.color||"#888";
const catBg    = (cats,id) => cats.find(c=>c.id===id)?.bg||"#F5F5F5";
const catLabel = (cats,id) => cats.find(c=>c.id===id)?.label||id;

function getPayDates(firstPaycheck,cycledays,year,month){
  if(!firstPaycheck) return [];
  const start=new Date(firstPaycheck+"T12:00:00");
  if(isNaN(start)) return [];
  const endOfMonth=new Date(year,month+1,0);
  const dates=[]; let cur=new Date(start);
  while(cur<=endOfMonth){
    if(cur.getMonth()===month&&cur.getFullYear()===year) dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate()+cycledays);
  }
  return dates;
}

function hasIncome(jobStart,year,month){
  if(!jobStart) return false;
  const js=new Date(jobStart+"T12:00:00");
  return new Date(year,month,1)>=new Date(js.getFullYear(),js.getMonth(),1);
}

function isRecurringDue(rec,y,m){
  if(!rec.startDate) return false;
  const start=new Date(rec.startDate+"T12:00:00");
  if(isNaN(start)) return false;
  if(rec.freq==="monthly") return y>start.getFullYear()||(y===start.getFullYear()&&m>=start.getMonth());
  return getPayDates(rec.startDate,rec.freq==="weekly"?7:14,y,m).length>0;
}

// ── MINI COMPONENTS ───────────────────────────────────────────────
function Bar({val,max,color,h=7}){
  const w=max>0?Math.min(100,(val/max)*100):0;
  return <div style={{height:h,background:"#E2E8F0",borderRadius:h,overflow:"hidden"}}><div style={{height:"100%",width:`${w}%`,background:color,borderRadius:h,transition:"width 0.5s cubic-bezier(.4,0,.2,1)"}}/></div>;
}
function Pill({label,color,bg}){
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:bg||color+"18",color,fontWeight:600,display:"inline-block",whiteSpace:"nowrap"}}>{label}</span>;
}
function DonutChart({data,size=110}){
  const total=data.reduce((s,d)=>s+(d.v||0),0)||1;
  const r=size*0.34; const cx=size/2,cy=size/2;
  const circ=2*Math.PI*r; let off=0;
  const slices=data.filter(d=>d.v>0).map(d=>{const dash=(d.v/total)*circ;const s={dash,off,color:d.color};off+=dash;return s;});
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEECEA" strokeWidth={r*0.5}/>
      {slices.map((s,i)=>(
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color}
          strokeWidth={r*0.5} strokeDasharray={`${s.dash} ${circ-s.dash}`}
          strokeDashoffset={-s.off} transform={`rotate(-90 ${cx} ${cy})`} style={{transition:"all 0.4s"}}/>
      ))}
      <text x={cx} y={cy-4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#0F172A" fontFamily="DM Sans,Inter,sans-serif">{c0(data.reduce((s,d)=>s+(d.v||0),0))}</text>
      <text x={cx} y={cy+9} textAnchor="middle" fontSize="8" fill="#94A3B8" fontFamily="DM Sans,Inter,sans-serif">total spent</text>
    </svg>
  );
}

// ── STYLES ────────────────────────────────────────────────────────
const S = {
  app:    {minHeight:"100vh",background:"#F1F5F9",fontFamily:"'DM Sans','Inter','Segoe UI',sans-serif",fontSize:13,color:"#0F172A"},
  topbar: {background:"rgba(255,255,255,0.92)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",borderBottom:"1px solid #E2E8F0",padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:30,boxShadow:"0 1px 12px rgba(15,23,42,0.06)"},
  logo:   {fontSize:17,fontWeight:800,background:"linear-gradient(135deg,#6366F1 0%,#8B5CF6 100%)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",letterSpacing:"-0.5px"},
  nav:    {display:"flex",gap:0,overflowX:"auto"},
  nb:     a=>({padding:"0 14px",height:44,background:"transparent",border:"none",borderBottom:a?"2.5px solid #6366F1":"2.5px solid transparent",color:a?"#6366F1":"#64748B",fontSize:12,cursor:"pointer",fontWeight:a?700:500,transition:"all 0.15s",fontFamily:"inherit",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}),
  body:   {padding:"20px",maxWidth:1200,margin:"0 auto"},
  mbar:   {display:"flex",gap:4,marginBottom:20,background:"#FFF",borderRadius:12,padding:6,border:"1px solid #E2E8F0",boxShadow:"0 1px 4px rgba(15,23,42,0.04)"},
  mbtn:   (a,has)=>({flex:1,padding:"6px 2px",background:a?"#EEF2FF":"transparent",border:"none",borderRadius:7,color:a?"#6366F1":has?"#334155":"#CBD5E1",fontSize:10,cursor:"pointer",fontWeight:a?700:500,transition:"all 0.15s",fontFamily:"inherit",lineHeight:1.4}),
  g4:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:14,marginBottom:18},
  g2:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16,marginBottom:16},
  g3:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:16},
  card:   {background:"#FFF",border:"1px solid #E2E8F0",borderRadius:14,padding:"18px 20px",boxShadow:"0 1px 4px rgba(15,23,42,0.04)"},
  kpi:    {background:"#FFF",border:"1px solid #E2E8F0",borderRadius:14,padding:"16px 18px 14px",boxShadow:"0 1px 4px rgba(15,23,42,0.04)",overflow:"hidden",position:"relative"},
  klabel: {fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6,fontWeight:700},
  kval:   c=>({fontSize:26,fontWeight:800,color:c||"#0F172A",letterSpacing:"-0.5px",lineHeight:1.1}),
  ksub:   {fontSize:11,color:"#94A3B8",marginTop:5},
  ptitle: {fontSize:10,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:14},
  slabel: {fontSize:10,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:5,fontWeight:600},
  input:  {background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:8,padding:"8px 12px",color:"#0F172A",fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
  iy:     {background:"#FFFBEB",border:"1.5px solid #F59E0B",borderRadius:8,padding:"8px 12px",color:"#78350F",fontSize:13,fontWeight:600,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
  sel:    {background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:8,padding:"8px 12px",color:"#0F172A",fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
  btn:    c=>({background:c+"18",border:`1.5px solid ${c}35`,borderRadius:8,padding:"7px 14px",color:c,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}),
  btnS:   c=>({background:c,border:`1.5px solid ${c}`,borderRadius:8,padding:"7px 16px",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:`0 2px 8px ${c}45`}),
  txrow:  {display:"flex",alignItems:"flex-start",gap:12,padding:"11px 0",borderBottom:"1px solid #F1F5F9"},
};

// ── TOP-LEVEL COMPONENTS ──────────────────────────────────────────
function MonthBar({vm,vy,monthData,setVm}){
  const getMD=(y,m)=>monthData[mkKey(y,m)]||{income:0,bonus:0,transactions:[],rothBalance:0};
  return (
    <div style={S.mbar}>
      {MONTHS.map((m,i)=>{
        const md=getMD(vy,i); const has=(md.transactions||[]).length>0; const isNow=i===CUR_M&&vy===CUR_Y;
        return (
          <button key={i} style={S.mbtn(i===vm,has)} onClick={()=>setVm(i)}>
            <div>{m}</div><div style={{fontSize:8}}>{isNow?"●":has?"·":""}</div>
          </button>
        );
      })}
    </div>
  );
}

function IncomeRow({incAvail,settings,editIncome,setEditIncome,tempVal,setTempVal,curMD,updMD,vy,vm,isFirstPayMonth,payDates,pendingTotal,setTab}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      {!incAvail?(
        <div style={{background:"#EEF2FF",border:"1px solid #AFA9EC",borderRadius:8,padding:"10px 16px",fontSize:12,color:"#6366F1",fontWeight:500}}>
          No income yet — job starts {new Date(settings.jobStart+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
          {!settings.firstPaycheck&&<span style={{color:"#A32D2D",marginLeft:8,fontWeight:600}}>· Set your first paycheck date in ⚙ Settings once HR confirms</span>}
          {settings.firstPaycheck&&<span style={{color:"#64748B",fontWeight:400,marginLeft:8}}>· First paycheck: {new Date(settings.firstPaycheck+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric"})}</span>}
        </div>
      ):(
        <>
          <div>
            <div style={S.slabel}>Net income</div>
            {editIncome==="income"?(
              <div style={{display:"flex",gap:6}}>
                <input autoFocus type="number" style={{...S.iy,width:130}} value={tempVal}
                  onChange={e=>setTempVal(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"){updMD(vy,vm,{income:parseFloat(tempVal)||0});setEditIncome(null);}if(e.key==="Escape")setEditIncome(null);}}/>
                <button style={S.btnS("#1D9E75")} onClick={()=>{updMD(vy,vm,{income:parseFloat(tempVal)||0});setEditIncome(null);}}>Save</button>
                <button style={S.btn("#64748B")} onClick={()=>setEditIncome(null)}>✕</button>
              </div>
            ):(
              <div onClick={()=>{setTempVal(curMD.income||0);setEditIncome("income");}}
                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#FFFBEB",border:"1.5px solid #EF9F27",borderRadius:6,cursor:"pointer"}}>
                <span style={{fontSize:16,fontWeight:700,color:"#412402"}}>{c0(curMD.income||0)}</span>
                <span style={{fontSize:10,color:"#64748B"}}>✎</span>
              </div>
            )}
          </div>
          {isFirstPayMonth&&(
            <div>
              <div style={S.slabel}>Sign-on bonus</div>
              {editIncome==="bonus"?(
                <div style={{display:"flex",gap:6}}>
                  <input autoFocus type="number" style={{...S.iy,width:130}} value={tempVal}
                    onChange={e=>setTempVal(e.target.value)}
                    onKeyDown={e=>{if(e.key==="Enter"){updMD(vy,vm,{bonus:parseFloat(tempVal)||0});setEditIncome(null);}if(e.key==="Escape")setEditIncome(null);}}/>
                  <button style={S.btnS("#1D9E75")} onClick={()=>{updMD(vy,vm,{bonus:parseFloat(tempVal)||0});setEditIncome(null);}}>Save</button>
                  <button style={S.btn("#64748B")} onClick={()=>setEditIncome(null)}>✕</button>
                </div>
              ):(
                <div onClick={()=>{setTempVal(curMD.bonus||0);setEditIncome("bonus");}}
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#EAF3DE",border:"1.5px solid #3B6D11",borderRadius:6,cursor:"pointer"}}>
                  <span style={{fontSize:16,fontWeight:700,color:"#173404"}}>{c0(curMD.bonus||0)}</span>
                  <span style={{fontSize:10,color:"#64748B"}}>✎ bonus</span>
                </div>
              )}
            </div>
          )}
          {payDates.length>0&&(
            <div>
              <div style={S.slabel}>Pay dates ({MONTHS[vm]})</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {payDates.map((d,i)=>(
                  <div key={i} style={{background:"#E1F5EE",border:"1px solid #5DCAA5",borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:600,color:"#085041"}}>
                    {fmtD(d)}{i===0&&isFirstPayMonth&&<span style={{marginLeft:6,fontSize:9,color:"#3B6D11"}}>+ bonus</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {pendingTotal>0&&(
        <div style={{marginLeft:"auto",background:"#E3F2FD",border:"1px solid #90CAF9",borderRadius:8,padding:"6px 12px",fontSize:12,color:"#1565C0",fontWeight:600,cursor:"pointer"}} onClick={()=>setTab("splits")}>
          💸 {c0(pendingTotal)} pending →
        </div>
      )}
    </div>
  );
}

function TxForm({txForm,setTxForm,splitPeople,setSplitPeople,addTx,setShowTxForm,cats}){
  const perShare = txForm.isSplit && txForm.totalBill && txForm.splitCount
    ? (parseFloat(txForm.totalBill)||0) / txForm.splitCount : 0;

  const setTotal = total => {
    const share = total && txForm.splitCount ? ((parseFloat(total)||0)/txForm.splitCount).toFixed(2) : "";
    setTxForm({...txForm, totalBill:total, amount:share});
  };
  const setSplitCount = n => {
    const next = Math.max(2, n);
    const share = txForm.totalBill ? ((parseFloat(txForm.totalBill)||0)/next).toFixed(2) : "";
    setTxForm({...txForm, splitCount:next, amount:share});
    setSplitPeople(prev => {
      const arr = [...prev];
      while(arr.length < next-1) arr.push({name:"",owes:0,paid:false});
      return arr.slice(0, next-1);
    });
  };

  return (
    <div style={{...S.card,marginBottom:14,border:"1.5px solid #AFA9EC"}}>
      <div style={S.ptitle}>New transaction</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:10}}>
        <div><div style={S.slabel}>Date</div>
          <input type="date" style={S.input} value={txForm.date} onChange={e=>setTxForm({...txForm,date:e.target.value})}/></div>
        <div><div style={S.slabel}>Merchant</div>
          <input type="text" style={S.iy} placeholder="e.g. Walmart..." value={txForm.merchant}
            onChange={e=>setTxForm({...txForm,merchant:e.target.value})}
            onKeyDown={e=>e.key==="Enter"&&!txForm.isSplit&&addTx()}/></div>
        <div><div style={S.slabel}>Category</div>
          <select style={S.sel} value={txForm.cat} onChange={e=>setTxForm({...txForm,cat:e.target.value})}>
            {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select></div>
        <div><div style={S.slabel}>{txForm.isSplit ? "Total bill ($)" : "Amount ($)"}</div>
          {txForm.isSplit
            ? <input type="number" inputMode="decimal" style={S.iy} placeholder="0.00" value={txForm.totalBill} onChange={e=>setTotal(e.target.value)}/>
            : <input type="number" inputMode="decimal" style={S.iy} placeholder="0.00" value={txForm.amount}
                onChange={e=>setTxForm({...txForm,amount:e.target.value})}
                onKeyDown={e=>e.key==="Enter"&&addTx()}/>
          }
        </div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
        <input type="text" style={{...S.input,flex:1,minWidth:140}} placeholder="Note (optional)" value={txForm.note}
          onChange={e=>setTxForm({...txForm,note:e.target.value})}/>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#6366F1",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={txForm.isSplit} onChange={e=>{
            setTxForm({...txForm,isSplit:e.target.checked,cat:e.target.checked?"split":txForm.cat,splitCount:2,totalBill:"",amount:""});
            setSplitPeople([{name:"",owes:0,paid:false}]);
          }}/>
          Split with friends
        </label>
      </div>
      {txForm.isSplit&&(
        <div style={{background:"#E3F2FD22",border:"1px solid #90CAF944",borderRadius:8,padding:"14px",marginBottom:10}}>
          {/* Stepper */}
          <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:12,flexWrap:"wrap"}}>
            <div style={{fontSize:12,fontWeight:600,color:"#1565C0"}}>Split how many ways?</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button type="button" onClick={()=>setSplitCount(txForm.splitCount-1)}
                style={{width:32,height:32,borderRadius:"50%",border:"1.5px solid #1565C0",background:"#FFF",color:"#1565C0",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>−</button>
              <span style={{fontSize:22,fontWeight:700,minWidth:28,textAlign:"center",color:"#0F172A"}}>{txForm.splitCount}</span>
              <button type="button" onClick={()=>setSplitCount(txForm.splitCount+1)}
                style={{width:32,height:32,borderRadius:"50%",border:"1.5px solid #1565C0",background:"#1565C0",color:"#FFF",fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>+</button>
            </div>
            {perShare>0&&(
              <div style={{background:"#E1F5EE",border:"1px solid #5DCAA5",borderRadius:8,padding:"6px 14px",fontSize:12}}>
                <span style={{fontWeight:700,color:"#085041"}}>{c2(perShare)}</span>
                <span style={{color:"#64748B",marginLeft:6}}>each ({txForm.splitCount} ways)</span>
              </div>
            )}
          </div>
          {/* Your share summary */}
          {perShare>0&&(
            <div style={{fontSize:11,color:"#6366F1",fontWeight:500,marginBottom:10}}>
              Your share: <strong>{c2(perShare)}</strong> · {txForm.splitCount-1} {txForm.splitCount-1===1?"person":"people"} each owe <strong>{c2(perShare)}</strong>
            </div>
          )}
          {/* Optional names */}
          <div style={{fontSize:10,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:8}}>Name the others (optional)</div>
          {Array.from({length:txForm.splitCount-1},(_,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:"#64748B",minWidth:56}}>Person {i+1}</span>
              <input type="text" style={{...S.input,flex:1}} placeholder="Name (optional)"
                value={splitPeople[i]?.name||""}
                onChange={e=>{const n=[...splitPeople];while(n.length<=i)n.push({name:"",owes:0,paid:false});n[i]={...n[i],name:e.target.value};setSplitPeople(n);}}/>
              {perShare>0&&<span style={{fontSize:12,fontWeight:600,color:"#1565C0",whiteSpace:"nowrap"}}>{c2(perShare)}</span>}
            </div>
          ))}
        </div>
      )}
      <div style={{display:"flex",gap:8}}>
        <button style={S.btnS("#6366F1")} onClick={addTx}>Add →</button>
        <button style={S.btn("#64748B")} onClick={()=>{setShowTxForm(false);setTxForm({date:now.toISOString().split("T")[0],merchant:"",cat:"dining",amount:"",note:"",isSplit:false,splitWith:[],totalBill:"",splitCount:2});setSplitPeople([{name:"",owes:0,paid:false}]);}}>Cancel</button>
      </div>
    </div>
  );
}

function TxList({txs,showDel=true,addReimb,delTx,cats,editTxId,editTxForm,setEditTxForm,startEditTx,saveTx}){
  const cc_=(id)=>catColor(cats,id); const cb_=(id)=>catBg(cats,id); const cl_=(id)=>catLabel(cats,id);
  const grouped=[...txs].sort((a,b)=>new Date(b.date)-new Date(a.date))
    .reduce((acc,tx)=>{if(!acc[tx.date])acc[tx.date]=[];acc[tx.date].push(tx);return acc;},{});
  if(txs.length===0) return <div style={{textAlign:"center",padding:"32px 0",color:"#64748B",fontSize:12}}>No transactions yet</div>;
  return Object.entries(grouped).map(([date,txs])=>(
    <div key={date} style={{marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:600,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.5px",padding:"6px 0",borderBottom:"1px solid #F1EFE8",display:"flex",justifyContent:"space-between"}}>
        <span>{fmtFull(date)}</span>
        <span>{c0(txs.filter(t=>!t.isReimb).reduce((s,t)=>s+t.amount,0))}</span>
      </div>
      {txs.map(tx=>{
        const cc=cc_(tx.cat); const cb=cb_(tx.cat);
        const isEditing=editTxId===tx.id;
        if(isEditing&&editTxForm){
          return (
            <div key={tx.id} style={{...S.txrow,flexDirection:"column",alignItems:"stretch",background:"#FAFAF8",borderRadius:8,padding:"12px",margin:"4px 0"}}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:8,marginBottom:8}}>
                <div><div style={S.slabel}>Date</div>
                  <input type="date" style={S.input} value={editTxForm.date} onChange={e=>setEditTxForm({...editTxForm,date:e.target.value})}/></div>
                <div><div style={S.slabel}>Merchant</div>
                  <input type="text" style={S.iy} value={editTxForm.merchant} autoFocus
                    onChange={e=>setEditTxForm({...editTxForm,merchant:e.target.value})}/></div>
                <div><div style={S.slabel}>Category</div>
                  <select style={S.sel} value={editTxForm.cat} onChange={e=>setEditTxForm({...editTxForm,cat:e.target.value})}>
                    {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select></div>
                <div><div style={S.slabel}>Amount ($)</div>
                  <input type="number" inputMode="decimal" style={S.iy} value={editTxForm.amount}
                    onChange={e=>setEditTxForm({...editTxForm,amount:e.target.value})}/></div>
              </div>
              <div style={{marginBottom:8}}>
                <input type="text" style={S.input} placeholder="Note (optional)" value={editTxForm.note}
                  onChange={e=>setEditTxForm({...editTxForm,note:e.target.value})}/>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button style={S.btnS("#6366F1")} onClick={()=>saveTx(tx.id)}>Save</button>
                <button style={S.btn("#64748B")} onClick={()=>startEditTx(null)}>Cancel</button>
              </div>
            </div>
          );
        }
        return (
          <div key={tx.id} style={S.txrow}>
            <div style={{width:38,height:38,borderRadius:10,background:tx.isReimb?"#D1FAE5":cc+"1a",border:`1.5px solid ${tx.isReimb?"#6EE7B7":cc+"30"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:15,fontWeight:700,color:tx.isReimb?"#059669":cc,lineHeight:1}}>
                {tx.isReimb?"↩":(tx.merchant||"?")[0].toUpperCase()}
              </span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:500}}>{tx.merchant}</span>
                {tx.recurringId&&<Pill label="recurring" color="#0F6E56" bg="#E1F5EE"/>}
                {tx.isReimb&&<Pill label="reimbursement ↩" color="#1D9E75" bg="#E1F5EE"/>}
                {tx.isSplit&&<Pill label="split" color="#1565C0" bg="#E3F2FD"/>}
                <Pill label={cl_(tx.cat)} color={cc} bg={cb}/>
              </div>
              {tx.note&&<div style={{fontSize:10,color:"#64748B"}}>{tx.note}</div>}
              {tx.isSplit&&tx.splitWith?.length>0&&(
                <div style={{marginTop:4}}>
                  {tx.splitWith.map((p,i)=>(
                    <div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,marginRight:8,fontSize:11}}>
                      <span style={{color:p.paid?"#1D9E75":"#1565C0",fontWeight:500}}>{p.name}</span>
                      <span style={{color:"#64748B"}}>owes {c2(p.owes)}</span>
                      {p.paid?<Pill label="paid ✓" color="#1D9E75" bg="#E1F5EE"/>
                        :<button style={{...S.btn("#1565C0"),padding:"2px 8px",fontSize:10}} onClick={()=>addReimb(tx.id,i)}>Mark paid</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:700,color:tx.isReimb?"#1D9E75":"#0F172A"}}>{tx.isReimb?"+":""}{c2(tx.amount)}</div>
              {tx.isSplit&&tx.totalBill>0&&<div style={{fontSize:10,color:"#64748B"}}>of {c2(tx.totalBill)}</div>}
            </div>
            {showDel&&<button onClick={()=>startEditTx(tx)} title="Edit" style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:13,padding:"0 2px",flexShrink:0}}>✎</button>}
            {showDel&&<button onClick={()=>delTx(tx.id)} style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>×</button>}
          </div>
        );
      })}
    </div>
  ));
}

// ── PLAID CONNECT BUTTON ──────────────────────────────────────────
function PlaidConnectButton({ onConnected }) {
  const [linkToken, setLinkToken] = useState("");
  const [loading,   setLoading]   = useState(false);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      try {
        const res = await fetch(`${FUNC_BASE}/plaid-exchange-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token, institution: metadata.institution }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        onConnected(data);
      } catch(e) { console.error("Exchange error:", e); }
      finally { setLoading(false); setLinkToken(""); }
    },
    onExit: () => { setLoading(false); setLinkToken(""); },
  });

  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${FUNC_BASE}/plaid-link-token`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLinkToken(data.link_token);
    } catch(e) { console.error("Link token error:", e); setLoading(false); }
  };

  return (
    <button style={S.btnS("#6366F1")} onClick={handleConnect} disabled={loading}>
      {loading ? "Opening…" : "+ Connect Bank"}
    </button>
  );
}

// ── MAIN ─────────────────────────────────────────────────────────
export default function App(){
  const [tab,            setTab]            = useState("overview");
  const [vm,             setVm]             = useState(CUR_M);
  const [vy,             setVy]             = useState(CUR_Y);
  const [monthData,      setMonthData]      = useState({});
  const [budgets,        setBudgets]        = useState({housing:1500,groceries:400,dining:200,transport:250,entertain:150,subs:80,hustle:0,savings:500,roth:500,split:0,other:100});
  const [goals,          setGoals]          = useState([{id:1,name:"Emergency Fund",target:15000,saved:0,color:"#1D9E75"},{id:2,name:"Vacation",target:3000,saved:0,color:"#6366F1"}]);
  const [settings,       setSettings]       = useState({jobStart:DEFAULT_JOB_START,firstPaycheck:DEFAULT_FIRST_CHECK,payCycle:DEFAULT_PAY_CYCLE,rothRecurring:500,rothOverrides:{}});
  const [cats,           setCats]           = useState(DEFAULT_CATS);
  const [recurring,      setRecurring]      = useState([]);
  const [recurringSkips, setRecurringSkips] = useState({});
  const [rollover,       setRollover]       = useState({});
  const [loaded,         setLoaded]         = useState(false);
  const [saving,         setSaving]         = useState(false);

  // UI state
  const [showTxForm,      setShowTxForm]      = useState(false);
  const [showSettings,    setShowSettings]    = useState(false);
  const [showExport,      setShowExport]      = useState(false);
  const [editIncome,      setEditIncome]      = useState(null);
  const [tempVal,         setTempVal]         = useState("");
  const [txForm,          setTxForm]          = useState({date:now.toISOString().split("T")[0],merchant:"",cat:"dining",amount:"",note:"",isSplit:false,splitWith:[],totalBill:"",splitCount:2});
  const [splitPeople,     setSplitPeople]     = useState([{name:"",owes:0,paid:false}]);
  const [txSearch,        setTxSearch]        = useState("");
  const [editTxId,        setEditTxId]        = useState(null);
  const [editTxForm,      setEditTxForm]      = useState(null);
  const [showQuickAdd,    setShowQuickAdd]     = useState(false);
  const [quickForm,       setQuickForm]        = useState({merchant:"",amount:"",cat:"dining"});
  const [showRecurForm,   setShowRecurForm]    = useState(false);
  const [recurForm,       setRecurForm]        = useState({name:"",cat:"subs",amount:"",freq:"monthly",startDate:now.toISOString().split("T")[0]});

  // Plaid state
  const [connections,      setConnections]      = useState([]);
  const [syncedTxs,        setSyncedTxs]        = useState([]);
  const [importSelections, setImportSelections] = useState({});
  const [importSearch,     setImportSearch]     = useState("");
  const [syncing,          setSyncing]          = useState(false);

  // ── LOAD ──
  useEffect(()=>{
    async function load(){
      try {
        const keys=["v3_md","v3_budgets","v3_goals","v3_settings","v3_cats","v3_recurring","v3_recurringSkips","v3_rollover"];
        const res=await Promise.all(keys.map(k=>storage.get(k).catch(()=>null)));
        if(res[0]) setMonthData(JSON.parse(res[0].value));
        if(res[1]) setBudgets(JSON.parse(res[1].value));
        if(res[2]) setGoals(JSON.parse(res[2].value));
        if(res[3]) setSettings(JSON.parse(res[3].value));
        if(res[4]) setCats(JSON.parse(res[4].value));
        if(res[5]) setRecurring(JSON.parse(res[5].value));
        if(res[6]) setRecurringSkips(JSON.parse(res[6].value));
        if(res[7]) setRollover(JSON.parse(res[7].value));
      } catch(e){ console.error("Load error",e); }
      setLoaded(true);
    }
    load();
    loadConnections();
  },[]);

  const save = useCallback(async(key,value)=>{
    setSaving(true);
    try { await storage.set(key,JSON.stringify(value)); } catch(e){ console.error("Save error",e); }
    setTimeout(()=>setSaving(false),600);
  },[]);

  // ── DERIVED ──
  const mkey  = mkKey(vy,vm);
  const getMD = (y,m) => monthData[mkKey(y,m)]||{income:0,bonus:0,transactions:[],rothBalance:0};
  const curMD = monthData[mkey]||{income:0,bonus:0,transactions:[],rothBalance:0};
  const txList = curMD.transactions||[];

  const incAvail = hasIncome(settings.jobStart,vy,vm);
  const isFirstPayMonth=(()=>{
    const fp=settings.firstPaycheck||settings.jobStart; if(!fp) return false;
    const js=new Date(fp+"T12:00:00"); return vy===js.getFullYear()&&vm===js.getMonth();
  })();
  const payDates=getPayDates(settings.firstPaycheck,settings.payCycle||14,vy,vm);

  const catSpend=(cat,txs=txList)=>txs.filter(t=>t.cat===cat&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
  const reimbReceived=txList.filter(t=>t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
  const rawSpend=cats.reduce((s,c)=>s+catSpend(c.id),0)-reimbReceived;
  const totalSpent=Math.max(0,rawSpend);
  const totalIncome=(curMD.income||0)+(curMD.bonus||0);
  const netSaved=totalIncome-totalSpent;
  const savRate=totalIncome>0?netSaved/totalIncome:0;

  const pendingSplits=txList.filter(t=>t.isSplit&&t.splitWith&&t.splitWith.some(p=>!p.paid));
  const pendingTotal=pendingSplits.reduce((s,t)=>s+(t.splitWith||[]).filter(p=>!p.paid).reduce((ss,p)=>ss+(p.owes||0),0),0);

  // MoM
  const prevY=vm===0?vy-1:vy; const prevM=vm===0?11:vm-1;
  const prevTxList=(getMD(prevY,prevM).transactions||[]);
  const catSpendPrev=(catId)=>prevTxList.filter(t=>t.cat===catId&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);

  // Effective budget with rollover
  const getEffBudget=(catId,y,m)=>{
    const base=budgets[catId]||0;
    if(!rollover[catId]) return base;
    const pY=m===0?y-1:y; const pM=m===0?11:m-1;
    const pTxs=(getMD(pY,pM).transactions||[]);
    const pSp=pTxs.filter(t=>t.cat===catId&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
    return base+Math.max(0,base-pSp);
  };

  const annualCats=cats.map(cat=>{
    let total=0;
    for(let m=0;m<12;m++){const md=getMD(vy,m);total+=(md.transactions||[]).filter(t=>t.cat===cat.id&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);}
    return {...cat,total};
  });
  const annualIncome=Array.from({length:12},(_,m)=>{const md=getMD(vy,m);return(md.income||0)+(md.bonus||0);}).reduce((s,v)=>s+v,0);
  const annualSpent=annualCats.reduce((s,c)=>s+c.total,0);
  const annualSaved=annualIncome-annualSpent;
  const rothYTD=annualCats.find(c=>c.id==="roth")?.total||0;

  // Recurring
  const pendingRecurring=(y,m)=>recurring.filter(rec=>{
    if(!isRecurringDue(rec,y,m)) return false;
    const confirmed=(getMD(y,m).transactions||[]).some(t=>t.recurringId===rec.id);
    const skipped=!!recurringSkips[`${rec.id}_${mkKey(y,m)}`];
    return !confirmed&&!skipped;
  });
  const recurringBadgeCount=pendingRecurring(CUR_Y,CUR_M).length;

  // Filtered txList for search
  const filteredTxList=txSearch.trim()
    ?txList.filter(t=>t.merchant.toLowerCase().includes(txSearch.toLowerCase())||catLabel(cats,t.cat).toLowerCase().includes(txSearch.toLowerCase()))
    :txList;

  // ── MUTATIONS ──
  const updMD=(y,m,up)=>{
    const key=mkKey(y,m); const next={...monthData,[key]:{...getMD(y,m),...up}};
    setMonthData(next); save("v3_md",next);
  };

  const addTx=()=>{
    if(!txForm.merchant) return;
    if(txForm.isSplit&&!txForm.totalBill) return;
    if(!txForm.isSplit&&!txForm.amount) return;
    const perShare=txForm.isSplit?(parseFloat(txForm.totalBill)||0)/txForm.splitCount:0;
    const tx={id:Date.now(),date:txForm.date,merchant:txForm.merchant,cat:txForm.cat,
      amount:txForm.isSplit?perShare:parseFloat(txForm.amount)||0,
      note:txForm.note,isSplit:txForm.isSplit,isReimb:false,
      splitWith:txForm.isSplit
        ?Array.from({length:txForm.splitCount-1},(_,i)=>({
            name:splitPeople[i]?.name||`Person ${i+1}`,
            owes:perShare,paid:false}))
        :[],
      totalBill:txForm.isSplit?parseFloat(txForm.totalBill)||0:0};
    const key=mkKey(vy,vm); const ex=monthData[key]||{income:0,bonus:0,transactions:[],rothBalance:0};
    const next={...monthData,[key]:{...ex,transactions:[...(ex.transactions||[]),tx]}};
    setMonthData(next); save("v3_md",next);
    setTxForm({date:now.toISOString().split("T")[0],merchant:"",cat:txForm.cat,amount:"",note:"",isSplit:false,splitWith:[],totalBill:"",splitCount:2});
    setSplitPeople([{name:"",owes:0,paid:false}]); setShowTxForm(false);
  };

  const quickAddTx=()=>{
    if(!quickForm.merchant||!quickForm.amount) return;
    const tx={id:Date.now(),date:now.toISOString().split("T")[0],merchant:quickForm.merchant,
      cat:quickForm.cat,amount:parseFloat(quickForm.amount)||0,note:"",isSplit:false,isReimb:false,splitWith:[],totalBill:0};
    const key=mkKey(vy,vm); const ex=monthData[key]||{income:0,bonus:0,transactions:[],rothBalance:0};
    const next={...monthData,[key]:{...ex,transactions:[...(ex.transactions||[]),tx]}};
    setMonthData(next); save("v3_md",next);
    setQuickForm({merchant:"",amount:"",cat:quickForm.cat}); setShowQuickAdd(false);
  };

  const addReimb=(txId,personIdx)=>{
    const key=mkKey(vy,vm); const ex=monthData[key]||{};
    const txs=(ex.transactions||[]).map(t=>{
      if(t.id!==txId) return t;
      const sw=t.splitWith.map((p,i)=>i===personIdx?{...p,paid:true,paidDate:now.toISOString().split("T")[0]}:p);
      return {...t,splitWith:sw};
    });
    const next={...monthData,[key]:{...ex,transactions:txs}};
    setMonthData(next); save("v3_md",next);
  };

  const delTx=id=>{
    const key=mkKey(vy,vm); const ex=monthData[key]||{};
    const next={...monthData,[key]:{...ex,transactions:(ex.transactions||[]).filter(t=>t.id!==id)}};
    setMonthData(next); save("v3_md",next);
  };

  const startEditTx=tx=>{
    if(!tx){setEditTxId(null);setEditTxForm(null);return;}
    setEditTxId(tx.id);
    setEditTxForm({date:tx.date,merchant:tx.merchant,cat:tx.cat,amount:String(tx.amount),note:tx.note||""});
  };

  const saveTx=id=>{
    if(!editTxForm) return;
    const key=mkKey(vy,vm); const ex=monthData[key]||{};
    const txs=(ex.transactions||[]).map(t=>t.id!==id?t:{...t,
      date:editTxForm.date,merchant:editTxForm.merchant,cat:editTxForm.cat,
      amount:parseFloat(editTxForm.amount)||0,note:editTxForm.note});
    const next={...monthData,[key]:{...ex,transactions:txs}};
    setMonthData(next); save("v3_md",next);
    setEditTxId(null); setEditTxForm(null);
  };

  const confirmRecurring=(rec,y,m)=>{
    const startDay=parseInt((rec.startDate||"").split("-")[2]||"1");
    const lastDay=new Date(y,m+1,0).getDate();
    const day=String(Math.min(startDay,lastDay)).padStart(2,"0");
    const date=`${y}-${String(m+1).padStart(2,"0")}-${day}`;
    const tx={id:Date.now(),date,merchant:rec.name,cat:rec.cat,amount:rec.amount,
      note:"Recurring",recurringId:rec.id,isSplit:false,isReimb:false,splitWith:[],totalBill:0};
    const key=mkKey(y,m); const ex=monthData[key]||{income:0,bonus:0,transactions:[],rothBalance:0};
    const next={...monthData,[key]:{...ex,transactions:[...(ex.transactions||[]),tx]}};
    setMonthData(next); save("v3_md",next);
  };

  const skipRecurring=(recId,y,m)=>{
    const next={...recurringSkips,[`${recId}_${mkKey(y,m)}`]:true};
    setRecurringSkips(next); save("v3_recurringSkips",next);
  };

  const addRecurring=()=>{
    if(!recurForm.name||!recurForm.amount) return;
    const next=[...recurring,{id:Date.now(),name:recurForm.name,cat:recurForm.cat,
      amount:parseFloat(recurForm.amount)||0,freq:recurForm.freq,startDate:recurForm.startDate}];
    setRecurring(next); save("v3_recurring",next);
    setRecurForm({name:"",cat:"subs",amount:"",freq:"monthly",startDate:now.toISOString().split("T")[0]});
    setShowRecurForm(false);
  };

  const delRecurring=id=>{
    const next=recurring.filter(r=>r.id!==id); setRecurring(next); save("v3_recurring",next);
  };

  // ── PLAID ──
  const loadConnections = useCallback(async () => {
    try {
      const res  = await fetch(`${FUNC_BASE}/plaid-get-connections`, { method: "POST" });
      const data = await res.json();
      if (data.connections) setConnections(data.connections);
    } catch(e) { console.error("Load connections error:", e); }
  }, []);

  const syncTransactions = async () => {
    setSyncing(true);
    try {
      const res  = await fetch(`${FUNC_BASE}/plaid-sync-transactions`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Filter out already-imported plaid_ids
      const imported = new Set();
      Object.values(monthData).forEach(md => (md.transactions||[]).forEach(t => { if (t.plaid_id) imported.add(t.plaid_id); }));
      const fresh = (data.transactions||[]).filter(t => !imported.has(t.plaid_id));

      setSyncedTxs(fresh);
      const sel = {};
      fresh.forEach(t => { sel[t.plaid_id] = true; });
      setImportSelections(sel);
      loadConnections();
    } catch(e) { console.error("Sync error:", e); }
    finally { setSyncing(false); }
  };

  const importPlaidTxs = () => {
    const toImport = syncedTxs.filter(t => importSelections[t.plaid_id]);
    if (!toImport.length) return;

    const byMonth = {};
    toImport.forEach(t => {
      const [y, m] = t.date.split("-");
      const key = mkKey(parseInt(y), parseInt(m) - 1);
      if (!byMonth[key]) byMonth[key] = [];
      byMonth[key].push(t);
    });

    let next = { ...monthData };
    Object.entries(byMonth).forEach(([key, txs]) => {
      const ex = next[key] || { income:0, bonus:0, transactions:[], rothBalance:0 };
      const newTxs = txs.map((t, i) => ({
        id: Date.now() + i, date: t.date, merchant: t.merchant,
        cat: t.category, amount: t.amount,
        note: `${t.institution} · ${t.account}`,
        isSplit: false, isReimb: false, splitWith: [], totalBill: 0,
        plaid_id: t.plaid_id,
      }));
      next[key] = { ...ex, transactions: [...ex.transactions, ...newTxs] };
    });

    setMonthData(next); save("v3_md", next);
    const ids = new Set(toImport.map(t => t.plaid_id));
    setSyncedTxs(prev => prev.filter(t => !ids.has(t.plaid_id)));
    setImportSelections({});
  };

  const exportData=()=>{
    const lines=["FINTRACK EXPORT — "+new Date().toLocaleDateString(),""];
    Object.entries(monthData).forEach(([key,md])=>{
      const [y,m]=key.split("-");
      lines.push(`\n=== ${FULLMONTHS[parseInt(m)-1]} ${y} ===`);
      lines.push(`Income: ${c2(md.income||0)}`);
      if(md.bonus>0) lines.push(`Bonus: ${c2(md.bonus)}`);
      (md.transactions||[]).forEach(t=>{lines.push(`  ${t.date}  ${t.merchant.padEnd(30)}  ${c2(t.amount)}  [${t.cat}]${t.isSplit?" SPLIT":""}`);});
    });
    return lines.join("\n");
  };

  const getRothTarget=(y,m)=>{
    const key=mkKey(y,m);
    return settings.rothOverrides?.[key]!==undefined?settings.rothOverrides[key]:(settings.rothRecurring||500);
  };

  if(!loaded) return <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",flexDirection:"column",gap:12}}><div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#6366F1,#8B5CF6)",animation:"spin 1s linear infinite"}}/><span style={{color:"#64748B",fontSize:12,fontWeight:500}}>Loading your finances…</span></div>;

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      {/* TOPBAR */}
      <div style={S.topbar}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={S.logo}>fintrack</div>
          <div style={{width:1,height:14,background:"#E2E8F0"}}/>
          <div style={{fontSize:11,color:"#64748B"}}>{FULLMONTHS[vm]} {vy}</div>
          {pendingTotal>0&&<div style={{fontSize:11,background:"#E3F2FD",color:"#1565C0",padding:"2px 8px",borderRadius:20,fontWeight:600,cursor:"pointer"}} onClick={()=>setTab("splits")}>💸 {c0(pendingTotal)}</div>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button style={{...S.btn("#64748B"),padding:"4px 10px",fontSize:11}} onClick={()=>setShowSettings(!showSettings)}>⚙</button>
          <button style={{...S.btn("#6366F1"),padding:"4px 10px",fontSize:11}} onClick={()=>setShowExport(!showExport)}>↓</button>
          <div style={{fontSize:10,fontWeight:600,color:saving?"#10B981":"#CBD5E1",minWidth:40,transition:"color 0.4s",display:"flex",alignItems:"center",gap:4}}>{saving?<><span style={{width:6,height:6,borderRadius:"50%",background:"#10B981",display:"inline-block"}}/>saving</> :<><span style={{width:6,height:6,borderRadius:"50%",background:"#CBD5E1",display:"inline-block"}}/>saved</>}</div>
        </div>
      </div>

      {/* NAV */}
      <div style={{background:"#FFF",borderBottom:"1px solid #E2E8F0",padding:"0 20px"}}>
        <div style={S.nav}>
          {[["overview","Overview"],["txns","Transactions"],["accounts","Accounts"],["recurring","Recurring"],["annual","Annual"],["splits","Splits"],["goals","Goals"],["roth","Roth IRA"]].map(([id,l])=>(
            <button key={id} style={S.nb(tab===id)} onClick={()=>setTab(id)}>
              {l}{id==="recurring"&&recurringBadgeCount>0&&<span style={{marginLeft:4,background:"#E24B4A",color:"#FFF",borderRadius:10,fontSize:9,padding:"1px 5px",fontWeight:700,verticalAlign:"middle"}}>{recurringBadgeCount}</span>}
            </button>
          ))}
        </div>
      </div>

      <div style={S.body}>

        {/* SETTINGS */}
        {showSettings&&(
          <div style={{...S.card,marginBottom:16,border:"1.5px solid #E8E6E0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <div style={S.ptitle}>Settings</div>
              <button style={S.btn("#64748B")} onClick={()=>setShowSettings(false)}>Close</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:16,marginBottom:20}}>
              <div>
                <div style={S.slabel}>Job start date</div>
                <input type="date" style={S.iy} value={settings.jobStart}
                  onChange={e=>{const next={...settings,jobStart:e.target.value};setSettings(next);save("v3_settings",next);}}/>
              </div>
              <div>
                <div style={S.slabel}>First paycheck date</div>
                <input type="date" style={{...S.iy,borderColor:settings.firstPaycheck?"#EF9F27":"#E24B4A"}} value={settings.firstPaycheck||""}
                  onChange={e=>{const next={...settings,firstPaycheck:e.target.value};setSettings(next);save("v3_settings",next);}}/>
                <div style={{fontSize:10,color:settings.firstPaycheck?"#64748B":"#A32D2D",marginTop:4}}>
                  {settings.firstPaycheck?"Pay dates calculated from here":"Set this when HR confirms"}
                </div>
              </div>
              <div>
                <div style={S.slabel}>Pay cycle</div>
                <select style={S.sel} value={settings.payCycle||14}
                  onChange={e=>{const next={...settings,payCycle:parseInt(e.target.value)};setSettings(next);save("v3_settings",next);}}>
                  <option value={7}>Weekly</option><option value={14}>Biweekly</option>
                  <option value={15}>Semi-monthly</option><option value={30}>Monthly</option>
                </select>
              </div>
              <div>
                <div style={S.slabel}>Default Roth IRA contribution</div>
                <input type="number" inputMode="decimal" style={S.iy} value={settings.rothRecurring||500}
                  onChange={e=>{const next={...settings,rothRecurring:parseFloat(e.target.value)||0};setSettings(next);save("v3_settings",next);}}/>
              </div>
            </div>

            {/* CATEGORIES */}
            <div style={{borderTop:"1px solid #E8E6E0",paddingTop:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={S.ptitle}>Categories</div>
                <button style={S.btn("#6366F1")} onClick={()=>{
                  const newCat={id:"cat_"+Date.now(),label:"New Category",color:"#6366F1",bg:autoBg("#6366F1")};
                  const next=[...cats,newCat]; setCats(next); save("v3_cats",next);
                }}>+ Add</button>
              </div>
              <div style={{display:"grid",gap:8}}>
                {cats.map(cat=>(
                  <div key={cat.id} style={{display:"flex",alignItems:"center",gap:8}}>
                    <input type="color" value={cat.color} style={{width:28,height:28,border:"none",borderRadius:4,cursor:"pointer",padding:0,background:"none"}}
                      onChange={e=>{const col=e.target.value;const next=cats.map(c=>c.id===cat.id?{...c,color:col,bg:autoBg(col)}:c);setCats(next);save("v3_cats",next);}}/>
                    <input type="text" value={cat.label} style={{...S.input,flex:1}}
                      onChange={e=>{const next=cats.map(c=>c.id===cat.id?{...c,label:e.target.value}:c);setCats(next);save("v3_cats",next);}}/>
                    <button onClick={()=>{
                      if(cats.length<=1) return;
                      const next=cats.filter(c=>c.id!==cat.id); setCats(next); save("v3_cats",next);
                    }} style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:18,padding:"0 4px",flexShrink:0}}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* EXPORT */}
        {showExport&&(
          <div style={{...S.card,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <div style={S.ptitle}>Export</div>
              <button style={S.btn("#64748B")} onClick={()=>setShowExport(false)}>Close</button>
            </div>
            <textarea readOnly value={exportData()} style={{...S.input,height:200,fontFamily:"monospace",fontSize:11,resize:"vertical"}}/>
            <div style={{fontSize:11,color:"#64748B",marginTop:6}}>Copy and save this as your backup.</div>
          </div>
        )}

        {/* ══ OVERVIEW ══ */}
        {tab==="overview"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <IncomeRow incAvail={incAvail} settings={settings} editIncome={editIncome} setEditIncome={setEditIncome}
            tempVal={tempVal} setTempVal={setTempVal} curMD={curMD} updMD={updMD} vy={vy} vm={vm}
            isFirstPayMonth={isFirstPayMonth} payDates={payDates} pendingTotal={pendingTotal} setTab={setTab}/>
          <div style={S.g4}>
            {[
              {l:"Total income", v:c0(totalIncome), c:totalIncome>0?"#1D9E75":"#64748B", s:curMD.bonus>0?`incl. ${c0(curMD.bonus)} bonus`:"this month"},
              {l:"Total spent",  v:c0(totalSpent),  c:totalSpent>totalIncome&&totalIncome>0?"#A32D2D":"#0F172A", s:`${c0(Object.values(budgets).reduce((s,v)=>s+v,0))} budgeted`},
              {l:"Net saved",    v:c0(netSaved),    c:netSaved>=0?"#1D9E75":"#A32D2D", s:netSaved>=0?"on track ↑":"over budget ↓"},
              {l:"Savings rate", v:totalIncome>0?pct(savRate):"—", c:savRate>=0.2?"#1D9E75":savRate>0?"#BA7517":"#64748B", s:totalIncome>0?(savRate>=0.2?"above 20% target":"below 20%"):"no income yet"},
            ].map((k,i)=>(
              <div key={i} style={S.kpi}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.c,opacity:0.85,borderRadius:"14px 14px 0 0"}}/>
                <div style={{...S.klabel,marginTop:6}}>{k.l}</div>
                <div style={S.kval(k.c)}>{k.v}</div>
                <div style={S.ksub}>{k.s}</div>
              </div>
            ))}
          </div>
          <div style={S.g2}>
            <div style={S.card}>
              <div style={S.ptitle}>Spending by category</div>
              {cats.filter(cat=>catSpend(cat.id)>0||budgets[cat.id]>0).map(cat=>{
                const sp=catSpend(cat.id);
                const effBudget=getEffBudget(cat.id,vy,vm);
                const ov=sp>effBudget&&effBudget>0;
                const ratio=effBudget>0?sp/effBudget:0;
                const alert=ratio>=1?"red":ratio>=0.8?"yellow":"none";
                const prevSp=catSpendPrev(cat.id);
                const delta=sp-prevSp;
                const rolloverAmt=rollover[cat.id]?Math.max(0,(budgets[cat.id]||0)-prevSp):0;
                return (
                  <div key={cat.id} style={{padding:"9px 0",borderBottom:"1px solid #F1EFE8"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:10,height:10,borderRadius:2,background:cat.color}}/>
                        <span style={{fontSize:12,fontWeight:500}}>{cat.label}</span>
                        {alert==="red"&&<span style={{width:7,height:7,borderRadius:"50%",background:"#E24B4A",display:"inline-block",flexShrink:0}}/>}
                        {alert==="yellow"&&<span style={{width:7,height:7,borderRadius:"50%",background:"#EF9F27",display:"inline-block",flexShrink:0}}/>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        {(prevSp>0||sp>0)&&<span style={{fontSize:10,color:delta>0?"#A32D2D":delta<0?"#1D9E75":"#64748B",minWidth:40,textAlign:"right"}}>{delta>0?"+":""}{c0(delta)}</span>}
                        <span style={{fontSize:13,fontWeight:700,color:ov?"#A32D2D":"#0F172A"}}>{c0(sp)}</span>
                        {effBudget>0&&<span style={{fontSize:11,color:"#64748B"}}>/ {c0(effBudget)}</span>}
                        {ov&&<Pill label="over" color="#A32D2D"/>}
                      </div>
                    </div>
                    <Bar val={sp} max={Math.max(effBudget,sp,1)} color={ov?"#E24B4A":alert==="yellow"?"#EF9F27":cat.color}/>
                    {rolloverAmt>0&&<div style={{fontSize:10,color:"#1D9E75",marginTop:2}}>+{c0(rolloverAmt)} rollover</div>}
                  </div>
                );
              })}
              {cats.every(c=>catSpend(c.id)===0)&&<div style={{color:"#64748B",fontSize:12,textAlign:"center",padding:"20px 0"}}>No transactions yet this month</div>}
            </div>
            <div>
              <div style={{...S.card,marginBottom:14}}>
                <div style={S.ptitle}>Breakdown</div>
                <div style={{display:"flex",alignItems:"center",gap:16}}>
                  <DonutChart data={cats.map(c=>({v:catSpend(c.id),color:c.color}))} size={110}/>
                  <div style={{flex:1}}>
                    {cats.filter(c=>catSpend(c.id)>0).map(cat=>(
                      <div key={cat.id} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:cat.color}}/>
                          <span style={{fontSize:11,color:"#444441"}}>{cat.label}</span>
                        </div>
                        <span style={{fontSize:11,fontWeight:600}}>{totalSpent>0?pct(catSpend(cat.id)/totalSpent,0):"—"}</span>
                      </div>
                    ))}
                    {cats.every(c=>catSpend(c.id)===0)&&<div style={{fontSize:11,color:"#64748B"}}>Add transactions to see breakdown</div>}
                  </div>
                </div>
              </div>
              <div style={S.card}>
                <div style={{...S.ptitle,display:"flex",justifyContent:"space-between"}}>
                  <span>Recent</span>
                  <button style={{...S.btn("#6366F1"),padding:"2px 8px",fontSize:11}} onClick={()=>setTab("txns")}>All →</button>
                </div>
                <TxList txs={[...txList].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5)} showDel={false} addReimb={addReimb} delTx={delTx} cats={cats} editTxId={editTxId} editTxForm={editTxForm} setEditTxForm={setEditTxForm} startEditTx={startEditTx} saveTx={saveTx}/>
              </div>
            </div>
          </div>
        </>)}

        {/* ══ TRANSACTIONS ══ */}
        {tab==="txns"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:15,fontWeight:700}}>{FULLMONTHS[vm]}</div>
            <button style={S.btnS("#6366F1")} onClick={()=>setShowTxForm(!showTxForm)}>{showTxForm?"✕ Cancel":"+ Add"}</button>
          </div>
          {showTxForm&&<TxForm txForm={txForm} setTxForm={setTxForm} splitPeople={splitPeople} setSplitPeople={setSplitPeople} addTx={addTx} setShowTxForm={setShowTxForm} cats={cats}/>}
          {!showTxForm&&(
            <div style={{marginBottom:10}}>
              <button style={S.btn("#1D9E75")} onClick={()=>{
                const reimb={id:Date.now(),date:now.toISOString().split("T")[0],merchant:"Reimbursement received",cat:"other",amount:0,note:"",isReimb:true,isSplit:false,splitWith:[]};
                const key=mkKey(vy,vm); const ex=monthData[key]||{income:0,bonus:0,transactions:[],rothBalance:0};
                const next={...monthData,[key]:{...ex,transactions:[...(ex.transactions||[]),reimb]}};
                setMonthData(next); save("v3_md",next);
              }}>+ Log reimbursement</button>
            </div>
          )}
          {/* Search bar */}
          <div style={{marginBottom:12}}>
            <input type="text" value={txSearch} onChange={e=>setTxSearch(e.target.value)}
              placeholder="Search merchant or category…" style={{...S.input,background:"#FFF"}}/>
          </div>
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <div style={S.ptitle}>{filteredTxList.length} transaction{filteredTxList.length!==1?"s":""}{txSearch?" (filtered)":""}</div>
              <span style={{fontSize:13,fontWeight:700}}>{c0(totalSpent)} net</span>
            </div>
            <TxList txs={filteredTxList} addReimb={addReimb} delTx={delTx} cats={cats} editTxId={editTxId} editTxForm={editTxForm} setEditTxForm={setEditTxForm} startEditTx={startEditTx} saveTx={saveTx}/>
          </div>
          <div style={{...S.card,marginTop:14}}>
            <div style={S.ptitle}>Monthly budget targets</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
              {cats.map(cat=>(
                <div key={cat.id} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:3,height:12,background:cat.color,borderRadius:2}}/>
                  <span style={{flex:1,fontSize:12,color:"#444441"}}>{cat.label}</span>
                  <label style={{fontSize:10,color:rollover[cat.id]?"#1D9E75":"#CBD5E1",display:"flex",alignItems:"center",gap:3,cursor:"pointer",whiteSpace:"nowrap"}}>
                    <input type="checkbox" checked={!!rollover[cat.id]}
                      onChange={e=>{const next={...rollover,[cat.id]:e.target.checked};setRollover(next);save("v3_rollover",next);}}/>
                    rollover
                  </label>
                  <input type="number" inputMode="decimal" value={budgets[cat.id]||0}
                    onChange={e=>{const next={...budgets,[cat.id]:parseFloat(e.target.value)||0};setBudgets(next);save("v3_budgets",next);}}
                    style={{...S.input,width:90,textAlign:"right"}}/>
                </div>
              ))}
            </div>
          </div>
        </>)}

        {/* ══ ACCOUNTS (PLAID) ══ */}
        {tab==="accounts"&&(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div>
              <div style={{fontSize:15,fontWeight:700}}>Connected Accounts</div>
              <div style={{fontSize:11,color:"#64748B",marginTop:2}}>Sandbox mode — test data only. Switch to production when ready.</div>
            </div>
            <PlaidConnectButton onConnected={()=>loadConnections()}/>
          </div>

          {/* Bank cards */}
          {connections.length===0?(
            <div style={{...S.card,textAlign:"center",padding:"40px 20px",marginBottom:16}}>
              <div style={{fontSize:36,marginBottom:12}}>🏦</div>
              <div style={{fontSize:14,fontWeight:700,color:"#0F172A",marginBottom:6}}>No accounts connected yet</div>
              <div style={{fontSize:12,color:"#64748B",marginBottom:16}}>Connect your Chase or Amex account to automatically import transactions.</div>
              <PlaidConnectButton onConnected={()=>loadConnections()}/>
            </div>
          ):(
            <div style={{...S.card,marginBottom:16}}>
              <div style={S.ptitle}>Your banks</div>
              {connections.map(conn=>(
                <div key={conn.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 0",borderBottom:"1px solid #F1F5F9"}}>
                  <div style={{width:42,height:42,borderRadius:12,background:"linear-gradient(135deg,#EEF2FF,#E0E7FF)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>🏦</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700}}>{conn.institution_name}</div>
                    <div style={{fontSize:11,color:"#64748B"}}>
                      {(conn.accounts||[]).map((a,i)=>(
                        <span key={i}>{a.name}{a.mask?` ···${a.mask}`:""}{i<conn.accounts.length-1?" · ":""}</span>
                      ))}
                    </div>
                    <div style={{fontSize:10,color:"#94A3B8",marginTop:2}}>
                      Last synced: {conn.last_synced?new Date(conn.last_synced).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Never"}
                    </div>
                  </div>
                  <Pill label="Connected ✓" color="#10B981" bg="#D1FAE5"/>
                </div>
              ))}
              <div style={{paddingTop:14,display:"flex",gap:10,alignItems:"center"}}>
                <button style={S.btnS("#6366F1")} onClick={syncTransactions} disabled={syncing}>
                  {syncing?"↻ Syncing…":"↻ Sync Now"}
                </button>
                {syncing&&<div style={{fontSize:11,color:"#6366F1"}}>Fetching transactions from Plaid…</div>}
              </div>
            </div>
          )}

          {/* Import preview */}
          {syncedTxs.length>0&&(<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div>
                <div style={{fontSize:14,fontWeight:700}}>{syncedTxs.length} new transaction{syncedTxs.length!==1?"s":""} ready to import</div>
                <div style={{fontSize:11,color:"#64748B"}}>{Object.values(importSelections).filter(Boolean).length} selected</div>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button style={S.btn("#64748B")} onClick={()=>{const s={};syncedTxs.forEach(t=>{s[t.plaid_id]=true;});setImportSelections(s);}}>All</button>
                <button style={S.btn("#64748B")} onClick={()=>setImportSelections({})}>None</button>
              </div>
            </div>
            <div style={{marginBottom:10}}>
              <input type="text" style={{...S.input,background:"#FFF"}} placeholder="Search transactions…"
                value={importSearch} onChange={e=>setImportSearch(e.target.value)}/>
            </div>
            <div style={S.card}>
              {syncedTxs
                .filter(t=>!importSearch||t.merchant.toLowerCase().includes(importSearch.toLowerCase())||catLabel(cats,t.category).toLowerCase().includes(importSearch.toLowerCase()))
                .slice(0,150)
                .map(t=>{
                  const cc=catColor(cats,t.category); const cb=catBg(cats,t.category);
                  return (
                    <div key={t.plaid_id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid #F1F5F9"}}>
                      <input type="checkbox" style={{flexShrink:0,width:16,height:16,cursor:"pointer"}}
                        checked={!!importSelections[t.plaid_id]}
                        onChange={e=>setImportSelections(prev=>({...prev,[t.plaid_id]:e.target.checked}))}/>
                      <div style={{width:34,height:34,borderRadius:8,background:cc+"1a",border:`1.5px solid ${cc}30`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:13,fontWeight:700,color:cc}}>{(t.merchant[0]||"?").toUpperCase()}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant}</div>
                        <div style={{fontSize:10,color:"#64748B"}}>{fmtD(t.date)} · {t.institution}</div>
                      </div>
                      <Pill label={catLabel(cats,t.category)} color={cc} bg={cb}/>
                      <div style={{fontSize:13,fontWeight:700,flexShrink:0,minWidth:60,textAlign:"right"}}>{c2(t.amount)}</div>
                    </div>
                  );
                })
              }
              {syncedTxs.length>150&&<div style={{fontSize:11,color:"#64748B",textAlign:"center",padding:"8px 0"}}>Showing 150 of {syncedTxs.length}. Search to filter.</div>}
            </div>
            <div style={{marginTop:14,display:"flex",gap:10,alignItems:"center"}}>
              <button style={S.btnS("#10B981")} onClick={importPlaidTxs}
                disabled={!Object.values(importSelections).some(Boolean)}>
                Import {Object.values(importSelections).filter(Boolean).length} transactions →
              </button>
              <button style={S.btn("#64748B")} onClick={()=>{setSyncedTxs([]);setImportSelections({});}}>Dismiss</button>
            </div>
          </>)}
        </>)}

        {/* ══ RECURRING ══ */}
        {tab==="recurring"&&(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700}}>Recurring</div>
            <button style={S.btnS("#6366F1")} onClick={()=>setShowRecurForm(!showRecurForm)}>{showRecurForm?"✕ Cancel":"+ Add Recurring"}</button>
          </div>

          {showRecurForm&&(
            <div style={{...S.card,marginBottom:14,border:"1.5px solid #AFA9EC"}}>
              <div style={S.ptitle}>New recurring payment</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,marginBottom:10}}>
                <div><div style={S.slabel}>Name</div>
                  <input type="text" style={S.iy} placeholder="e.g. Rent" value={recurForm.name}
                    onChange={e=>setRecurForm({...recurForm,name:e.target.value})}/></div>
                <div><div style={S.slabel}>Category</div>
                  <select style={S.sel} value={recurForm.cat} onChange={e=>setRecurForm({...recurForm,cat:e.target.value})}>
                    {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select></div>
                <div><div style={S.slabel}>Amount ($)</div>
                  <input type="number" inputMode="decimal" style={S.iy} placeholder="0.00" value={recurForm.amount}
                    onChange={e=>setRecurForm({...recurForm,amount:e.target.value})}/></div>
                <div><div style={S.slabel}>Frequency</div>
                  <select style={S.sel} value={recurForm.freq} onChange={e=>setRecurForm({...recurForm,freq:e.target.value})}>
                    <option value="monthly">Monthly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="weekly">Weekly</option>
                  </select></div>
                <div><div style={S.slabel}>Start date</div>
                  <input type="date" style={S.input} value={recurForm.startDate}
                    onChange={e=>setRecurForm({...recurForm,startDate:e.target.value})}/></div>
              </div>
              <button style={S.btnS("#6366F1")} onClick={addRecurring}>Save recurring →</button>
            </div>
          )}

          {/* Pending this month */}
          {(()=>{const pending=pendingRecurring(vy,vm);return pending.length>0&&(
            <div style={{...S.card,marginBottom:14,border:"1.5px solid #EF9F2744"}}>
              <div style={{...S.ptitle,color:"#BA7517"}}>Pending — {FULLMONTHS[vm]} ({pending.length})</div>
              {pending.map(rec=>{
                const cc=catColor(cats,rec.cat); const cb=catBg(cats,rec.cat);
                return (
                  <div key={rec.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #F1EFE8"}}>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600}}>{rec.name}</div>
                      <div style={{display:"flex",gap:6,marginTop:3}}>
                        <Pill label={catLabel(cats,rec.cat)} color={cc} bg={cb}/>
                        <Pill label={rec.freq} color="#64748B" bg="#F1EFE8"/>
                      </div>
                    </div>
                    <div style={{fontSize:14,fontWeight:700,color:"#0F172A",marginRight:8}}>{c2(rec.amount)}</div>
                    <button style={S.btnS("#1D9E75")} onClick={()=>confirmRecurring(rec,vy,vm)}>Confirm</button>
                    <button style={S.btn("#64748B")} onClick={()=>skipRecurring(rec.id,vy,vm)}>Skip</button>
                  </div>
                );
              })}
            </div>
          );})()}

          {/* All recurring definitions */}
          <div style={S.card}>
            <div style={S.ptitle}>All recurring ({recurring.length})</div>
            {recurring.length===0&&<div style={{color:"#64748B",fontSize:12,textAlign:"center",padding:"24px 0"}}>No recurring payments set up yet.</div>}
            {recurring.map(rec=>{
              const cc=catColor(cats,rec.cat); const cb=catBg(cats,rec.cat);
              const confirmedThisMonth=(getMD(vy,vm).transactions||[]).some(t=>t.recurringId===rec.id);
              const skippedThisMonth=!!recurringSkips[`${rec.id}_${mkKey(vy,vm)}`];
              return (
                <div key={rec.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid #F1EFE8"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:13,fontWeight:600}}>{rec.name}</span>
                      {confirmedThisMonth&&<Pill label="confirmed ✓" color="#1D9E75" bg="#E1F5EE"/>}
                      {skippedThisMonth&&<Pill label="skipped" color="#64748B" bg="#F1EFE8"/>}
                    </div>
                    <div style={{display:"flex",gap:6,marginTop:4}}>
                      <Pill label={catLabel(cats,rec.cat)} color={cc} bg={cb}/>
                      <Pill label={rec.freq} color="#64748B" bg="#F1EFE8"/>
                      <span style={{fontSize:10,color:"#64748B"}}>from {fmtD(rec.startDate)}</span>
                    </div>
                  </div>
                  <div style={{fontSize:14,fontWeight:700}}>{c2(rec.amount)}</div>
                  <button onClick={()=>delRecurring(rec.id)} style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:18,padding:"0 4px"}}>×</button>
                </div>
              );
            })}
          </div>
        </>)}

        {/* ══ SPLITS ══ */}
        {tab==="splits"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>Splits</div>
          <div style={S.g3}>
            <div style={S.kpi}><div style={S.klabel}>Pending</div><div style={S.kval("#1565C0")}>{c0(pendingTotal)}</div><div style={S.ksub}>friends still owe you</div></div>
            <div style={S.kpi}><div style={S.klabel}>Split txns</div><div style={S.kval("#0F172A")}>{txList.filter(t=>t.isSplit).length}</div><div style={S.ksub}>this month</div></div>
            <div style={S.kpi}><div style={S.klabel}>Reimbursed</div><div style={S.kval("#1D9E75")}>{c0(txList.filter(t=>t.isSplit).reduce((s,t)=>(t.splitWith||[]).filter(p=>p.paid).reduce((ss,p)=>ss+(p.owes||0),0)+s,0))}</div><div style={S.ksub}>received back</div></div>
          </div>
          <div style={S.card}>
            <div style={S.ptitle}>Split expenses — {FULLMONTHS[vm]}</div>
            {txList.filter(t=>t.isSplit).length===0&&<div style={{color:"#64748B",fontSize:12,textAlign:"center",padding:"24px 0"}}>No split expenses this month.</div>}
            {txList.filter(t=>t.isSplit).map(tx=>(
              <div key={tx.id} style={{...S.card,marginBottom:10,border:"1px solid #E3F2FD"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700}}>{tx.merchant}</div>
                    <div style={{fontSize:11,color:"#64748B"}}>{fmtD(tx.date)} · {catLabel(cats,tx.cat)}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#1565C0"}}>{c2(tx.amount)} <span style={{fontSize:11,color:"#64748B",fontWeight:400}}>your share</span></div>
                    {tx.totalBill>0&&<div style={{fontSize:11,color:"#64748B"}}>{c2(tx.totalBill)} total</div>}
                  </div>
                </div>
                {(tx.splitWith||[]).map((p,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderTop:"1px solid #F1EFE8"}}>
                    <div style={{flex:1}}>
                      <span style={{fontSize:12,fontWeight:600}}>{p.name}</span>
                      <span style={{fontSize:12,color:"#64748B",marginLeft:8}}>owes {c2(p.owes)}</span>
                    </div>
                    {p.paid?<Pill label={`Paid ✓ ${p.paidDate?fmtD(p.paidDate):""}`} color="#1D9E75" bg="#E1F5EE"/>
                      :<button style={S.btnS("#1565C0")} onClick={()=>addReimb(tx.id,i)}>Mark paid</button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>)}

        {/* ══ ANNUAL ══ */}
        {tab==="annual"&&(<>
          <div style={S.g4}>
            {[
              {l:"Annual income",    v:c0(annualIncome), c:"#1D9E75"},
              {l:"Annual spent",     v:c0(annualSpent),  c:"#0F172A"},
              {l:"Annual saved",     v:c0(annualSaved),  c:annualSaved>=0?"#185FA5":"#A32D2D"},
              {l:"Avg savings rate", v:annualIncome>0?pct(annualSaved/annualIncome):"—", c:"#BA7517"},
            ].map((k,i)=>(
              <div key={i} style={S.kpi}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:k.c,opacity:0.85,borderRadius:"14px 14px 0 0"}}/>
                <div style={{...S.klabel,marginTop:6}}>{k.l}</div>
                <div style={S.kval(k.c)}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={S.g2}>
            <div style={S.card}>
              <div style={S.ptitle}>Month by month — {vy}</div>
              <div style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,marginBottom:8,paddingBottom:6,borderBottom:"1px solid #E8E6E0"}}>
                {["","Income","Spent","Saved"].map((h,i)=><div key={i} style={{fontSize:10,color:"#64748B",textAlign:i>0?"right":"left"}}>{h}</div>)}
              </div>
              {MONTHS.map((m,i)=>{
                const md=getMD(vy,i); const inc=(md.income||0)+(md.bonus||0);
                const reimbs=(md.transactions||[]).filter(t=>t.isReimb).reduce((s,t)=>s+t.amount,0);
                const sp=Math.max(0,(md.transactions||[]).filter(t=>!t.isReimb).reduce((s,t)=>s+(t.amount||0),0)-reimbs);
                const sv=inc-sp; const has=(md.transactions||[]).length>0; const isNow=i===CUR_M&&vy===CUR_Y;
                return (
                  <div key={i} onClick={()=>{setVm(i);setTab("overview");}}
                    style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,padding:"6px 4px",borderBottom:"1px solid #F1EFE8",cursor:"pointer",background:isNow?"#F8F7FF":"transparent",borderRadius:4}}>
                    <div style={{fontSize:12,fontWeight:isNow?700:400,color:isNow?"#6366F1":"#444441"}}>{m}</div>
                    <div style={{fontSize:12,textAlign:"right",color:has?"#1D9E75":"#CBD5E1"}}>{has?c0(inc):"—"}</div>
                    <div style={{fontSize:12,textAlign:"right",color:has?"#0F172A":"#CBD5E1"}}>{has?c0(sp):"—"}</div>
                    <div style={{fontSize:12,textAlign:"right",fontWeight:600,color:has?(sv>=0?"#185FA5":"#A32D2D"):"#CBD5E1"}}>{has?c0(sv):"—"}</div>
                  </div>
                );
              })}
              <div style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,padding:"8px 4px",borderTop:"2px solid #E8E6E0",marginTop:4}}>
                {["TOTAL",c0(annualIncome),c0(annualSpent),c0(annualSaved)].map((v,i)=>(
                  <div key={i} style={{fontSize:12,fontWeight:700,textAlign:i>0?"right":"left",color:i===3?(annualSaved>=0?"#185FA5":"#A32D2D"):"#0F172A"}}>{v}</div>
                ))}
              </div>
            </div>
            <div style={S.card}>
              <div style={S.ptitle}>Annual by category</div>
              {annualCats.map(cat=>(
                <div key={cat.id} style={{padding:"8px 0",borderBottom:"1px solid #F1EFE8"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:10,height:10,borderRadius:2,background:cat.color}}/>
                      <span style={{fontSize:12,color:"#444441"}}>{cat.label}</span>
                    </div>
                    <div style={{display:"flex",gap:10}}>
                      <span style={{fontSize:12,fontWeight:700}}>{c0(cat.total)}</span>
                      <span style={{fontSize:11,color:"#64748B"}}>{annualSpent>0?pct(cat.total/annualSpent,0):"—"}</span>
                    </div>
                  </div>
                  <Bar val={cat.total} max={Math.max(annualSpent,1)} color={cat.color}/>
                </div>
              ))}
            </div>
          </div>
        </>)}

        {/* ══ GOALS ══ */}
        {tab==="goals"&&(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div style={{fontSize:15,fontWeight:700}}>Savings Goals</div>
            <button style={S.btnS("#1D9E75")} onClick={()=>{const next=[...goals,{id:Date.now(),name:"New Goal",target:5000,saved:0,color:"#185FA5"}];setGoals(next);save("v3_goals",next);}}>+ Add Goal</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14}}>
            {goals.map(goal=>{
              const p=goal.target>0?Math.min(1,goal.saved/goal.target):0; const done=p>=1;
              return (
                <div key={goal.id} style={{...S.card,border:`1.5px solid ${done?"#5DCAA5":"#E2E8F0"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <input value={goal.name} onChange={e=>{const next=goals.map(g=>g.id===goal.id?{...g,name:e.target.value}:g);setGoals(next);save("v3_goals",next);}}
                      style={{background:"transparent",border:"none",outline:"none",fontSize:14,fontWeight:700,color:"#0F172A",fontFamily:"inherit",flex:1}}/>
                    {done&&<Pill label="Complete ✓" color="#1D9E75" bg="#E1F5EE"/>}
                  </div>
                  <div style={{marginBottom:10}}>
                    <Bar val={goal.saved} max={goal.target||1} color={done?"#1D9E75":goal.color} h={8}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#64748B",marginTop:4}}>
                      <span>{pct(p,0)} complete</span><span>{c0(Math.max(0,goal.target-goal.saved))} to go</span>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div><div style={S.slabel}>Target</div>
                      <input type="number" inputMode="decimal" value={goal.target} onChange={e=>{const next=goals.map(g=>g.id===goal.id?{...g,target:parseFloat(e.target.value)||0}:g);setGoals(next);save("v3_goals",next);}} style={S.input}/></div>
                    <div><div style={S.slabel}>Saved so far</div>
                      <input type="number" inputMode="decimal" value={goal.saved} onChange={e=>{const next=goals.map(g=>g.id===goal.id?{...g,saved:parseFloat(e.target.value)||0}:g);setGoals(next);save("v3_goals",next);}} style={S.iy}/></div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:12,fontWeight:700,color:goal.color}}>{c2(goal.saved)} / {c2(goal.target)}</span>
                    <button onClick={()=>{const next=goals.filter(g=>g.id!==goal.id);setGoals(next);save("v3_goals",next);}} style={{background:"none",border:"none",color:"#CBD5E1",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>)}

        {/* ══ ROTH IRA ══ */}
        {tab==="roth"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>Roth IRA</div>
          <div style={{fontSize:12,color:"#64748B",marginBottom:16}}>Auto-tracked from transactions · Add via Transactions tab with category "Roth IRA"</div>
          <div style={S.g3}>
            <div style={{...S.kpi,border:"1.5px solid #EF9F2744"}}>
              <div style={S.klabel}>Contributions YTD</div><div style={S.kval("#854F0B")}>{c0(rothYTD)}</div>
              <div style={S.ksub}>{c0(7000-rothYTD)} of $7,000 remaining</div>
            </div>
            <div style={S.kpi}><div style={S.klabel}>This month</div><div style={S.kval("#0F172A")}>{c0(catSpend("roth"))}</div><div style={S.ksub}>target: {c0(getRothTarget(vy,vm))}</div></div>
            <div style={S.kpi}><div style={S.klabel}>Monthly default</div><div style={S.kval("#1D9E75")}>{c0(settings.rothRecurring||500)}</div><div style={S.ksub}>change in Settings ⚙</div></div>
          </div>
          <div style={{...S.card,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={S.ptitle}>2026 contribution limit</div>
              <span style={{fontSize:12,fontWeight:700,color:"#854F0B"}}>{c0(rothYTD)} / $7,000</span>
            </div>
            <Bar val={rothYTD} max={7000} color="#BA7517" h={10}/>
            <div style={{fontSize:11,color:"#64748B",marginTop:5}}>{pct(rothYTD/7000,1)} used · {c0(7000-rothYTD)} remaining</div>
          </div>
          <div style={S.g2}>
            <div style={S.card}>
              <div style={S.ptitle}>Month-by-month contributions</div>
              {MONTHS.map((m,i)=>{
                const md=getMD(vy,i);
                const contrib=(md.transactions||[]).filter(t=>t.cat==="roth"&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
                const target=getRothTarget(vy,i); const isNow=i===CUR_M&&vy===CUR_Y;
                return (
                  <div key={i} style={{padding:"8px 0",borderBottom:"1px solid #F1EFE8",background:isNow?"#FFFBEB":"transparent",borderRadius:isNow?4:0,paddingLeft:isNow?6:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:contrib>0?5:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:12,fontWeight:isNow?700:400,color:isNow?"#854F0B":"#444441",width:32}}>{m}</span>
                        {isNow&&<Pill label="current" color="#854F0B" bg="#FAEEDA"/>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:12,fontWeight:700,color:contrib>0?"#854F0B":"#CBD5E1"}}>{contrib>0?c0(contrib):"—"}</span>
                        <span style={{fontSize:11,color:"#CBD5E1"}}>/ {c0(target)}</span>
                        {contrib>=target&&contrib>0&&<Pill label="✓" color="#1D9E75" bg="#E1F5EE"/>}
                      </div>
                    </div>
                    {contrib>0&&<Bar val={contrib} max={target||contrib} color="#BA7517"/>}
                  </div>
                );
              })}
              <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,borderTop:"2px solid #E8E6E0",marginTop:4}}>
                <span style={{fontSize:12,fontWeight:700}}>Total {vy}</span>
                <span style={{fontSize:13,fontWeight:700,color:"#854F0B"}}>{c0(rothYTD)}</span>
              </div>
            </div>
            <div style={S.card}>
              <div style={S.ptitle}>Monthly overrides</div>
              <div style={{fontSize:12,color:"#64748B",marginBottom:10}}>Override the default {c0(settings.rothRecurring||500)}/mo for a specific month</div>
              {MONTHS.map((m,i)=>{
                const key=mkKey(vy,i); const ov=settings.rothOverrides?.[key];
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                    <span style={{width:32,fontSize:12,color:"#444441",fontWeight:500}}>{m}</span>
                    <input type="number" inputMode="decimal" placeholder={`${settings.rothRecurring||500} (default)`}
                      value={ov!==undefined?ov:""}
                      onChange={e=>{
                        const v=e.target.value===""?undefined:parseFloat(e.target.value)||0;
                        const overrides={...(settings.rothOverrides||{})};
                        if(v===undefined) delete overrides[key]; else overrides[key]=v;
                        const next={...settings,rothOverrides:overrides};
                        setSettings(next); save("v3_settings",next);
                      }}
                      style={{...S.input,width:120,textAlign:"right",borderColor:ov!==undefined?"#EF9F27":"#E2E8F0"}}/>
                    {ov!==undefined&&<Pill label="override" color="#BA7517" bg="#FAEEDA"/>}
                  </div>
                );
              })}
            </div>
          </div>
        </>)}

      </div>

      {/* ── QUICK ADD FLOATING BUTTON ── */}
      {showQuickAdd&&(
        <div style={{position:"fixed",bottom:86,right:20,zIndex:100,background:"#FFF",border:"1px solid #E2E8F0",borderRadius:16,padding:18,boxShadow:"0 8px 32px rgba(15,23,42,0.14)",width:268}}>
          <div style={{fontSize:13,fontWeight:700,marginBottom:12,color:"#0F172A",letterSpacing:"-0.2px"}}>Quick Add</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <input type="text" style={S.iy} placeholder="Merchant" value={quickForm.merchant}
              onChange={e=>setQuickForm({...quickForm,merchant:e.target.value})}
              onKeyDown={e=>e.key==="Enter"&&quickAddTx()} autoFocus/>
            <input type="number" inputMode="decimal" style={S.iy} placeholder="Amount ($)" value={quickForm.amount}
              onChange={e=>setQuickForm({...quickForm,amount:e.target.value})}
              onKeyDown={e=>e.key==="Enter"&&quickAddTx()}/>
            <select style={S.sel} value={quickForm.cat} onChange={e=>setQuickForm({...quickForm,cat:e.target.value})}>
              {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <button style={{...S.btnS("#6366F1"),flex:1}} onClick={quickAddTx}>Add →</button>
            <button style={S.btn("#64748B")} onClick={()=>setShowQuickAdd(false)}>✕</button>
          </div>
        </div>
      )}
      <button onClick={()=>setShowQuickAdd(!showQuickAdd)}
        style={{position:"fixed",bottom:20,right:20,zIndex:100,width:54,height:54,borderRadius:"50%",background:"linear-gradient(135deg,#6366F1,#8B5CF6)",color:"#FFF",border:"none",fontSize:26,cursor:"pointer",boxShadow:"0 4px 20px rgba(99,102,241,0.5)",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,transition:"transform 0.15s",transform:showQuickAdd?"rotate(45deg)":"rotate(0deg)"}}>
        +
      </button>
    </div>
  );
}
