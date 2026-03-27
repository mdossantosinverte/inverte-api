const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

let stockCache = { data: null, lastFetch: 0 };
const CACHE_TTL = 30_000;

// These are confirmed xStock symbols on Bybit — verified from Bybit's own pages
// We use a CONFIRMED list + also dynamically check for any new ones via the API
// Format: base ticker (without USDT)
const CONFIRMED_XSTOCKS = new Set([
  "AAPLXUSDT", "NVDAXUSDT", "TSLAXUSDT", "GOOGLXUSDT", "METAXUSDT",
  "AMZNXUSDT", "MSFTXUSDT", "COINXUSDT", "HOODXUSDT", "MCDXUSDT",
  "CRCLXUSDT", "SPYXUSDT",  "QQQXUSDT",  "GLDXUSDT",  "SLVXUSDT",
  "IWMXUSDT",  "AMDXUSDT",  "INTCXUSDT", "NFLXXUSDT", "UBERXUSDT",
  "SHOPXUSDT", "MSTRXUSDT", "PLTRXUSDT", "SNAPXUSDT", "SPOTXUSDT",
  "PYPLXUSDT", "SQXUSDT",   "NKEXUSDT",  "RIVNXUSDT", "SOFIXUSDT",
  "TSMXUSDT",  "ABBVXUSDT", "JNJXUSDT",  "PGXUSDT",   "MRKXUSDT",
  "GSXUSDT",   "MSXUSDT",   "BLKXUSDT",  "CATXUSDT",  "BAXUSDT",
  "LMTXUSDT",  "GEXUSDT",   "FDXXUSDT",  "UPSXUSDT",  "PANWXUSDT",
  "CRWDXUSDT", "SNOWXUSDT", "CLOUDXUSDT","QCOMXUSDT", "TXNXUSDT",
  "COSTXUSDT", "CVSXUSDT",  "LLXYUSDT",  "ORACLXUSDT","CRMXUSDT",
  "ADOBEXUSDT","AMGXUSDT",  "WDAYXUSDT", "JPMXUSDT",  "BACXUSDT",
  "DISXUSDT",  "KOXUSDT",   "PFEXUSDT",  "WMTXUSDT",  "XOMXUSDT",
]);

const NAMES = {
  AAPLX:   "Apple Inc.",         NVDAX:  "NVIDIA Corp.",
  TSLAX:   "Tesla Inc.",         GOOGLX: "Alphabet Inc.",
  METAX:   "Meta Platforms",     AMZNX:  "Amazon.com Inc.",
  MSFTX:   "Microsoft Corp.",    COINX:  "Coinbase Global",
  HOODX:   "Robinhood Markets",  MCDX:   "McDonald's Corp.",
  CRCLX:   "Circle Internet",    SPYX:   "SPDR S&P 500 ETF",
  QQQX:    "Nasdaq-100 ETF",     GLDX:   "SPDR Gold ETF",
  SLVX:    "iShares Silver ETF", IWMX:   "Russell 2000 ETF",
  AMDX:    "AMD Inc.",           INTCX:  "Intel Corp.",
  NFLXX:   "Netflix Inc.",       UBERX:  "Uber Technologies",
  SHOPX:   "Shopify Inc.",       MSTRX:  "MicroStrategy Inc.",
  PLTRX:   "Palantir Tech.",     SNAPX:  "Snap Inc.",
  SPOTX:   "Spotify Technology", PYPLX:  "PayPal Holdings",
  SQX:     "Block Inc.",         NKEX:   "Nike Inc.",
  RIVNX:   "Rivian Automotive",  SOFIX:  "SoFi Technologies",
  TSMX:    "TSMC",               ABBVX:  "AbbVie Inc.",
  JNJX:    "Johnson & Johnson",  PGX:    "Procter & Gamble",
  MRKX:    "Merck & Co.",        GSX:    "Goldman Sachs",
  MSX:     "Morgan Stanley",     BLKX:   "BlackRock Inc.",
  CATX:    "Caterpillar Inc.",   BAX:    "Boeing Co.",
  LMTX:    "Lockheed Martin",    GEX:    "GE Aerospace",
  FDXX:    "FedEx Corp.",        UPSX:   "UPS Inc.",
  PANWX:   "Palo Alto Networks", CRWDX:  "CrowdStrike",
  SNOWX:   "Snowflake Inc.",     CLOUDX: "Cloudflare Inc.",
  QCOMX:   "Qualcomm Inc.",      TXNX:   "Texas Instruments",
  COSTX:   "Costco Wholesale",   CVSX:   "CVS Health",
  LLYX:    "Eli Lilly & Co.",    ORACLX: "Oracle Corp.",
  CRMX:    "Salesforce Inc.",    ADOBEX: "Adobe Inc.",
  AMGX:    "Amgen Inc.",         WDAYX:  "Workday Inc.",
  JPMX:    "JPMorgan Chase",     BACX:   "Bank of America",
  DISX:    "Walt Disney Co.",    KOX:    "Coca-Cola Co.",
  PFEX:    "Pfizer Inc.",        WMTX:   "Walmart Inc.",
  XOMX:    "ExxonMobil Corp.",
};

