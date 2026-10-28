import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, csvToTransactions, toCsv } from "./csv.js";

test("parseCsv handles quotes, commas, newlines, CRLF and blank lines", () => {
  const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\n\n"line1\nline2",z\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "z"]]);
});

test("csvToTransactions maps columns by header name and any order", () => {
  const rows = csvToTransactions("Amount,Date,Type,Category\n1,000.50,2026-10-01,Income,Salary\n".replace("1,000.50", '"1,000.50"'));
  assert.deepEqual(rows, [{ date: "2026-10-01", type: "income", category: "Salary", amount: 1000.5, note: "" }]);
});

test("csvToTransactions reports a missing column", () => {
  assert.throws(() => csvToTransactions("date,type,amount\n2026-10-01,expense,5"), /category/);
  assert.throws(() => csvToTransactions(""), /empty/);
});

test("export then import round-trips, and formulas are defused on export", () => {
  const items = [
    { date: "2026-10-01", type: "expense", category: "Food", amount: 12.5, note: '=HYPERLINK("http://x")' },
    { date: "2026-10-02", type: "income", category: "Salary", amount: 100, note: "a, b" },
  ];
  const csv = toCsv(items);
  assert.ok(csv.includes("'=HYPERLINK")); // a leading apostrophe stops Excel running it
  const back = csvToTransactions(csv);
  assert.equal(back[0].note, '=HYPERLINK("http://x")');
  assert.equal(back[1].note, "a, b");
  assert.equal(back[0].amount, 12.5);
});
