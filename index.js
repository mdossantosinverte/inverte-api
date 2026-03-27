const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

// Cache to avoid hammering Bybit
let cache = { stocks: null, lastFetch: 0 };
const CACHE_TTL = 30_000; // 30 seconds

// xStock symbols on Bybit end with X, e.g. AAPLX, NVDAX, TSLAX
// Trading pairs are AAPLXUSDT, NVDAXUSDT, etc.
const NAMES = {
  AAPLX:  "Apple Inc.",
  NVDAX:  "NVIDIA Corp.",
  TSLAX:  "Tesla Inc.",
  GOOGLX: "Alphabet Inc.",
  METAX:  "Meta Platforms",
  AMZNX:  "Amazon.com",
  MSFTX:  "Microsoft Corp.",
  COINX:  "Coinbase Global",
  HOODX:  "Robinhood Markets",
  MCDX:   "McDonald's Corp.",
  CRCLX:  "Circle Internet",
  SPYX:   "S&P 500 ETF",
  QQQX:   "Nasdaq-100 ETF",
  IWMX:   "Russell 2000 ETF",
  GLDX:   "Gold ETF",
  SLVX:   "Silver ETF",
  AMDX:   "AMD Inc.",
  INTCX:  "Intel Corp.",
  NFLXX:  "Netflix Inc.",
  UBERX:  "Uber Technologies",
  SHOPX:  "Shopify Inc.",
  VX:     "Visa Inc.",
  MAX:    "Mastercard Inc.",
  JPMX:   "JPMorgan Chase",
  BACX:   "Bank of America",
  DISX:   "Walt Disney Co.",
  KOX:    "Coca-Cola Co.",
  PFEX:   "Pfizer Inc.",
  WBTX:   "Walmart Inc.",
  XOMX:   "ExxonMobil Corp.",
};

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "1.0.0" });
});

// All xStocks with live prices
app.get("/stocks", async (req, res) => {
  try {
    // Return cached data if fresh
    if (cache.stocks && Date.now() - cache.lastFetch < CACHE_TTL) {
      return res.json({ source: "cache", data: cache.stocks });
    }

    const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await response.json();

    if (json.retCode !== 0) throw new Error(json.retMsg);

    const stocks = [];
    for (const item of json.result.list) {
      const sym = item.symbol;
      const ticker = sym.replace("USDT", "");
      if (!NAMES[ticker]) continue;

      const price   = parseFloat(item.lastPrice)    || 0;
      const prev    = parseFloat(item.prevPrice24h) || price;
      const changeP = parseFloat(item.price24hPcnt) * 100 || 0;

      stocks.push({
        symbol:    sym,
        ticker,
        name:      NAMES[ticker],
        price,
        change:    price - prev,
        changeP,
        high24h:   parseFloat(item.highPrice24h) || 0,
        low24h:    parseFloat(item.lowPrice24h)  || 0,
        volume24h: parseFloat(item.volume24h)    || 0,
      });
    }

    // Sort known stocks first
    stocks.sort((a, b) => {
      const aK = !!NAMES[a.ticker], bK = !!NAMES[b.ticker];
      if (aK && !bK) return -1;
      if (!aK && bK) return 1;
      return a.ticker.localeCompare(b.ticker);
    });

    // Update cache
    cache = { stocks, lastFetch: Date.now() };
    res.json({ source: "live", data: stocks });

  } catch (err) {
    console.error("GET /stocks error:", err.message);
    if (cache.stocks) return res.json({ source: "stale", data: cache.stocks });
    res.status(500).json({ error: err.message });
  }
});

// Candles for a specific stock
app.get("/candles/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || "D";
    const limit    = req.query.limit    || 30;

    const response = await fetch(
      `${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const candles = json.result.list
      .reverse()
      .map(c => ({
        time:  parseInt(c[0]),
        open:  parseFloat(c[1]),
        high:  parseFloat(c[2]),
        low:   parseFloat(c[3]),
        close: parseFloat(c[4]),
      }));

    res.json({ data: candles });

  } catch (err) {
    console.error("GET /candles error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Single ticker price
app.get("/ticker/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await fetch(
      `${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`
    );
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const item    = json.result.list[0];
    const price   = parseFloat(item.lastPrice)    || 0;
    const prev    = parseFloat(item.prevPrice24h)  || price;
    const changeP = parseFloat(item.price24hPcnt)  * 100 || 0;

    res.json({
      data: {
        price,
        change:    price - prev,
        changeP,
        high24h:   parseFloat(item.highPrice24h) || 0,
        low24h:    parseFloat(item.lowPrice24h)  || 0,
        volume24h: parseFloat(item.volume24h)    || 0,
      }
    });

  } catch (err) {
    console.error("GET /ticker error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

// Debug — see raw Bybit response
app.get("/debug", async (req, res) => {
  const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
  const json = await response.json();
  const all = json.result.list.map(i => i.symbol);
  const xstocks = all.filter(s => s.includes("AAPL") || s.includes("TSLA") || s.includes("NVDA") || s.endsWith("XUSDT") || s.includes("COINX"));
  res.json({ total: all.length, xstocks, sample: all.slice(0, 30) });
});

app.listen(PORT, () => {
  console.log(`✅ Inverte API running on port ${PORT}`);
});