// All table access lives here.
//
// Table "Expenses" (single table, four kinds of item, all under the partition key userId):
//
//   Transaction   sk = "2026-10-26#<expenseId>"  type, amount, category, categoryDate, note
//   Monthly total sk = "SUMMARY#2026-10"         income, expense, "cat#Food", ...   (written by the stream Lambda only)
//   Budget        sk = "BUDGET#Food"             category, limit
//   Dedupe marker sk = "EVT#<streamEventId>"     ttl  (makes the stream Lambda safe to retry)
//
// * Any date range of transactions is ONE Query: sk BETWEEN "2026-10-01" AND "2026-10-31~".
//   ("~" sorts after "#", so every "2026-10-31#<id>" is included.)
// * GSI "byCategory": userId + categoryDate ("Food#2026-10-26") lists one category for any date range.
// * Summaries are read with one GetItem, so the API never rescans transactions.
//
// With TABLE_NAME unset, an in-memory store is used for local development and tests.

const { randomUUID } = require("node:crypto");

const TABLE = process.env.TABLE_NAME;
const INDEX = "byCategory";
const SUMMARY_PREFIX = "SUMMARY#";
const BUDGET_PREFIX = "BUDGET#";
const EVENT_PREFIX = "EVT#";
const MAX_ROWS = 5000; // safety cap for a single list call

