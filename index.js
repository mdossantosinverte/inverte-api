const express   = require("express");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");
const { z }     = require("zod");

const app = express();
app.use(cors());

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." }
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Rate limit exceeded." }
});

app.use("/stocks",  limiter);
app.use("/candles", limiter);
app.use("/ticker",  limiter);
app.use("/debug",   strictLimiter);

// ─── Validation Schemas ───────────────────────────────────────────────────────

const symbolSchema = z.string()
  .regex(/^[A-Z0-9]+USDT$/, "Invalid symbol format")
  .max(20);

const rangeSchema = z.enum(["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "ALL"]);

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE = "https://api.bybit.com";

const XSTOCKS_LAUNCH_MS = new Date("2025-06-30").getTime();

const CONFIRMED_XSTOCKS = new Set([
  "AAPLXUSDT", "NVDAXUSDT", "TSLAXUSDT", "GOOGLXUSDT", "METAXUSDT",
  "AMZNXUSDT", "MSFTXUSDT", "COINXUSDT", "HOODXUSDT",  "MCDXUSDT",
  "CRCLXUSDT", "SPYXUSDT",  "QQQXUSDT",  "GLDXUSDT",   "SLVXUSDT",
  "IWMXUSDT",  "AMDXUSDT",  "INTCXUSDT", "NFLXXUSDT",  "UBERXUSDT",
  "SHOPXUSDT", "MSTRXUSDT", "PLTRXUSDT", "SNAPXUSDT",  "SPOTXUSDT",
  "PYPLXUSDT", "SQXUSDT",   "NKEXUSDT",  "RIVNXUSDT",  "SOFIXUSDT",
  "TSMXUSDT",  "ABBVXUSDT", "JNJXUSDT",  "PGXUSDT",    "MRKXUSDT",
  "GSXUSDT",   "MSXUSDT",   "BLKXUSDT",  "CATXUSDT",   "BAXUSDT",
  "LMTXUSDT",  "GEXUSDT",   "FDXXUSDT",  "UPSXUSDT",   "PANWXUSDT",
  "CRWDXUSDT", "SNOWXUSDT", "CLOUDXUSDT","QCOMXUSDT",  "TXNXUSDT",
  "COSTXUSDT", "CVSXUSDT",  "LLXYUSDT",  "ORACLXUSDT", "CRMXUSDT",
  "ADOBEXUSDT","AMGXUSDT",  "WDAYXUSDT", "JPMXUSDT",   "BACXUSDT",
  "DISXUSDT",  "KOXUSDT",   "PFEXUSDT",  "WMTXUSDT",   "XOMXUSDT",
]);

const NAMES = {
  AAPLX:  "Apple Inc.",          NVDAX:  "NVIDIA Corp.",
  TSLAX:  "Tesla Inc.",          GOOGLX: "Alphabet Inc.",
  METAX:  "Meta Platforms",      AMZNX:  "Amazon.com Inc.",
  MSFTX:  "Microsoft Corp.",     COINX:  "Coinbase Global",
  HOODX:  "Robinhood Markets",   MCDX:   "McDonald's Corp.",
  CRCLX:  "Circle Internet",     SPYX:   "SPDR S&P 500 ETF",
  QQQX:   "Nasdaq-100 ETF",      GLDX:   "SPDR Gold ETF",
  SLVX:   "iShares Silver ETF",  IWMX:   "Russell 2000 ETF",
  AMDX:   "AMD Inc.",            INTCX:  "Intel Corp.",
  NFLXX:  "Netflix Inc.",        UBERX:  "Uber Technologies",
  SHOPX:  "Shopify Inc.",        MSTRX:  "MicroStrategy Inc.",
  PLTRX:  "Palantir Tech.",      SNAPX:  "Snap Inc.",
  SPOTX:  "Spotify Technology",  PYPLX:  "PayPal Holdings",
  SQX:    "Block Inc.",          NKEX:   "Nike Inc.",
  RIVNX:  "Rivian Automotive",   SOFIX:  "SoFi Technologies",
  TSMX:   "TSMC",                ABBVX:  "AbbVie Inc.",
  JNJX:   "Johnson & Johnson",   PGX:    "Procter & Gamble",
  MRKX:   "Merck & Co.",         GSX:    "Goldman Sachs",
  MSX:    "Morgan Stanley",      BLKX:   "BlackRock Inc.",
  CATX:   "Caterpillar Inc.",    BAX:    "Boeing Co.",
  LMTX:   "Lockheed Martin",     GEX:    "GE Aerospace",
  FDXX:   "FedEx Corp.",         UPSX:   "UPS Inc.",
  PANWX:  "Palo Alto Networks",  CRWDX:  "CrowdStrike",
  SNOWX:  "Snowflake Inc.",      CLOUDX: "Cloudflare Inc.",
  QCOMX:  "Qualcomm Inc.",       TXNX:   "Texas Instruments",
  COSTX:  "Costco Wholesale",    CVSX:   "CVS Health",
  LLYX:   "Eli Lilly & Co.",     ORACLX: "Oracle Corp.",
  CRMX:   "Salesforce Inc.",     ADOBEX: "Adobe Inc.",
  AMGX:   "Amgen Inc.",          WDAYX:  "Workday Inc.",
  JPMX:   "JPMorgan Chase",      BACX:   "Bank of America",
  DISX:   "Walt Disney Co.",     KOX:    "Coca-Cola Co.",
  PFEX:   "Pfizer Inc.",         WMTX:   "Walmart Inc.",
  XOMX:   "ExxonMobil Corp.",
};

// ─── Cache ────────────────────────────────────────────────────────────────────

let stockCache = { data: null, lastFetch: 0 };
const CACHE_TTL  = 30_000;

const tickerCache = new Map();
const TICKER_TTL  = 10_000;

const candleCache = new Map();
const CANDLE_TTL  = 60_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIntervalConfig(range) {
  const now = Date.now();
  const day = 86400000;
  switch (range) {
    case "1D":  return { interval: "60",  limit: 24  };
    case "1W":  return { interval: "240", limit: 42  };
    case "1M":  return { interval: "D",   limit: 30  };
    case "3M":  return { interval: "D",   limit: 90  };
    case "6M":  return { interval: "D",   limit: 180 };
    case "YTD": {
      const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
      const days = Math.ceil((now - Math.max(jan1, XSTOCKS_LAUNCH_MS)) / day);
      return { interval: "D", limit: Math.max(days, 1) };
    }
    case "1Y": {
      const days = Math.ceil((now - XSTOCKS_LAUNCH_MS) / day);
      return { interval: "D", limit: Math.min(days + 5, 365) };
    }
    case "ALL": return { interval: "D", limit: 300 };
    default:    return { interval: "D", limit: 30  };
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "9.1.0" });
});

