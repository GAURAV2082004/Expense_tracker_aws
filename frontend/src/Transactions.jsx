import { useMemo, useRef, useState } from "react";
import { formatMoney, dayLabel } from "./format.js";

export default function Transactions({
  expenses,
  loading,
  categories,
  filter,
  onFilter,
  onEdit,
  onDelete,
  onExport,
  onImport,
  hasDemoData,
  onToggleDemo,
  demoBusy,
}) {
  const [query, setQuery] = useState("");
  const fileRef = useRef(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return expenses;
    return expenses.filter((x) => `${x.category} ${x.note ?? ""}`.toLowerCase().includes(q));
  }, [expenses, query]);

  return (
    <section className="list-wrap">
      <div className="list-head">
        <h2>Transactions ({visible.length})</h2>
        <div className="tools">
          {onToggleDemo && (
            <button
              className={`btn-sample ${hasDemoData ? "danger" : ""}`}
              onClick={onToggleDemo}
              disabled={demoBusy}
              title={hasDemoData ? "Remove sample dataset" : "Load demo transactions"}
            >
              {demoBusy ? (
                "Processing…"
              ) : hasDemoData ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Remove Demo Data
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  Insert Demo Data
                </>
              )}
            </button>
          )}
          <button className="secondary" onClick={() => onExport(visible)} disabled={visible.length === 0}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
          <button className="secondary" onClick={() => fileRef.current?.click()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ""; // lets the same file be picked again
              if (file) onImport(file);
            }}
          />
        </div>
      </div>

      <div className="filters">
        <label className="filter grow">
          <span>Search transactions</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by note or category…" />
        </label>
        <label className="filter">
          <span>Filter by Category</span>
          <select value={filter} onChange={(e) => onFilter(e.target.value)}>
            <option value="">All Categories</option>
            {[...categories.expense, ...categories.income].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      {!loading && visible.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <p>{query ? "No transactions match your search filter." : "No transactions recorded for this month yet. Add one above or insert demo data."}</p>
        </div>
      )}

      <ul className="rows">
        {visible.map((x) => (
          <li key={x.sk}>
            <span className="when">{dayLabel(x.date)}</span>
            <span className="what">
              <div className="what-top">
                <span className="category-tag" data-cat={x.category}>{x.category}</span>
              </div>
              {x.note && <small>{x.note}</small>}
            </span>
            <span className={x.type === "income" ? "amt income" : "amt expense"}>
              {x.type === "income" ? "+" : "−"}
              {formatMoney(x.amount)}
            </span>
            <span className="row-actions">
              <button className="ghost" onClick={() => onEdit(x)} aria-label={`Edit ${x.category} on ${x.date}`}>
                Edit
              </button>
              <button className="ghost danger" onClick={() => onDelete(x)} aria-label={`Delete ${x.category} on ${x.date}`}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
