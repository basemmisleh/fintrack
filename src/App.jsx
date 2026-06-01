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

// ── UPCOMING PAYMENTS ────────────────────────────────────────────
function getUpcomingPayments(recurring, monthData, windowDays=14){
  const today=new Date(); today.setHours(0,0,0,0);
  const end=new Date(today); end.setDate(today.getDate()+windowDays);
  const mkKey=(y,m)=>`${y}-${String(m+1).padStart(2,"0")}`;
  const isConfirmed=(rec,date)=>{
    const key=mkKey(date.getFullYear(),date.getMonth());
    const txs=(monthData[key]||{}).transactions||[];
    return txs.some(t=>t.recurringId===rec.id);
  };
  const upcoming=[];
  recurring.forEach(rec=>{
    if(!rec.startDate) return;
    const startDay=parseInt(rec.startDate.split("-")[2]||"1");
    if(rec.freq==="monthly"||rec.freq==="biweekly"||rec.freq==="weekly"){
      const cycle=rec.freq==="weekly"?7:rec.freq==="biweekly"?14:0;
      if(cycle>0){
        // weekly/biweekly: walk from startDate
        const start=new Date(rec.startDate+"T12:00:00");
        let cur=new Date(start);
        while(cur<=end){
          if(cur>today&&!isConfirmed(rec,cur)){
            upcoming.push({...rec,dueDate:new Date(cur),daysAway:Math.round((cur-today)/86400000)});
            break;
          }
          cur.setDate(cur.getDate()+cycle);
        }
      } else {
        // monthly: check same day in current and next month
        for(let mo=0;mo<=2;mo++){
          const d=new Date(today.getFullYear(),today.getMonth()+mo,startDay);
          if(d>today&&d<=end&&!isConfirmed(rec,d)){
            upcoming.push({...rec,dueDate:d,daysAway:Math.round((d-today)/86400000)});
            break;
          }
        }
      }
    }
  });
  return upcoming.sort((a,b)=>a.dueDate-b.dueDate);
}

// ── SUBSCRIPTION DETECTOR ─────────────────────────────────────────
function detectSubscriptions(monthData){
  const allTxs=[];
  Object.values(monthData).forEach(md=>(md.transactions||[]).forEach(t=>{
    if(!t.isReimb&&t.merchant) allTxs.push(t);
  }));
  const byMerchant={};
  allTxs.forEach(t=>{
    const key=t.merchant.toLowerCase().trim();
    if(!byMerchant[key]) byMerchant[key]=[];
    byMerchant[key].push(t);
  });
  const detected=[];
  Object.entries(byMerchant).forEach(([key,txs])=>{
    if(txs.length<2) return;
    const sorted=[...txs].sort((a,b)=>new Date(a.date)-new Date(b.date));
    const intervals=[];
    for(let i=1;i<sorted.length;i++){
      intervals.push((new Date(sorted[i].date)-new Date(sorted[i-1].date))/86400000);
    }
    const avg=intervals.reduce((s,v)=>s+v,0)/intervals.length;
    if(avg>400) return;
    const intervalOk=intervals.every(d=>Math.abs(d-avg)<=10);
    const amounts=sorted.map(t=>t.amount);
    const avgAmt=amounts.reduce((s,v)=>s+v,0)/amounts.length;
    const amountOk=amounts.every(a=>Math.abs(a-avgAmt)/(avgAmt||1)<=0.15);
    if(!intervalOk||!amountOk) return;
    const freq=avg<=10?"weekly":avg<=20?"biweekly":avg<=95?"monthly":"quarterly";
    const mult={weekly:52,biweekly:26,monthly:12,quarterly:4}[freq];
    const last=sorted[sorted.length-1]; const prev=sorted[sorted.length-2];
    detected.push({
      id:key, merchant:sorted[0].merchant, amount:last.amount, frequency:freq,
      occurrences:sorted.length, cat:sorted[0].cat,
      priceIncrease:last.amount>prev.amount*1.05,
      priceIncreasePct:prev.amount>0?Math.round((last.amount-prev.amount)/prev.amount*100):0,
      annualCost:last.amount*mult, lastDate:last.date,
    });
  });
  return detected.sort((a,b)=>b.annualCost-a.annualCost);
}

// ── SPENDING INSIGHTS ─────────────────────────────────────────────
function generateInsights(monthData, cats, budgets, vm, vy){
  const getMD=(y,m)=>monthData[`${y}-${String(m).padStart(2,"0")}`]||{income:0,bonus:0,transactions:[]};
  const catSpend=(y,m,id)=>(getMD(y,m).transactions||[]).filter(t=>t.cat===id&&!t.isReimb&&!t.isPaidForOther).reduce((s,t)=>s+(t.amount||0),0);
  const insights=[];

  // Per-category vs 3-month rolling average
  cats.forEach(cat=>{
    const cur=catSpend(vy,vm,cat.id);
    if(cur===0) return;
    const prevAmts=[1,2,3].map(n=>{
      const pm=vm-n<0?vm-n+12:vm-n; const py=vm-n<0?vy-1:vy;
      return catSpend(py,pm,cat.id);
    }).filter(v=>v>0);
    if(prevAmts.length<2) return;
    const avg=prevAmts.reduce((s,v)=>s+v,0)/prevAmts.length;
    const pct=avg>0?(cur-avg)/avg:0;
    if(pct>0.25) insights.push({icon:"↑",color:"#A32D2D",bg:"#FEF2F2",text:`${cat.label} is ${Math.round(pct*100)}% above your 3-month average (avg ${c0(avg)}/mo)`});
    else if(pct<-0.2) insights.push({icon:"↓",color:"#1D9E75",bg:"#F0FDF4",text:`${cat.label} is ${Math.round(Math.abs(pct)*100)}% below your 3-month average — nice restraint`});
  });

  // Savings rate
  const curMD=getMD(vy,vm);
  const income=(curMD.income||0)+(curMD.bonus||0);
  const spent=cats.reduce((s,cat)=>s+catSpend(vy,vm,cat.id),0);
  if(income>0){
    const rate=(income-spent)/income;
    if(rate>=0.2) insights.push({icon:"✓",color:"#1D9E75",bg:"#F0FDF4",text:`On track to save ${Math.round(rate*100)}% this month — above your 20% target`});
    else if(spent>0) insights.push({icon:"!",color:"#BA7517",bg:"#FFFBEB",text:`Savings rate is ${Math.round(Math.max(0,rate)*100)}% — ${c0(income*0.2-(income-spent))} more to save to hit 20%`});
  }

  // Subscription total
  const subSpend=catSpend(vy,vm,"subs");
  if(subSpend>0) insights.push({icon:"↺",color:"#6366F1",bg:"#EEF2FF",text:`Subscriptions: ${c0(subSpend)}/mo · ${c0(subSpend*12)}/yr`});

  // Largest single category
  const top=[...cats].sort((a,b)=>catSpend(vy,vm,b.id)-catSpend(vy,vm,a.id)).find(c=>catSpend(vy,vm,c.id)>0);
  if(top&&insights.length<5) insights.push({icon:"▶",color:"#64748B",bg:"#F8FAFC",text:`Biggest spend: ${top.label} at ${c0(catSpend(vy,vm,top.id))} — ${spent>0?Math.round(catSpend(vy,vm,top.id)/spent*100):0}% of total`});

  return insights.slice(0,5);
}

