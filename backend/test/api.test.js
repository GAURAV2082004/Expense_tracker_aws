const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../app");
const db = require("../db");
const { handler: streamHandler } = require("../stream");

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (path, method = "GET", body) =>
  fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = (path, method, body) => call(path, method, body).then((r) => r.json());
const add = (body) => json("/expenses", "POST", body);
const summary = (month) => json(`/summary?month=${month}`);

test("add, list by month and category, summary, delete", async () => {
  const lunch = await add({ type: "expense", amount: 250.5, category: "Food", date: "2026-03-05", note: "Lunch" });
  await add({ type: "expense", amount: 1000, category: "Transport", date: "2026-03-20" });
  await add({ type: "income", amount: 50000, category: "Salary", date: "2026-03-01" });
  await add({ type: "expense", amount: 99, category: "Food", date: "2026-04-02" });

  let rows = await json("/expenses?month=2026-03");
  assert.deepEqual(rows.map((r) => r.date), ["2026-03-20", "2026-03-05", "2026-03-01"]); // newest first

  rows = await json("/expenses?month=2026-03&category=Food");
  assert.equal(rows.length, 1);

  const s = await summary("2026-03");
  assert.equal(s.income, 50000);
  assert.equal(s.expense, 1250.5);
  assert.equal(s.balance, 48749.5);
  assert.deepEqual(s.byCategory, { Food: 250.5, Transport: 1000 });

  const months = await json("/summary/months");
  assert.deepEqual(months.map((m) => m.month), ["2026-03", "2026-04"]);

  assert.equal((await call(`/expenses/${lunch.date}/${lunch.expenseId}`, "DELETE")).status, 204);
  assert.deepEqual((await summary("2026-03")).byCategory, { Transport: 1000 });
});

test("date-range list spans months", async () => {
  await add({ type: "expense", amount: 10, category: "Food", date: "2026-06-30" });
  await add({ type: "expense", amount: 20, category: "Food", date: "2026-07-01" });
  const rows = await json("/expenses?from=2026-06-30&to=2026-07-01");
  assert.equal(rows.length, 2);
  assert.equal((await call("/expenses?from=2026-07-01&to=2026-06-30")).status, 400);
  assert.equal((await call("/expenses?from=2026-07-01")).status, 400);
});

test("editing keeps summaries correct, including when the date moves to another month", async () => {
  const t = await add({ type: "expense", amount: 100, category: "Food", date: "2026-08-10", note: "Dinner" });

  // same month, new amount and category
  let edited = await json(`/expenses/${t.date}/${t.expenseId}`, "PUT", {
    type: "expense", amount: 150, category: "Shopping", date: "2026-08-10", note: "Gift",
  });
  assert.equal(edited.expenseId, t.expenseId);
  assert.equal(edited.createdAt, t.createdAt);
  assert.deepEqual((await summary("2026-08")).byCategory, { Shopping: 150 });

  // the date moves to the next month
  edited = await json(`/expenses/2026-08-10/${t.expenseId}`, "PUT", {
    type: "expense", amount: 150, category: "Shopping", date: "2026-09-02", note: "Gift",
  });
  assert.equal(edited.sk, `2026-09-02#${t.expenseId}`);
  assert.equal((await summary("2026-08")).expense, 0);
  assert.equal((await summary("2026-09")).expense, 150);
  assert.equal((await json("/expenses?month=2026-08")).length, 0);

  assert.equal((await call("/expenses/2026-08-10/nope", "PUT", { type: "expense", amount: 1, category: "Food", date: "2026-08-10" })).status, 404);
});

test("import is all-or-nothing and reports the bad row", async () => {
  const good = { type: "expense", amount: 5, category: "Food", date: "2026-11-01" };
  let res = await call("/expenses/import", "POST", { rows: [good, { ...good, amount: -1 }, good] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /^Row 2:/);
  assert.equal((await json("/expenses?month=2026-11")).length, 0); // nothing was saved

  res = await call("/expenses/import", "POST", { rows: [good, { ...good, date: "2026-11-02", category: "Rent", amount: 9000 }] });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).imported, 2);
  assert.equal((await summary("2026-11")).expense, 9005);

  assert.equal((await call("/expenses/import", "POST", { rows: [] })).status, 400);
  const tooMany = Array.from({ length: 201 }, () => good);
  assert.equal((await call("/expenses/import", "POST", { rows: tooMany })).status, 400);
});

