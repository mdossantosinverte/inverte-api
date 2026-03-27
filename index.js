const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

let stockCache = { data: null, lastFetch: 0 };
const CACHE_TTL = 30_000;

const CRYPTO_EXCLUSIONS = new Set([
  "TRXUSDT","AVAXUSDT","ICXUSDT","HTXUSDT","IMXUSDT","MBOXUSDT","STXUSDT",
  "MPLXUSDT","NAVXUSDT","SNXUSDT","WEMIXUSDT","DYDXUSDT","ZEXUSDT","FRAXUSDT",
  "GMXUSDT","APEXUSDT","MBXUSDT","SPXUSDT","ZRXUSDT","FLUXUSDT","KLAYUSDT",
  "MATICXUSDT","LINAXUSDT","HEXUSDT","SHIBXUSDT","INJXUSDT","APTXUSDT",
  "STRKUSDT","PIXELUSDT","AXLUSDT","RDNTUSDT","LQTYUSDT","XVSUSDT","CAKEUSDT",
  "BAKEUSDT","BELXUSDT","BSWUSDT","TUSDT","LUXUSDT","REXUSDT","NEXUSDT",
  "VEXUSDT","TEXUSDT","SEXUSDT","HEXUSDT","DEXUSDT","NEXOUSDT",
]);

const NAMES = {
  AAPLX:   "Apple Inc.",
  NVDAX:   "NVIDIA Corp.",
  TSLAX:   "Tesla Inc.",
  GOOGLX:  "Alphabet Inc.",
  METAX:   "Meta Platforms",
  AMZNX:   "Amazon.com Inc.",
  MSFTX:   "Microsoft Corp.",
  COINX:   "Coinbase Global",
  HOODX:   "Robinhood Markets",
  MCDX:    "McDonald's Corp.",
  CRCLX:   "Circle Internet",
  SPYX:    "SPDR S&P 500 ETF",
  QQQX:    "Nasdaq-100 ETF",
  IWMX:    "Russell 2000 ETF",
  GLDX:    "SPDR Gold ETF",
  SLVX:    "iShares Silver ETF",
  AMDX:    "AMD Inc.",
  INTCX:   "Intel Corp.",
  NFLXX:   "Netflix Inc.",
  UBERX:   "Uber Technologies",
  SHOPX:   "Shopify Inc.",
  VX:      "Visa Inc.",
  MAX:     "Mastercard Inc.",
  JPMX:    "JPMorgan Chase",
  BACX:    "Bank of America",
  DISX:    "Walt Disney Co.",
  KOX:     "Coca-Cola Co.",
  PFEX:    "Pfizer Inc.",
  WMTX:    "Walmart Inc.",
  XOMX:    "ExxonMobil Corp.",
  MSTRX:   "MicroStrategy Inc.",
  PLTRX:   "Palantir Tech.",
  PYPLX:   "PayPal Holdings",
  SQX:     "Block Inc.",
  SNAPX:   "Snap Inc.",
  SPOTX:   "Spotify Technology",
  NKEX:    "Nike Inc.",
  RIVNX:   "Rivian Automotive",
  SOFIX:   "SoFi Technologies",
  TSMX:    "TSMC",
  ABBVX:   "AbbVie Inc.",
  LLYХ:    "Eli Lilly & Co.",
  JNJX:    "Johnson & Johnson",
  PGX:     "Procter & Gamble",
  MRKX:    "Merck & Co.",
  GSX:     "Goldman Sachs",
  MSX:     "Morgan Stanley",
  BLKX:    "BlackRock Inc.",
  CATX:    "Caterpillar Inc.",
  BAX:     "Boeing Co.",
  LMTX:    "Lockheed Martin",
  GEX:     "GE Aerospace",
  FDXX:    "FedEx Corp.",
  UPSX:    "UPS Inc.",
  PANWX:   "Palo Alto Networks",
  CRWDX:   "CrowdStrike",
  SNOWX:   "Snowflake Inc.",
  CLOUDX:  "Cloudflare Inc.",
  WDAYX:   "Workday Inc.",
  QCOMX:   "Qualcomm Inc.",
  TXNX:    "Texas Instruments",
};

