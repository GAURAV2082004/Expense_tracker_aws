const express = require("express");
const db = require("./db");
const CATEGORIES = require("./categories");

// Until Cognito is added on Day 3 every request belongs to one fixed user.
const USER_ID = "demo-user";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ALL_CATEGORIES = [...CATEGORIES.expense, ...CATEGORIES.income];
const MAX_IMPORT_ROWS = 200;

const app = express();

// API Gateway's CORS config answers preflight requests itself. This is a safety net so a
// preflight can never fall through to a route and return 404 if that config is ever removed.
app.use((req, res, next) => (req.method === "OPTIONS" ? res.sendStatus(204) : next()));

// One JSON log line per request, for CloudWatch Logs Insights. Query strings are left out on purpose.
if (process.env.LOG_REQUESTS === "true") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () =>
      console.log(JSON.stringify({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }))
    );
    next();
  });
}

// The import route accepts a bigger body than everything else. It must be registered first:
// once a body is parsed, later parsers skip it.
app.use("/expenses/import", express.json({ limit: "200kb" }));
app.use(express.json({ limit: "10kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/categories", (_req, res) => res.json(CATEGORIES));

// ---------- transactions ----------
app.post("/expenses", async (req, res, next) => {
  try {
    const parsed = parseTransaction(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.status(201).json(await db.create(USER_ID, parsed.value));
  } catch (err) {
    next(err);
  }
});

// Validates every row first, then writes. Either the whole file is accepted or nothing is saved.
app.post("/expenses/import", async (req, res, next) => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: "Send at least one row." });
    if (rows.length > MAX_IMPORT_ROWS)
      return res.status(400).json({ error: `Import up to ${MAX_IMPORT_ROWS} rows at a time.` });

    const valid = [];
    for (let i = 0; i < rows.length; i++) {
      const parsed = parseTransaction(rows[i]);
      if (parsed.error) return res.status(400).json({ error: `Row ${i + 1}: ${parsed.error}` });
      valid.push(parsed.value);
    }
    res.status(201).json({ imported: await db.importMany(USER_ID, valid) });
  } catch (err) {
    next(err);
  }
});

app.get("/expenses", async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const { category } = req.query;
    if (category !== undefined && !ALL_CATEGORIES.includes(category))
      return res.status(400).json({ error: "Unknown category." });
    res.json(await db.list(USER_ID, { ...range, category }));
  } catch (err) {
    next(err);
  }
});

app.put("/expenses/:date/:expenseId", async (req, res, next) => {
  try {
    const { date, expenseId } = req.params;
    if (!isRealDate(date)) return res.status(400).json({ error: "date must look like 2026-10-26." });
    const parsed = parseTransaction(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const item = await db.update(USER_ID, date, expenseId, parsed.value);
    if (!item) return res.status(404).json({ error: "Transaction not found." });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

app.delete("/expenses/:date/:expenseId", async (req, res, next) => {
  try {
    const { date, expenseId } = req.params;
    if (!isRealDate(date)) return res.status(400).json({ error: "date must look like 2026-10-26." });
    const removed = await db.remove(USER_ID, date, expenseId);
    if (!removed) return res.status(404).json({ error: "Transaction not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------- summaries (pre-computed by the stream Lambda, never a scan) ----------
app.get("/summary", async (req, res, next) => {
  try {
    const month = req.query.month ?? currentMonth();
    if (!MONTH_RE.test(month)) return res.status(400).json({ error: "month must look like 2026-10." });
    res.json(await db.getSummary(USER_ID, month));
  } catch (err) {
    next(err);
  }
});

app.get("/summary/months", async (_req, res, next) => {
  try {
    res.json(await db.listSummaries(USER_ID));
  } catch (err) {
    next(err);
  }
});

// ---------- budgets ----------
app.get("/budgets", async (_req, res, next) => {
  try {
    res.json(await db.listBudgets(USER_ID));
  } catch (err) {
    next(err);
  }
});

app.put("/budgets/:category", async (req, res, next) => {
  try {
    const { category } = req.params;
    if (!CATEGORIES.expense.includes(category)) return res.status(400).json({ error: "Budgets are for expense categories." });
    const limit = Number(req.body?.limit);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1e9)
      return res.status(400).json({ error: "Budget must be greater than 0." });
    res.json(await db.setBudget(USER_ID, category, Math.round(limit * 100) / 100));
  } catch (err) {
    next(err);
  }
});

app.delete("/budgets/:category", async (req, res, next) => {
  try {
    const removed = await db.removeBudget(USER_ID, req.params.category);
    if (!removed) return res.status(404).json({ error: "Budget not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

app.use((_req, res) => res.status(404).json({ error: "Not found." }));

// Log the real error to CloudWatch, return a generic message to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

// ---------- helpers ----------
function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function isRealDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Accepts ?month=2026-10 or ?from=2026-01-01&to=2026-10-31. Defaults to the current month.
function parseRange({ month, from, to }) {
  if (from !== undefined || to !== undefined) {
    if (!isRealDate(from) || !isRealDate(to)) return { error: "from and to must look like 2026-10-26." };
    if (from > to) return { error: "from must not be after to." };
    return { from, to };
  }
  const m = month ?? currentMonth();
  if (!MONTH_RE.test(m)) return { error: "month must look like 2026-10." };
  return { from: `${m}-01`, to: `${m}-31` };
}

function parseTransaction(body) {
  if (!body || typeof body !== "object") return { error: "Send a transaction object." };
  const { type, category, date } = body;
  if (type !== "expense" && type !== "income") return { error: "type must be expense or income." };

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return { error: "Amount must be greater than 0." };

  if (!CATEGORIES[type].includes(category)) return { error: `Pick a valid ${type} category.` };
  if (!isRealDate(date)) return { error: "date must look like 2026-10-26." };

  let note = "";
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.trim().length > 200)
      return { error: "Note must be 200 characters or fewer." };
    note = body.note.trim();
  }
  return { value: { type, amount: Math.round(amount * 100) / 100, category, date, note } };
}

module.exports = app;
