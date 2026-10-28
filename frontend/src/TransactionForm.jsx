import { useEffect, useState } from "react";
import { today } from "./format.js";

// Used for both adding and editing. onSubmit resolves to true when the save worked.
export default function TransactionForm({ categories, editing, onSubmit, onCancel }) {
  const [type, setType] = useState("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Food");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setAmount(String(editing.amount));
    setCategory(editing.category);
    setDate(editing.date);
    setNote(editing.note ?? "");
  }, [editing]);

  const options = categories[type] ?? [];
  const effectiveCategory = options.includes(category) ? category : options[0] ?? "";

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    const ok = await onSubmit({ type, amount: Number(amount), category: effectiveCategory, date, note });
    setSaving(false);
    if (ok && !editing) {
      setAmount("");
      setNote("");
    }
  }

  return (
    <form className="panel add" onSubmit={submit}>
      <div className="panel-head">
        <h2>{editing ? "Edit transaction" : "Add a transaction"}</h2>
      </div>

      <div className="seg" role="radiogroup" aria-label="Type">
        {["expense", "income"].map((t) => (
          <label key={t} className={type === t ? "on" : ""}>
            <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} />
            {t === "expense" ? "Expense" : "Income"}
          </label>
        ))}
      </div>

      <div className="grid">
        <label>
          Amount (₹)
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            required
          />
        </label>
        <label>
          Category
          <select value={effectiveCategory} onChange={(e) => setCategory(e.target.value)}>
            {options.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="wide">
          Note (optional)
          <input value={note} maxLength={200} placeholder="e.g. Groceries at supermarket" onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : type === "expense" ? "+ Add expense" : "+ Add income"}
        </button>
        {editing && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