// ── CASH FLOW FORECAST ────────────────────────────────────────────
function generateForecast(settings, recurring, monthlyIncome, startingBalance){
  const today=new Date();
  const weeks=[];
  let balance=startingBalance||0;
  const cycle=settings.payCycle||14;
  const annualChecks=cycle===7?52:cycle===14?26:cycle===15?24:12;
  const perCheck=monthlyIncome>0?monthlyIncome/(annualChecks/12):0;

  const weeklyRec=recurring.filter(r=>r.freq==="weekly").reduce((s,r)=>s+(r.amount||0),0);
  const biweeklyRec=recurring.filter(r=>r.freq==="biweekly").reduce((s,r)=>s+(r.amount||0),0);
  const monthlyRec=recurring.filter(r=>r.freq==="monthly").reduce((s,r)=>s+(r.amount||0),0);

  for(let w=0;w<12;w++){
    const ws=new Date(today); ws.setDate(today.getDate()+w*7);
    const we=new Date(ws); we.setDate(ws.getDate()+7);
    let income=0;
    if(settings.firstPaycheck){
      const months=new Set([`${ws.getFullYear()}-${ws.getMonth()}`,`${we.getFullYear()}-${we.getMonth()}`]);
      months.forEach(mk=>{
        const [y,m]=mk.split("-").map(Number);
        getPayDates(settings.firstPaycheck,cycle,y,m).forEach(d=>{
          const pd=new Date(d+"T12:00:00");
          if(pd>=ws&&pd<we) income+=perCheck;
        });
      });
    }
    const expenses=weeklyRec+(w%2===0?biweeklyRec:0)+monthlyRec/4.33;
    balance+=income-expenses;
    const label=w===0?"Now":`W${w+1}`;
    weeks.push({label,balance:Math.round(balance),income:Math.round(income),expenses:Math.round(expenses)});
  }
  return weeks;
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

function ForecastChart({weeks, threshold}){
  if(!weeks?.length) return null;
  const vals=weeks.map(w=>w.balance);
  const maxV=Math.max(...vals,threshold||0,1);
  const minV=Math.min(...vals,0);
  const range=maxV-minV||1;
  const H=110; const barW=18; const gap=6; const W=weeks.length*(barW+gap);
  const toY=v=>H-Math.max(0,((v-minV)/range)*H);
  const zeroY=H-Math.max(0,(-minV/range)*H);
  return(
    <svg viewBox={`0 0 ${W} ${H+18}`} style={{width:"100%",height:H+18,display:"block",overflow:"visible"}}>
      {threshold!=null&&(()=>{const ty=toY(threshold);return(<><line x1={0} y1={ty} x2={W} y2={ty} stroke="#EF9F27" strokeWidth={1} strokeDasharray="4,3" opacity={0.8}/><text x={W+2} y={ty+4} fontSize="7" fill="#BA7517">${(threshold/1000).toFixed(0)}k</text></>);})()}
      {minV<0&&<line x1={0} y1={zeroY} x2={W} y2={zeroY} stroke="#CBD5E1" strokeWidth={1}/>}
      {weeks.map((w,i)=>{
        const x=i*(barW+gap);
        const isLow=threshold!=null&&w.balance<threshold;
        const color=w.balance<0?"#E24B4A":isLow?"#F59E0B":"#6366F1";
        const barH=Math.max(2,Math.abs(((w.balance-minV)/range)*H));
        const y=toY(Math.max(w.balance,minV));
        return(
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} opacity={0.8} rx={3}/>
            <text x={x+barW/2} y={H+13} textAnchor="middle" fontSize="7" fill="#94A3B8">{w.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ── THEME ─────────────────────────────────────────────────────────
const LIGHT = {
  bg:"#F1F5F9", surface:"#FFFFFF", elevated:"#F8FAFC",
  border:"#E2E8F0", borderSubtle:"#F1F5F9",
  text:"#0F172A", muted:"#64748B", subtle:"#94A3B8",
  shadow:"0 2px 8px rgba(15,23,42,0.06)", shadowSm:"0 1px 4px rgba(15,23,42,0.04)",
  inputBg:"#F8FAFC", navBg:"rgba(255,255,255,0.92)",
};
const DARK = {
  bg:"#020617", surface:"#0E1223", elevated:"#1E293B",
  border:"rgba(255,255,255,0.08)", borderSubtle:"rgba(255,255,255,0.05)",
  text:"#F8FAFC", muted:"#94A3B8", subtle:"#64748B",
  shadow:"0 2px 16px rgba(0,0,0,0.4)", shadowSm:"0 1px 6px rgba(0,0,0,0.3)",
  inputBg:"#1E293B", navBg:"rgba(2,6,23,0.92)",
};

function makeStyles(dark, accent){
  const T=dark?DARK:LIGHT; const A=accent||"#6366F1";
  return {
    T,
    app:    {minHeight:"100vh",background:T.bg,fontFamily:"'IBM Plex Sans','DM Sans','Inter',sans-serif",fontSize:13,color:T.text,transition:"background 0.3s,color 0.3s"},
    topbar: {background:T.navBg,backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",borderBottom:`1px solid ${T.border}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:30,boxShadow:T.shadow},
    logo:   {fontSize:17,fontWeight:800,background:`linear-gradient(135deg,${A} 0%,${A}cc 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",letterSpacing:"-0.5px"},
    nav:    {display:"flex",gap:0,overflowX:"auto",background:T.surface,borderBottom:`1px solid ${T.border}`},
    nb:     a=>({padding:"0 14px",height:44,background:"transparent",border:"none",borderBottom:a?`2.5px solid ${A}`:"2.5px solid transparent",color:a?A:T.muted,fontSize:12,cursor:"pointer",fontWeight:a?700:500,transition:"all 0.15s",fontFamily:"inherit",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}),
    body:   {padding:"20px",maxWidth:1200,margin:"0 auto"},
    mbar:   {display:"flex",gap:4,marginBottom:20,background:T.surface,borderRadius:12,padding:6,border:`1px solid ${T.border}`,boxShadow:T.shadowSm},
    mbtn:   (a,has)=>({flex:1,padding:"6px 2px",background:a?A+"22":"transparent",border:"none",borderRadius:7,color:a?A:has?T.text:T.subtle,fontSize:10,cursor:"pointer",fontWeight:a?700:500,transition:"all 0.15s",fontFamily:"inherit",lineHeight:1.4}),
    g4:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:14,marginBottom:18},
    g2:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))",gap:16,marginBottom:16},
    g3:     {display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:16},
    card:   {background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,padding:"18px 20px",boxShadow:T.shadowSm,transition:"background 0.3s,border-color 0.3s"},
    kpi:    {background:T.surface,border:`1px solid ${T.border}`,borderRadius:16,padding:"16px 18px 14px",boxShadow:T.shadowSm,overflow:"hidden",position:"relative",transition:"background 0.3s"},
    klabel: {fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6,fontWeight:700},
    kval:   c=>({fontSize:26,fontWeight:800,color:c||T.text,letterSpacing:"-0.5px",lineHeight:1.1}),
    ksub:   {fontSize:11,color:T.subtle,marginTop:5},
    ptitle: {fontSize:10,fontWeight:700,color:T.subtle,textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:14},
    slabel: {fontSize:10,color:T.subtle,textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:5,fontWeight:600},
    input:  {background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
    iy:     {background:dark?"#2D1F00":"#FFFBEB",border:`1.5px solid #F59E0B`,borderRadius:8,padding:"8px 12px",color:dark?"#FDE68A":"#78350F",fontSize:13,fontWeight:600,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
    sel:    {background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 12px",color:T.text,fontSize:13,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"},
    btn:    c=>({background:c+"22",border:`1.5px solid ${c}40`,borderRadius:8,padding:"7px 14px",color:c,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",transition:"all 0.15s"}),
    btnS:   c=>({background:c,border:`1.5px solid ${c}`,borderRadius:8,padding:"7px 16px",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:`0 3px 10px ${c}50`,transition:"all 0.15s"}),
    txrow:  {display:"flex",alignItems:"flex-start",gap:12,padding:"11px 0",borderBottom:`1px solid ${T.borderSubtle}`},
  };
}
// S is initialized with defaults; inside App it gets recomputed from settings
let S = makeStyles(false,"#6366F1");

// ── TOP-LEVEL COMPONENTS ──────────────────────────────────────────
function MonthBar({vm,vy,monthData,setVm,setVy}){
  const hasTxs=(monthData[mkKey(vy,vm)]?.transactions||[]).length>0;
  const isNow=vm===CUR_M&&vy===CUR_Y;
  const goBack=()=>{
    if(vm===0){setVm(11);setVy(y=>y-1);}else setVm(m=>m-1);
  };
  const goForward=()=>{
    if(vm===11){setVm(0);setVy(y=>y+1);}else setVm(m=>m+1);
  };
  return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,gap:8}}>
      <button onClick={goBack}
        style={{width:34,height:34,borderRadius:10,background:S.T.elevated,border:`1px solid ${S.T.border}`,color:S.T.muted,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
        ‹
      </button>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:15,fontWeight:700,color:S.T.text,letterSpacing:"-0.3px"}}>
          {FULLMONTHS[vm]} {vy}
          {isNow&&<span style={{marginLeft:6,fontSize:9,background:S.T.elevated,color:S.T.muted,borderRadius:10,padding:"2px 7px",fontWeight:600,verticalAlign:"middle"}}>current</span>}
        </div>
        {hasTxs&&<div style={{fontSize:10,color:S.T.subtle,marginTop:1}}>has transactions</div>}
      </div>
      <button onClick={goForward}
        style={{width:34,height:34,borderRadius:10,background:S.T.elevated,border:`1px solid ${S.T.border}`,color:S.T.muted,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s"}}>
        ›
      </button>
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

function TxList({txs,showDel=true,addReimb,delTx,cats,editTxId,editTxForm,setEditTxForm,startEditTx,saveTx,bulkMode=false,bulkSelected=new Set(),setBulkSelected}){
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
            <div key={tx.id} style={{...S.txrow,flexDirection:"column",alignItems:"stretch",background:S.T.elevated,borderRadius:8,padding:"12px",margin:"4px 0"}}>
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
              <div style={{marginBottom:8,padding:"10px 12px",background:"#FFF7ED",borderRadius:8,border:"1px solid #FED7AA"}}>
                <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,fontWeight:600,color:"#C2410C"}}>
                  <input type="checkbox" checked={!!editTxForm.isPaidForOther}
                    onChange={e=>setEditTxForm({...editTxForm,isPaidForOther:e.target.checked})}/>
                  Paid for someone else — exclude from my expenses
                </label>
                {editTxForm.isPaidForOther&&<div style={{fontSize:11,color:"#9A3412",marginTop:6}}>This transaction will be voided from your spending totals and budgets.</div>}
              </div>
              <div style={{marginBottom:10,padding:"10px 12px",background:"#F8FAFC",borderRadius:8,border:"1px solid #E2E8F0"}}>
                <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,fontWeight:600,color:"#1565C0"}}>
                  <input type="checkbox" checked={!!editTxForm.isSplit}
                    onChange={e=>setEditTxForm({...editTxForm,isSplit:e.target.checked,splitCount:2,cat:e.target.checked?"split":editTxForm.cat})}/>
                  Split this expense — I paid for others
                </label>
                {editTxForm.isSplit&&(
                  <div style={{marginTop:10,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <span style={{fontSize:12,color:"#64748B"}}>Split how many ways?</span>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <button type="button" onClick={()=>setEditTxForm({...editTxForm,splitCount:Math.max(2,editTxForm.splitCount-1)})}
                        style={{width:28,height:28,borderRadius:"50%",border:"1.5px solid #1565C0",background:"#FFF",color:"#1565C0",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                      <span style={{fontSize:20,fontWeight:700,minWidth:24,textAlign:"center"}}>{editTxForm.splitCount}</span>
                      <button type="button" onClick={()=>setEditTxForm({...editTxForm,splitCount:editTxForm.splitCount+1})}
                        style={{width:28,height:28,borderRadius:"50%",border:"1.5px solid #1565C0",background:"#1565C0",color:"#FFF",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                    </div>
                    {parseFloat(editTxForm.amount)>0&&(
                      <div style={{background:"#E1F5EE",border:"1px solid #5DCAA5",borderRadius:8,padding:"4px 12px",fontSize:12}}>
                        Your share: <strong>{c2((parseFloat(editTxForm.amount)||0)/editTxForm.splitCount)}</strong>
                        <span style={{color:"#64748B",marginLeft:6}}>of {c2(parseFloat(editTxForm.amount)||0)} total</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:8}}>
                <button style={S.btnS("#6366F1")} onClick={()=>saveTx(tx.id)}>Save</button>
                <button style={S.btn("#64748B")} onClick={()=>startEditTx(null)}>Cancel</button>
              </div>
            </div>
          );
        }
        return (
          <div key={tx.id} style={{...S.txrow,opacity:tx.isPaidForOther?0.5:1,cursor:bulkMode?"pointer":"default",background:bulkMode&&bulkSelected.has(tx.id)?"#EEF2FF":"transparent"}}
            onClick={bulkMode?()=>setBulkSelected(prev=>{const n=new Set(prev);n.has(tx.id)?n.delete(tx.id):n.add(tx.id);return n;}):undefined}>
            {bulkMode&&<input type="checkbox" readOnly checked={bulkSelected.has(tx.id)} style={{flexShrink:0,width:16,height:16,cursor:"pointer"}} onClick={e=>e.stopPropagation()}/>}
            <div style={{width:38,height:38,borderRadius:10,background:tx.isPaidForOther?"#FFF7ED":tx.isReimb?"#D1FAE5":cc+"1a",border:`1.5px solid ${tx.isPaidForOther?"#FED7AA":tx.isReimb?"#6EE7B7":cc+"30"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:15,fontWeight:700,color:tx.isPaidForOther?"#C2410C":tx.isReimb?"#059669":cc,lineHeight:1}}>
                {tx.isPaidForOther?"↷":tx.isReimb?"↩":(tx.merchant||"?")[0].toUpperCase()}
              </span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:500}}>{tx.merchant}</span>
                {tx.isPaidForOther&&<Pill label="↷ paid for others" color="#C2410C" bg="#FFF7ED"/>}
                {tx.recurringId&&<Pill label="recurring" color="#0F6E56" bg="#E1F5EE"/>}
                {tx.isReimb&&<Pill label="reimbursement ↩" color="#1D9E75" bg="#E1F5EE"/>}
                {tx.isSplit&&<Pill label="split" color="#1565C0" bg="#E3F2FD"/>}
                {tx.amount>=200&&!tx.isReimb&&!tx.isPaidForOther&&<Pill label="large" color="#7C3AED" bg="#EDE9FE"/>}
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
            {showDel&&<button onClick={()=>delTx(tx.id,tx.merchant)} style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>×</button>}
          </div>
        );
      })}
    </div>
  ));
}

// ── PLAID CONNECT BUTTON ──────────────────────────────────────────
const PLAID_REDIRECT_URI = "https://fintrack-five-nu.vercel.app";

function PlaidConnectButton({ onConnected }) {
  const isOAuthRedirect = new URLSearchParams(window.location.search).has("oauth_state_id");
  const [linkToken, setLinkToken] = useState(() => isOAuthRedirect ? (localStorage.getItem("plaid_link_token") || "") : "");
  const [loading,   setLoading]   = useState(isOAuthRedirect);

  const receivedRedirectUri = isOAuthRedirect ? window.location.href : undefined;

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri,
    onSuccess: async (public_token, metadata) => {
      localStorage.removeItem("plaid_link_token");
      window.history.replaceState({}, "", window.location.pathname);
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
    onExit: () => {
      localStorage.removeItem("plaid_link_token");
      window.history.replaceState({}, "", window.location.pathname);
      setLoading(false);
      setLinkToken("");
    },
  });

  useEffect(() => { if (linkToken && ready) open(); }, [linkToken, ready, open]);

  const handleConnect = async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${FUNC_BASE}/plaid-link-token`, { method: "POST" });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      localStorage.setItem("plaid_link_token", data.link_token);
      setLinkToken(data.link_token);
    } catch(e) { console.error("Link token error:", e); setLoading(false); }
  };

  return (
    <button style={S.btnS("#6366F1")} onClick={handleConnect} disabled={loading || isOAuthRedirect}>
      {loading || isOAuthRedirect ? "Opening…" : "+ Connect Bank"}
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
  const [settings,       setSettings]       = useState({jobStart:DEFAULT_JOB_START,firstPaycheck:DEFAULT_FIRST_CHECK,payCycle:DEFAULT_PAY_CYCLE,rothRecurring:500,rothOverrides:{},flagKeywords:["Amex Send"],excludedAccounts:[],userName:"",accentColor:"#6366F1"});
  const [drillCat,       setDrillCat]       = useState(null);
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
  const [bulkMode,        setBulkMode]        = useState(false);
  const [bulkSelected,    setBulkSelected]    = useState(new Set());
  const [bulkCat,         setBulkCat]         = useState("dining");
  const [undoStack,       setUndoStack]       = useState(null);
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
  const [dismissedSubs,    setDismissedSubs]    = useState([]);
  const [forecastBalance,  setForecastBalance]  = useState("");
  const [forecastThreshold,setForecastThreshold]= useState(1000);

  // Net Worth state
  const [plaidBalances,       setPlaidBalances]       = useState([]);
  const [loadingBalances,     setLoadingBalances]     = useState(false);
  const [manualAssets,        setManualAssets]        = useState([]);
  const [networthSnapshots,   setNetworthSnapshots]   = useState([]);
  const [showManualAssetForm, setShowManualAssetForm] = useState(false);
  const [manualAssetForm,     setManualAssetForm]     = useState({name:"",type:"real_estate",value:""});

  // ── LOAD ──
  useEffect(()=>{
    async function load(){
      try {
        const keys=["v3_md","v3_budgets","v3_goals","v3_settings","v3_cats","v3_recurring","v3_recurringSkips","v3_rollover","v3_dismissed_subs","v3_manual_assets","v3_nw_snapshots"];
        const res=await Promise.all(keys.map(k=>storage.get(k).catch(()=>null)));
        if(res[0]) setMonthData(JSON.parse(res[0].value));
        if(res[1]) setBudgets(JSON.parse(res[1].value));
        if(res[2]) setGoals(JSON.parse(res[2].value));
        if(res[3]) setSettings(def=>({...def,...JSON.parse(res[3].value)}));
        if(res[4]) setCats(JSON.parse(res[4].value));
        if(res[5]) setRecurring(JSON.parse(res[5].value));
        if(res[6]) setRecurringSkips(JSON.parse(res[6].value));
        if(res[7]) setRollover(JSON.parse(res[7].value));
        if(res[8]) setDismissedSubs(JSON.parse(res[8].value));
        if(res[9]) setManualAssets(JSON.parse(res[9].value));
        if(res[10]) setNetworthSnapshots(JSON.parse(res[10].value));
      } catch(e){ console.error("Load error",e); }
      setLoaded(true);
    }
    load();
    loadConnections();
    loadBalances();
  },[]);

  const loadBalances = async()=>{
    setLoadingBalances(true);
    try{
      const res=await fetch(`${FUNC_BASE}/plaid-get-balances`,{method:"POST"});
      const data=await res.json();
      if(data.accounts) setPlaidBalances(data.accounts);
    }catch(e){console.error("Balance load error:",e);}
    finally{setLoadingBalances(false);}
  };

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

  const catSpend=(cat,txs=txList)=>txs.filter(t=>t.cat===cat&&!t.isReimb&&!t.isPaidForOther).reduce((s,t)=>s+(t.amount||0),0);
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

  const delTx=(id,merchant)=>{
    if(!window.confirm(`Delete "${merchant||"this transaction"}"?`)) return;
    const key=mkKey(vy,vm); const ex=monthData[key]||{};
    const tx=(ex.transactions||[]).find(t=>t.id===id);
    const next={...monthData,[key]:{...ex,transactions:(ex.transactions||[]).filter(t=>t.id!==id)}};
    setMonthData(next); save("v3_md",next);
    if(tx){
      if(undoStack?.timeout) clearTimeout(undoStack.timeout);
      const timeout=setTimeout(()=>setUndoStack(null),6000);
      setUndoStack({tx,key,timeout});
    }
  };

  const undoDelete=()=>{
    if(!undoStack) return;
    clearTimeout(undoStack.timeout);
    const ex=monthData[undoStack.key]||{};
    const next={...monthData,[undoStack.key]:{...ex,transactions:[...(ex.transactions||[]),undoStack.tx]}};
    setMonthData(next); save("v3_md",next);
    setUndoStack(null);
  };

  const startEditTx=tx=>{
    if(!tx){setEditTxId(null);setEditTxForm(null);return;}
    setEditTxId(tx.id);
    const ways=tx.isSplit?(tx.splitWith?.length||1)+1:2;
    setEditTxForm({
      date:tx.date, merchant:tx.merchant, cat:tx.cat,
      amount:String(tx.isSplit?tx.totalBill||tx.amount:tx.amount),
      note:tx.note||"", isSplit:tx.isSplit||false,
      splitCount:ways, isPaidForOther:tx.isPaidForOther||false,
    });
  };

  const saveTx=id=>{
    if(!editTxForm) return;
    const total=parseFloat(editTxForm.amount)||0;
    const myShare=editTxForm.isSplit?total/editTxForm.splitCount:total;
    const key=mkKey(vy,vm); const ex=monthData[key]||{};
    const txs=(ex.transactions||[]).map(t=>t.id!==id?t:{...t,
      date:editTxForm.date, merchant:editTxForm.merchant, cat:editTxForm.cat,
      amount:myShare, note:editTxForm.note,
      isSplit:editTxForm.isSplit, isPaidForOther:editTxForm.isPaidForOther||false,
      totalBill:editTxForm.isSplit?total:0,
      splitWith:editTxForm.isSplit
        ?Array.from({length:editTxForm.splitCount-1},(_,i)=>
            (t.splitWith?.[i]||{name:`Person ${i+1}`,paid:false,owes:myShare}))
        :[],
    });
    const next={...monthData,[key]:{...ex,transactions:txs}};
    setMonthData(next); save("v3_md",next);
    setEditTxId(null); setEditTxForm(null);
  };

  const applyBulkCat=()=>{
    const key=mkKey(vy,vm); const ex=monthData[key]||{};
    const txs=(ex.transactions||[]).map(t=>bulkSelected.has(t.id)?{...t,cat:bulkCat}:t);
    const next={...monthData,[key]:{...ex,transactions:txs}};
    setMonthData(next); save("v3_md",next);
    setBulkSelected(new Set()); setBulkMode(false);
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

  // ── NET WORTH ──
  const addManualAsset=()=>{
    if(!manualAssetForm.name||!manualAssetForm.value) return;
    const next=[...manualAssets,{id:Date.now(),...manualAssetForm,value:parseFloat(manualAssetForm.value)||0}];
    setManualAssets(next); save("v3_manual_assets",next);
    setManualAssetForm({name:"",type:"real_estate",value:""}); setShowManualAssetForm(false);
  };
  const delManualAsset=id=>{
    const next=manualAssets.filter(a=>a.id!==id); setManualAssets(next); save("v3_manual_assets",next);
  };
  const saveSnapshot=(nw,assets,liabilities)=>{
    const date=mkKey(CUR_Y,CUR_M);
    const snap={date,netWorth:nw,assets,liabilities};
    const next=[...networthSnapshots.filter(s=>s.date!==date),snap].sort((a,b)=>a.date.localeCompare(b.date)).slice(-24);
    setNetworthSnapshots(next); save("v3_nw_snapshots",next);
  };

  // ── PLAID ──
  const unlinkConnection = async (connectionId, institutionName) => {
    if (!window.confirm(`Unlink ${institutionName}? This will remove the connection and stop syncing.`)) return;
    try {
      const res = await fetch(`${FUNC_BASE}/plaid-remove-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connectionId }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      loadConnections();
    } catch(e) { console.error("Unlink error:", e); alert("Failed to unlink: " + e.message); }
  };

  const clearAllData = () => {
    if (!window.confirm("Clear ALL transaction data? This cannot be undone.")) return;
    const next = {};
    setMonthData(next);
    save("v3_md", next);
  };

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

      if (data.skipped?.length) {
        alert(`${data.skipped.join(", ")}: still loading initial transactions. Plaid needs a few minutes on first connect. Try again shortly.`);
      }
      const keywords = settings.flagKeywords || [];
      const excluded = settings.excludedAccounts || [];
      // Auto-mark transactions from extension cards
      const markedFresh = fresh.map(t => {
        const isExtension = excluded.some(acct => t.account && t.account.toLowerCase().includes(acct.toLowerCase()));
        return isExtension ? { ...t, isPaidForOther: true } : t;
      });
      setSyncedTxs(markedFresh);
      const sel = {};
      markedFresh.forEach(t => {
        const flagged = keywords.some(kw => kw && t.merchant.toLowerCase().includes(kw.toLowerCase()));
        sel[t.plaid_id] = !flagged && !t.isPaidForOther;
      });
      setImportSelections(sel);
      loadConnections();
    } catch(e) { console.error("Sync error:", e); alert("Sync failed: " + e.message); }
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

  // ── THEME ─────────────────────────────────────────────────────
  S = makeStyles(!!settings.darkMode, settings.accentColor||"#6366F1");
  const T = S.T;

  if(!loaded) return <div style={{...S.app,display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",flexDirection:"column",gap:12}}><div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${settings.accentColor||"#6366F1"},${settings.accentColor||"#6366F1"}cc)`,animation:"spin 1s linear infinite"}}/><span style={{color:T.muted,fontSize:12,fontWeight:500}}>Loading your finances…</span></div>;

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div style={S.app}>
      {/* TOPBAR */}
      <div style={S.topbar}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {(drillCat||showSettings)?(
            <button onClick={()=>{setDrillCat(null);setShowSettings(false);setBulkMode(false);setBulkSelected(new Set());startEditTx(null);}}
              style={{background:"none",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:6,color:settings.accentColor||"#6366F1",fontWeight:700,fontSize:13,padding:0,fontFamily:"inherit"}}>
              ← <span style={{...S.logo,backgroundImage:`linear-gradient(135deg,${settings.accentColor||"#6366F1"} 0%,${settings.accentColor||"#6366F1"}99 100%)`}}>fintrack</span>
            </button>
          ):(
            <div style={{...S.logo,backgroundImage:`linear-gradient(135deg,${settings.accentColor||"#6366F1"} 0%,${settings.accentColor||"#8B5CF6"} 100%)`}}>fintrack</div>
          )}
          <div style={{width:1,height:14,background:"#E2E8F0"}}/>
          {showSettings?(
            <span style={{fontSize:13,fontWeight:700,color:T.text}}>Settings</span>
          ):drillCat?(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:10,height:10,borderRadius:2,background:catColor(cats,drillCat)}}/>
              <span style={{fontSize:13,fontWeight:700,color:T.text}}>{catLabel(cats,drillCat)}</span>
              <span style={{fontSize:11,color:"#94A3B8"}}>{FULLMONTHS[vm]}</span>
            </div>
          ):(
            <>
              <div style={{fontSize:11,color:"#64748B"}}>{FULLMONTHS[vm]} {vy}</div>
              {pendingTotal>0&&<div style={{fontSize:11,background:"#E3F2FD",color:"#1565C0",padding:"2px 8px",borderRadius:20,fontWeight:600,cursor:"pointer"}} onClick={()=>setTab("splits")}>💸 {c0(pendingTotal)}</div>}
            </>
          )}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {!showSettings&&!drillCat&&<button style={{...S.btn("#64748B"),padding:"4px 10px",fontSize:11}} onClick={()=>setShowSettings(true)}>⚙</button>}
          {!showSettings&&!drillCat&&<button style={{...S.btn("#6366F1"),padding:"4px 10px",fontSize:11}} onClick={()=>setShowExport(!showExport)}>↓</button>}
          <div style={{fontSize:10,fontWeight:600,color:saving?"#10B981":"#CBD5E1",minWidth:40,transition:"color 0.4s",display:"flex",alignItems:"center",gap:4}}>{saving?<><span style={{width:6,height:6,borderRadius:"50%",background:"#10B981",display:"inline-block"}}/>saving</> :<><span style={{width:6,height:6,borderRadius:"50%",background:"#CBD5E1",display:"inline-block"}}/>saved</>}</div>
        </div>
      </div>

      {/* NAV */}
      {!drillCat&&!showSettings&&<div style={{...S.nav,padding:"0 20px"}}>
        <div style={S.nav}>
          {[["overview","Overview"],["txns","Transactions"],["accounts","Accounts"],["recurring","Recurring"],["networth","Net Worth"],["annual","Annual"],["splits","Splits"],["goals","Goals"],["roth","Roth IRA"]].map(([id,l])=>(
            <button key={id} style={S.nb(tab===id)} onClick={()=>setTab(id)}>
              {l}{id==="recurring"&&recurringBadgeCount>0&&<span style={{marginLeft:4,background:"#E24B4A",color:"#FFF",borderRadius:10,fontSize:9,padding:"1px 5px",fontWeight:700,verticalAlign:"middle"}}>{recurringBadgeCount}</span>}
            </button>
          ))}
        </div>
      </div>}

      <div style={S.body}>

        {/* ══ CATEGORY DRILL-DOWN PAGE ══ */}
        {drillCat&&(()=>{
          const cat=cats.find(c=>c.id===drillCat)||{label:drillCat,color:"#888",bg:"#F5F5F5"};
          const catTxs=txList.filter(t=>t.cat===drillCat);
          const total=catSpend(drillCat);
          const budget=getEffBudget(drillCat,vy,vm);
          const count=catTxs.filter(t=>!t.isReimb&&!t.isPaidForOther).length;
          return(
            <div>
              {/* Category hero */}
              <div style={{background:`linear-gradient(135deg,${cat.color}18,${cat.color}08)`,border:`1px solid ${cat.color}30`,borderRadius:14,padding:"20px 24px",marginBottom:16}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                  <div style={{width:44,height:44,borderRadius:12,background:cat.color,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{fontSize:20,color:"#FFF",fontWeight:800}}>{cat.label[0]}</span>
                  </div>
                  <div>
                    <div style={{fontSize:22,fontWeight:800,color:"#0F172A",letterSpacing:"-0.5px"}}>{cat.label}</div>
                    <div style={{fontSize:12,color:"#64748B"}}>{FULLMONTHS[vm]} {vy}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
                  <div><div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>Spent</div>
                    <div style={{fontSize:26,fontWeight:800,color:cat.color,letterSpacing:"-0.5px"}}>{c0(total)}</div></div>
                  {budget>0&&<div><div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>Budget</div>
                    <div style={{fontSize:26,fontWeight:800,color:"#0F172A",letterSpacing:"-0.5px"}}>{c0(budget)}</div></div>}
                  {budget>0&&<div><div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>Remaining</div>
                    <div style={{fontSize:26,fontWeight:800,color:total>budget?"#A32D2D":"#1D9E75",letterSpacing:"-0.5px"}}>{c0(budget-total)}</div></div>}
                  <div><div style={{fontSize:11,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>Transactions</div>
                    <div style={{fontSize:26,fontWeight:800,color:"#0F172A",letterSpacing:"-0.5px"}}>{count}</div></div>
                </div>
                {budget>0&&<div style={{marginTop:12}}><Bar val={total} max={Math.max(budget,total,1)} color={total>budget?"#E24B4A":cat.color} h={8}/></div>}
              </div>

              {/* Bulk select bar — sticky */}
              <div style={{...S.card,marginBottom:12,background:bulkMode?"#EEF2FF":"#FFF",border:bulkMode?"1.5px solid #AFA9EC":"1px solid #E2E8F0",position:"sticky",top:56,zIndex:20,boxShadow:"0 2px 8px rgba(15,23,42,0.08)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <button style={bulkMode?S.btnS("#6366F1"):S.btn("#6366F1")} onClick={()=>{setBulkMode(v=>!v);setBulkSelected(new Set());}}>
                    {bulkMode?"✕ Cancel":"⊡ Select multiple"}
                  </button>
                  {bulkMode&&<>
                    <span style={{fontSize:12,fontWeight:600,color:"#6366F1"}}>{bulkSelected.size} selected</span>
                    <button style={{...S.btn("#64748B"),fontSize:11,padding:"3px 10px"}} onClick={()=>setBulkSelected(new Set(catTxs.map(t=>t.id)))}>All</button>
                    <button style={{...S.btn("#64748B"),fontSize:11,padding:"3px 10px"}} onClick={()=>setBulkSelected(new Set())}>Clear</button>
                    <div style={{flex:1}}/>
                    {bulkSelected.size>0&&<>
                      <select value={bulkCat} onChange={e=>setBulkCat(e.target.value)} style={{...S.sel,width:140,fontSize:12}}>
                        {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <button style={S.btnS("#6366F1")} onClick={applyBulkCat}>Apply to {bulkSelected.size}</button>
                    </>}
                  </>}
                </div>
              </div>

              {/* Transaction list */}
              <div style={S.card}>
                {catTxs.length===0
                  ?<div style={{textAlign:"center",padding:"32px 0",color:"#64748B",fontSize:12}}>No transactions in this category</div>
                  :<TxList txs={catTxs} addReimb={addReimb} delTx={delTx} cats={cats}
                    editTxId={editTxId} editTxForm={editTxForm} setEditTxForm={setEditTxForm} startEditTx={startEditTx} saveTx={saveTx}
                    bulkMode={bulkMode} bulkSelected={bulkSelected} setBulkSelected={setBulkSelected}/>
                }
              </div>
            </div>
          );
        })()}

        {!drillCat&&!showSettings&&<>

        {/* ══ SETTINGS PAGE ══ */}
        {showSettings&&(
          <div>
            {/* ── PROFILE ── */}
            {(()=>{
              const accent=settings.accentColor||"#6366F1";
              const initials=(settings.userName||"").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)||"Me";
              const ACCENT_COLORS=[{v:"#6366F1",n:"Indigo"},{v:"#8B5CF6",n:"Violet"},{v:"#0EA5E9",n:"Sky"},{v:"#10B981",n:"Emerald"},{v:"#F59E0B",n:"Amber"},{v:"#F43F5E",n:"Rose"}];
              const upd=(patch)=>{const next={...settings,...patch};setSettings(next);save("v3_settings",next);};
              return(
                <>
                {/* Profile card */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:16}}>Profile</div>
                  <div style={{display:"flex",alignItems:"center",gap:20}}>
                    <div style={{width:64,height:64,borderRadius:20,background:`linear-gradient(135deg,${accent},${accent}99)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,color:"#FFF",flexShrink:0,boxShadow:`0 4px 16px ${accent}40`}}>
                      {initials}
                    </div>
                    <div style={{flex:1}}>
                      <div style={S.slabel}>Your name</div>
                      <input type="text" style={{...S.input,fontSize:15,fontWeight:600}} placeholder="e.g. Basem Misleh"
                        value={settings.userName||""} onChange={e=>upd({userName:e.target.value})}/>
                    </div>
                  </div>
                </div>

                {/* Appearance */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:16}}>Appearance</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div style={S.slabel}>Dark mode</div>
                    <button onClick={()=>upd({darkMode:!settings.darkMode})}
                      style={{width:48,height:26,borderRadius:13,background:settings.darkMode?accent:"#CBD5E1",border:"none",cursor:"pointer",position:"relative",transition:"background 0.3s",padding:0}}>
                      <div style={{width:20,height:20,borderRadius:10,background:"#FFF",position:"absolute",top:3,left:settings.darkMode?25:3,transition:"left 0.3s",boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}/>
                    </button>
                  </div>
                  <div style={S.slabel}>Accent color</div>
                  <div style={{display:"flex",gap:10,marginTop:8,flexWrap:"wrap"}}>
                    {ACCENT_COLORS.map(c=>(
                      <button key={c.v} onClick={()=>upd({accentColor:c.v})}
                        style={{width:36,height:36,borderRadius:10,background:c.v,border:accent===c.v?`3px solid ${T.text}`:"3px solid transparent",cursor:"pointer",boxShadow:accent===c.v?`0 0 0 2px ${T.surface},0 0 0 4px ${c.v}`:"none",transition:"all 0.15s"}}
                        title={c.n}/>
                    ))}
                  </div>
                </div>

                {/* Pay schedule */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:16}}>Pay schedule</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14}}>
                    <div>
                      <div style={S.slabel}>Job start date</div>
                      <input type="date" style={S.iy} value={settings.jobStart} onChange={e=>upd({jobStart:e.target.value})}/>
                    </div>
                    <div>
                      <div style={S.slabel}>First paycheck date</div>
                      <input type="date" style={{...S.iy,borderColor:settings.firstPaycheck?"#EF9F27":"#E24B4A"}} value={settings.firstPaycheck||""} onChange={e=>upd({firstPaycheck:e.target.value})}/>
                      <div style={{fontSize:10,color:settings.firstPaycheck?"#64748B":"#A32D2D",marginTop:4}}>{settings.firstPaycheck?"Pay dates calculated from here":"Set this when HR confirms"}</div>
                    </div>
                    <div>
                      <div style={S.slabel}>Pay cycle</div>
                      <select style={S.sel} value={settings.payCycle||14} onChange={e=>upd({payCycle:parseInt(e.target.value)})}>
                        <option value={7}>Weekly</option><option value={14}>Biweekly</option>
                        <option value={15}>Semi-monthly</option><option value={30}>Monthly</option>
                      </select>
                    </div>
                    <div>
                      <div style={S.slabel}>Default Roth IRA / mo</div>
                      <input type="number" inputMode="decimal" style={S.iy} value={settings.rothRecurring||500} onChange={e=>upd({rothRecurring:parseFloat(e.target.value)||0})}/>
                    </div>
                  </div>
                </div>

                {/* Categories */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                    <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px"}}>Categories</div>
                    <button style={S.btn(accent)} onClick={()=>{const nc={id:"cat_"+Date.now(),label:"New Category",color:accent,bg:autoBg(accent)};const next=[...cats,nc];setCats(next);save("v3_cats",next);}}>+ Add</button>
                  </div>
                  <div style={{display:"grid",gap:8}}>
                    {cats.map(cat=>(
                      <div key={cat.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#F8FAFC",borderRadius:8,border:"1px solid #E2E8F0"}}>
                        <div style={{width:12,height:12,borderRadius:3,background:cat.color,flexShrink:0}}/>
                        <input type="text" value={cat.label} style={{...S.input,flex:1,background:"transparent",border:"none",padding:"0",fontSize:13,fontWeight:500}}
                          onChange={e=>{const next=cats.map(c=>c.id===cat.id?{...c,label:e.target.value}:c);setCats(next);save("v3_cats",next);}}/>
                        <input type="color" value={cat.color} style={{width:24,height:24,border:"none",borderRadius:4,cursor:"pointer",padding:0,background:"none",flexShrink:0}}
                          onChange={e=>{const col=e.target.value;const next=cats.map(c=>c.id===cat.id?{...c,color:col,bg:autoBg(col)}:c);setCats(next);save("v3_cats",next);}}/>
                        <button onClick={()=>{if(cats.length<=1)return;const next=cats.filter(c=>c.id!==cat.id);setCats(next);save("v3_cats",next);}}
                          style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>×</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Flag keywords */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Import — flag for review</div>
                  <div style={{fontSize:11,color:"#94A3B8",marginBottom:12}}>Matching transactions are unchecked by default and highlighted on import.</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
                    {(settings.flagKeywords||[]).map((kw,i)=>(
                      <div key={i} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:20,padding:"4px 12px",fontSize:12}}>
                        <span style={{color:"#78350F",fontWeight:600}}>{kw}</span>
                        <button onClick={()=>upd({flagKeywords:(settings.flagKeywords||[]).filter((_,j)=>j!==i)})}
                          style={{background:"none",border:"none",color:"#B45309",cursor:"pointer",fontSize:14,lineHeight:1,padding:0}}>×</button>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <input type="text" style={{...S.input,flex:1}} placeholder="Add keyword (e.g. Amex Send)"
                      onKeyDown={e=>{if(e.key==="Enter"&&e.target.value.trim()){upd({flagKeywords:[...(settings.flagKeywords||[]),e.target.value.trim()]});e.target.value="";}}}/>
                    <button style={S.btn("#BA7517")} onClick={e=>{const inp=e.target.previousSibling;if(inp.value.trim()){upd({flagKeywords:[...(settings.flagKeywords||[]),inp.value.trim()]});inp.value=""}}}>+ Add</button>
                  </div>
                </div>

                {/* Data & export */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:16}}>Data & export</div>
                  <button style={{...S.btn("#6366F1"),marginBottom:8,display:"block"}} onClick={()=>setShowExport(v=>!v)}>{showExport?"Hide":"Show"} export</button>
                  {showExport&&<textarea readOnly value={exportData()} style={{...S.input,height:160,fontFamily:"monospace",fontSize:10,resize:"vertical",marginTop:8}}/>}
                </div>

                {/* Danger zone */}
                <div style={{...S.card,border:"1.5px solid #FCA5A544"}}>
                  <div style={{fontSize:12,fontWeight:700,color:"#991B1B",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:12}}>Danger zone</div>
                  <button style={{...S.btn("#E24B4A"),fontSize:12}} onClick={clearAllData}>🗑 Clear all transaction data</button>
                  <div style={{fontSize:10,color:"#94A3B8",marginTop:6}}>Removes all transactions. Settings, budgets, and categories are kept.</div>
                </div>
                </>
              );
            })()}
          </div>
        )}


        {/* ══ OVERVIEW ══ */}
        {tab==="overview"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm} setVy={setVy}/>
          {(()=>{
            const overBudget=cats.filter(cat=>{const sp=catSpend(cat.id);const eff=getEffBudget(cat.id,vy,vm);return eff>0&&sp>eff;});
            return overBudget.length>0&&(
              <div style={{background:"#FEF2F2",border:"1.5px solid #FCA5A5",borderRadius:10,padding:"10px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:16}}>⚠️</span>
                <div style={{flex:1}}>
                  <span style={{fontSize:12,fontWeight:700,color:"#991B1B"}}>Over budget: </span>
                  {overBudget.map((cat,i)=>{
                    const sp=catSpend(cat.id); const eff=getEffBudget(cat.id,vy,vm);
                    return <span key={cat.id} style={{fontSize:12,color:"#991B1B"}}>{cat.label} ({c0(sp-eff)} over){i<overBudget.length-1?", ":""}</span>;
                  })}
                </div>
                <button style={{...S.btn("#991B1B"),fontSize:11,padding:"3px 10px"}} onClick={()=>setTab("txns")}>View transactions →</button>
              </div>
            );
          })()}
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
          {(()=>{
            const upcoming=getUpcomingPayments(recurring,monthData);
            return upcoming.length>0&&(
              <div style={{...S.card,marginBottom:16,border:`1px solid ${T.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div style={S.ptitle}>Upcoming in the next 14 days</div>
                  <span style={{fontSize:11,color:T.muted}}>{c0(upcoming.reduce((s,u)=>s+u.amount,0))} due</span>
                </div>
                {upcoming.map((u,i)=>{
                  const cc=catColor(cats,u.cat); const isUrgent=u.daysAway<=3;
                  const dateStr=u.dueDate.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
                  return(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:i<upcoming.length-1?`1px solid ${T.borderSubtle}`:"none"}}>
                      <div style={{width:36,height:36,borderRadius:10,background:cc+"20",border:`1.5px solid ${cc}35`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:cc,flexShrink:0}}>
                        {u.name[0].toUpperCase()}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:600,color:T.text}}>{u.name}</div>
                        <div style={{fontSize:11,color:T.muted}}>{dateStr} · {catLabel(cats,u.cat)}</div>
                      </div>
                      <div style={{textAlign:"right",flexShrink:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:T.text}}>{c2(u.amount)}</div>
                        <div style={{fontSize:10,fontWeight:600,color:isUrgent?"#E24B4A":"#F59E0B",marginTop:1}}>
                          {u.daysAway===0?"today":u.daysAway===1?"tomorrow":`in ${u.daysAway} days`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {(()=>{const insights=generateInsights(monthData,cats,budgets,vm,vy);return insights.length>0&&(
            <div style={{...S.card,marginBottom:16}}>
              <div style={S.ptitle}>Insights — {MONTHS[vm]}</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {insights.map((ins,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 12px",background:ins.bg,borderRadius:8,border:`1px solid ${ins.color}22`}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:ins.color+"20",border:`1.5px solid ${ins.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:ins.color,fontWeight:700,flexShrink:0}}>{ins.icon}</div>
                    <span style={{fontSize:12,color:"#0F172A",lineHeight:1.5}}>{ins.text}</span>
                  </div>
                ))}
              </div>
            </div>
          );})()}
          {(()=>{
            const weeks=generateForecast(settings,recurring,totalIncome,parseFloat(forecastBalance)||0);
            const lowWeeks=weeks.filter(w=>w.balance<forecastThreshold);
            return(
              <div style={{...S.card,marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
                  <div>
                    <div style={S.ptitle}>12-week cash flow forecast</div>
                    <div style={{fontSize:11,color:"#64748B"}}>Based on your pay schedule and recurring expenses</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                    <div>
                      <div style={{fontSize:9,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>Current balance</div>
                      <input type="number" inputMode="decimal" value={forecastBalance} onChange={e=>setForecastBalance(e.target.value)}
                        placeholder="e.g. 5000" style={{...S.iy,width:100,fontSize:12,padding:"4px 8px"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:9,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:2}}>Alert below</div>
                      <input type="number" inputMode="decimal" value={forecastThreshold} onChange={e=>setForecastThreshold(parseFloat(e.target.value)||0)}
                        style={{...S.input,width:80,fontSize:12,padding:"4px 8px"}}/>
                    </div>
                  </div>
                </div>
                <ForecastChart weeks={weeks} threshold={forecastThreshold}/>
                {lowWeeks.length>0&&(
                  <div style={{marginTop:8,fontSize:11,color:"#BA7517",background:"#FFFBEB",borderRadius:6,padding:"6px 10px"}}>
                    ⚠ {lowWeeks.length} week{lowWeeks.length>1?"s":""} projected below {c0(forecastThreshold)}: {lowWeeks.map(w=>w.label).join(", ")}
                  </div>
                )}
                {!settings.firstPaycheck&&<div style={{marginTop:8,fontSize:11,color:"#94A3B8"}}>Set your first paycheck date in Settings to include income in the forecast.</div>}
              </div>
            );
          })()}
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
                  <div key={cat.id} onClick={()=>sp>0&&setDrillCat(cat.id)}
                    style={{padding:"9px 0",borderBottom:"1px solid #F1EFE8",cursor:sp>0?"pointer":"default",borderRadius:4,transition:"background 0.1s"}}
                    onMouseEnter={e=>{if(sp>0)e.currentTarget.style.background=T.elevated;}}
                    onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
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
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm} setVy={setVy}/>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div>
              <div style={{fontSize:15,fontWeight:700}}>{FULLMONTHS[vm]} {vy}</div>
              <div style={{fontSize:11,color:"#94A3B8"}}>{txList.length} transaction{txList.length!==1?"s":""}</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              {!bulkMode&&!showTxForm&&txList.length>0&&(
                <button style={{...S.btn("#E24B4A"),fontSize:11,padding:"5px 10px"}}
                  onClick={()=>{
                    if(!window.confirm(`Wipe all data for ${FULLMONTHS[vm]} ${vy}? This removes all transactions and income. Cannot be undone.`)) return;
                    const key=mkKey(vy,vm);
                    const next={...monthData,[key]:{income:0,bonus:0,transactions:[],rothBalance:0}};
                    setMonthData(next); save("v3_md",next);
                  }}>🗑 Wipe month</button>
              )}
              <button style={bulkMode?S.btnS("#6366F1"):S.btn("#6366F1")} onClick={()=>{setBulkMode(v=>!v);setBulkSelected(new Set());}}>
                {bulkMode?"✕ Cancel select":"⊡ Select"}
              </button>
              {!bulkMode&&<button style={S.btnS("#6366F1")} onClick={()=>setShowTxForm(!showTxForm)}>{showTxForm?"✕ Cancel":"+ Add"}</button>}
            </div>
          </div>
          {bulkMode&&(
            <div style={{...S.card,marginBottom:12,background:"#EEF2FF",border:"1.5px solid #AFA9EC",position:"sticky",top:56,zIndex:20,boxShadow:"0 2px 8px rgba(15,23,42,0.08)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{fontSize:12,fontWeight:600,color:"#6366F1"}}>{bulkSelected.size} selected</span>
                <button style={{...S.btn("#64748B"),fontSize:11,padding:"3px 10px"}} onClick={()=>{const all=new Set(filteredTxList.map(t=>t.id));setBulkSelected(all);}}>Select all</button>
                <button style={{...S.btn("#64748B"),fontSize:11,padding:"3px 10px"}} onClick={()=>setBulkSelected(new Set())}>Clear</button>
                <div style={{flex:1}}/>
                {bulkSelected.size>0&&(<>
                  <select value={bulkCat} onChange={e=>setBulkCat(e.target.value)} style={{...S.sel,width:140,fontSize:12}}>
                    {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <button style={S.btnS("#6366F1")} onClick={applyBulkCat}>Apply to {bulkSelected.size}</button>
                </>)}
              </div>
            </div>
          )}
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
            <TxList txs={filteredTxList} addReimb={addReimb} delTx={delTx} cats={cats} editTxId={editTxId} editTxForm={editTxForm} setEditTxForm={setEditTxForm} startEditTx={startEditTx} saveTx={saveTx} bulkMode={bulkMode} bulkSelected={bulkSelected} setBulkSelected={setBulkSelected}/>
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
              <div style={{fontSize:11,color:"#64748B",marginTop:2}}>Connect your bank accounts to automatically import transactions.</div>
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
                <div key={conn.id} style={{padding:"12px 0",borderBottom:"1px solid #F1F5F9"}}>
                  <div style={{display:"flex",alignItems:"center",gap:14}}>
                    <div style={{width:42,height:42,borderRadius:12,background:"linear-gradient(135deg,#EEF2FF,#E0E7FF)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>🏦</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:700}}>{conn.institution_name}</div>
                      <div style={{fontSize:10,color:"#94A3B8",marginTop:2}}>
                        Last synced: {conn.last_synced?new Date(conn.last_synced).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"Never"}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6,flexShrink:0}}>
                      <Pill label="Connected ✓" color="#10B981" bg="#D1FAE5"/>
                      <button onClick={()=>unlinkConnection(conn.id,conn.institution_name)}
                        style={{...S.btn("#E24B4A"),padding:"3px 10px",fontSize:11}}>Unlink</button>
                    </div>
                  </div>
                  {/* Individual card toggles */}
                  {(conn.accounts||[]).length>0&&(
                    <div style={{marginTop:10,marginLeft:56,display:"flex",flexDirection:"column",gap:6}}>
                      {(conn.accounts||[]).map(a=>{
                        const acctKey=a.name+(a.mask?` ···${a.mask}`:"");
                        const isExcluded=(settings.excludedAccounts||[]).includes(acctKey);
                        return(
                          <div key={a.id||a.mask} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:isExcluded?"#FFF7ED":"#F8FAFC",borderRadius:8,padding:"7px 12px",border:`1px solid ${isExcluded?"#FED7AA":"#E2E8F0"}`}}>
                            <div>
                              <span style={{fontSize:12,fontWeight:600,color:isExcluded?"#C2410C":"#0F172A"}}>{acctKey}</span>
                              <span style={{fontSize:10,color:"#94A3B8",marginLeft:8}}>{a.subtype||a.type}</span>
                            </div>
                            <button
                              onClick={()=>{
                                const cur=settings.excludedAccounts||[];
                                const next=isExcluded?cur.filter(x=>x!==acctKey):[...cur,acctKey];
                                const s={...settings,excludedAccounts:next};
                                setSettings(s); save("v3_settings",s);
                              }}
                              style={{...S.btn(isExcluded?"#C2410C":"#1D9E75"),padding:"3px 10px",fontSize:11,whiteSpace:"nowrap"}}>
                              {isExcluded?"↷ Extension card":"✓ My card"}
                            </button>
                          </div>
                        );
                      })}
                      {(settings.excludedAccounts||[]).some(x=>(conn.accounts||[]).some(a=>(a.name+(a.mask?` ···${a.mask}`:""))===x))&&(
                        <div style={{fontSize:10,color:"#C2410C",marginTop:2}}>Extension card transactions will be auto-flagged as "paid for someone else" on next sync.</div>
                      )}
                    </div>
                  )}
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
                  const isFlagged=(settings.flagKeywords||[]).some(kw=>kw&&t.merchant.toLowerCase().includes(kw.toLowerCase()));
                  return (
                    <div key={t.plaid_id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${isFlagged?"#FEF3C7":"#F1F5F9"}`,background:isFlagged?"#FFFBEB":"transparent"}}>
                      <input type="checkbox" style={{flexShrink:0,width:16,height:16,cursor:"pointer"}}
                        checked={!!importSelections[t.plaid_id]}
                        onChange={e=>setImportSelections(prev=>({...prev,[t.plaid_id]:e.target.checked}))}/>
                      <div style={{width:34,height:34,borderRadius:8,background:cc+"1a",border:`1.5px solid ${cc}30`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                        <span style={{fontSize:13,fontWeight:700,color:cc}}>{(t.merchant[0]||"?").toUpperCase()}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.merchant}</span>
                          {isFlagged&&<Pill label="⚑ Review" color="#BA7517" bg="#FEF3C7"/>}
                        </div>
                        <div style={{fontSize:10,color:"#64748B"}}>{fmtD(t.date)} · {t.institution}</div>
                      </div>
                      <select value={t.category}
                        onChange={e=>setSyncedTxs(prev=>prev.map(tx=>tx.plaid_id===t.plaid_id?{...tx,category:e.target.value}:tx))}
                        style={{...S.sel,width:120,fontSize:11,padding:"4px 8px",flexShrink:0}}>
                        {cats.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
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

          {(()=>{
            const detected=detectSubscriptions(monthData).filter(s=>!dismissedSubs.includes(s.id)&&!recurring.some(r=>r.name.toLowerCase()===s.merchant.toLowerCase()));
            const alreadyTracked=detectSubscriptions(monthData).filter(s=>recurring.some(r=>r.name.toLowerCase()===s.merchant.toLowerCase()));
            const monthlyTotal=detected.reduce((s,d)=>s+(d.frequency==="monthly"?d.amount:d.frequency==="weekly"?d.amount*4.33:d.frequency==="biweekly"?d.amount*2.17:d.amount/3),0);
            return detected.length>0&&(
              <div style={{...S.card,marginBottom:14,border:"1.5px solid #6366F144"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <div>
                    <div style={S.ptitle}>Auto-detected subscriptions ({detected.length})</div>
                    <div style={{fontSize:11,color:"#64748B"}}>Based on your transaction history · Est. {c0(monthlyTotal)}/mo total</div>
                  </div>
                </div>
                {detected.map(sub=>{
                  const cc=catColor(cats,sub.cat); const cb=catBg(cats,sub.cat);
                  return (
                    <div key={sub.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid #F1F5F9",flexWrap:"wrap"}}>
                      <div style={{width:36,height:36,borderRadius:9,background:cc+"1a",border:`1.5px solid ${cc}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:cc,flexShrink:0}}>
                        {sub.merchant[0].toUpperCase()}
                      </div>
                      <div style={{flex:1,minWidth:120}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:13,fontWeight:600}}>{sub.merchant}</span>
                          <Pill label={sub.frequency} color="#6366F1" bg="#EEF2FF"/>
                          <Pill label={catLabel(cats,sub.cat)} color={cc} bg={cb}/>
                          {sub.priceIncrease&&<Pill label={`↑${sub.priceIncreasePct}% price increase`} color="#A32D2D" bg="#FEF2F2"/>}
                        </div>
                        <div style={{fontSize:11,color:"#64748B",marginTop:2}}>{c2(sub.amount)}/occurrence · {c0(sub.annualCost)}/yr · {sub.occurrences} charges found</div>
                      </div>
                      <div style={{display:"flex",gap:8,flexShrink:0}}>
                        <button style={S.btnS("#1D9E75")} onClick={()=>{
                          const next=[...recurring,{id:Date.now(),name:sub.merchant,cat:sub.cat,amount:sub.amount,freq:sub.frequency,startDate:sub.lastDate}];
                          setRecurring(next); save("v3_recurring",next);
                          const nd=[...dismissedSubs,sub.id]; setDismissedSubs(nd); save("v3_dismissed_subs",nd);
                        }}>+ Track</button>
                        <button style={S.btn("#64748B")} onClick={()=>{
                          const nd=[...dismissedSubs,sub.id]; setDismissedSubs(nd); save("v3_dismissed_subs",nd);
                        }}>Dismiss</button>
                      </div>
                    </div>
                  );
                })}
                {alreadyTracked.length>0&&<div style={{fontSize:10,color:"#94A3B8",marginTop:8}}>{alreadyTracked.length} already tracked: {alreadyTracked.map(s=>s.merchant).join(", ")}</div>}
              </div>
            );
          })()}

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

        {/* ══ NET WORTH ══ */}
        {tab==="networth"&&(()=>{
          const depository=plaidBalances.filter(a=>a.type==="depository");
          const investment=plaidBalances.filter(a=>a.type==="investment");
          const credit=plaidBalances.filter(a=>a.type==="credit");
          const loan=plaidBalances.filter(a=>a.type==="loan");
          const assetsPlaid=[...depository,...investment].reduce((s,a)=>s+(a.balance||0),0);
          const assetsManual=manualAssets.reduce((s,a)=>s+(a.value||0),0);
          const assetsTotal=assetsPlaid+assetsManual;
          const liabilitiesTotal=[...credit,...loan].reduce((s,a)=>s+Math.abs(a.balance||0),0);
          const netWorth=assetsTotal-liabilitiesTotal;
          const prevSnap=networthSnapshots.length>=2?networthSnapshots[networthSnapshots.length-2]:null;
          const momDelta=prevSnap?netWorth-prevSnap.netWorth:null;
          const ASSET_TYPES={real_estate:"Real Estate",vehicle:"Vehicle",cash:"Cash / Savings",crypto:"Crypto",investment:"Investment",other:"Other"};
          if(plaidBalances.length>0&&netWorth!==0) saveSnapshot(netWorth,assetsTotal,liabilitiesTotal);
          return(<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:15,fontWeight:700}}>Net Worth</div>
              <button style={S.btn("#6366F1")} onClick={loadBalances} disabled={loadingBalances}>{loadingBalances?"Refreshing…":"↻ Refresh"}</button>
            </div>

            {/* KPI cards */}
            <div style={S.g3}>
              <div style={{...S.kpi,border:"1.5px solid #6366F144"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:netWorth>=0?"#6366F1":"#E24B4A",opacity:0.85,borderRadius:"14px 14px 0 0"}}/>
                <div style={{...S.klabel,marginTop:6}}>Net Worth</div>
                <div style={S.kval(netWorth>=0?"#6366F1":"#E24B4A")}>{c0(netWorth)}</div>
                {momDelta!==null&&<div style={S.ksub}>{momDelta>=0?"↑":"↓"} {c0(Math.abs(momDelta))} vs last month</div>}
              </div>
              <div style={S.kpi}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"#1D9E75",opacity:0.85,borderRadius:"14px 14px 0 0"}}/>
                <div style={{...S.klabel,marginTop:6}}>Total Assets</div>
                <div style={S.kval("#1D9E75")}>{c0(assetsTotal)}</div>
                <div style={S.ksub}>{c0(assetsManual)} manual · {c0(assetsPlaid)} Plaid</div>
              </div>
              <div style={S.kpi}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"#A32D2D",opacity:0.85,borderRadius:"14px 14px 0 0"}}/>
                <div style={{...S.klabel,marginTop:6}}>Total Liabilities</div>
                <div style={S.kval("#A32D2D")}>{c0(liabilitiesTotal)}</div>
                <div style={S.ksub}>{credit.length} card{credit.length!==1?"s":""} · {loan.length} loan{loan.length!==1?"s":""}</div>
              </div>
            </div>

            {/* Asset / Liability ratio bar */}
            {assetsTotal+liabilitiesTotal>0&&(
              <div style={{...S.card,marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:6}}>
                  <span style={{color:"#1D9E75",fontWeight:600}}>Assets {assetsTotal+liabilitiesTotal>0?Math.round(assetsTotal/(assetsTotal+liabilitiesTotal)*100):0}%</span>
                  <span style={{color:"#A32D2D",fontWeight:600}}>Liabilities {assetsTotal+liabilitiesTotal>0?Math.round(liabilitiesTotal/(assetsTotal+liabilitiesTotal)*100):0}%</span>
                </div>
                <div style={{height:10,borderRadius:10,overflow:"hidden",display:"flex"}}>
                  <div style={{flex:assetsTotal||0.01,background:"#1D9E75",transition:"flex 0.5s"}}/>
                  <div style={{flex:liabilitiesTotal||0.01,background:"#E24B4A",transition:"flex 0.5s"}}/>
                </div>
              </div>
            )}

            <div style={S.g2}>
              {/* Assets */}
              <div>
                <div style={{...S.card,marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div style={S.ptitle}>Assets — {c0(assetsTotal)}</div>
                    <button style={{...S.btn("#1D9E75"),fontSize:11}} onClick={()=>setShowManualAssetForm(v=>!v)}>+ Add manual</button>
                  </div>
                  {showManualAssetForm&&(
                    <div style={{background:"#F0FDF4",borderRadius:8,padding:12,marginBottom:12,border:"1px solid #86EFAC"}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                        <div><div style={S.slabel}>Name</div>
                          <input type="text" style={S.iy} placeholder="e.g. Tesla Model 3" value={manualAssetForm.name}
                            onChange={e=>setManualAssetForm(f=>({...f,name:e.target.value}))}/></div>
                        <div><div style={S.slabel}>Type</div>
                          <select style={S.sel} value={manualAssetForm.type} onChange={e=>setManualAssetForm(f=>({...f,type:e.target.value}))}>
                            {Object.entries(ASSET_TYPES).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select></div>
                        <div style={{gridColumn:"span 2"}}><div style={S.slabel}>Value ($)</div>
                          <input type="number" inputMode="decimal" style={S.iy} placeholder="0" value={manualAssetForm.value}
                            onChange={e=>setManualAssetForm(f=>({...f,value:e.target.value}))}/></div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button style={S.btnS("#1D9E75")} onClick={addManualAsset}>Add →</button>
                        <button style={S.btn("#64748B")} onClick={()=>setShowManualAssetForm(false)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {[...depository,...investment].map(a=>(
                    <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #F1F5F9"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:600}}>{a.name} {a.mask?`···${a.mask}`:""}</div>
                        <div style={{fontSize:10,color:"#94A3B8"}}>{a.institution} · {a.type}</div>
                      </div>
                      <div style={{fontSize:13,fontWeight:700,color:"#1D9E75"}}>{c2(a.balance||0)}</div>
                    </div>
                  ))}
                  {manualAssets.map(a=>(
                    <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #F1F5F9"}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:600}}>{a.name}</div>
                        <div style={{fontSize:10,color:"#94A3B8"}}>{ASSET_TYPES[a.type]||a.type} · manual</div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#1D9E75"}}>{c2(a.value)}</div>
                        <button onClick={()=>delManualAsset(a.id)} style={{background:"none",border:"none",color:"#CBD5E1",cursor:"pointer",fontSize:16}}>×</button>
                      </div>
                    </div>
                  ))}
                  {assetsPlaid===0&&manualAssets.length===0&&<div style={{color:"#94A3B8",fontSize:12,textAlign:"center",padding:"20px 0"}}>No assets yet — connect a bank or add manually</div>}
                </div>

                {/* Liabilities */}
                {liabilitiesTotal>0&&(
                  <div style={S.card}>
                    <div style={{...S.ptitle,marginBottom:12}}>Liabilities — {c0(liabilitiesTotal)}</div>
                    {[...credit,...loan].map(a=>(
                      <div key={a.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #F1F5F9"}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:600}}>{a.name} {a.mask?`···${a.mask}`:""}</div>
                          <div style={{fontSize:10,color:"#94A3B8"}}>{a.institution} · {a.type}</div>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:"#A32D2D"}}>{c2(Math.abs(a.balance||0))}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* History chart */}
              <div style={S.card}>
                <div style={S.ptitle}>Net worth history</div>
                {networthSnapshots.length<2?(
                  <div style={{color:"#94A3B8",fontSize:12,textAlign:"center",padding:"32px 0"}}>Check back next month — history builds over time as snapshots are saved.</div>
                ):(()=>{
                  const snaps=networthSnapshots.slice(-12);
                  const maxV=Math.max(...snaps.map(s=>s.netWorth),1);
                  const minV=Math.min(...snaps.map(s=>s.netWorth),0);
                  const range=maxV-minV||1; const H=140;
                  return(
                    <div>
                      <svg viewBox={`0 0 ${snaps.length*34} ${H+20}`} style={{width:"100%",height:H+20,display:"block"}}>
                        {snaps.map((s,i)=>{
                          const barH=Math.max(2,((s.netWorth-minV)/range)*H);
                          const x=i*34+2; const y=H-barH;
                          const color=s.netWorth>=0?"#6366F1":"#E24B4A";
                          const [yr,mo]=s.date.split("-");
                          return(
                            <g key={i}>
                              <rect x={x} y={y} width={28} height={barH} fill={color} opacity={0.75} rx={3}/>
                              <text x={x+14} y={H+14} textAnchor="middle" fontSize="8" fill="#94A3B8">{MONTHS[parseInt(mo)-1]}</text>
                            </g>
                          );
                        })}
                      </svg>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"#64748B",marginTop:4}}>
                        <span>Low: {c0(Math.min(...snaps.map(s=>s.netWorth)))}</span>
                        <span>High: {c0(Math.max(...snaps.map(s=>s.netWorth)))}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </>);
        })()}

        {/* ══ SPLITS ══ */}
        {tab==="splits"&&(<>
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm} setVy={setVy}/>
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
                    style={{display:"grid",gridTemplateColumns:"44px 1fr 1fr 1fr",gap:6,padding:"6px 4px",borderBottom:`1px solid ${T.borderSubtle}`,cursor:"pointer",background:isNow?T.elevated:"transparent",borderRadius:4}}>
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
          <MonthBar vm={vm} vy={vy} monthData={monthData} setVm={setVm} setVy={setVy}/>
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

        </>} {/* end !drillCat && !showSettings */}

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

      {/* ── UNDO TOAST ── */}
      {undoStack&&(
        <div style={{position:"fixed",bottom:90,left:"50%",transform:"translateX(-50%)",background:"#1E293B",color:"#FFF",borderRadius:14,padding:"12px 18px",display:"flex",alignItems:"center",gap:14,zIndex:300,boxShadow:"0 8px 32px rgba(0,0,0,0.25)",fontSize:13,whiteSpace:"nowrap",animation:"fadeUp 0.2s ease"}}>
          <span style={{color:"#94A3B8"}}>Deleted</span>
          <span style={{fontWeight:600}}>{undoStack.tx.merchant}</span>
          <button onClick={undoDelete}
            style={{background:"#6366F1",border:"none",color:"#FFF",borderRadius:8,padding:"5px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            Undo
          </button>
          <button onClick={()=>{clearTimeout(undoStack.timeout);setUndoStack(null);}}
            style={{background:"none",border:"none",color:"#64748B",cursor:"pointer",fontSize:18,lineHeight:1,padding:0}}>×</button>
        </div>
      )}
    </div>
  );
}