const round2 = (n) => Math.round(n * 100) / 100;
const monthOf = (date) => date.slice(0, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildItem(userId, input, expenseId = randomUUID().slice(0, 12), createdAt) {
  const { type, amount, category, date, note } = input;
  const now = new Date().toISOString();
  return {
    userId,
    sk: `${date}#${expenseId}`,
    expenseId,
    type,
    amount,
    category,
    categoryDate: `${category}#${date}`,
    date,
    note,
    createdAt: createdAt ?? now,
    updatedAt: now,
  };
}

function toSummary(month, item) {
  const byCategory = {};
  for (const [k, v] of Object.entries(item ?? {})) {
    if (k.startsWith("cat#") && v !== 0) byCategory[k.slice(4)] = round2(v);
  }
  const income = round2(item?.income ?? 0);
  const expense = round2(item?.expense ?? 0);
  return { month, income, expense, balance: round2(income - expense), byCategory };
}

// ---------- DynamoDB ----------
function dynamoStore() {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const {
    DynamoDBDocumentClient,
    QueryCommand,
    GetCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand,
    BatchWriteCommand,
    TransactWriteCommand,
  } = require("@aws-sdk/lib-dynamodb");

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const conditionFailed = (err) => err.name === "ConditionalCheckFailedException";

  // A Query returns at most 1 MB per call, so follow LastEvaluatedKey.
  async function queryAll(params, max = MAX_ROWS) {
    const items = [];
    let key;
    do {
      const out = await doc.send(new QueryCommand({ TableName: TABLE, ExclusiveStartKey: key, ...params }));
      items.push(...(out.Items ?? []));
      key = out.LastEvaluatedKey;
    } while (key && items.length < max);
    return items.slice(0, max);
  }

  return {
    // ----- transactions -----
    async create(userId, input) {
      const item = buildItem(userId, input);
      await doc.send(
        new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(sk)" })
      );
      return item;
    },

    async list(userId, { from, to, category }) {
      if (category) {
        return queryAll({
          IndexName: INDEX,
          KeyConditionExpression: "userId = :u AND categoryDate BETWEEN :a AND :b",
          ExpressionAttributeValues: { ":u": userId, ":a": `${category}#${from}`, ":b": `${category}#${to}~` },
          ScanIndexForward: false,
        });
      }
      return queryAll({
        KeyConditionExpression: "userId = :u AND sk BETWEEN :a AND :b",
        ExpressionAttributeValues: { ":u": userId, ":a": from, ":b": `${to}~` },
        ScanIndexForward: false,
      });
    },

    // The date is part of the sort key, so changing it means delete + put. Doing both in one
    // transaction means a failure can never leave the transaction missing or duplicated.
    async update(userId, date, expenseId, input) {
      const oldKey = { userId, sk: `${date}#${expenseId}` };
      const old = (await doc.send(new GetCommand({ TableName: TABLE, Key: oldKey }))).Item;
      if (!old) return null;

      const item = buildItem(userId, input, expenseId, old.createdAt);
      try {
        if (item.sk === old.sk) {
          await doc.send(
            new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_exists(sk)" })
          );
        } else {
          await doc.send(
            new TransactWriteCommand({
              TransactItems: [
                { Delete: { TableName: TABLE, Key: oldKey, ConditionExpression: "attribute_exists(sk)" } },
                { Put: { TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(sk)" } },
              ],
            })
          );
        }
      } catch (err) {
        if (conditionFailed(err) || err.name === "TransactionCanceledException") return null;
        throw err;
      }
      return item;
    },

    async remove(userId, date, expenseId) {
      try {
        await doc.send(
          new DeleteCommand({
            TableName: TABLE,
            Key: { userId, sk: `${date}#${expenseId}` },
            ConditionExpression: "attribute_exists(sk)",
          })
        );
        return true;
      } catch (err) {
        if (conditionFailed(err)) return false;
        throw err;
      }
    },

    // BatchWriteItem takes 25 items per call and may return UnprocessedItems when throttled.
    // It is not atomic, so the API validates every row before writing any.
    async importMany(userId, inputs) {
      const items = inputs.map((i) => buildItem(userId, i));
      for (let i = 0; i < items.length; i += 25) {
        let pending = { [TABLE]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) };
        for (let attempt = 0; Object.keys(pending).length; attempt++) {
          if (attempt >= 5) throw new Error("DynamoDB kept returning unprocessed items.");
          if (attempt) await sleep(100 * 2 ** attempt);
          const out = await doc.send(new BatchWriteCommand({ RequestItems: pending }));
          pending = out.UnprocessedItems ?? {};
        }
      }
      return items.length;
    },

    // ----- summaries -----
    async getSummary(userId, month) {
      const out = await doc.send(new GetCommand({ TableName: TABLE, Key: { userId, sk: SUMMARY_PREFIX + month } }));
      return toSummary(month, out.Item);
    },

    async listSummaries(userId) {
      const items = await queryAll({
        KeyConditionExpression: "userId = :u AND begins_with(sk, :p)",
        ExpressionAttributeValues: { ":u": userId, ":p": SUMMARY_PREFIX },
      });
      return items.map((i) => {
        const s = toSummary(i.sk.slice(SUMMARY_PREFIX.length), i);
        return { month: s.month, income: s.income, expense: s.expense };
      });
    },

    // Called by the stream Lambda. sign: +1 for an added transaction, -1 for a removed one.
    // Streams deliver at least once, so each call carries a dedupe key. A marker item and the
    // summary update are written in ONE transaction: if the marker already exists, nothing
    // changes. Markers expire through DynamoDB TTL after a day.
    async applyDelta(item, sign, dedupeKey) {
      const delta = round2(sign * item.amount);
      const names = { "#t": item.type === "income" ? "income" : "expense" };
      let expr = "ADD #t :a";
      if (item.type === "expense") {
        names["#c"] = `cat#${item.category}`;
        expr += ", #c :a";
      }
      try {
        await doc.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: TABLE,
                  Item: { userId: item.userId, sk: EVENT_PREFIX + dedupeKey, ttl: Math.floor(Date.now() / 1000) + 86400 },
                  ConditionExpression: "attribute_not_exists(sk)",
                },
              },
              {
                Update: {
                  TableName: TABLE,
                  Key: { userId: item.userId, sk: SUMMARY_PREFIX + monthOf(item.date) },
                  UpdateExpression: expr,
                  ExpressionAttributeNames: names,
                  ExpressionAttributeValues: { ":a": delta },
                },
              },
            ],
          })
        );
        return true;
      } catch (err) {
        if (err.name === "TransactionCanceledException" && err.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed")
          return false; // this stream record was already applied
        throw err;
      }
    },

    // ----- budgets -----
    async setBudget(userId, category, limit) {
      await doc.send(
        new PutCommand({
          TableName: TABLE,
          Item: { userId, sk: BUDGET_PREFIX + category, category, limit, updatedAt: new Date().toISOString() },
        })
      );
      return { category, limit };
    },

    async listBudgets(userId) {
      const items = await queryAll({
        KeyConditionExpression: "userId = :u AND begins_with(sk, :p)",
        ExpressionAttributeValues: { ":u": userId, ":p": BUDGET_PREFIX },
      });
      return items.map(({ category, limit }) => ({ category, limit }));
    },

    async removeBudget(userId, category) {
      try {
        await doc.send(
          new DeleteCommand({
            TableName: TABLE,
            Key: { userId, sk: BUDGET_PREFIX + category },
            ConditionExpression: "attribute_exists(sk)",
          })
        );
        return true;
      } catch (err) {
        if (conditionFailed(err)) return false;
        throw err;
      }
    },
  };
}