// Correct interval mapping for Bybit
// Bybit kline intervals: 1,3,5,15,30,60,120,240,360,720,D,W,M
// We compute "from" timestamp for accurate date ranges
function getIntervalConfig(range) {
  const now = Date.now();
  const day  = 86400000;
  const week = day * 7;

  switch (range) {
    case "1D":  return { interval: "60",  limit: 24  }; // 24 x 1hr = 1 day
    case "1W":  return { interval: "240", limit: 42  }; // 42 x 4hr = ~1 week
    case "1M":  return { interval: "D",   limit: 30  }; // 30 daily
    case "3M":  return { interval: "D",   limit: 90  }; // 90 daily
    case "6M":  return { interval: "D",   limit: 180 }; // 180 daily
    case "YTD": {
      // Days from Jan 1 of current year to today
      const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
      const daysSinceJan1 = Math.ceil((now - jan1) / day);
      return { interval: "D", limit: Math.max(daysSinceJan1, 1) };
    }
    case "1Y":  return { interval: "W",   limit: 52  }; // 52 weekly = 1 year
    case "5Y":  return { interval: "W",   limit: 260 }; // 260 weekly = 5 years
    case "MAX": return { interval: "M",   limit: 60  }; // 60 monthly = 5 years max available
    default:    return { interval: "D",   limit: 30  };
  }
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "4.0.0" });
});

app.get("/stocks", async (req, res) => {
  try {
    if (stockCache.data && Date.now() - stockCache.lastFetch < CACHE_TTL) {
      return res.json({ source: "cache", data: stockCache.data });
    }

    const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const stocks = [];
    for (const item of json.result.list) {
      const sym = item.symbol;
      if (CRYPTO_EXCLUSIONS.has(sym)) continue;
      const ticker = sym.replace("USDT", "");
      const isKnown = !!NAMES[ticker];
      const looksLikeXStock = sym.endsWith("XUSDT") && !CRYPTO_EXCLUSIONS.has(sym);
      if (!isKnown && !looksLikeXStock) continue;

      const price   = parseFloat(item.lastPrice)    || 0;
      const prev    = parseFloat(item.prevPrice24h) || price;
      const changeP = parseFloat(item.price24hPcnt) * 100 || 0;

      stocks.push({
        symbol:    sym,
        ticker,
        name:      NAMES[ticker] ?? ticker.replace(/X$/, "") + " Stock",
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
    res.json({ source: "live", data: stocks });

  } catch (err) {
    console.error("GET /stocks error:", err.message);
    if (stockCache.data) return res.json({ source: "stale", data: stockCache.data });
    res.status(500).json({ error: err.message });
  }
});

app.get("/candles/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const range = req.query.range || "1M";
    const cfg   = getIntervalConfig(range);

    const url = `${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${cfg.interval}&limit=${cfg.limit}`;
    const response = await fetch(url);
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

app.get("/ticker/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);
    const item  = json.result.list[0];
    const price = parseFloat(item.lastPrice) || 0;
    const prev  = parseFloat(item.prevPrice24h) || price;
    res.json({ data: {
      price,
      change:    price - prev,
      changeP:   parseFloat(item.price24hPcnt) * 100 || 0,
      high24h:   parseFloat(item.highPrice24h) || 0,
      low24h:    parseFloat(item.lowPrice24h)  || 0,
      volume24h: parseFloat(item.volume24h)    || 0,
    }});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/debug", async (req, res) => {
  const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
  const json = await response.json();
  const all = json.result.list.map(i => i.symbol);
  const xstocks = all.filter(s => s.endsWith("XUSDT") && !CRYPTO_EXCLUSIONS.has(s));
  res.json({ count: xstocks.length, xstocks });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Inverte API v4 on port ${PORT}`));