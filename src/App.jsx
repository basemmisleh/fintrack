import { useState, useEffect, useCallback } from "react";
import { storage } from "./storage.js";

const CATS = [
  { id:"housing",   label:"Housing",        color:"#185FA5", bg:"#E6F1FB" },
  { id:"groceries", label:"Groceries",      color:"#3B6D11", bg:"#EAF3DE" },
  { id:"dining",    label:"Dining Out",     color:"#854F0B", bg:"#FAEEDA" },
  { id:"transport", label:"Transportation", color:"#993C1D", bg:"#FAECE7" },
  { id:"entertain", label:"Entertainment",  color:"#993556", bg:"#FBEAF0" },
  { id:"subs",      label:"Subscriptions",  color:"#534AB7", bg:"#EEEDFE" },
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

const c2  = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const c0  = n => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:0,maximumFractionDigits:0}).format(n||0);
const pct = (n,d=1) => `${((n||0)*100).toFixed(d)}%`;
const mkKey  = (y,m) => `${y}-${String(m).padStart(2,"0")}`;
const fmtD   = d => { try { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}); } catch(e){ return d; }};
const fmtFull= d => { try { return new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"}); } catch(e){ return d; }};

function getPayDates(firstPaycheck, cycledays, year, month) {
  if(!firstPaycheck) return [];
  const start = new Date(firstPaycheck+"T12:00:00");
  if(isNaN(start)) return [];
  const endOfMonth = new Date(year, month+1, 0);
  const dates = [];
  let cur = new Date(start);
  while(cur <= endOfMonth) {
    if(cur.getMonth()===month && cur.getFullYear()===year)
      dates.push(cur.toISOString().split("T")[0]);
    cur.setDate(cur.getDate()+cycledays);
  }
  return dates;
}

function hasIncome(jobStart, year, month) {
  if(!jobStart) return false;
  const js = new Date(jobStart+"T12:00:00");
  const first = new Date(year, month, 1);
  return first >= new Date(js.getFullYear(), js.getMonth(), 1);
}

// ── MINI COMPONENTS ───────────────────────────────────────────────
function Bar({val,max,color,h=6}){
  const w=max>0?Math.min(100,(val/max)*100):0;
  return <div style={{height:h,background:"#EEECEA",borderRadius:h,overflow:"hidden"}}><div style={{height:"100%",width:`${w}%`,background:color,borderRadius:h,transition:"width 0.4s"}}/></div>;
}

function Pill({label,color,bg}){
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:20,background:bg||color+"18",color,fontWeight:600,display:"inline-block",whiteSpace:"nowrap"}}>{label}</span>;
}

function DonutChart({data,size=110}){
  const total=data.reduce((s,d)=>s+(d.v||0),0)||1;
  const r=size*0.34; const cx=size/2,cy=size/2;
  const circ=2*Math.PI*r; let off=0;
  const slices=data.filter(d=>d.v>0).map(d=>{
    const dash=(d.v/total)*circ;
    const s={dash,off,color:d.color}; off+=dash; return s;
  });
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEECEA" strokeWidth={r*0.5}/>
      {slices.map((s,i)=>(
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color}
          strokeWidth={r*0.5} strokeDasharray={`${s.dash} ${circ-s.dash}`}
          strokeDashoffset={-s.off} transform={`rotate(-90 ${cx} ${cy})`}
          style={{transition:"all 0.4s"}}/>
      ))}
      <text x={cx} y={cy-4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1E2130" fontFamily="DM Sans,sans-serif">{c0(data.reduce((s,d)=>s+(d.v||0),0))}</text>
      <text x={cx} y={cy+9} textAnchor="middle" fontSize="8" fill="#888780" fontFamily="DM Sans,sans-serif">total spent</text>
    </svg>
  );
}

