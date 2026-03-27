const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());

const BASE = "https://api.bybit.com";

// Cache
let stockCache = { data: null, lastFetch: 0 };
let symbolCache = null; // xStock symbols — fetched once
const CACHE_TTL = 30_000; // 30 seconds

// Known xStock names — used for display
// Any symbol NOT in this list will use auto-generated name
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
  BRKBX:  "Berkshire Hathaway",
  LLYХ:   "Eli Lilly & Co.",
  JNJX:   "Johnson & Johnson",
  PGX:    "Procter & Gamble",
  UNITX:  "UnitedHealth Group",
  EXXONX: "ExxonMobil Corp.",
  ABBVX:  "AbbVie Inc.",
  CSBOX:  "Costco Wholesale",
  MRKX:   "Merck & Co.",
  CVSX:   "CVS Health",
  ORACLX: "Oracle Corp.",
  CRMX:   "Salesforce Inc.",
  ADOBEX: "Adobe Inc.",
  ACNX:   "Accenture PLC",
  TMX:    "T-Mobile US",
  NKEX:   "Nike Inc.",
  SBUXХ:  "Starbucks Corp.",
  MCDX:   "McDonald's Corp.",
  CMCSAX: "Comcast Corp.",
  TXNX:   "Texas Instruments",
  QCOMX:  "Qualcomm Inc.",
  AMGНX:  "Amgen Inc.",
  GSX:    "Goldman Sachs",
  MSX:    "Morgan Stanley",
  BLKX:   "BlackRock Inc.",
  SPGIX:  "S&P Global Inc.",
  CATX:   "Caterpillar Inc.",
  DEX:    "Deere & Company",
  HONX:   "Honeywell Intl.",
  MMМX:   "3M Company",
  GEX:    "General Electric",
  RTXX:   "Raytheon Tech.",
  BAX:    "Boeing Co.",
  LMTX:   "Lockheed Martin",
  FDXX:   "FedEx Corp.",
  UPSX:   "UPS Inc.",
};

// Fetch the list of xStock symbols from Bybit instrument info
// xStocks are tagged in the "innovation" zone on Bybit
async function getXStockSymbols() {
  if (symbolCache) return symbolCache;
  try {
    const res  = await fetch(`${BASE}/v5/market/instruments-info?category=spot&status=Trading`);
    const json = await res.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    // Filter symbols that are in the "XSTOCK" or innovation zone
    // Also match against our known list + pattern: ticker ends with X + USDT
    const known = new Set(Object.keys(NAMES).map(k => k + "USDT"));
    const symbols = new Set();

    for (const item of json.result.list) {
      const sym = item.symbol;
      // Include if it's in our known list
      if (known.has(sym)) { symbols.add(sym); continue; }
      // Or if innovation tag contains xstock
      if (item.innovation === "1" && sym.endsWith("XUSDT")) {
        // Exclude known crypto tokens that happen to end in XUSDT
        const cryptoExclusions = new Set([
          "TRXUSDT","AVAXUSDT","ICXUSDT","HTXUSDT","IMXUSDT",
          "MBOXUSDT","STXUSDT","MPLXUSDT","NAVXUSDT","SNXUSDT",
          "WEMIXUSDT","DYDXUSDT","ZEXUSDT","FRAXUSDT","GMXUSDT",
          "APEXUSDT","MBXUSDT","SPXUSDT","ZRXUSDT",
        ]);
        if (!cryptoExclusions.has(sym)) symbols.add(sym);
      }
    }

    symbolCache = [...symbols];
    console.log(`Found ${symbolCache.length} xStock symbols:`, symbolCache);
    return symbolCache;
  } catch (err) {
    console.error("getXStockSymbols error:", err.message);
    // Fall back to known list
    return Object.keys(NAMES).map(k => k + "USDT");
  }
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Inverte API", version: "2.0.0" });
});

// All xStocks with live prices
app.get("/stocks", async (req, res) => {
  try {
    if (stockCache.data && Date.now() - stockCache.lastFetch < CACHE_TTL) {
      return res.json({ source: "cache", data: stockCache.data });
    }

    const [tickerRes, xStockSymbols] = await Promise.all([
      fetch(`${BASE}/v5/market/tickers?category=spot`),
      getXStockSymbols(),
    ]);

    const json = await tickerRes.json();
    if (json.retCode !== 0) throw new Error(json.retMsg);

    const symbolSet = new Set(xStockSymbols);
    const stocks = [];

    for (const item of json.result.list) {
      const sym = item.symbol;
      if (!symbolSet.has(sym)) continue;

      const ticker   = sym.replace("USDT", "");
      const price    = parseFloat(item.lastPrice)    || 0;
      const prev     = parseFloat(item.prevPrice24h) || price;
      const changeP  = parseFloat(item.price24hPcnt) * 100 || 0;

      // Auto-generate name if not in our list
      const autoName = ticker.replace(/X$/, "") + " Stock";

      stocks.push({
        symbol:    sym,
        ticker,
        name:      NAMES[ticker] ?? autoName,
        price,
        change:    price - prev,
        changeP,
        high24h:   parseFloat(item.highPrice24h) || 0,
        low24h:    parseFloat(item.lowPrice24h)  || 0,
        volume24h: parseFloat(item.volume24h)    || 0,
      });
    }

    // Sort: known names first, then by ticker
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

// Candles for chart
app.get("/candles/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    const interval = req.query.interval || "D";
    const limit    = parseInt(req.query.limit) || 30;

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

// Single ticker
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

// Debug
app.get("/debug", async (req, res) => {
  const symbols = await getXStockSymbols();
  res.json({ count: symbols.length, symbols });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Inverte API v2 running on port ${PORT}`);
});