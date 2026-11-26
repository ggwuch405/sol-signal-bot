const API = "https://api.bybit.com/v5/market/kline";
const SYMBOL = "SOLUSDT";
const INTERVAL = "5";
const refreshButton = document.getElementById("refresh");
let refreshTimer = null;

const el = id => document.getElementById(id);
const fmt = (n, digits=4) => Number(n).toLocaleString("en-US", {minimumFractionDigits:digits, maximumFractionDigits:digits});

function ema(values, period) {
  const alpha = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(alpha * values[i] + (1 - alpha) * out[i - 1]);
  }
  return out;
}

function rsiWilder(values, period=14) {
  const changes = [];
  for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1]);
  if (changes.length < period) throw new Error("Недостаточно данных для RSI");
  let gain = 0, loss = 0;
  for (let i = 0; i < period; i++) {
    gain += Math.max(changes[i], 0);
    loss += Math.max(-changes[i], 0);
  }
  gain /= period; loss /= period;
  for (let i = period; i < changes.length; i++) {
    gain = (gain * (period - 1) + Math.max(changes[i], 0)) / period;
    loss = (loss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

async function loadData() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Загрузка…";
  el("error").style.display = "none";
  el("connection").textContent = "ЗАГРУЗКА…";

  try {
    const url = `${API}?category=spot&symbol=${SYMBOL}&interval=${INTERVAL}&limit=100`;
    const response = await fetch(url, {cache:"no-store"});
    if (!response.ok) throw new Error(`Bybit ответил HTTP ${response.status}`);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg || "Ошибка Bybit API");

    const now = Date.now();
    const duration = Number(INTERVAL) * 60 * 1000;
    const candles = json.result.list
      .map(c => ({time:Number(c[0]), close:Number(c[4]), volume:Number(c[5])}))
      .filter(c => c.time + duration <= now)
      .sort((a,b) => a.time - b.time);

    if (candles.length < 30) throw new Error("Пока недостаточно закрытых свечей");

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const fast = ema(closes, 9);
    const slow = ema(closes, 21);
    const rsi = rsiWilder(closes, 14);
    const last = candles[candles.length - 1];
    const avgVol = volumes.slice(-21,-1).reduce((a,b)=>a+b,0) / 20;
    const volumeText = last.volume > avgVol ? "Выше среднего" : "Обычный";

    let direction = "НЕЙТРАЛЬНО";
    let className = "neutral";
    let explanation = "Индикаторы не показывают согласованного направления.";
    if (fast.at(-1) > slow.at(-1) && rsi >= 50 && rsi < 70) {
      direction = "ВВЕРХ";
      className = "up";
      explanation = "EMA 9 выше EMA 21, RSI находится в диапазоне 50–70.";
    } else if (fast.at(-1) < slow.at(-1) && rsi > 30 && rsi <= 50) {
      direction = "ВНИЗ";
      className = "down";
      explanation = "EMA 9 ниже EMA 21, RSI находится в диапазоне 30–50.";
    }

    el("price").textContent = `${fmt(last.close, 3)} USDT`;
    el("ema-fast").textContent = fmt(fast.at(-1), 4);
    el("ema-slow").textContent = fmt(slow.at(-1), 4);
    el("rsi").textContent = rsi.toFixed(2);
    el("rsi-bar").style.width = `${Math.max(0,Math.min(100,rsi))}%`;
    el("volume").textContent = volumeText;
    el("direction").textContent = direction;
    el("direction").className = `signal-value ${className}`;
    el("ema-state").textContent = fast.at(-1) > slow.at(-1) ? "EMA: БЫЧЬЕ" : fast.at(-1) < slow.at(-1) ? "EMA: МЕДВЕЖЬЕ" : "EMA: РАВНО";
    el("explanation").textContent = explanation;
    el("candle-time").textContent = new Date(last.time).toLocaleString("ru-RU", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
    el("updated").textContent = `Обновлено: ${new Date().toLocaleTimeString("ru-RU")}`;
    el("connection").textContent = "ДАННЫЕ АКТУАЛЬНЫ";
  } catch (error) {
    el("connection").textContent = "НЕТ СВЯЗИ";
    el("error").textContent = `Не удалось обновить данные: ${error.message}. Проверь интернет и попробуй ещё раз.`;
    el("error").style.display = "block";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = "Обновить";
  }
}

refreshButton.addEventListener("click", loadData);
loadData();
refreshTimer = setInterval(() => {
  if (document.visibilityState === "visible") loadData();
}, 30000);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(err => console.log("SW:", err));
  });
}