const XSTOCKS_LAUNCH_MS = new Date("2025-06-30").getTime();

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

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "9.0.0" });
});

app.get("/stocks", async (req, res) => {
  try {
    if (stockCache.data && Date.now() - stockCache.lastFetch < CACHE_TTL) {
      return res.json({ source: "cache", count: stockCache.data.length, data: stockCache.data });
    }

    const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const stocks = [];
    for (const item of json.result.list) {
      const sym = item.symbol;
      // Use confirmed list + also catch any new xStocks dynamically
      // Dynamic catch: ends in XUSDT, price > $5 (real stocks), not a known crypto
      const isConfirmed = CONFIRMED_XSTOCKS.has(sym);
      const price = parseFloat(item.lastPrice) || 0;
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
  try {
    const { symbol } = req.params;
    const cfg = getIntervalConfig(req.query.range || "1M");
    const r = await fetch(`${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${cfg.interval}&limit=${cfg.limit}`);
    const json = await r.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);
    const candles = json.result.list.reverse().map(c => ({
      time: parseInt(c[0]), open: parseFloat(c[1]),
      high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]),
    }));
    res.json({ data: candles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/ticker/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const r = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`);
    const json = await r.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);
    const item  = json.result.list[0];
    const price = parseFloat(item.lastPrice) || 0;
    const prev  = parseFloat(item.prevPrice24h) || price;
    res.json({ data: {
      price, change: price - prev,
      changeP:   parseFloat(item.price24hPcnt) * 100 || 0,
      high24h:   parseFloat(item.highPrice24h) || 0,
      low24h:    parseFloat(item.lowPrice24h)  || 0,
      volume24h: parseFloat(item.volume24h)    || 0,
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Raw dump — shows everything ending in XUSDT with price > $5
// Use this to discover new xStocks Bybit adds
app.get("/debug", async (req, res) => {
  try {
    const r = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await r.json();
    const candidates = json.result.list
      .filter(i => i.symbol.endsWith("XUSDT") && parseFloat(i.lastPrice) > 0)
      .map(i => ({
        symbol: i.symbol,
        price:  parseFloat(i.lastPrice),
        inConfirmedList: CONFIRMED_XSTOCKS.has(i.symbol),
      }))
      .sort((a, b) => b.price - a.price);

    const active = candidates.filter(i => parseFloat(i.price) > 5);
    const micro  = candidates.filter(i => parseFloat(i.price) <= 5);

    res.json({
      activeXStocks: active.length,
      active,
      microPricedCrypto: micro.length,
      micro,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Inverte API v9 on port ${PORT}`));