app.get("/stocks", async (req, res) => {
  try {
    if (stockCache.data && Date.now() - stockCache.lastFetch < CACHE_TTL) {
      return res.json({ source: "cache", count: stockCache.data.length, data: stockCache.data });
    }

    const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json     = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const stocks = [];
    for (const item of json.result.list) {
      const sym         = item.symbol;
      const isConfirmed = CONFIRMED_XSTOCKS.has(sym);
      const price       = parseFloat(item.lastPrice) || 0;
      if (!isConfirmed && !(sym.endsWith("XUSDT") && price > 5)) continue;
      if (price === 0) continue;

      const ticker  = sym.replace("USDT", "");
      const prev    = parseFloat(item.prevPrice24h) || price;
      const changeP = parseFloat(item.price24hPcnt) * 100 || 0;

      stocks.push({
        symbol:    sym,
        ticker,
        name:      NAMES[ticker] || ticker.replace(/X$/, "") + " Stock",
        price,
        change:    price - prev,
        changeP,
        high24h:   parseFloat(item.highPrice24h) || 0,
        low24h:    parseFloat(item.lowPrice24h)  || 0,
        volume24h: parseFloat(item.volume24h)    || 0,
      });
    }

    stocks.sort((a, b) => {
      const aK = !!NAMES[a.ticker], bK = !!NAMES[b.ticker];
      if (aK && !bK) return -1;
      if (!aK && bK) return 1;
      return a.ticker.localeCompare(b.ticker);
    });

    stockCache = { data: stocks, lastFetch: Date.now() };
    res.json({ source: "live", count: stocks.length, data: stocks });

  } catch (err) {
    console.error("GET /stocks error:", err.message);
    if (stockCache.data) return res.json({ source: "stale", data: stockCache.data });
    res.status(500).json({ error: err.message });
  }
});

