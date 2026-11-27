const API = "https://api.bybit.com/v5/market/kline";
const SYMBOLS = [{key:"sol",symbol:"SOLUSDT"},{key:"hype",symbol:"HYPEUSDT"}];
const INTERVAL = "1";
const refreshButton = document.getElementById("refresh");
let refreshTimer = null;
const el = id => document.getElementById(id);
const fmt = (n, digits=4) => Number(n).toLocaleString("en-US",{minimumFractionDigits:digits,maximumFractionDigits:digits});

function ema(values, period) {
  const alpha = 2/(period+1), out=[values[0]];
  for(let i=1;i<values.length;i++) out.push(alpha*values[i]+(1-alpha)*out[i-1]);
  return out;
}
function rsiWilder(values,period=14) {
  const changes=[];
  for(let i=1;i<values.length;i++) changes.push(values[i]-values[i-1]);
  if(changes.length<period) throw new Error("Недостаточно данных для RSI");
  let gain=0,loss=0;
  for(let i=0;i<period;i++){gain+=Math.max(changes[i],0);loss+=Math.max(-changes[i],0);}
  gain/=period;loss/=period;
  for(let i=period;i<changes.length;i++){
    gain=(gain*(period-1)+Math.max(changes[i],0))/period;
    loss=(loss*(period-1)+Math.max(-changes[i],0))/period;
  }
  if(loss===0) return gain===0?50:100;
  return 100-100/(1+gain/loss);
}
function candlePattern(candles) {
  const c=candles.at(-1), p=candles.at(-2);
  const range=Math.max(c.high-c.low,1e-12);
  const body=Math.abs(c.close-c.open);
  const upper=c.high-Math.max(c.open,c.close);
  const lower=Math.min(c.open,c.close)-c.low;
  const bullish=c.close>c.open, bearish=c.close<c.open;
  const prevBull=p.close>p.open, prevBear=p.close<p.open;
  if(body/range<0.1) return "Доджи — нерешительность";
  if(bullish && lower>body*2 && upper<body*0.8) return "Молот — возможный отскок вверх";
  if(bearish && upper>body*2 && lower<body*0.8) return "Падающая звезда — возможный откат";
  if(prevBear && bullish && c.open<=p.close && c.close>=p.open) return "Бычье поглощение";
  if(prevBull && bearish && c.open>=p.close && c.close<=p.open) return "Медвежье поглощение";
  if(bullish) return "Бычья свеча";
  if(bearish) return "Медвежья свеча";
  return "Нейтральная свеча";
}
function analyze(candles) {
  const closes=candles.map(c=>c.close), volumes=candles.map(c=>c.volume);
  const fast=ema(closes,9), slow=ema(closes,21), rsi=rsiWilder(closes,14);
  const last=candles.at(-1), pattern=candlePattern(candles);
  const avgVol=volumes.slice(-21,-1).reduce((a,b)=>a+b,0)/20;
  const volText=last.volume>avgVol*1.25?"Выше среднего":last.volume<avgVol*0.75?"Ниже среднего":"Обычный";
  const upTrend=fast.at(-1)>slow.at(-1), downTrend=fast.at(-1)<slow.at(-1);
  let score=0, reasons=[];
  if(upTrend){score+=2;reasons.push("EMA 9 выше EMA 21");}
  if(downTrend){score-=2;reasons.push("EMA 9 ниже EMA 21");}
  if(rsi>=55 && rsi<70){score+=1;reasons.push("RSI показывает положительный импульс");}
  else if(rsi>30 && rsi<=45){score-=1;reasons.push("RSI показывает отрицательный импульс");}
  else if(rsi>=70){reasons.push("RSI в высокой зоне — импульс может быть перегрет");}
  else if(rsi<=30){reasons.push("RSI в низкой зоне — возможно ослабление продаж");}
  if(pattern.includes("Бычье поглощение")||pattern.includes("Молот")){score+=1;reasons.push("свечная модель с бычьим оттенком");}
  if(pattern.includes("Медвежье поглощение")||pattern.includes("Падающая звезда")){score-=1;reasons.push("свечная модель с медвежьим оттенком");}
  if(volText==="Выше среднего") reasons.push("объём выше среднего");
  let direction="НЕЙТРАЛЬНО", cls="neutral";
  if(score>=3){direction="СКОРЕЕ ВВЕРХ";cls="up";}
  else if(score<=-3){direction="СКОРЕЕ ВНИЗ";cls="down";}
  else reasons.push("признаки смешанные, явного перевеса нет");
  return {last,fast:fast.at(-1),slow:slow.at(-1),rsi,volText,pattern,direction,cls,reasons,score};
}
async function loadSymbol(item) {
  const url=`${API}?category=spot&symbol=${item.symbol}&interval=${INTERVAL}&limit=120`;
  const response=await fetch(url,{cache:"no-store"});
  if(!response.ok) throw new Error(`${item.symbol}: HTTP ${response.status}`);
  const json=await response.json();
  if(json.retCode!==0) throw new Error(`${item.symbol}: ${json.retMsg||"ошибка API"}`);
  const now=Date.now(), duration=60000;
  const candles=json.result.list.map(c=>({time:Number(c[0]),open:Number(c[1]),high:Number(c[2]),low:Number(c[3]),close:Number(c[4]),volume:Number(c[5])}))
    .filter(c=>c.time+duration<=now).sort((a,b)=>a.time-b.time);
  if(candles.length<30) throw new Error(`${item.symbol}: недостаточно закрытых свечей`);
  const a=analyze(candles), k=item.key;
  el(`${k}-price`).textContent=`${fmt(a.last.close,3)} USDT`;
  el(`${k}-ema-fast`).textContent=fmt(a.fast,4);
  el(`${k}-ema-slow`).textContent=fmt(a.slow,4);
  el(`${k}-rsi`).textContent=a.rsi.toFixed(2);
  el(`${k}-rsi-bar`).style.width=`${Math.max(0,Math.min(100,a.rsi))}%`;
  el(`${k}-volume`).textContent=a.volText;
  el(`${k}-direction`).textContent=a.direction;
  el(`${k}-direction`).className=`signal-value ${a.cls}`;
  el(`${k}-ema-state`).textContent=a.fast>a.slow?"EMA: БЫЧЬЕ":a.fast<a.slow?"EMA: МЕДВЕЖЬЕ":"EMA: РАВНО";
  el(`${k}-explanation`).textContent=a.reasons.join("; ")+".";
  el(`${k}-pattern`).textContent=a.pattern;
  el(`${k}-candle-time`).textContent=new Date(a.last.time).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
  const validUntil=new Date(a.last.time+120000);
  el(`${k}-valid`).textContent=`до ${validUntil.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"})}`;
}
async function loadData(){
  refreshButton.disabled=true;refreshButton.textContent="Загрузка…";
  el("error").style.display="none";el("connection").textContent="ЗАГРУЗКА…";
  try{
    const results=await Promise.allSettled(SYMBOLS.map(loadSymbol));
    const failed=results.filter(r=>r.status==="rejected");
    if(failed.length===2) throw new Error(failed.map(r=>r.reason.message).join(" | "));
    el("connection").textContent=failed.length?"ЧАСТИЧНО ОБНОВЛЕНО":"ДАННЫЕ АКТУАЛЬНЫ";
    if(failed.length) el("error").textContent=failed.map(r=>r.reason.message).join(" | "),el("error").style.display="block";
    el("updated").textContent=`Проверено: ${new Date().toLocaleTimeString("ru-RU")}`;
  }catch(error){
    el("connection").textContent="НЕТ СВЯЗИ";
    el("error").textContent=`Не удалось обновить данные: ${error.message}. Проверь интернет и попробуй ещё раз.`;
    el("error").style.display="block";
  }finally{refreshButton.disabled=false;refreshButton.textContent="Обновить";}
}
refreshButton.addEventListener("click",loadData);
loadData();
refreshTimer=setInterval(()=>{if(document.visibilityState==="visible")loadData();},60000);
if("serviceWorker" in navigator) window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(err=>console.log("SW:",err)));
