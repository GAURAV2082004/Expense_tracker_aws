// Small CSV reader and writer, so the app needs no extra dependency.
export const COLUMNS = ["date", "type", "category", "amount", "note"];
const REQUIRED = ["date", "type", "category", "amount"];

export function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// Columns are found by header name, so their order does not matter.
export function csvToTransactions(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) throw new Error("The file is empty.");

  const names = header.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !names.includes(c));
  if (missing.length) throw new Error(`Missing column: ${missing.join(", ")}. Expected: ${COLUMNS.join(", ")}.`);

  const at = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)]));
  const cell = (r, c) => (at[c] >= 0 ? (r[at[c]] ?? "").trim() : "");

  return body.map((r) => ({
    date: cell(r, "date"),
    type: cell(r, "type").toLowerCase(),
    category: cell(r, "category"),
    amount: Number(cell(r, "amount").replace(/,/g, "")),
    note: cell(r, "note").replace(/^'(?=[=+\-@])/, ""), // undo the export's formula guard
  }));
}

const escapeField = (value) => {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// A note that starts with = + - or @ can run as a formula when opened in Excel, so it gets a leading apostrophe.
const guardFormula = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function toCsv(items) {
  const lines = [COLUMNS.join(",")];
  for (const x of items) {
    lines.push(
      [x.date, x.type, x.category, x.amount, guardFormula(x.note ?? "")].map(escapeField).join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