app.get("/candles/:symbol", async (req, res) => {
  // Validate inputs before touching Bybit
  const symResult   = symbolSchema.safeParse(req.params.symbol);
  const rangeResult = rangeSchema.safeParse(req.query.range || "1M");

  if (!symResult.success)   return res.status(400).json({ error: "Invalid symbol format" });
  if (!rangeResult.success) return res.status(400).json({ error: "Invalid range. Use: 1D 1W 1M 3M 6M YTD 1Y ALL" });

  const symbol = symResult.data;
  const range  = rangeResult.data;
  const key    = `${symbol}_${range}`;

  try {
    const cached = candleCache.get(key);
    if (cached && Date.now() - cached.ts < CANDLE_TTL) {
      return res.json({ source: "cache", data: cached.data });
    }

    const cfg  = getIntervalConfig(range);
    const r    = await fetch(`${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${cfg.interval}&limit=${cfg.limit}`);
    const json = await r.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const data = json.result.list.reverse().map(c => ({
      time:  parseInt(c[0]),
      open:  parseFloat(c[1]),
      high:  parseFloat(c[2]),
      low:   parseFloat(c[3]),
      close: parseFloat(c[4]),
    }));

    candleCache.set(key, { data, ts: Date.now() });
    res.json({ source: "live", data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/ticker/:symbol", async (req, res) => {
  // Validate symbol before touching Bybit
  const symResult = symbolSchema.safeParse(req.params.symbol);
  if (!symResult.success) return res.status(400).json({ error: "Invalid symbol format" });

  const symbol = symResult.data;

  try {
    const cached = tickerCache.get(symbol);
    if (cached && Date.now() - cached.ts < TICKER_TTL) {
      return res.json({ source: "cache", data: cached.data });
    }

    const r    = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`);
    const json = await r.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const item  = json.result.list[0];
    const price = parseFloat(item.lastPrice) || 0;
    const prev  = parseFloat(item.prevPrice24h) || price;

    const data = {
      price,
      change:    price - prev,
      changeP:   parseFloat(item.price24hPcnt) * 100 || 0,
      high24h:   parseFloat(item.highPrice24h) || 0,
      low24h:    parseFloat(item.lowPrice24h)  || 0,
      volume24h: parseFloat(item.volume24h)    || 0,
    };

    tickerCache.set(symbol, { data, ts: Date.now() });
    res.json({ source: "live", data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/debug", async (req, res) => {
  if (!process.env.DEBUG_KEY || req.query.key !== process.env.DEBUG_KEY) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const r    = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await r.json();

    const candidates = json.result.list
      .filter(i => i.symbol.endsWith("XUSDT") && parseFloat(i.lastPrice) > 0)
      .map(i => ({
        symbol:          i.symbol,
        price:           parseFloat(i.lastPrice),
        inConfirmedList: CONFIRMED_XSTOCKS.has(i.symbol),
      }))
      .sort((a, b) => b.price - a.price);

    const active = candidates.filter(i => i.price > 5);
    const micro  = candidates.filter(i => i.price <= 5);

    res.json({
      activeXStocks:     active.length,
      active,
      microPricedCrypto: micro.length,
      micro,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Inverte API v9.1 on port ${PORT}`));
