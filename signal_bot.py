
import os
import time
import requests
from pybit.unified_trading import HTTP

# ===== НАСТРОЙКИ =====

SYMBOL = "SOLUSDT"
TIMEFRAME = "5"

EMA_FAST = 9
EMA_SLOW = 21
RSI_PERIOD = 14

CHECK_INTERVAL = 30

# Секреты будут задаваться в настройках облака
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

# По умолчанию используем Testnet, как в исходном коде
TESTNET = os.getenv("BYBIT_TESTNET", "true").lower() == "true"

session = HTTP(testnet=TESTNET)


# ===== TELEGRAM =====

def send_telegram(message):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("Не настроены Telegram-переменные")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"

    try:
        response = requests.post(
            url,
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message
            },
            timeout=15
        )
        response.raise_for_status()

        if not response.json().get("ok"):
            raise RuntimeError("Telegram не подтвердил отправку")

        return True

    except Exception as error:
        print(f"Ошибка Telegram: {error}")
        return False


# ===== EMA =====

def ema(data, period):
    alpha = 2 / (period + 1)
    result = [data[0]]

    for value in data[1:]:
        result.append(
            alpha * value + (1 - alpha) * result[-1]
        )

    return result


# ===== RSI =====

def calculate_rsi(data, period=14):
    changes = [
        data[i] - data[i - 1]
        for i in range(1, len(data))
    ]

    gains = [max(x, 0) for x in changes]
    losses = [max(-x, 0) for x in changes]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(changes)):
        avg_gain = (
            avg_gain * (period - 1) + gains[i]
        ) / period

        avg_loss = (
            avg_loss * (period - 1) + losses[i]
        ) / period

    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0

    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


# ===== ПОЛУЧЕНИЕ ДАННЫХ =====

def get_market_data():
    response = session.get_kline(
        category="linear",
        symbol=SYMBOL,
        interval=TIMEFRAME,
        limit=100
    )

    if response["retCode"] != 0:
        raise RuntimeError(response["retMsg"])

    candles = sorted(
        response["result"]["list"],
        key=lambda x: int(x[0])
    )

    now = int(time.time() * 1000)
    interval = int(TIMEFRAME) * 60000

    # Убираем незакрытую свечу
    candles = [
        c for c in candles
        if int(c[0]) + interval <= now
    ]

    if len(candles) < 30:
        raise RuntimeError("Недостаточно закрытых свечей")

    close = [float(c[4]) for c in candles]
    volume = [float(c[5]) for c in candles]

    return close, volume


# ===== АНАЛИЗ =====

def analyze():
    close, volume = get_market_data()

    fast = ema(close, EMA_FAST)
    slow = ema(close, EMA_SLOW)

    rsi = calculate_rsi(close, RSI_PERIOD)

    price = close[-1]
    average_volume = sum(volume[-21:-1]) / 20
    volume_ok = volume[-1] > average_volume

    if fast[-1] > slow[-1] and 50 <= rsi < 70:
        direction = "UPTREND"
        description = "Восходящее направление"

    elif fast[-1] < slow[-1] and 30 < rsi <= 50:
        direction = "DOWNTREND"
        description = "Нисходящее направление"

    else:
        direction = "WAIT"
        description = "Нет совпадения условий"

    message = (
        "SOLUSDT — АНАЛИЗ РЫНКА\n"
        "━━━━━━━━━━━━━━━━\n"
        f"Цена: {price:.4f} USDT\n"
        f"EMA 9: {fast[-1]:.4f}\n"
        f"EMA 21: {slow[-1]:.4f}\n"
        f"RSI: {rsi:.2f}\n"
        f"Объём: {'Повышенный' if volume_ok else 'Обычный'}\n"
        "━━━━━━━━━━━━━━━━\n"
        f"Состояние: {direction}\n"
        f"{description}\n\n"
        "Информационный анализ, не торговая рекомендация."
    )

    print(message)
    return direction, message


# ===== ГЛАВНЫЙ ЦИКЛ =====

def main():
    print("SOL SIGNAL BOT запущен")
    print(f"Testnet: {TESTNET}")

    last_signal = None

    while True:
        try:
            direction, message = analyze()

            # Отправляем сообщение при первом запуске
            # и только при последующем изменении состояния
            if direction != last_signal:
                if send_telegram(message):
                    last_signal = direction
                    print("Уведомление отправлено")

        except Exception as error:
            print(f"Ошибка анализа: {error}")

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
