const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

let stockCache = { data: null, lastFetch: 0 };
const CACHE_TTL = 30_000;

// Known crypto tokens that end in XUSDT — must exclude these
const CRYPTO_EXCLUSIONS = new Set([
  "TRXUSDT","AVAXUSDT","ICXUSDT","HTXUSDT","IMXUSDT","MBOXUSDT","STXUSDT",
  "MPLXUSDT","NAVXUSDT","SNXUSDT","WEMIXUSDT","DYDXUSDT","ZEXUSDT","FRAXUSDT",
  "GMXUSDT","APEXUSDT","MBXUSDT","SPXUSDT","ZRXUSDT","FLUXUSDT","KLAYUSDT",
  "MATICXUSDT","LINAXUSDT","HEXUSDT","INJXUSDT","APTXUSDT","STRKUSDT",
  "PIXELUSDT","AXLUSDT","RDNTUSDT","LQTYUSDT","XVSUSDT","CAKEUSDT","BAKEUSDT",
  "BELXUSDT","BSWUSDT","LUXUSDT","REXUSDT","NEXUSDT","VEXUSDT","TEXUSDT",
  "SEXUSDT","DEXUSDT","NEXOUSDT","FOXUSDT","TRIXUSDT","MIXUSDT","FIXUSDT",
  "SIXUSDT","NIXUSDT","WIXUSDT","PIXUSDT","KUJIXUSDT","MINIXUSDT",
  "SHIBXUSDT","DOGEXUSDT","FLOKIXUSDT","PEPEХUSDT",
]);

// Display names for known xStocks
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
  QCOMX:   "Qualcomm Inc.",
  TXNX:    "Texas Instruments",
  AMGX:    "Amgen Inc.",
  COST X:  "Costco Wholesale",
  CVSX:    "CVS Health",
  LLYХ:    "Eli Lilly & Co.",
  ORACLX:  "Oracle Corp.",
  CRMX:    "Salesforce Inc.",
  ADOBEX:  "Adobe Inc.",
  NKEX:    "Nike Inc.",
  SBUXХ:   "Starbucks Corp.",
  TMX:     "T-Mobile US",
  ATNTX:   "AT&T Inc.",
  VZWX:    "Verizon Comms.",
  INTUX:   "Intuitive Surgical",
  ISRGX:   "ISRG Inc.",
  DHRX:    "Danaher Corp.",
  MDTX:    "Medtronic PLC",
  ABNBX:   "Airbnb Inc.",
  BKNGX:   "Booking Holdings",
  EXPDX:   "Expedia Group",
  LYFTX:   "Lyft Inc.",
  RBLXX:   "Roblox Corp.",
  ZOOMX:   "Zoom Video",
  DOCSGNX: "DocuSign Inc.",
  WDAYX:   "Workday Inc.",
  SVCNX:   "ServiceNow Inc.",
};

// xStocks launched June 30, 2025
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
      const startFrom = Math.max(jan1, XSTOCKS_LAUNCH_MS);
      const days = Math.ceil((now - startFrom) / day);
      return { interval: "D", limit: Math.max(days, 1) };
    }
    case "1Y": {
      // xStocks only exist since Jun 2025 (~10 months)
      // Return all daily data since launch — effectively same as ALL
      const daysSinceLaunch = Math.ceil((now - XSTOCKS_LAUNCH_MS) / day);
      return { interval: "D", limit: Math.min(daysSinceLaunch + 5, 365) };
    }
    case "ALL":
      return { interval: "D", limit: 300 };
    default:
      return { interval: "D", limit: 30 };
  }
}

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "6.0.0" });
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
      if (!sym.endsWith("XUSDT")) continue;

      const price = parseFloat(item.lastPrice) || 0;
      if (price === 0) continue; // skip inactive

      const ticker  = sym.replace("USDT", "");
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
    const range = req.query.range || "1M";
    const cfg   = getIntervalConfig(range);
    const url   = `${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${cfg.interval}&limit=${cfg.limit}`;
    const response = await fetch(url);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);
    const candles = json.result.list.reverse().map(c => ({
      time: parseInt(c[0]), open: parseFloat(c[1]),
      high: parseFloat(c[2]), low: parseFloat(c[3]), close: parseFloat(c[4]),
    }));
    res.json({ data: candles, launchDate: XSTOCKS_LAUNCH_MS });
  } catch (err) {
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

// Debug endpoint — shows exactly what xStocks are active on Bybit right now
app.get("/debug", async (req, res) => {
  try {
    const response = await fetch(`${BASE}/v5/market/tickers?category=spot`);
    const json = await response.json();
    const all = json.result.list
      .filter(i => i.symbol.endsWith("XUSDT") && !CRYPTO_EXCLUSIONS.has(i.symbol) && parseFloat(i.lastPrice) > 0)
      .map(i => ({ symbol: i.symbol, ticker: i.symbol.replace("USDT",""), price: parseFloat(i.lastPrice) }));
    res.json({ count: all.length, xstocks: all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Inverte API v6 on port ${PORT}`));