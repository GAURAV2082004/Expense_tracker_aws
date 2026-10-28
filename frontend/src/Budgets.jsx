import { useState } from "react";
import { formatMoney } from "./format.js";

const barColor = (ratio) => (ratio > 1 ? "#e11d48" : ratio >= 0.8 ? "#d97706" : "#059669");

export default function Budgets({ budgets, spent, expenseCategories, onSave, onRemove }) {
  const [category, setCategory] = useState("Food");
  const [limit, setLimit] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (await onSave(category, Number(limit))) setLimit("");
  }

  const sorted = [...budgets].sort((a, b) => a.category.localeCompare(b.category));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Monthly budgets</h2>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <p>No budgets configured. Set category limits below to track spending progress.</p>
        </div>
      ) : (
        <ul className="budgets">
          {sorted.map((b) => {
            const used = spent[b.category] ?? 0;
            const ratio = b.limit > 0 ? used / b.limit : 0;
            const left = b.limit - used;
            const pct = Math.round(ratio * 100);
            return (
              <li key={b.category}>
                <div className="b-top">
                  <b>{b.category}</b>
                  <span className={left < 0 ? "over" : "muted"}>
                    {left < 0 ? `${formatMoney(-left)} over (${pct}%)` : `${formatMoney(left)} left (${pct}%)`}
                  </span>
                </div>
                <div
                  className="track"
                  role="progressbar"
                  aria-label={`${b.category} budget used`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, pct)}
                >
                  <div className="fill" style={{ width: `${Math.min(100, ratio * 100)}%`, background: barColor(ratio) }} />
                </div>
                <div className="b-bottom">
                  <span className="muted">
                    {formatMoney(used)} of {formatMoney(b.limit)}
                  </span>
                  <button className="ghost danger" onClick={() => onRemove(b.category)} aria-label={`Remove ${b.category} budget`}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form className="budget-form" onSubmit={submit}>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Budget category">
          {expenseCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <input
          type="number"
          min="1"
          step="0.01"
          inputMode="decimal"
          placeholder="Monthly limit (₹)"
          aria-label="Monthly limit"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          required
        />
        <button type="submit" className="secondary">
          Set limit
        </button>
      </form>
    </section>
  );
}