test("import accepts a body larger than the 10 kb default", async () => {
  const row = { type: "expense", amount: 1, category: "Food", date: "2026-12-01", note: "x".repeat(150) };
  const rows = Array.from({ length: 100 }, () => row); // roughly 20 kb
  const res = await call("/expenses/import", "POST", { rows });
  assert.equal(res.status, 201);
  assert.equal((await call("/expenses", "POST", { ...row, note: "x".repeat(20000) })).status, 413);
});

test("budgets: set, list, update, remove", async () => {
  assert.equal((await call("/budgets/Food", "PUT", { limit: 8000 })).status, 200);
  await call("/budgets/Rent", "PUT", { limit: 22000 });
  await call("/budgets/Food", "PUT", { limit: 9000 }); // update
  const list = await json("/budgets");
  assert.deepEqual(list.sort((a, b) => a.category.localeCompare(b.category)), [
    { category: "Food", limit: 9000 },
    { category: "Rent", limit: 22000 },
  ]);
  assert.equal((await call("/budgets/Salary", "PUT", { limit: 1 })).status, 400); // income category
  assert.equal((await call("/budgets/Food", "PUT", { limit: 0 })).status, 400);
  assert.equal((await call("/budgets/Food", "DELETE")).status, 204);
  assert.equal((await call("/budgets/Food", "DELETE")).status, 404);
});

test("rejects bad input", async () => {
  const good = { type: "expense", amount: 10, category: "Food", date: "2026-05-01" };
  const post = (patch) => call("/expenses", "POST", { ...good, ...patch });
  assert.equal((await post({ amount: 0 })).status, 400);
  assert.equal((await post({ amount: "abc" })).status, 400);
  assert.equal((await post({ category: "Salary" })).status, 400);
  assert.equal((await post({ date: "2026-02-31" })).status, 400);
  assert.equal((await post({ type: "gift" })).status, 400);
  assert.equal((await post({ note: "x".repeat(201) })).status, 400);
  assert.equal((await call("/expenses?month=2026-13")).status, 400);
  assert.equal((await call("/expenses?category=Nope")).status, 400);
});

test("unknown transaction returns 404, preflight returns 204", async () => {
  assert.equal((await call("/expenses/2026-01-01/nope", "DELETE")).status, 404);
  assert.equal((await call("/expenses", "OPTIONS")).status, 204);
});

test("stream handler: add, subtract, modify, ignore non-transactions, and survive retries", async () => {
  const image = (extra = {}) => ({
    userId: { S: "demo-user" },
    sk: { S: "2025-01-05#abc" },
    type: { S: "expense" },
    amount: { N: "40.5" },
    category: { S: "Food" },
    date: { S: "2025-01-05" },
    ...extra,
  });

  const insert = { eventID: "evt-1", eventName: "INSERT", dynamodb: { NewImage: image() } };
  const junk = [
    { eventID: "evt-2", eventName: "INSERT", dynamodb: { NewImage: image({ sk: { S: "SUMMARY#2025-01" } }) } },
    { eventID: "evt-3", eventName: "INSERT", dynamodb: { NewImage: image({ sk: { S: "BUDGET#Food" } }) } },
    { eventID: "evt-4", eventName: "INSERT", dynamodb: { NewImage: image({ sk: { S: "EVT#xyz" } }) } },
  ];
  await streamHandler({ Records: [insert, ...junk] });
  assert.equal((await db.getSummary("demo-user", "2025-01")).expense, 40.5);

  // The same batch delivered again (a retry) must not double count.
  await streamHandler({ Records: [insert, ...junk] });
  assert.equal((await db.getSummary("demo-user", "2025-01")).expense, 40.5);

  // MODIFY: 40.5 becomes 60, and the category changes.
  await streamHandler({
    Records: [
      {
        eventID: "evt-5",
        eventName: "MODIFY",
        dynamodb: { OldImage: image(), NewImage: image({ amount: { N: "60" }, category: { S: "Rent" } }) },
      },
    ],
  });
  let s = await db.getSummary("demo-user", "2025-01");
  assert.equal(s.expense, 60);
  assert.deepEqual(s.byCategory, { Rent: 60 });

  await streamHandler({
    Records: [{ eventID: "evt-6", eventName: "REMOVE", dynamodb: { OldImage: image({ amount: { N: "60" }, category: { S: "Rent" } }) } }],
  });
  s = await db.getSummary("demo-user", "2025-01");
  assert.equal(s.expense, 0);
});
