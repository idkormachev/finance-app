const STORAGE_KEY = "expense-tracker-transactions";

/**
 * Transaction shape:
 * { id, amount: number, currency: "EUR"|"RSD", category: string,
 *   date: ISOString, type: "income"|"expense" }
 */

function loadTransactions() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveTransactions(transactions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function addTransaction({ amount, currency, category, date, type = "expense" }) {
  const transactions = loadTransactions();
  transactions.push({
    id: crypto.randomUUID(),
    amount: Number(amount),
    currency,
    category,
    date: date || new Date().toISOString(),
    type,
  });
  saveTransactions(transactions);
}

function getBalance(currency) {
  return loadTransactions()
    .filter((tx) => tx.currency === currency)
    .reduce((sum, tx) => sum + (tx.type === "income" ? tx.amount : -tx.amount), 0);
}

function formatAmount(value) {
  return value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// --- Transaction form ---

const txForm = document.getElementById("transaction-form");
const txDateInput = document.getElementById("tx-date");

txDateInput.value = toDatetimeLocalValue(new Date());

txForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const type = document.getElementById("tx-type").value;
  const currency = document.getElementById("tx-currency").value;
  const amount = parseFloat(document.getElementById("tx-amount").value);
  const category = document.getElementById("tx-category").value.trim();
  const dateValue = txDateInput.value;

  if (!(amount > 0) || !category) {
    return;
  }

  addTransaction({
    amount,
    currency,
    category,
    date: dateValue ? new Date(dateValue).toISOString() : new Date().toISOString(),
    type,
  });

  txForm.reset();
  document.getElementById("tx-type").value = "expense";
  document.getElementById("tx-currency").value = "EUR";
  txDateInput.value = toDatetimeLocalValue(new Date());

  renderBalances();
  renderTransactions();
});

// --- Rendering ---

function renderBalances() {
  document.getElementById("balance-eur").textContent = formatAmount(getBalance("EUR"));
  document.getElementById("balance-rsd").textContent = formatAmount(getBalance("RSD"));
}

function renderTransactions() {
  const list = document.getElementById("transaction-list");
  const transactions = loadTransactions()
    .slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  list.innerHTML = "";

  if (transactions.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Пока нет транзакций.";
    list.appendChild(empty);
    return;
  }

  for (const tx of transactions) {
    const item = document.createElement("li");
    item.className = "transaction-item";

    const main = document.createElement("div");
    main.className = "tx-main";

    const category = document.createElement("span");
    category.className = "tx-category";
    category.textContent = tx.category;

    const date = document.createElement("span");
    date.className = "tx-date";
    date.textContent = formatDate(tx.date);

    main.appendChild(category);
    main.appendChild(date);

    const amount = document.createElement("span");
    amount.className = `tx-amount ${tx.type}`;
    const sign = tx.type === "income" ? "+" : "-";
    amount.textContent = `${sign}${formatAmount(tx.amount)} ${tx.currency}`;

    item.appendChild(main);
    item.appendChild(amount);
    list.appendChild(item);
  }
}

// --- Init ---

renderBalances();
renderTransactions();
