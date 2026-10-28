const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
export const formatMoney = (n) => money.format(n);

// Local calendar date as YYYY-MM-DD (toISOString would shift it to UTC).
export const today = () => new Date().toLocaleDateString("en-CA");
export const thisMonth = () => today().slice(0, 7);

export const prevMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 2, 1).toLocaleDateString("en-CA").slice(0, 7);
};

export const monthLabel = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
};

export const dayLabel = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