// ── STYLES ────────────────────────────────────────────────────────
const S = {
  app:    {minHeight:"100vh",background:"#F5F4F0",fontFamily:"'DM Sans','Segoe UI',sans-serif",fontSize:13,color:"#1E2130"},
  topbar: {background:"#FFF",borderBottom:"1px solid #E8E6E0",padding:"0 16px",display:"flex",alignItems:"center",justifyContent:"space-between",height:50,position:"sticky",top:0,zIndex:30,boxShadow:"0 1px 3px rgba(0,0,0,0.04)"},
  logo:   {fontSize:15,fontWeight:700,color:"#1E2130",letterSpacing:"-0.5px"},
  nav:    {display:"flex",gap:2,overflowX:"auto"},
  nb:     a=>({padding:"5px 10px",background:a?"#EEEDFE":"transparent",border:"none",borderRadius:6,color:a?"#534AB7":"#888780",fontSize:12,cursor:"pointer",fontWeight:a?600:400,transition:"all 0.15s",fontFamily:"inherit",whiteSpace:"nowrap"}),
  body:   {padding:"16px",maxWidth:1200,margin:"0 auto"},
  mbar:   {display:"flex",gap:3,marginBottom:20,background:"#FFF",borderRadius:8,padding:5,border:"1px solid #E8E6E0"},
  mbtn:   (a,has)=>({flex:1,padding:"5px 2px",background:a?"#EEEDFE":"transparent",border:"none",borderRadius:5,color:a?"#534AB7":has?"#1E2130":"#BDBDBD",fontSize:10,cursor:"pointer",fontWeight:a?700:400,transition:"all 0.15s",fontFamily:"inherit",lineHeight:1.4}),
  g4:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:16},
  g2:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:14,marginBottom:14},
  g3:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:14},
  card:   {background:"#FFF",border:"1px solid #E8E6E0",borderRadius:10,padding:"16px 18px",boxShadow:"0 1px 3px rgba(0,0,0,0.03)"},
  kpi:    {background:"#FFF",border:"1px solid #E8E6E0",borderRadius:10,padding:"13px 15px",boxShadow:"0 1px 3px rgba(0,0,0,0.03)"},
  klabel: {fontSize:10,color:"#888780",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:4},
  kval:   c=>({fontSize:21,fontWeight:700,color:c||"#1E2130",letterSpacing:"-0.5px",lineHeight:1.1}),
  ksub:   {fontSize:11,color:"#888780",marginTop:3},
  ptitle: {fontSize:11,fontWeight:600,color:"#888780",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:12},
  slabel: {fontSize:10,color:"#888780",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:5},
  input:  {background:"#FAFAF8",border:"1px solid #E8E6E0",borderRadius:6,padding:"7px 10px",color:"#1E2130",fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
  iy:     {background:"#FFFBEB",border:"1.5px solid #EF9F27",borderRadius:6,padding:"7px 10px",color:"#412402",fontSize:13,fontWeight:600,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
  sel:    {background:"#FAFAF8",border:"1px solid #E8E6E0",borderRadius:6,padding:"7px 10px",color:"#1E2130",fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
  btn:    c=>({background:c+"18",border:`1px solid ${c}44`,borderRadius:6,padding:"7px 14px",color:c,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}),
  btnS:   c=>({background:c,border:`1px solid ${c}`,borderRadius:6,padding:"7px 16px",color:"#FFF",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}),
  txrow:  {display:"flex",alignItems:"flex-start",gap:8,padding:"9px 0",borderBottom:"1px solid #F1EFE8"},
};

// ── MODULE-LEVEL HELPERS ──────────────────────────────────────────
const catColor = id => CATS.find(c=>c.id===id)?.color||"#888";
const catBg    = id => CATS.find(c=>c.id===id)?.bg||"#F5F5F5";
const catLabel = id => CATS.find(c=>c.id===id)?.label||id;

// ── TOP-LEVEL COMPONENTS ──────────────────────────────────────────

function MonthBar({vm, vy, monthData, setVm}){
  const getMD=(y,m)=>monthData[mkKey(y,m)]||{income:0,bonus:0,transactions:[],rothBalance:0};
  return (
    <div style={S.mbar}>
      {MONTHS.map((m,i)=>{
        const md=getMD(vy,i);
        const has=(md.transactions||[]).length>0;
        const isNow=i===CUR_M&&vy===CUR_Y;
        return (
          <button key={i} style={S.mbtn(i===vm,has)} onClick={()=>setVm(i)}>
            <div>{m}</div>
            <div style={{fontSize:8}}>{isNow?"●":has?"·":""}</div>
          </button>
        );
      })}
    </div>
  );
}

function IncomeRow({incAvail, settings, editIncome, setEditIncome, tempVal, setTempVal, curMD, updMD, vy, vm, isFirstPayMonth, payDates, pendingTotal, setTab}){
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      {!incAvail?(
        <div style={{background:"#EEEDFE",border:"1px solid #AFA9EC",borderRadius:8,padding:"10px 16px",fontSize:12,color:"#534AB7",fontWeight:500}}>
          No income yet — job starts {new Date(settings.jobStart+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
          {!settings.firstPaycheck&&<span style={{color:"#A32D2D",marginLeft:8,fontWeight:600}}>· Set your first paycheck date in ⚙ Settings once HR confirms</span>}
          {settings.firstPaycheck&&<span style={{color:"#888780",fontWeight:400,marginLeft:8}}>· First paycheck: {new Date(settings.firstPaycheck+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric"})}</span>}
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
                <button style={S.btn("#888780")} onClick={()=>setEditIncome(null)}>✕</button>
              </div>
            ):(
              <div onClick={()=>{setTempVal(curMD.income||0);setEditIncome("income");}}
                style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#FFFBEB",border:"1.5px solid #EF9F27",borderRadius:6,cursor:"pointer"}}>
                <span style={{fontSize:16,fontWeight:700,color:"#412402"}}>{c0(curMD.income||0)}</span>
                <span style={{fontSize:10,color:"#888780"}}>✎</span>
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
                  <button style={S.btn("#888780")} onClick={()=>setEditIncome(null)}>✕</button>
                </div>
              ):(
                <div onClick={()=>{setTempVal(curMD.bonus||0);setEditIncome("bonus");}}
                  style={{display:"inline-flex",alignItems:"center",gap:6,padding:"6px 12px",background:"#EAF3DE",border:"1.5px solid #3B6D11",borderRadius:6,cursor:"pointer"}}>
                  <span style={{fontSize:16,fontWeight:700,color:"#173404"}}>{c0(curMD.bonus||0)}</span>
                  <span style={{fontSize:10,color:"#888780"}}>✎ bonus</span>
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

function TxForm({txForm, setTxForm, splitPeople, setSplitPeople, addTx, setShowTxForm}){
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
            {CATS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select></div>
        <div><div style={S.slabel}>Amount ($)</div>
          <input type="number" inputMode="decimal" style={S.iy} placeholder="0.00" value={txForm.amount}
            onChange={e=>setTxForm({...txForm,amount:e.target.value})}
            onKeyDown={e=>e.key==="Enter"&&!txForm.isSplit&&addTx()}/></div>
      </div>
      <div style={{display:"flex",gap:10,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
        <input type="text" style={{...S.input,flex:1,minWidth:140}} placeholder="Note (optional)" value={txForm.note}
          onChange={e=>setTxForm({...txForm,note:e.target.value})}/>
        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#534AB7",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={txForm.isSplit} onChange={e=>setTxForm({...txForm,isSplit:e.target.checked,cat:e.target.checked?"split":txForm.cat})}/>
          Split with friends
        </label>
      </div>
      {txForm.isSplit&&(
        <div style={{background:"#E3F2FD22",border:"1px solid #90CAF944",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:600,color:"#1565C0",marginBottom:10}}>Split details</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
            <div><div style={S.slabel}>Total bill</div>
              <input type="number" inputMode="decimal" style={S.iy} placeholder="0.00" value={txForm.totalBill}
                onChange={e=>setTxForm({...txForm,totalBill:e.target.value})}/></div>
            <div><div style={S.slabel}>Your share</div>
              <div style={{fontSize:12,color:"#888780",padding:"8px 0"}}>{c2(parseFloat(txForm.amount)||0)}</div></div>
          </div>
          {splitPeople.map((p,i)=>(
            <div key={i} style={{display:"flex",gap:8,marginBottom:6,alignItems:"center"}}>
              <input type="text" style={{...S.input,flex:1}} placeholder={`Friend ${i+1}`}
                value={p.name} onChange={e=>{const n=[...splitPeople];n[i]={...n[i],name:e.target.value};setSplitPeople(n);}}/>
              <input type="number" inputMode="decimal" style={{...S.input,width:90}} placeholder="Owes $"
                value={p.owes||""} onChange={e=>{const n=[...splitPeople];n[i]={...n[i],owes:parseFloat(e.target.value)||0};setSplitPeople(n);}}/>
              {splitPeople.length>1&&<button style={{...S.btn("#A32D2D"),padding:"5px 8px"}} onClick={()=>setSplitPeople(splitPeople.filter((_,j)=>j!==i))}>✕</button>}
            </div>
          ))}
          <button style={S.btn("#1565C0")} onClick={()=>setSplitPeople([...splitPeople,{name:"",owes:0,paid:false}])}>+ Add person</button>
        </div>
      )}
      <div style={{display:"flex",gap:8}}>
        <button style={S.btnS("#534AB7")} onClick={addTx}>Add →</button>
        <button style={S.btn("#888780")} onClick={()=>{setShowTxForm(false);setTxForm({date:now.toISOString().split("T")[0],merchant:"",cat:"dining",amount:"",note:"",isSplit:false,splitWith:[],totalBill:""});setSplitPeople([{name:"",owes:0,paid:false}]);}}>Cancel</button>
      </div>
    </div>
  );
}

function TxList({txs, showDel=true, addReimb, delTx}){
  const grouped=[...txs].sort((a,b)=>new Date(b.date)-new Date(a.date))
    .reduce((acc,tx)=>{if(!acc[tx.date])acc[tx.date]=[];acc[tx.date].push(tx);return acc;},{});
  if(txs.length===0) return <div style={{textAlign:"center",padding:"32px 0",color:"#888780",fontSize:12}}>No transactions yet</div>;
  return Object.entries(grouped).map(([date,txs])=>(
    <div key={date} style={{marginBottom:10}}>
      <div style={{fontSize:10,fontWeight:600,color:"#888780",textTransform:"uppercase",letterSpacing:"0.5px",padding:"6px 0",borderBottom:"1px solid #F1EFE8",display:"flex",justifyContent:"space-between"}}>
        <span>{fmtFull(date)}</span>
        <span>{c0(txs.filter(t=>!t.isReimb).reduce((s,t)=>s+t.amount,0))}</span>
      </div>
      {txs.map(tx=>{
        const cc=catColor(tx.cat); const cb=catBg(tx.cat);
        return (
          <div key={tx.id} style={S.txrow}>
            <div style={{width:3,height:tx.isSplit?36:14,background:tx.isReimb?"#1D9E75":cc,borderRadius:2,flexShrink:0,marginTop:2}}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:500}}>{tx.merchant}</span>
                {tx.isReimb&&<Pill label="reimbursement ↩" color="#1D9E75" bg="#E1F5EE"/>}
                {tx.isSplit&&<Pill label="split" color="#1565C0" bg="#E3F2FD"/>}
                <Pill label={catLabel(tx.cat)} color={cc} bg={cb}/>
              </div>
              {tx.note&&<div style={{fontSize:10,color:"#888780"}}>{tx.note}</div>}
              {tx.isSplit&&tx.splitWith?.length>0&&(
                <div style={{marginTop:4}}>
                  {tx.splitWith.map((p,i)=>(
                    <div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,marginRight:8,fontSize:11}}>
                      <span style={{color:p.paid?"#1D9E75":"#1565C0",fontWeight:500}}>{p.name}</span>
                      <span style={{color:"#888780"}}>owes {c2(p.owes)}</span>
                      {p.paid
                        ?<Pill label="paid ✓" color="#1D9E75" bg="#E1F5EE"/>
                        :<button style={{...S.btn("#1565C0"),padding:"2px 8px",fontSize:10}} onClick={()=>addReimb(tx.id,i)}>Mark paid</button>
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:700,color:tx.isReimb?"#1D9E75":"#1E2130"}}>{tx.isReimb?"+":""}{c2(tx.amount)}</div>
              {tx.isSplit&&tx.totalBill>0&&<div style={{fontSize:10,color:"#888780"}}>of {c2(tx.totalBill)}</div>}
            </div>
            {showDel&&<button onClick={()=>delTx(tx.id)} style={{background:"none",border:"none",color:"#BDBDBD",cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>×</button>}
          </div>
        );
      })}
    </div>
  ));
}

// ── MAIN ─────────────────────────────────────────────────────────
export default function App(){
  const [tab,       setTab]       = useState("overview");
  const [vm,        setVm]        = useState(CUR_M);
  const [vy,        setVy]        = useState(CUR_Y);
  const [monthData, setMonthData] = useState({});
  const [budgets,   setBudgets]   = useState({housing:1500,groceries:400,dining:200,transport:250,entertain:150,subs:80,hustle:0,savings:500,roth:500,split:0,other:100});
  const [goals,     setGoals]     = useState([{id:1,name:"Emergency Fund",target:15000,saved:0,color:"#1D9E75"},{id:2,name:"Vacation",target:3000,saved:0,color:"#534AB7"}]);
  const [settings,  setSettings]  = useState({jobStart:DEFAULT_JOB_START,firstPaycheck:DEFAULT_FIRST_CHECK,payCycle:DEFAULT_PAY_CYCLE,rothRecurring:500,rothOverrides:{}});
  const [loaded,    setLoaded]    = useState(false);
  const [saving,    setSaving]    = useState(false);

  // UI state
  const [showTxForm,   setShowTxForm]   = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport,   setShowExport]   = useState(false);
  const [editIncome,   setEditIncome]   = useState(null);
  const [tempVal,      setTempVal]      = useState("");
  const [txForm,       setTxForm]       = useState({date:now.toISOString().split("T")[0],merchant:"",cat:"dining",amount:"",note:"",isSplit:false,splitWith:[],totalBill:""});
  const [splitPeople,  setSplitPeople]  = useState([{name:"",owes:0,paid:false}]);

  // ── LOAD ──
  useEffect(()=>{
    async function load(){
      try {
        const keys=["v3_md","v3_budgets","v3_goals","v3_settings"];
        const res=await Promise.all(keys.map(k=>storage.get(k).catch(()=>null)));
        if(res[0]) setMonthData(JSON.parse(res[0].value));
        if(res[1]) setBudgets(JSON.parse(res[1].value));
        if(res[2]) setGoals(JSON.parse(res[2].value));
        if(res[3]) setSettings(JSON.parse(res[3].value));
      } catch(e){ console.error("Load error",e); }
      setLoaded(true);
    }
    load();
  },[]);

  const persist = useCallback(async(md,bg,gl,st)=>{
    setSaving(true);
    try {
      await Promise.all([
        storage.set("v3_md",      JSON.stringify(md??monthData)),
        storage.set("v3_budgets", JSON.stringify(bg??budgets)),
        storage.set("v3_goals",   JSON.stringify(gl??goals)),
        storage.set("v3_settings",JSON.stringify(st??settings)),
      ]);
    } catch(e){ console.error("Save error",e); }
    setTimeout(()=>setSaving(false),600);
  },[monthData,budgets,goals,settings]);

  // ── DERIVED ──
  const mkey   = mkKey(vy,vm);
  const curMD  = monthData[mkey] || {income:0,bonus:0,transactions:[],rothBalance:0};
  const txList = curMD.transactions || [];
  const incAvail = hasIncome(settings.jobStart, vy, vm);
  const isFirstPayMonth = (()=>{
    const fp=settings.firstPaycheck||settings.jobStart;
    if(!fp) return false;
    const js=new Date(fp+"T12:00:00");
    return vy===js.getFullYear() && vm===js.getMonth();
  })();
  const payDates = getPayDates(settings.firstPaycheck, settings.payCycle||14, vy, vm);

  const getMD = (y,m) => monthData[mkKey(y,m)] || {income:0,bonus:0,transactions:[],rothBalance:0};
  const catSpend = (cat,txs=txList) => txs.filter(t=>t.cat===cat).reduce((s,t)=>s+(t.amount||0),0);
  const reimbReceived = txList.filter(t=>t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
  const rawSpend = CATS.reduce((s,c)=>s+catSpend(c.id),0) - reimbReceived;
  const totalSpent = Math.max(0, rawSpend);
  const totalIncome = (curMD.income||0)+(curMD.bonus||0);
  const netSaved = totalIncome - totalSpent;
  const savRate  = totalIncome>0 ? netSaved/totalIncome : 0;

  const pendingSplits = txList.filter(t=>t.isSplit&&t.splitWith&&t.splitWith.some(p=>!p.paid));
  const pendingTotal  = pendingSplits.reduce((s,t)=>s+(t.splitWith||[]).filter(p=>!p.paid).reduce((ss,p)=>ss+(p.owes||0),0),0);

  const annualCats = CATS.map(cat=>{
    let total=0;
    for(let m=0;m<12;m++){
      const md=getMD(vy,m);
      total+=(md.transactions||[]).filter(t=>t.cat===cat.id&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
    }
    return {...cat,total};
  });
  const annualIncome=Array.from({length:12},(_,m)=>{const md=getMD(vy,m);return (md.income||0)+(md.bonus||0);}).reduce((s,v)=>s+v,0);
  const annualSpent=annualCats.reduce((s,c)=>s+c.total,0);
  const annualSaved=annualIncome-annualSpent;
  const rothYTD=annualCats.find(c=>c.id==="roth")?.total||0;

  // ── MUTATIONS ──
  const updMD=(y,m,up)=>{
    const key=mkKey(y,m);
    const next={...monthData,[key]:{...getMD(y,m),...up}};
    setMonthData(next); persist(next,null,null,null);
  };

  const addTx=()=>{
    if(!txForm.merchant||!txForm.amount) return;
    const tx={
      id:Date.now(), date:txForm.date, merchant:txForm.merchant,
      cat:txForm.cat, amount:parseFloat(txForm.amount)||0,
      note:txForm.note, isSplit:txForm.isSplit, isReimb:false,
      splitWith: txForm.isSplit ? splitPeople.filter(p=>p.name).map(p=>({...p,paid:false})) : [],
      totalBill: txForm.isSplit ? parseFloat(txForm.totalBill)||0 : 0,
    };
    const key=mkKey(vy,vm);
    const ex=monthData[key]||{income:0,bonus:0,transactions:[],rothBalance:0};
    const next={...monthData,[key]:{...ex,transactions:[...(ex.transactions||[]),tx]}};
    setMonthData(next); persist(next,null,null,null);
    setTxForm({date:now.toISOString().split("T")[0],merchant:"",cat:txForm.cat,amount:"",note:"",isSplit:false,splitWith:[],totalBill:""});
    setSplitPeople([{name:"",owes:0,paid:false}]);
    setShowTxForm(false);
  };

  const addReimb=(txId,personIdx)=>{
    const key=mkKey(vy,vm);
    const ex=monthData[key]||{};
    const txs=(ex.transactions||[]).map(t=>{
      if(t.id!==txId) return t;
      const sw=t.splitWith.map((p,i)=>i===personIdx?{...p,paid:true,paidDate:now.toISOString().split("T")[0]}:p);
      return {...t,splitWith:sw};
    });
    const next={...monthData,[key]:{...ex,transactions:txs}};
    setMonthData(next); persist(next,null,null,null);
  };

  const delTx=id=>{
    const key=mkKey(vy,vm);
    const ex=monthData[key]||{};
    const next={...monthData,[key]:{...ex,transactions:(ex.transactions||[]).filter(t=>t.id!==id)}};
    setMonthData(next); persist(next,null,null,null);
  };

  const exportData=()=>{
    const lines=["FINTRACK EXPORT — "+new Date().toLocaleDateString(),""];
    Object.entries(monthData).forEach(([key,md])=>{
      const [y,m]=key.split("-");
      lines.push(`\n=== ${FULLMONTHS[parseInt(m)-1]} ${y} ===`);
      lines.push(`Income: ${c2(md.income||0)}`);
      if(md.bonus>0) lines.push(`Bonus: ${c2(md.bonus)}`);
      (md.transactions||[]).forEach(t=>{
        lines.push(`  ${t.date}  ${t.merchant.padEnd(30)}  ${c2(t.amount)}  [${t.cat}]${t.isSplit?" SPLIT":""}`);
      });
    });
    return lines.join("\n");
  };

  const getRothTarget=(y,m)=>{
    const key=mkKey(y,m);
    return settings.rothOverrides?.[key]!==undefined ? settings.rothOverrides[key] : (settings.rothRecurring||500);
  };

  if(!loaded) return <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",height:"100vh"}}><span style={{color:"#888780"}}>Loading your finances...</span></div>;

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      {/* TOPBAR */}
      <div style={S.topbar}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={S.logo}>fintrack</div>
          <div style={{width:1,height:14,background:"#E8E6E0"}}/>
          <div style={{fontSize:11,color:"#888780"}}>{FULLMONTHS[vm]} {vy}</div>
          {pendingTotal>0&&<div style={{fontSize:11,background:"#E3F2FD",color:"#1565C0",padding:"2px 8px",borderRadius:20,fontWeight:600,cursor:"pointer"}} onClick={()=>setTab("splits")}>💸 {c0(pendingTotal)}</div>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button style={{...S.btn("#888780"),padding:"4px 10px",fontSize:11}} onClick={()=>setShowSettings(!showSettings)}>⚙</button>
          <button style={{...S.btn("#534AB7"),padding:"4px 10px",fontSize:11}} onClick={()=>setShowExport(!showExport)}>↓</button>
          <div style={{fontSize:10,color:saving?"#1D9E75":"#BDBDBD",minWidth:36,transition:"color 0.4s"}}>{saving?"saving...":"saved"}</div>
        </div>
      </div>

      {/* NAV */}
      <div style={{background:"#FFF",borderBottom:"1px solid #E8E6E0",padding:"0 16px"}}>
        <div style={S.nav}>
          {[["overview","Overview"],["txns","Transactions"],["annual","Annual"],["splits","Splits"],["goals","Goals"],["roth","Roth IRA"]].map(([id,l])=>(
            <button key={id} style={S.nb(tab===id)} onClick={()=>setTab(id)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={S.body}>

        {/* SETTINGS */}
        {showSettings&&(
          <div style={{...S.card,marginBottom:16,border:"1.5px solid #E8E6E0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
              <div style={S.ptitle}>Settings</div>
              <button style={S.btn("#888780")} onClick={()=>setShowSettings(false)}>Close</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:16}}>
              <div>
                <div style={S.slabel}>Job start date</div>
                <input type="date" style={S.iy} value={settings.jobStart}
                  onChange={e=>{const next={...settings,jobStart:e.target.value};setSettings(next);persist(null,null,null,next);}}/>
              </div>
              <div>
                <div style={S.slabel}>First paycheck date</div>
                <input type="date" style={{...S.iy,borderColor:settings.firstPaycheck?"#EF9F27":"#E24B4A"}} value={settings.firstPaycheck||""}
                  onChange={e=>{const next={...settings,firstPaycheck:e.target.value};setSettings(next);persist(null,null,null,next);}}/>
                <div style={{fontSize:10,color:settings.firstPaycheck?"#888780":"#A32D2D",marginTop:4}}>
                  {settings.firstPaycheck?"Pay dates calculated from here":"Set this when HR confirms"}
                </div>
              </div>
              <div>
                <div style={S.slabel}>Pay cycle</div>
                <select style={S.sel} value={settings.payCycle||14}
                  onChange={e=>{const next={...settings,payCycle:parseInt(e.target.value)};setSettings(next);persist(null,null,null,next);}}>
                  <option value={7}>Weekly</option>
                  <option value={14}>Biweekly</option>
                  <option value={15}>Semi-monthly</option>
                  <option value={30}>Monthly</option>
                </select>
              </div>
              <div>
                <div style={S.slabel}>Default Roth IRA contribution</div>
                <input type="number" inputMode="decimal" style={S.iy} value={settings.rothRecurring||500}
                  onChange={e=>{const next={...settings,rothRecurring:parseFloat(e.target.value)||0};setSettings(next);persist(null,null,null,next);}}/>
              </div>
            </div>
          </div>
        )}

        {/* EXPORT */}
        {showExport&&(
          <div style={{...S.card,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
              <div style={S.ptitle}>Export</div>
              <button style={S.btn("#888780")} onClick={()=>setShowExport(false)}>Close</button>
            </div>
            <textarea readOnly value={exportData()} style={{...S.input,height:200,fontFamily:"monospace",fontSize:11,resize:"vertical"}}/>
            <div style={{fontSize:11,color:"#888780",marginTop:6}}>Copy and save this as your backup.</div>
          </div>
        )}

        {/* ══ OVERVIEW ══ */}
        {tab==="overview"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <IncomeRow
            incAvail={incAvail} settings={settings}
            editIncome={editIncome} setEditIncome={setEditIncome}
            tempVal={tempVal} setTempVal={setTempVal}
            curMD={curMD} updMD={updMD} vy={vy} vm={vm}
            isFirstPayMonth={isFirstPayMonth} payDates={payDates}
            pendingTotal={pendingTotal} setTab={setTab}
          />
          <div style={S.g4}>
            {[
              {l:"Total income",  v:c0(totalIncome),   c:totalIncome>0?"#1D9E75":"#888780", s:curMD.bonus>0?`incl. ${c0(curMD.bonus)} bonus`:"this month"},
              {l:"Total spent",   v:c0(totalSpent),    c:totalSpent>totalIncome&&totalIncome>0?"#A32D2D":"#1E2130", s:`${c0(Object.values(budgets).reduce((s,v)=>s+v,0))} budgeted`},
              {l:"Net saved",     v:c0(netSaved),      c:netSaved>=0?"#1D9E75":"#A32D2D", s:netSaved>=0?"on track ↑":"over budget ↓"},
              {l:"Savings rate",  v:totalIncome>0?pct(savRate):"—", c:savRate>=0.2?"#1D9E75":savRate>0?"#BA7517":"#888780", s:totalIncome>0?(savRate>=0.2?"above 20% target":"below 20%"):"no income yet"},
            ].map((k,i)=>(
              <div key={i} style={S.kpi}>
                <div style={S.klabel}>{k.l}</div>
                <div style={S.kval(k.c)}>{k.v}</div>
                <div style={S.ksub}>{k.s}</div>
              </div>
            ))}
          </div>
          <div style={S.g2}>
            <div style={S.card}>
              <div style={S.ptitle}>Spending by category</div>
              {CATS.filter(cat=>catSpend(cat.id)>0||budgets[cat.id]>0).map(cat=>{
                const sp=catSpend(cat.id); const bg=budgets[cat.id]||0; const ov=sp>bg&&bg>0;
                return (
                  <div key={cat.id} style={{padding:"9px 0",borderBottom:"1px solid #F1EFE8"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:10,height:10,borderRadius:2,background:cat.color}}/>
                        <span style={{fontSize:12,fontWeight:500}}>{cat.label}</span>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:13,fontWeight:700,color:ov?"#A32D2D":"#1E2130"}}>{c0(sp)}</span>
                        {bg>0&&<span style={{fontSize:11,color:"#888780"}}>/ {c0(bg)}</span>}
                        {ov&&<Pill label="over" color="#A32D2D"/>}
                      </div>
                    </div>
                    <Bar val={sp} max={Math.max(bg,sp,1)} color={ov?"#E24B4A":cat.color}/>
                  </div>
                );
              })}
              {CATS.every(c=>catSpend(c.id)===0)&&<div style={{color:"#888780",fontSize:12,textAlign:"center",padding:"20px 0"}}>No transactions yet this month</div>}
            </div>
            <div>
              <div style={{...S.card,marginBottom:14}}>
                <div style={S.ptitle}>Breakdown</div>
                <div style={{display:"flex",alignItems:"center",gap:16}}>
                  <DonutChart data={CATS.map(c=>({v:catSpend(c.id),color:c.color}))} size={110}/>
                  <div style={{flex:1}}>
                    {CATS.filter(c=>catSpend(c.id)>0).map(cat=>(
                      <div key={cat.id} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:8,height:8,borderRadius:"50%",background:cat.color}}/>
                          <span style={{fontSize:11,color:"#444441"}}>{cat.label}</span>
                        </div>
                        <span style={{fontSize:11,fontWeight:600}}>{totalSpent>0?pct(catSpend(cat.id)/totalSpent,0):"—"}</span>
                      </div>
                    ))}
                    {CATS.every(c=>catSpend(c.id)===0)&&<div style={{fontSize:11,color:"#888780"}}>Add transactions to see breakdown</div>}
                  </div>
                </div>
              </div>
              <div style={S.card}>
                <div style={{...S.ptitle,display:"flex",justifyContent:"space-between"}}>
                  <span>Recent</span>
                  <button style={{...S.btn("#534AB7"),padding:"2px 8px",fontSize:11}} onClick={()=>setTab("txns")}>All →</button>
                </div>
                <TxList txs={[...txList].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5)} showDel={false} addReimb={addReimb} delTx={delTx}/>
              </div>
            </div>
          </div>
        </>)}

        {/* ══ TRANSACTIONS ══ */}
        {tab==="txns"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:15,fontWeight:700}}>{FULLMONTHS[vm]}</div>
            <button style={S.btnS("#534AB7")} onClick={()=>setShowTxForm(!showTxForm)}>{showTxForm?"✕ Cancel":"+ Add"}</button>
          </div>
          {showTxForm&&<TxForm txForm={txForm} setTxForm={setTxForm} splitPeople={splitPeople} setSplitPeople={setSplitPeople} addTx={addTx} setShowTxForm={setShowTxForm}/>}
          {!showTxForm&&(
            <div style={{marginBottom:10}}>
              <button style={S.btn("#1D9E75")} onClick={()=>{
                const reimb={id:Date.now(),date:now.toISOString().split("T")[0],merchant:"Reimbursement received",cat:"other",amount:0,note:"",isReimb:true,isSplit:false,splitWith:[]};
                const key=mkKey(vy,vm);
                const ex=monthData[key]||{income:0,bonus:0,transactions:[],rothBalance:0};
                const next={...monthData,[key]:{...ex,transactions:[...(ex.transactions||[]),reimb]}};
                setMonthData(next);persist(next,null,null,null);
              }}>+ Log reimbursement</button>
            </div>
          )}
          <div style={S.card}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
              <div style={S.ptitle}>{txList.length} transaction{txList.length!==1?"s":""}</div>
              <span style={{fontSize:13,fontWeight:700}}>{c0(totalSpent)} net</span>
            </div>
            <TxList txs={txList} addReimb={addReimb} delTx={delTx}/>
          </div>
          <div style={{...S.card,marginTop:14}}>
            <div style={S.ptitle}>Monthly budget targets</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:8}}>
              {CATS.map(cat=>(
                <div key={cat.id} style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:3,height:12,background:cat.color,borderRadius:2}}/>
                  <span style={{flex:1,fontSize:12,color:"#444441"}}>{cat.label}</span>
                  <input type="number" inputMode="decimal" value={budgets[cat.id]||0}
                    onChange={e=>{const next={...budgets,[cat.id]:parseFloat(e.target.value)||0};setBudgets(next);persist(null,next,null,null);}}
                    style={{...S.input,width:90,textAlign:"right"}}/>
                </div>
              ))}
            </div>
          </div>
        </>)}

        {/* ══ SPLITS ══ */}
        {tab==="splits"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm}/>
          <div style={{fontSize:15,fontWeight:700,marginBottom:16}}>Splits</div>
          <div style={S.g3}>
            <div style={S.kpi}>
              <div style={S.klabel}>Pending</div>
              <div style={S.kval("#1565C0")}>{c0(pendingTotal)}</div>
              <div style={S.ksub}>friends still owe you</div>
            </div>
            <div style={S.kpi}>
              <div style={S.klabel}>Split txns</div>
              <div style={S.kval("#1E2130")}>{txList.filter(t=>t.isSplit).length}</div>
              <div style={S.ksub}>this month</div>
            </div>
            <div style={S.kpi}>
              <div style={S.klabel}>Reimbursed</div>
              <div style={S.kval("#1D9E75")}>{c0(txList.filter(t=>t.isSplit).reduce((s,t)=>(t.splitWith||[]).filter(p=>p.paid).reduce((ss,p)=>ss+(p.owes||0),0)+s,0))}</div>
              <div style={S.ksub}>received back</div>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.ptitle}>Split expenses — {FULLMONTHS[vm]}</div>
            {txList.filter(t=>t.isSplit).length===0&&(
              <div style={{color:"#888780",fontSize:12,textAlign:"center",padding:"24px 0"}}>No split expenses this month.</div>
            )}
            {txList.filter(t=>t.isSplit).map(tx=>(
              <div key={tx.id} style={{...S.card,marginBottom:10,border:"1px solid #E3F2FD"}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:700}}>{tx.merchant}</div>
                    <div style={{fontSize:11,color:"#888780"}}>{fmtD(tx.date)} · {catLabel(tx.cat)}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#1565C0"}}>{c2(tx.amount)} <span style={{fontSize:11,color:"#888780",fontWeight:400}}>your share</span></div>
                    {tx.totalBill>0&&<div style={{fontSize:11,color:"#888780"}}>{c2(tx.totalBill)} total</div>}
                  </div>
                </div>
                {(tx.splitWith||[]).map((p,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderTop:"1px solid #F1EFE8"}}>
                    <div style={{flex:1}}>
                      <span style={{fontSize:12,fontWeight:600}}>{p.name}</span>
                      <span style={{fontSize:12,color:"#888780",marginLeft:8}}>owes {c2(p.owes)}</span>
                    </div>
                    {p.paid
                      ?<Pill label={`Paid ✓ ${p.paidDate?fmtD(p.paidDate):""}`} color="#1D9E75" bg="#E1F5EE"/>
                      :<button style={S.btnS("#1565C0")} onClick={()=>addReimb(tx.id,i)}>Mark paid</button>
                    }
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
              {l:"Annual income", v:c0(annualIncome), c:"#1D9E75"},
              {l:"Annual spent",  v:c0(annualSpent),  c:"#1E2130"},
              {l:"Annual saved",  v:c0(annualSaved),  c:annualSaved>=0?"#185FA5":"#A32D2D"},
              {l:"Avg savings rate", v:annualIncome>0?pct(annualSaved/annualIncome):"—", c:"#BA7517"},
            ].map((k,i)=>(
              <div key={i} style={S.kpi}>
                <div style={S.klabel}>{k.l}</div>
                <div style={S.kval(k.c)}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={S.g2}>
            <div style={S.card}>
              <div style={S.ptitle}>Month by month — {vy}</div>
              <div style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,marginBottom:8,paddingBottom:6,borderBottom:"1px solid #E8E6E0"}}>
                {["","Income","Spent","Saved"].map((h,i)=><div key={i} style={{fontSize:10,color:"#888780",textAlign:i>0?"right":"left"}}>{h}</div>)}
              </div>
              {MONTHS.map((m,i)=>{
                const md=getMD(vy,i);
                const inc=(md.income||0)+(md.bonus||0);
                const reimbs=(md.transactions||[]).filter(t=>t.isReimb).reduce((s,t)=>s+t.amount,0);
                const sp=Math.max(0,(md.transactions||[]).filter(t=>!t.isReimb).reduce((s,t)=>s+(t.amount||0),0)-reimbs);
                const sv=inc-sp;
                const has=(md.transactions||[]).length>0;
                const isNow=i===CUR_M&&vy===CUR_Y;
                return (
                  <div key={i} onClick={()=>{setVm(i);setTab("overview");}}
                    style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,padding:"6px 4px",borderBottom:"1px solid #F1EFE8",cursor:"pointer",background:isNow?"#F8F7FF":"transparent",borderRadius:4}}>
                    <div style={{fontSize:12,fontWeight:isNow?700:400,color:isNow?"#534AB7":"#444441"}}>{m}</div>
                    <div style={{fontSize:12,textAlign:"right",color:has?"#1D9E75":"#BDBDBD"}}>{has?c0(inc):"—"}</div>
                    <div style={{fontSize:12,textAlign:"right",color:has?"#1E2130":"#BDBDBD"}}>{has?c0(sp):"—"}</div>
                    <div style={{fontSize:12,textAlign:"right",fontWeight:600,color:has?(sv>=0?"#185FA5":"#A32D2D"):"#BDBDBD"}}>{has?c0(sv):"—"}</div>
                  </div>
                );
              })}
              <div style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,padding:"8px 4px",borderTop:"2px solid #E8E6E0",marginTop:4}}>
                {["TOTAL",c0(annualIncome),c0(annualSpent),c0(annualSaved)].map((v,i)=>(
                  <div key={i} style={{fontSize:12,fontWeight:700,textAlign:i>0?"right":"left",color:i===3?(annualSaved>=0?"#185FA5":"#A32D2D"):"#1E2130"}}>{v}</div>
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
                      <span style={{fontSize:11,color:"#888780"}}>{annualSpent>0?pct(cat.total/annualSpent,0):"—"}</span>
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
            <button style={S.btnS("#1D9E75")} onClick={()=>{const next=[...goals,{id:Date.now(),name:"New Goal",target:5000,saved:0,color:"#185FA5"}];setGoals(next);persist(null,null,next,null);}}>+ Add Goal</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:14}}>
            {goals.map(goal=>{
              const p=goal.target>0?Math.min(1,goal.saved/goal.target):0;
              const done=p>=1;
              return (
                <div key={goal.id} style={{...S.card,border:`1.5px solid ${done?"#5DCAA5":"#E8E6E0"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <input value={goal.name} onChange={e=>{const next=goals.map(g=>g.id===goal.id?{...g,name:e.target.value}:g);setGoals(next);persist(null,null,next,null);}}
                      style={{background:"transparent",border:"none",outline:"none",fontSize:14,fontWeight:700,color:"#1E2130",fontFamily:"inherit",flex:1}}/>
                    {done&&<Pill label="Complete ✓" color="#1D9E75" bg="#E1F5EE"/>}
                  </div>
                  <div style={{marginBottom:10}}>
                    <Bar val={goal.saved} max={goal.target||1} color={done?"#1D9E75":goal.color} h={8}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#888780",marginTop:4}}>
                      <span>{pct(p,0)} complete</span><span>{c0(Math.max(0,goal.target-goal.saved))} to go</span>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    <div><div style={S.slabel}>Target</div>
                      <input type="number" inputMode="decimal" value={goal.target} onChange={e=>{const next=goals.map(g=>g.id===goal.id?{...g,target:parseFloat(e.target.value)||0}:g);setGoals(next);persist(null,null,next,null);}} style={S.input}/></div>
                    <div><div style={S.slabel}>Saved so far</div>
                      <input type="number" inputMode="decimal" value={goal.saved} onChange={e=>{const next=goals.map(g=>g.id===goal.id?{...g,saved:parseFloat(e.target.value)||0}:g);setGoals(next);persist(null,null,next,null);}} style={S.iy}/></div>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:12,fontWeight:700,color:goal.color}}>{c2(goal.saved)} / {c2(goal.target)}</span>
                    <button onClick={()=>{const next=goals.filter(g=>g.id!==goal.id);setGoals(next);persist(null,null,next,null);}} style={{background:"none",border:"none",color:"#BDBDBD",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>remove</button>
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
          <div style={{fontSize:12,color:"#888780",marginBottom:16}}>Auto-tracked from transactions · Add via Transactions tab with category "Roth IRA"</div>
          <div style={S.g3}>
            <div style={{...S.kpi,border:"1.5px solid #EF9F2744"}}>
              <div style={S.klabel}>Contributions YTD</div>
              <div style={S.kval("#854F0B")}>{c0(rothYTD)}</div>
              <div style={S.ksub}>{c0(7000-rothYTD)} of $7,000 remaining</div>
            </div>
            <div style={S.kpi}>
              <div style={S.klabel}>This month</div>
              <div style={S.kval("#1E2130")}>{c0(catSpend("roth"))}</div>
              <div style={S.ksub}>target: {c0(getRothTarget(vy,vm))}</div>
            </div>
            <div style={S.kpi}>
              <div style={S.klabel}>Monthly default</div>
              <div style={S.kval("#1D9E75")}>{c0(settings.rothRecurring||500)}</div>
              <div style={S.ksub}>change in Settings ⚙</div>
            </div>
          </div>
          <div style={{...S.card,marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <div style={S.ptitle}>2026 contribution limit</div>
              <span style={{fontSize:12,fontWeight:700,color:"#854F0B"}}>{c0(rothYTD)} / $7,000</span>
            </div>
            <Bar val={rothYTD} max={7000} color="#BA7517" h={10}/>
            <div style={{fontSize:11,color:"#888780",marginTop:5}}>{pct(rothYTD/7000,1)} used · {c0(7000-rothYTD)} remaining</div>
          </div>
          <div style={S.g2}>
            <div style={S.card}>
              <div style={S.ptitle}>Month-by-month contributions</div>
              {MONTHS.map((m,i)=>{
                const md=getMD(vy,i);
                const contrib=(md.transactions||[]).filter(t=>t.cat==="roth"&&!t.isReimb).reduce((s,t)=>s+(t.amount||0),0);
                const target=getRothTarget(vy,i);
                const isNow=i===CUR_M&&vy===CUR_Y;
                return (
                  <div key={i} style={{padding:"8px 0",borderBottom:"1px solid #F1EFE8",background:isNow?"#FFFBEB":"transparent",borderRadius:isNow?4:0,paddingLeft:isNow?6:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:contrib>0?5:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:12,fontWeight:isNow?700:400,color:isNow?"#854F0B":"#444441",width:32}}>{m}</span>
                        {isNow&&<Pill label="current" color="#854F0B" bg="#FAEEDA"/>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:12,fontWeight:700,color:contrib>0?"#854F0B":"#BDBDBD"}}>{contrib>0?c0(contrib):"—"}</span>
                        <span style={{fontSize:11,color:"#BDBDBD"}}>/ {c0(target)}</span>
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
              <div style={{fontSize:12,color:"#888780",marginBottom:10}}>Override the default {c0(settings.rothRecurring||500)}/mo for a specific month</div>
              {MONTHS.map((m,i)=>{
                const key=mkKey(vy,i);
                const ov=settings.rothOverrides?.[key];
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
                        setSettings(next); persist(null,null,null,next);
                      }}
                      style={{...S.input,width:120,textAlign:"right",borderColor:ov!==undefined?"#EF9F27":"#E8E6E0"}}/>
                    {ov!==undefined&&<Pill label="override" color="#BA7517" bg="#FAEEDA"/>}
                  </div>
                );
              })}
            </div>
          </div>
        </>)}

      </div>
    </div>
  );
}
