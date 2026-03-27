const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

let stockCache     = { data: null, lastFetch: 0 };
let xstockSymbols  = null; // cached set of confirmed xStock symbols
const CACHE_TTL    = 30_000; // 30s price cache
const SYMBOLS_TTL  = 3_600_000; // 1hr symbol cache

let symbolsCachedAt = 0;

// Display names — for UI only, NOT used for filtering
const NAMES = {
  AAPLX:  "Apple Inc.",
  NVDAX:  "NVIDIA Corp.",
  TSLAX:  "Tesla Inc.",
  GOOGLX: "Alphabet Inc.",
  METAX:  "Meta Platforms",
  AMZNX:  "Amazon.com Inc.",
  MSFTX:  "Microsoft Corp.",
  COINX:  "Coinbase Global",
  HOODX:  "Robinhood Markets",
  MCDX:   "McDonald's Corp.",
  CRCLX:  "Circle Internet",
  SPYX:   "SPDR S&P 500 ETF",
  QQQX:   "Nasdaq-100 ETF",
  IWMX:   "Russell 2000 ETF",
  GLDX:   "SPDR Gold ETF",
  SLVX:   "iShares Silver ETF",
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
  WMTX:   "Walmart Inc.",
  XOMX:   "ExxonMobil Corp.",
  MSTRX:  "MicroStrategy Inc.",
  PLTRX:  "Palantir Tech.",
  PYPLX:  "PayPal Holdings",
  SQX:    "Block Inc.",
  SNAPX:  "Snap Inc.",
  SPOTX:  "Spotify Technology",
  NKEX:   "Nike Inc.",
  RIVNX:  "Rivian Automotive",
  SOFIX:  "SoFi Technologies",
  TSMX:   "TSMC",
  ABBVX:  "AbbVie Inc.",
  JNJX:   "Johnson & Johnson",
  PGX:    "Procter & Gamble",
  MRKX:   "Merck & Co.",
  GSX:    "Goldman Sachs",
  MSX:    "Morgan Stanley",
  BLKX:   "BlackRock Inc.",
  CATX:   "Caterpillar Inc.",
  BAX:    "Boeing Co.",
  LMTX:   "Lockheed Martin",
  GEX:    "GE Aerospace",
  FDXX:   "FedEx Corp.",
  UPSX:   "UPS Inc.",
  PANWX:  "Palo Alto Networks",
  CRWDX:  "CrowdStrike",
  SNOWX:  "Snowflake Inc.",
  CLOUDX: "Cloudflare Inc.",
  QCOMX:  "Qualcomm Inc.",
  TXNX:   "Texas Instruments",
  COSTX:  "Costco Wholesale",
  CVSX:   "CVS Health",
  LLYX:   "Eli Lilly & Co.",
  ORACLX: "Oracle Corp.",
  CRMX:   "Salesforce Inc.",
  ADOBEX: "Adobe Inc.",
  AMGX:   "Amgen Inc.",
  WDAYX:  "Workday Inc.",
};

// Fetch xStock symbols dynamically from Bybit instruments-info
// xStocks are in the "innovation" zone (innovation === "1") AND end with XUSDT
// We also do a price sanity check (price must be > $1 to exclude micro-cap crypto)
async function fetchXStockSymbols() {
  if (xstockSymbols && Date.now() - symbolsCachedAt < SYMBOLS_TTL) {
    return xstockSymbols;
  }

  try {
    // Fetch instruments info — has the "innovation" flag
    // Need pagination since there are 500+ spot instruments
    let cursor = "";
    const allInstruments = [];

    do {
      const url = `${BASE}/v5/market/instruments-info?category=spot&limit=500${cursor ? `&cursor=${cursor}` : ""}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (json.retCode !== 0) break;
      allInstruments.push(...json.result.list);
      cursor = json.result.nextPageCursor || "";
    } while (cursor);

    // xStocks: innovation zone + ends with XUSDT
    const symbols = new Set(
      allInstruments
        .filter(i => i.innovation === "1" && i.symbol.endsWith("XUSDT"))
        .map(i => i.symbol)
    );

    // Fallback: if we got nothing from innovation flag, use our known list
    if (symbols.size === 0) {
      console.warn("No innovation xStocks found, using fallback known list");
      ["AAPLXUSDT","NVDAXUSDT","TSLAXUSDT","GOOGLXUSDT","METAXUSDT","AMZNXUSDT",
       "COINXUSDT","HOODXUSDT","MCDXUSDT","CRCLXUSDT"].forEach(s => symbols.add(s));
    }

    xstockSymbols = symbols;
    symbolsCachedAt = Date.now();
    console.log(`✅ Found ${symbols.size} xStock symbols via instruments-info`);
    return symbols;

  } catch (err) {
    console.error("fetchXStockSymbols error:", err.message);
    // Return last cached or empty set
    return xstockSymbols || new Set();
  }
}

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
  res.json({ status: "ok", service: "Inverte API", version: "8.0.0" });
});

app.get("/stocks", async (req, res) => {
  try {
    if (stockCache.data && Date.now() - stockCache.lastFetch < CACHE_TTL) {
      return res.json({ source: "cache", count: stockCache.data.length, data: stockCache.data });
    }

    // Get the confirmed xStock symbol set from Bybit
    const xstockSet = await fetchXStockSymbols();

    // Get live prices
    const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const stocks = [];
    for (const item of json.result.list) {
      const sym = item.symbol;
      if (!xstockSet.has(sym)) continue;

      const price = parseFloat(item.lastPrice) || 0;
      if (price < 1) continue; // sanity check — real stocks are > $1

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
    const res2 = await fetch(`${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${cfg.interval}&limit=${cfg.limit}`);
    const json = await res2.json();
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
    const res2 = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`);
    const json = await res2.json();
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

// Debug — shows raw instruments-info results
app.get("/debug", async (req, res) => {
  try {
    const symbols = await fetchXStockSymbols();
    res.json({
      count: symbols.size,
      symbols: [...symbols].sort(),
      cachedAt: new Date(symbolsCachedAt).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force refresh the symbol cache
app.get("/refresh-symbols", async (req, res) => {
  symbolsCachedAt = 0;
  xstockSymbols = null;
  const symbols = await fetchXStockSymbols();
  res.json({ count: symbols.size, symbols: [...symbols].sort() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`✅ Inverte API v8 on port ${PORT}`);
  // Pre-warm the symbol cache on startup
  await fetchXStockSymbols();
});