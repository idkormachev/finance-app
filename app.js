const STORAGE_KEY = "expense-tracker-transactions";

/**
 * Transaction shape:
 * { id, amount: number, currency: "EUR"|"RSD", category: string, name: string,
 *   date: ISOString, type: "income"|"expense" }
 */

const CATEGORY_EMOJI = {
  "Еда": "🛒",
  "Кафе": "☕",
  "Для дома": "🏠",
  "Транспорт": "🚗",
  "Документы": "📄",
  "Одежда": "👕",
};
const DEFAULT_CATEGORY_EMOJI = "🏷️";

function getCategoryEmoji(category) {
  return CATEGORY_EMOJI[category] || DEFAULT_CATEGORY_EMOJI;
}

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

function addTransaction({ amount, currency, category, name, date, type = "expense" }) {
  const transactions = loadTransactions();
  transactions.push({
    id: crypto.randomUUID(),
    amount: Number(amount),
    currency,
    category,
    name,
    date: date || new Date().toISOString(),
    type,
  });
  saveTransactions(transactions);
}

function removeTransaction(id) {
  saveTransactions(loadTransactions().filter((tx) => tx.id !== id));
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

function formatDateOnly(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

// --- Exchange rates (EUR/RSD/RUB via exchangerate-api.com, cached 2h) ---

const RATES_STORAGE_KEY = "expense-tracker-rates";
const RATES_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const RATES_API_URL = "https://open.er-api.com/v6/latest/EUR";

function loadCachedRates() {
  const raw = localStorage.getItem(RATES_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveCachedRates(rates, timestamp) {
  localStorage.setItem(RATES_STORAGE_KEY, JSON.stringify({ rates, timestamp }));
}

function isCacheFresh(cached) {
  return !!cached && Date.now() - cached.timestamp < RATES_TTL_MS;
}

async function fetchRates() {
  const response = await fetch(RATES_API_URL);
  if (!response.ok) throw new Error(`Rates request failed: ${response.status}`);
  const data = await response.json();
  if (data.result !== "success" || !data.rates?.RSD || !data.rates?.RUB) {
    throw new Error("Unexpected rates response");
  }
  // Rates relative to EUR: 1 EUR = rates.RSD RSD = rates.RUB RUB.
  return { EUR: 1, RSD: data.rates.RSD, RUB: data.rates.RUB };
}

// Cached rates get returned immediately (or null while nothing has loaded yet);
// getRates() resolves once fresh data is available, using the cache if it's
// still within RATES_TTL_MS and only hitting the network when it's stale.
let currentRates = null;

async function getRates() {
  const cached = loadCachedRates();

  if (isCacheFresh(cached)) {
    currentRates = cached.rates;
    return { rates: cached.rates, timestamp: cached.timestamp, fromCache: true };
  }

  try {
    const rates = await fetchRates();
    const timestamp = Date.now();
    saveCachedRates(rates, timestamp);
    currentRates = rates;
    return { rates, timestamp, fromCache: false };
  } catch (err) {
    if (cached) {
      // Network/API failure: fall back to stale cache rather than showing nothing.
      currentRates = cached.rates;
      return { rates: cached.rates, timestamp: cached.timestamp, fromCache: true, stale: true };
    }
    throw err;
  }
}

function convert(amount, fromCurrency, toCurrency, rates) {
  const amountInEur = fromCurrency === "EUR" ? amount : amount / rates[fromCurrency];
  return toCurrency === "EUR" ? amountInEur : amountInEur * rates[toCurrency];
}

// --- Transaction form ---

const txForm = document.getElementById("transaction-form");
const txDateInput = document.getElementById("tx-date");
const txCategorySelect = document.getElementById("tx-category");
const txCategoryCustomWrap = document.getElementById("tx-category-custom-wrap");
const txCategoryCustomInput = document.getElementById("tx-category-custom");

txDateInput.value = toDatetimeLocalValue(new Date());

txCategorySelect.addEventListener("change", () => {
  txCategoryCustomWrap.hidden = txCategorySelect.value !== "custom";
});

txForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const type = document.getElementById("tx-type").value;
  const currency = document.getElementById("tx-currency").value;
  const amount = parseFloat(document.getElementById("tx-amount").value);
  const name = document.getElementById("tx-name").value.trim();
  const category =
    txCategorySelect.value === "custom"
      ? txCategoryCustomInput.value.trim()
      : txCategorySelect.value;
  const dateValue = txDateInput.value;

  if (!(amount > 0) || !name || !category) {
    return;
  }

  addTransaction({
    amount,
    currency,
    category,
    name,
    date: dateValue ? new Date(dateValue).toISOString() : new Date().toISOString(),
    type,
  });

  txForm.reset();
  document.getElementById("tx-type").value = "expense";
  document.getElementById("tx-currency").value = "EUR";
  txCategorySelect.value = "Еда";
  txCategoryCustomWrap.hidden = true;
  txDateInput.value = toDatetimeLocalValue(new Date());

  renderBalances();
  renderTransactions();
  renderTotals();
});

// --- Rendering ---

function renderBalances() {
  document.getElementById("balance-eur").textContent = formatAmount(getBalance("EUR"));
  document.getElementById("balance-rsd").textContent = formatAmount(getBalance("RSD"));
}

function renderTotals() {
  const eurEl = document.getElementById("total-eur");
  const rsdEl = document.getElementById("total-rsd");
  const rubEl = document.getElementById("total-rub");
  const plannedRsdEl = document.getElementById("planned-total-rsd");
  const netRsdEl = document.getElementById("total-rsd-net");

  if (!currentRates) {
    eurEl.textContent = "—";
    rsdEl.textContent = "—";
    rubEl.textContent = "—";
    plannedRsdEl.textContent = "—";
    netRsdEl.textContent = "—";
    return;
  }

  const balanceEur = getBalance("EUR");
  const balanceRsd = getBalance("RSD");

  let totalRsd = 0;
  for (const [el, currency] of [
    [eurEl, "EUR"],
    [rsdEl, "RSD"],
    [rubEl, "RUB"],
  ]) {
    const total =
      convert(balanceEur, "EUR", currency, currentRates) +
      convert(balanceRsd, "RSD", currency, currentRates);
    el.textContent = formatAmount(total);
    if (currency === "RSD") totalRsd = total;
  }

  const plannedTotalRsd = loadPlanned().reduce(
    (sum, item) => sum + convert(item.amount, item.currency, "RSD", currentRates),
    0
  );
  plannedRsdEl.textContent = formatAmount(plannedTotalRsd);
  netRsdEl.textContent = formatAmount(totalRsd - plannedTotalRsd);
}

async function refreshRates() {
  const statusEl = document.getElementById("rates-status");
  statusEl.textContent = "Загрузка курса…";

  try {
    const { timestamp, fromCache, stale } = await getRates();
    renderTotals();
    const timeLabel = formatDate(new Date(timestamp).toISOString());
    if (stale) {
      statusEl.textContent = `Не удалось обновить курс, используются старые данные от ${timeLabel}`;
    } else if (fromCache) {
      statusEl.textContent = `Курс (из кеша) от ${timeLabel}`;
    } else {
      statusEl.textContent = `Курс обновлён: ${timeLabel}`;
    }
  } catch (err) {
    statusEl.textContent = "Не удалось загрузить курс валют.";
  }
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

    const title = document.createElement("span");
    title.className = "tx-category";
    title.title = tx.category;

    const emoji = document.createElement("span");
    emoji.className = "tx-emoji";
    emoji.setAttribute("aria-hidden", "true");
    emoji.textContent = getCategoryEmoji(tx.category);

    title.appendChild(emoji);
    title.appendChild(document.createTextNode(tx.name || tx.category));

    const date = document.createElement("span");
    date.className = "tx-date";
    date.textContent = formatDate(tx.date);

    main.appendChild(title);
    main.appendChild(date);

    const right = document.createElement("div");
    right.className = "tx-right";

    const amount = document.createElement("span");
    amount.className = `tx-amount ${tx.type}`;
    const sign = tx.type === "income" ? "+" : "-";
    amount.textContent = `${sign}${formatAmount(tx.amount)} ${tx.currency}`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Удалить «${tx.name || tx.category}»`);
    deleteBtn.addEventListener("click", () => {
      const label = tx.name || tx.category;
      if (!confirm(`Удалить транзакцию «${label}» на ${formatAmount(tx.amount)} ${tx.currency}?`)) {
        return;
      }
      removeTransaction(tx.id);
      renderBalances();
      renderTransactions();
      renderTotals();
    });

    right.appendChild(amount);
    right.appendChild(deleteBtn);

    item.appendChild(main);
    item.appendChild(right);
    list.appendChild(item);
  }
}

// --- Planned expenses (separate list, does not affect balance) ---

const PLANNED_STORAGE_KEY = "expense-tracker-planned";

/**
 * Planned expense shape:
 * { id, name: string, amount: number, currency: "EUR"|"RSD", date: ISOString }
 */

function loadPlanned() {
  const raw = localStorage.getItem(PLANNED_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function savePlanned(items) {
  localStorage.setItem(PLANNED_STORAGE_KEY, JSON.stringify(items));
}

function addPlanned({ name, amount, currency, date }) {
  const items = loadPlanned();
  items.push({
    id: crypto.randomUUID(),
    name,
    amount: Number(amount),
    currency,
    date,
  });
  savePlanned(items);
}

function removePlanned(id) {
  savePlanned(loadPlanned().filter((item) => item.id !== id));
}

const plannedForm = document.getElementById("planned-form");
const plannedDateInput = document.getElementById("planned-date");

function toDateInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

plannedDateInput.value = toDateInputValue(new Date());

plannedForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const name = document.getElementById("planned-name").value.trim();
  const amount = parseFloat(document.getElementById("planned-amount").value);
  const currency = document.getElementById("planned-currency").value;
  const dateValue = plannedDateInput.value;

  if (!name || !(amount > 0) || !dateValue) {
    return;
  }

  addPlanned({
    name,
    amount,
    currency,
    date: new Date(dateValue).toISOString(),
  });

  plannedForm.reset();
  document.getElementById("planned-currency").value = "EUR";
  plannedDateInput.value = toDateInputValue(new Date());

  renderPlanned();
  renderTotals();
});

function renderPlanned() {
  const list = document.getElementById("planned-list");
  const items = loadPlanned()
    .slice()
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  list.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Пока нет запланированных расходов.";
    list.appendChild(empty);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "transaction-item";

    const main = document.createElement("div");
    main.className = "tx-main";

    const name = document.createElement("span");
    name.className = "tx-category";
    name.textContent = item.name;

    const date = document.createElement("span");
    date.className = "tx-date";
    date.textContent = formatDateOnly(item.date);

    main.appendChild(name);
    main.appendChild(date);

    const right = document.createElement("div");
    right.className = "tx-right";

    const amount = document.createElement("span");
    amount.className = "tx-amount expense";
    amount.textContent = `${formatAmount(item.amount)} ${item.currency}`;

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.textContent = "✕";
    deleteBtn.setAttribute("aria-label", `Удалить «${item.name}»`);
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`Удалить «${item.name}» на ${formatAmount(item.amount)} ${item.currency}?`)) {
        return;
      }
      removePlanned(item.id);
      renderPlanned();
      renderTotals();
    });

    right.appendChild(amount);
    right.appendChild(deleteBtn);

    li.appendChild(main);
    li.appendChild(right);
    list.appendChild(li);
  }
}

// --- Import / export ---

const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFileInput = document.getElementById("import-file-input");

exportBtn.addEventListener("click", () => {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions: loadTransactions(),
    planned: loadPlanned(),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `finance-app-export-${toDateInputValue(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => {
  importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files[0];
  importFileInput.value = "";
  if (!file) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    alert("Не удалось прочитать файл: это не корректный JSON.");
    return;
  }

  if (!Array.isArray(data.transactions) || !Array.isArray(data.planned)) {
    alert("Файл имеет неверный формат: не найдены списки transactions/planned.");
    return;
  }

  if (
    !confirm(
      `Импортировать данные из файла?\nТранзакций: ${data.transactions.length}, запланированных расходов: ${data.planned.length}.\nТекущие данные будут заменены.`
    )
  ) {
    return;
  }

  saveTransactions(data.transactions);
  savePlanned(data.planned);

  renderBalances();
  renderTransactions();
  renderPlanned();
  renderTotals();
});

// --- Init ---

renderBalances();
renderTransactions();
renderPlanned();
refreshRates();
