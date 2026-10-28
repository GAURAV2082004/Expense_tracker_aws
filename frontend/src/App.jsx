import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import {
  getCategories,
  listExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  importExpenses,
  getSummary,
  getMonths,
  getBudgets,
  setBudget,
  deleteBudget,
} from "./api.js";
import { csvToTransactions, toCsv } from "./csv.js";
import { formatMoney, thisMonth, prevMonth, monthLabel } from "./format.js";
import { SAMPLE_CSV, DEMO_MONTHS, getDemoSignatures } from "./sampleData.js";
import TransactionForm from "./TransactionForm.jsx";
import Transactions from "./Transactions.jsx";
import Budgets from "./Budgets.jsx";

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#64748b"];
const MAX_IMPORT_ROWS = 200;

export default function App() {
  const [month, setMonth] = useState(thisMonth());
  const [categories, setCategories] = useState({ expense: [], income: [] });
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [prevSummary, setPrevSummary] = useState(null);
  const [months, setMonths] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);
  const [hasDemoData, setHasDemoData] = useState(() => localStorage.getItem("expense_demo_loaded") === "true");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);

  const say = useCallback((message) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4500);
  }, []);

  const refreshSummaries = useCallback(async (m) => {
    const [s, prev, all] = await Promise.all([getSummary(m), getSummary(prevMonth(m)), getMonths()]);
    setSummary(s);
    setPrevSummary(prev);
    setMonths(all);
  }, []);

  // Totals are updated by a DynamoDB Streams Lambda a moment after a write,
  // so refresh now and once more shortly after.
  const refreshSoon = useCallback(
    (m) => {
      refreshSummaries(m).catch(() => {});
      setTimeout(() => refreshSummaries(m).catch(() => {}), 1500);
    },
    [refreshSummaries]
  );

  useEffect(() => {
    Promise.all([getCategories(), getBudgets()])
      .then(([cats, b]) => {
        setCategories(cats);
        setBudgets(b);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([listExpenses(month, filter), refreshSummaries(month)])
      .then(([rows]) => {
        if (cancelled) return;
        setExpenses(rows);
        const sigs = getDemoSignatures();
        const demoPresent = rows.some((x) =>
          sigs.has(`${x.date}|${x.type}|${x.category}|${x.amount}|${x.note ?? ""}`)
        );
        if (demoPresent) {
          setHasDemoData(true);
          localStorage.setItem("expense_demo_loaded", "true");
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [month, filter, refreshSummaries]);

  const inView = (x) => x.date.startsWith(month) && (!filter || filter === x.category);
  const bySk = (a, b) => b.sk.localeCompare(a.sk);

  // ----- transactions -----
  async function saveTransaction(payload) {
    setError("");
    try {
      if (editing) {
        const updated = await updateExpense(editing, payload);
        setExpenses((prev) => {
          const rest = prev.filter((x) => x.sk !== editing.sk);
          return (inView(updated) ? [updated, ...rest] : rest).sort(bySk);
        });
        setEditing(null);
        say("Changes saved.");
      } else {
        const created = await addExpense(payload);
        if (inView(created)) setExpenses((prev) => [created, ...prev].sort(bySk));
        say(payload.type === "expense" ? "Expense added." : "Income added.");
      }
      refreshSoon(month);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function removeTransaction(item) {
    setError("");
    try {
      await deleteExpense(item);
      setExpenses((prev) => prev.filter((x) => x.sk !== item.sk));
      if (editing?.sk === item.sk) setEditing(null);
      say("Transaction deleted.");
      refreshSoon(month);
    } catch (err) {
      setError(err.message);
    }
  }

  // ----- CSV -----
  function exportCsv(rows) {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    say(`Exported ${rows.length} transactions.`);
  }

  async function importCsv(file) {
    setError("");
    try {
      const rows = csvToTransactions(await file.text());
      if (rows.length === 0) throw new Error("The file has no transactions.");
      if (rows.length > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
      const { imported } = await importExpenses(rows);
      say(`Imported ${imported} transactions.`);
      setExpenses(await listExpenses(month, filter));
      refreshSoon(month);
    } catch (err) {
      setError(`Import failed. ${err.message} Nothing was saved.`);
    }
  }

  // ----- Demo Data Toggle (Insert / Remove) -----
  async function toggleDemoData() {
    if (demoBusy) return;
    setDemoBusy(true);
    setError("");

    if (!hasDemoData) {
      // INSERT demo data
      try {
        const rows = csvToTransactions(SAMPLE_CSV);
        const { imported } = await importExpenses(rows);
        if (budgets.length === 0) {
          await Promise.allSettled([
            setBudget("Food", 8000),
            setBudget("Rent", 25000),
            setBudget("Entertainment", 3000),
          ]);
          setBudgets(await getBudgets());
        }
        setHasDemoData(true);
        localStorage.setItem("expense_demo_loaded", "true");
        say(`Demo data inserted (${imported} transactions across 3 months).`);
        setExpenses(await listExpenses(month, filter));
        refreshSoon(month);
      } catch (err) {
        setError(`Could not insert demo data: ${err.message}`);
      } finally {
        setDemoBusy(false);
      }
    } else {
      // REMOVE demo data
      try {
        const sigs = getDemoSignatures();
        let removedCount = 0;

        for (const m of DEMO_MONTHS) {
          const list = await listExpenses(m);
          const demoRows = list.filter((x) =>
            sigs.has(`${x.date}|${x.type}|${x.category}|${x.amount}|${x.note ?? ""}`)
          );
          for (const item of demoRows) {
            await deleteExpense(item);
            removedCount++;
          }
        }

        // Remove demo budgets if they were standard demo values
        await Promise.allSettled([
          deleteBudget("Food"),
          deleteBudget("Rent"),
          deleteBudget("Entertainment"),
        ]);
        setBudgets(await getBudgets());

        setHasDemoData(false);
        localStorage.removeItem("expense_demo_loaded");
        say(`Removed demo dataset (${removedCount} transactions cleared).`);
        setExpenses(await listExpenses(month, filter));
        refreshSoon(month);
      } catch (err) {
        setError(`Could not remove demo data: ${err.message}`);
      } finally {
        setDemoBusy(false);
      }
    }
  }

  // ----- budgets -----
  async function saveBudget(category, limit) {
    setError("");
    try {
      const saved = await setBudget(category, limit);
      setBudgets((prev) => [...prev.filter((b) => b.category !== category), saved]);
      say(`${category} budget saved.`);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function removeBudget(category) {
    setError("");
    try {
      await deleteBudget(category);
      setBudgets((prev) => prev.filter((b) => b.category !== category));
      say(`${category} budget removed.`);
    } catch (err) {
      setError(err.message);
    }
  }

  // ----- derived numbers -----
  const categoryEntries = useMemo(
    () => Object.entries(summary?.byCategory ?? {}).sort((a, b) => b[1] - a[1]),
    [summary]
  );

  const insights = useMemo(() => {
    if (!summary) return [];
    const out = [];
    out.push({
      label: "Savings rate",
      value: summary.income > 0 ? `${Math.round((summary.balance / summary.income) * 100)}%` : "No income yet",
    });
    if (prevSummary && prevSummary.expense > 0) {
      const diff = summary.expense - prevSummary.expense;
      const pct = Math.round((Math.abs(diff) / prevSummary.expense) * 100);
      out.push({
        label: `Spending vs ${monthLabel(prevMonth(month))}`,
        value: diff === 0 ? "No change" : `${formatMoney(Math.abs(diff))} ${diff > 0 ? "more" : "less"} (${pct}%)`,
        bad: diff > 0,
      });
    }
    if (categoryEntries.length && summary.expense > 0) {
      const [name, value] = categoryEntries[0];
      out.push({ label: "Top spending", value: `${name} (${Math.round((value / summary.expense) * 100)}%)` });
    }
    return out;
  }, [summary, prevSummary, categoryEntries, month]);

  const doughnut = {
    labels: categoryEntries.map(([name]) => name),
    datasets: [
      {
        data: categoryEntries.map(([, v]) => v),
        backgroundColor: categoryEntries.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 2,
        borderColor: "#fff",
      },
    ],
  };

  const recent = months.slice(-6);
  const bars = {
    labels: recent.map((m) => monthLabel(m.month)),
    datasets: [
      { label: "Income", data: recent.map((m) => m.income), backgroundColor: "#10b981", borderRadius: 6 },
      { label: "Expenses", data: recent.map((m) => m.expense), backgroundColor: "#f43f5e", borderRadius: 6 },
    ],
  };
  const chartBase = { responsive: true, maintainAspectRatio: false, animation: reduceMotion ? false : undefined };

  const income = summary?.income ?? 0;
  const expense = summary?.expense ?? 0;
  const balance = summary?.balance ?? 0;

  return (
    <main className="shell">
      {/* Top Header */}
      <header className="top">
        <div className="brand">
          <div className="logo-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div className="brand-text">
            <h1>Expense Tracker</h1>
            <span className="badge-tag">Serverless Cloud v2</span>
          </div>
        </div>

        <div className="top-actions">
          <label className="month">
            <span>Viewing Month</span>
            <input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
      </header>

      {/* Modern Metric Stat Cards */}
      <section className="figures" aria-label="Monthly totals">
        <div className="fig-card">
          <div className="fig-card-header">
            <span className="fig-label">Total Income</span>
            <div className="fig-icon-pill income" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
            </div>
          </div>
          <p className="fig income">{formatMoney(income)}</p>
          <p className="fig-subtext">Received this month</p>
        </div>

        <div className="fig-card">
          <div className="fig-card-header">
            <span className="fig-label">Total Spent</span>
            <div className="fig-icon-pill expense" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                <polyline points="17 18 23 18 23 12" />
              </svg>
            </div>
          </div>
          <p className="fig expense">{formatMoney(expense)}</p>
          <p className="fig-subtext">{income > 0 ? `${Math.round((expense / income) * 100)}% of income spent` : "Outflow this month"}</p>
        </div>

        <div className="fig-card">
          <div className="fig-card-header">
            <span className="fig-label">Net Balance</span>
            <div className="fig-icon-pill balance" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
            </div>
          </div>
          <p className={`fig ${balance < 0 ? "expense" : "balance"}`}>{formatMoney(balance)}</p>
          <p className="fig-subtext">{balance >= 0 ? "Remaining net savings" : "Expenses exceed income"}</p>
        </div>
      </section>

      {/* Insights Pills */}
      {insights.length > 0 && (
        <dl className="insights">
          {insights.map((i) => (
            <div key={i.label} className="insight-pill">
              <dt>{i.label}:</dt>
              <dd className={i.bad ? "bad" : ""}>{i.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Status Notifications */}
      <div role="alert" className={error ? "error" : "error hidden"}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{error}</span>
      </div>
      <div role="status" className={notice ? "notice" : "notice hidden"}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>{notice}</span>
      </div>

      {/* Charts Section */}
      <section className="charts">
        <div className="panel">
          <div className="panel-head">
            <h2>Spending by category</h2>
          </div>
          {categoryEntries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
                  <path d="M22 12A10 10 0 0 0 12 2v10z" />
                </svg>
              </div>
              <p>{loading ? "Loading transactions…" : "No spending recorded for this month."}</p>
            </div>
          ) : (
            <div className="donut-row">
              <div className="donut">
                <Doughnut data={doughnut} options={{ ...chartBase, cutout: "66%", plugins: { legend: { display: false } } }} />
              </div>
              <ul className="legend">
                {categoryEntries.map(([name, value], i) => (
                  <li key={name}>
                    <i style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span>{name}</span>
                    <b>{formatMoney(value)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Last 6 months</h2>
          </div>
          {recent.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </div>
              <p>Add transactions across months to see monthly totals and trends.</p>
            </div>
          ) : (
            <div className="bars">
              <Bar
                data={bars}
                options={{
                  ...chartBase,
                  plugins: { legend: { position: "bottom" } },
                  scales: {
                    x: { grid: { display: false } },
                    y: { beginAtZero: true, grid: { color: "#f1f5f9" }, ticks: { callback: (v) => formatMoney(v) } },
                  },
                }}
              />
            </div>
          )}
        </div>
      </section>

      {/* Duo: Budgets + Add Transaction */}
      <section className="duo">
        <Budgets
          budgets={budgets}
          spent={summary?.byCategory ?? {}}
          expenseCategories={categories.expense}
          onSave={saveBudget}
          onRemove={removeBudget}
        />
        <TransactionForm
          categories={categories}
          editing={editing}
          onSubmit={saveTransaction}
          onCancel={() => setEditing(null)}
        />
      </section>

      {/* Transactions List */}
      <Transactions
        expenses={expenses}
        loading={loading}
        categories={categories}
        filter={filter}
        onFilter={setFilter}
        onEdit={(x) => {
          setEditing(x);
          window.scrollTo({ top: document.querySelector(".add")?.offsetTop - 20 || 0, behavior: reduceMotion ? "auto" : "smooth" });
        }}
        onDelete={removeTransaction}
        onExport={exportCsv}
        onImport={importCsv}
        hasDemoData={hasDemoData}
        onToggleDemo={toggleDemoData}
        demoBusy={demoBusy}
      />
    </main>
  );
}
