// The API URL is injected at build time (see scripts/deploy-frontend.ps1).
const BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(BASE + path, { ...options, headers: { "content-type": "application/json" } });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

const qs = (params) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  return p.toString() ? `?${p}` : "";
};
const seg = encodeURIComponent;
const send = (method, body) => ({ method, body: JSON.stringify(body) });

export const getCategories = () => request("/categories");
export const listExpenses = (month, category) => request(`/expenses${qs({ month, category })}`);
export const addExpense = (body) => request("/expenses", send("POST", body));
export const updateExpense = (old, body) => request(`/expenses/${seg(old.date)}/${seg(old.expenseId)}`, send("PUT", body));
export const deleteExpense = (e) => request(`/expenses/${seg(e.date)}/${seg(e.expenseId)}`, { method: "DELETE" });
export const importExpenses = (rows) => request("/expenses/import", send("POST", { rows }));
export const getSummary = (month) => request(`/summary${qs({ month })}`);
export const getMonths = () => request("/summary/months");
export const getBudgets = () => request("/budgets");
export const setBudget = (category, limit) => request(`/budgets/${seg(category)}`, send("PUT", { limit }));
export const deleteBudget = (category) => request(`/budgets/${seg(category)}`, { method: "DELETE" });
