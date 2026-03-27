const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

let stockCache = { data: null, lastFetch: 0 };
const CACHE_TTL = 30_000;

// All confirmed xStock tickers on Bybit (ticker without USDT)
// We use a whitelist approach based on the X-suffix pattern + exclusion list
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
  SOFIX:   "SoFi Technologies",
  RIVNX:   "Rivian Automotive",
  LCIDX:   "Lucid Group",
  NKEX:    "Nike Inc.",
  SBUXХ:   "Starbucks Corp.",
  PYPLX:   "PayPal Holdings",
  SQX:     "Block Inc.",
  TWTRX:   "X Corp.",
  SNAPX:   "Snap Inc.",
  SPOTX:   "Spotify Technology",
  AIRBNBX: "Airbnb Inc.",
  DOORX:   "DoorDash Inc.",
  LYFТX:   "Lyft Inc.",
  ROBLX:   "Roblox Corp.",
  UNITYX:  "Unity Software",
  ZOOMX:   "Zoom Video",
  DOCSX:   "DocuSign Inc.",
  TWLOX:   "Twilio Inc.",
  DATAX:   "Databricks",
  SNOWX:   "Snowflake Inc.",
  MONGOХ:  "MongoDB Inc.",
  CLOUDX:  "Cloudflare Inc.",
  FASTLYX: "Fastly Inc.",
  OKТAX:   "Okta Inc.",
  ZENX:    "Zendesk Inc.",
  HUBSX:   "HubSpot Inc.",
  WDAYX:   "Workday Inc.",
  SERVICEX:"ServiceNow Inc.",
  PANWX:   "Palo Alto Networks",
  CRWDX:   "CrowdStrike",
  ZSCAX:   "Zscaler Inc.",
  FTNTX:   "Fortinet Inc.",
  ABBVX:   "AbbVie Inc.",
  LLYХ:    "Eli Lilly & Co.",
  JNJX:    "Johnson & Johnson",
  PGX:     "Procter & Gamble",
  MRKX:    "Merck & Co.",
  BMYX:    "Bristol-Myers",
  GILDX:   "Gilead Sciences",
  REGXX:   "Regeneron Pharma",
  BIIBX:   "Biogen Inc.",
  MRNA:    "Moderna Inc.",
  BNTXX:   "BioNTech SE",
  GSX:     "Goldman Sachs",
  MSX:     "Morgan Stanley",
  BLKX:    "BlackRock Inc.",
  SCHX:    "Charles Schwab",
  FITBX:   "Fifth Third Bank",
  CATX:    "Caterpillar Inc.",
  DEX:     "Deere & Company",
  HONX:    "Honeywell Intl.",
  GEX:     "GE Aerospace",
  BAX:     "Boeing Co.",
  LMTX:    "Lockheed Martin",
  RTXX:    "Raytheon Tech.",
  NGRX:    "Northrop Grumman",
  FDXX:    "FedEx Corp.",
  UPSX:    "UPS Inc.",
  DHLX:    "DHL Group",
  TSMX:    "TSMC",
  SAMSUX:  "Samsung Electronics",
  ASMX:    "ASML Holding",
  QCOMX:   "Qualcomm Inc.",
  TXNX:    "Texas Instruments",
  MUХ:     "Micron Technology",
  WDCX:    "Western Digital",
  SEAGATX: "Seagate Tech.",
};

// Bybit interval mapping
// Bybit accepts: 1,3,5,15,30,60,120,240,360,720,D,W,M
const INTERVAL_MAP = {
  "1H":  { interval: "60",  limit: 24  },
  "1D":  { interval: "60",  limit: 24  },
  "1W":  { interval: "D",   limit: 7   },
  "1M":  { interval: "D",   limit: 30  },
  "3M":  { interval: "D",   limit: 90  },
  "6M":  { interval: "D",   limit: 180 },
  "YTD": { interval: "D",   limit: 90  },
  "1Y":  { interval: "W",   limit: 52  },
  "5Y":  { interval: "W",   limit: 260 },
};

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "3.0.0" });
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

      // Match xStocks: known tickers OR ends with XUSDT but not a known crypto
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

// Candles — supports named intervals like 1H, 1M, 3M, 1Y etc.
app.get("/candles/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const namedInterval = req.query.range || "1M";
    const cfg = INTERVAL_MAP[namedInterval] || INTERVAL_MAP["1M"];

    const response = await fetch(
      `${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=${cfg.interval}&limit=${cfg.limit}`
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

app.get("/ticker/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const response = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`);
    const json = await response.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);
    const item    = json.result.list[0];
    const price   = parseFloat(item.lastPrice)   || 0;
    const prev    = parseFloat(item.prevPrice24h) || price;
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
app.listen(PORT, () => console.log(`✅ Inverte API v3 on port ${PORT}`));