// ---------- In-memory (local dev and tests) ----------
function memoryStore() {
  const rows = new Map(); // `${userId}|${sk}` -> transaction
  const summaries = new Map(); // `${userId}|${month}` -> raw summary item
  const budgets = new Map(); // `${userId}|${category}` -> { category, limit }
  const applied = new Set(); // dedupe keys, like the EVT# markers

  const store = {
    async create(userId, input) {
      const item = buildItem(userId, input);
      rows.set(`${userId}|${item.sk}`, item);
      await store.applyDelta(item, 1, `local-${randomUUID()}`); // no stream locally, so apply inline
      return item;
    },

    async list(userId, { from, to, category }) {
      return [...rows.values()]
        .filter((r) => r.userId === userId && r.date >= from && r.date <= to)
        .filter((r) => (category ? r.category === category : true))
        .sort((a, b) => b.sk.localeCompare(a.sk));
    },

    async update(userId, date, expenseId, input) {
      const oldKey = `${userId}|${date}#${expenseId}`;
      const old = rows.get(oldKey);
      if (!old) return null;
      const item = buildItem(userId, input, expenseId, old.createdAt);
      rows.delete(oldKey);
      rows.set(`${userId}|${item.sk}`, item);
      await store.applyDelta(old, -1, `local-${randomUUID()}`);
      await store.applyDelta(item, 1, `local-${randomUUID()}`);
      return item;
    },

    async remove(userId, date, expenseId) {
      const key = `${userId}|${date}#${expenseId}`;
      const item = rows.get(key);
      if (!item) return false;
      rows.delete(key);
      await store.applyDelta(item, -1, `local-${randomUUID()}`);
      return true;
    },

    async importMany(userId, inputs) {
      for (const input of inputs) await store.create(userId, input);
      return inputs.length;
    },

    async getSummary(userId, month) {
      return toSummary(month, summaries.get(`${userId}|${month}`));
    },

    async listSummaries(userId) {
      return [...summaries.entries()]
        .filter(([k]) => k.startsWith(`${userId}|`))
        .map(([k, v]) => {
          const s = toSummary(k.split("|")[1], v);
          return { month: s.month, income: s.income, expense: s.expense };
        })
        .sort((a, b) => a.month.localeCompare(b.month));
    },

    async applyDelta(item, sign, dedupeKey) {
      if (applied.has(dedupeKey)) return false;
      applied.add(dedupeKey);
      const key = `${item.userId}|${monthOf(item.date)}`;
      const s = summaries.get(key) ?? {};
      const delta = round2(sign * item.amount);
      const field = item.type === "income" ? "income" : "expense";
      s[field] = round2((s[field] ?? 0) + delta);
      if (item.type === "expense") {
        const c = `cat#${item.category}`;
        s[c] = round2((s[c] ?? 0) + delta);
      }
      summaries.set(key, s);
      return true;
    },

    async setBudget(userId, category, limit) {
      budgets.set(`${userId}|${category}`, { category, limit });
      return { category, limit };
    },

    async listBudgets(userId) {
      return [...budgets.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, v]) => v);
    },

    async removeBudget(userId, category) {
      return budgets.delete(`${userId}|${category}`);
    },
  };
  return store;
}

module.exports = TABLE ? dynamoStore() : memoryStore();
