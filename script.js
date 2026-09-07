// ===================================================================
// GeoExchange — live data layer
//   Fiat rates:   National Bank of Georgia public API (no auth)
//   Crypto price: CoinLore public API (no auth)
// ===================================================================

const NBG_API = "https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json";
const CRYPTO_API = "https://api.coinlore.net/api/tickers/?start=0&limit=5";
const REFRESH_MS = 60000; // matches the "60 წამი" claim on the page

let nbgRates = {}; // { USD: { perUnit, diffPerUnit, name }, ... }
let btcData = null; // { price_usd, percent_change_24h }

function currencySymbol(code) {
  switch (code) {
    case "GEL": return "₾";
    case "USD": return "$";
    case "EUR": return "€";
    case "GBP": return "£";
    case "TRY": return "₺";
    case "CHF": return "₣";
    default: return code;
  }
}

function fmt(n, maxDigits = 4) {
  return Number(n).toLocaleString("ka-GE", { minimumFractionDigits: 2, maximumFractionDigits: maxDigits });
}

function flash(el) {
  if (!el) return;
  el.classList.remove("value-flash");
  // restart the animation even if it's already mid-flight
  void el.offsetWidth;
  el.classList.add("value-flash");
}

// ---------------------------------------------------------------
// 1. Fetch live NBG fiat rates (fetch + async/await)
// ---------------------------------------------------------------
async function loadNbgRates(dateStr) {
  const url = dateStr ? `${NBG_API}/?date=${dateStr}` : NBG_API;
  const res = await fetch(url);
  const data = await res.json();
  const day = data[0];
  const map = {};
  map.GEL = { perUnit: 1, diffPerUnit: 0, name: "Georgian Lari", date: day.date };
  day.currencies.forEach((c) => {
    map[c.code] = {
      perUnit: c.rate / c.quantity,
      diffPerUnit: c.diff / c.quantity,
      name: c.name,
      date: day.date,
    };
  });
  return map;
}

async function refreshLiveRates() {
  try {
    nbgRates = await loadNbgRates();
    updateTickerFromNbg();
    convertCurrency();
    updateHeroStatus(true);
  } catch (err) {
    console.error("NBG rate fetch failed:", err);
    updateHeroStatus(false);
  }
}

function updateHeroStatus(ok) {
  const el = document.getElementById("hero-status");
  if (!el) return;
  const now = new Date();
  const time = now.toLocaleTimeString("ka-GE", { hour: "2-digit", minute: "2-digit" });
  el.textContent = ok ? `განახლდა ${time}` : "დროებით მიუწვდომელია";
}

function tickerDiffBadge(el, diff, isPercent = false) {
  el.classList.remove("bg-primary/15", "text-primary", "bg-error/15", "text-error", "bg-surface-container-high", "text-on-surface-variant");
  el.innerHTML = "";
  const icon = document.createElement("span");
  icon.className = "material-symbols-outlined text-[14px]";
  const label = document.createElement("span");

  if (diff > 0.00001) {
    el.classList.add("bg-primary/15", "text-primary");
    icon.textContent = "arrow_drop_up";
    label.textContent = isPercent ? `+${diff.toFixed(2)}%` : `+${diff.toFixed(4)}`;
    el.appendChild(icon);
  } else if (diff < -0.00001) {
    el.classList.add("bg-error/15", "text-error");
    icon.textContent = "arrow_drop_down";
    label.textContent = isPercent ? `${diff.toFixed(2)}%` : diff.toFixed(4);
    el.appendChild(icon);
  } else {
    el.classList.add("bg-surface-container-high", "text-on-surface-variant");
    label.textContent = isPercent ? "0.00%" : "0.0000";
  }
  el.appendChild(label);
}

function updateTickerFromNbg() {
  const pairs = [
    { code: "USD", valueEl: "ticker-usd-value", diffEl: "ticker-usd-diff" },
    { code: "EUR", valueEl: "ticker-eur-value", diffEl: "ticker-eur-diff" },
    { code: "GBP", valueEl: "ticker-gbp-value", diffEl: "ticker-gbp-diff" },
    { code: "TRY", valueEl: "ticker-try-value", diffEl: "ticker-try-diff" },
  ];

  pairs.forEach(({ code, valueEl, diffEl }) => {
    const rate = nbgRates[code];
    const valueNode = document.getElementById(valueEl);
    const diffNode = document.getElementById(diffEl);
    if (!rate || !valueNode || !diffNode) return;
    valueNode.textContent = `${fmt(rate.perUnit)} ₾`;
    flash(valueNode);
    tickerDiffBadge(diffNode, rate.diffPerUnit);
  });
}

// ---------------------------------------------------------------
// 2. Fetch live BTC/USD (fetch + async/await)
// ---------------------------------------------------------------
async function refreshCrypto() {
  const valueNode = document.getElementById("ticker-btc-value");
  const diffNode = document.getElementById("ticker-btc-diff");
  try {
    const res = await fetch(CRYPTO_API);
    const data = await res.json();
    btcData = data.data.find((c) => c.symbol === "BTC") || data.data[0];
    const price = parseFloat(btcData.price_usd);
    const change = parseFloat(btcData.percent_change_24h);
    if (valueNode) {
      valueNode.textContent = `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
      flash(valueNode);
    }
    if (diffNode) tickerDiffBadge(diffNode, change, true);
  } catch (err) {
    console.error("Crypto fetch failed:", err);
    if (valueNode) valueNode.textContent = "N/A";
  }
}

// ---------------------------------------------------------------
// 3. Converter — built entirely on live NBG rates
// ---------------------------------------------------------------
function convertCurrency() {
  const fromInput = document.getElementById("input-amount");
  const fromSelect = document.getElementById("select-from");
  const toSelect = document.getElementById("select-to");
  const resultEl = document.getElementById("calc-result");
  const rateIndicator = document.getElementById("live-rate-indicator");
  const fromLabel = document.getElementById("from-symbol-label");
  const toLabel = document.getElementById("to-symbol-label");
  if (!fromInput || !fromSelect || !toSelect || !resultEl) return;

  const amount = parseFloat(fromInput.value) || 0;
  const fromCode = fromSelect.value;
  const toCode = toSelect.value;

  if (fromLabel) fromLabel.textContent = `${fromCode} (${currencySymbol(fromCode)})`;
  if (toLabel) toLabel.textContent = `${toCode} (${currencySymbol(toCode)})`;

  const fromRate = nbgRates[fromCode];
  const toRate = nbgRates[toCode];

  if (!fromRate || !toRate) {
    resultEl.textContent = "…";
    if (rateIndicator) rateIndicator.textContent = "იტვირთება…";
    return;
  }

  const gelAmount = amount * fromRate.perUnit;
  const result = gelAmount / toRate.perUnit;
  const unitRate = fromRate.perUnit / toRate.perUnit;

  resultEl.textContent = `${fmt(result)} ${currencySymbol(toCode)}`;
  if (rateIndicator) {
    rateIndicator.textContent = `1 ${fromCode} = ${fmt(unitRate)} ${toCode} · NBG`;
  }
}

function setupConverter() {
  const fromInput = document.getElementById("input-amount");
  const fromSelect = document.getElementById("select-from");
  const toSelect = document.getElementById("select-to");
  const swapBtn = document.getElementById("btn-swap-currencies");

  if (fromInput) fromInput.addEventListener("input", convertCurrency);
  if (fromSelect) fromSelect.addEventListener("change", convertCurrency);
  if (toSelect) toSelect.addEventListener("change", convertCurrency);

  if (swapBtn) {
    swapBtn.addEventListener("click", () => {
      const temp = fromSelect.value;
      fromSelect.value = toSelect.value;
      toSelect.value = temp;
      convertCurrency();
    });
  }

  document.querySelectorAll(".quick-amt-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const val = this.getAttribute("data-val");
      if (fromInput && val) {
        fromInput.value = val;
        convertCurrency();
      }
    });
  });
}

// ---------------------------------------------------------------
// 4. Bank comparison — illustrative margins layered on the real NBG rate
// ---------------------------------------------------------------
function updateBankRates(currCode) {
  const rate = nbgRates[currCode];
  const rows = document.querySelectorAll(".bank-row");
  if (!rate) return;

  rows.forEach((row) => {
    const spreadPct = parseFloat(row.getAttribute("data-spread-pct")) || 0.02;
    const buy = rate.perUnit * (1 - spreadPct / 2);
    const sell = rate.perUnit * (1 + spreadPct / 2);
    const buyEl = row.querySelector(".buy-val");
    const sellEl = row.querySelector(".sell-val");
    const spreadEl = row.querySelector(".spread-val");
    if (buyEl) buyEl.textContent = `${fmt(buy)} ₾`;
    if (sellEl) sellEl.textContent = `${fmt(sell)} ₾`;
    if (spreadEl) spreadEl.textContent = fmt(sell - buy);
  });
}

function setupBankTabs() {
  const tabBtns = document.querySelectorAll(".bank-tab-btn");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", function () {
      tabBtns.forEach((b) => {
        b.classList.remove("bg-primary", "text-on-primary");
        b.classList.add("text-on-surface-variant");
      });
      this.classList.add("bg-primary", "text-on-primary");
      this.classList.remove("text-on-surface-variant");
      updateBankRates(this.getAttribute("data-curr"));
    });
  });

  const searchInput = document.getElementById("bank-search-input");
  if (searchInput) {
    searchInput.addEventListener("keyup", function () {
      const query = this.value.toLowerCase().trim();
      document.querySelectorAll(".bank-row").forEach((row) => {
        const name = row.getAttribute("data-name").toLowerCase();
        row.style.display = name.includes(query) ? "" : "none";
      });
    });
  }
}

// ---------------------------------------------------------------
// 5. Historical chart — real NBG rates sampled across the last 30 days
// ---------------------------------------------------------------
function isoDateMinusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

let currentChartDays = 30;

function sampleOffsetsForRange(days) {
  const steps = days <= 7 ? days : 7; // always 8 data points, spread across the range
  const offsets = [];
  for (let i = steps; i >= 0; i--) {
    offsets.push(Math.round((i / steps) * days));
  }
  return [...new Set(offsets)];
}

async function loadHistoricalChart(days = currentChartDays) {
  currentChartDays = days;
  document.getElementById("chart-current-label")?.classList.add("opacity-50");
  const sampleOffsets = sampleOffsetsForRange(days);
  try {
    const results = await Promise.all(
      sampleOffsets.map(async (offset) => {
        const dateStr = isoDateMinusDays(offset);
        const rates = await loadNbgRates(offset === 0 ? undefined : dateStr);
        return { offset, dateStr, value: rates.USD ? rates.USD.perUnit : null };
      })
    );

    const points = results.filter((r) => r.value !== null);
    if (points.length < 2) return;

    drawTrendChart(points);
  } catch (err) {
    console.error("Historical chart fetch failed:", err);
  } finally {
    document.getElementById("chart-current-label")?.classList.remove("opacity-50");
  }
}

function setupChartTimeframes() {
  const tabs = document.querySelectorAll(".tf-tab-btn");
  tabs.forEach((btn) => {
    btn.addEventListener("click", function () {
      tabs.forEach((b) => {
        b.classList.remove("active", "bg-primary", "text-on-primary");
        b.classList.add("text-on-surface-variant");
      });
      this.classList.add("active", "bg-primary", "text-on-primary");
      this.classList.remove("text-on-surface-variant");
      loadHistoricalChart(parseInt(this.getAttribute("data-days"), 10));
    });
  });
}

function drawTrendChart(points) {
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const current = values[values.length - 1];

  document.getElementById("chart-max").textContent = `${fmt(max)} ₾`;
  document.getElementById("chart-min").textContent = `${fmt(min)} ₾`;
  document.getElementById("chart-avg").textContent = `${fmt(avg)} ₾`;
  document.getElementById("chart-top-label").textContent = `${fmt(max)}`;
  document.getElementById("chart-current-label").textContent = `მიმდინარე: ${fmt(current)} ₾`;

  const w = 800;
  const h = 200;
  const pad = 10;
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - pad - ((p.value - min) / range) * (h - pad * 2);
    return [x, y];
  });

  const linePath = coords.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(" ");
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;

  document.getElementById("chart-line-path").setAttribute("d", linePath);
  document.getElementById("chart-area-path").setAttribute("d", areaPath);

  const labelRow = document.getElementById("chart-date-labels");
  if (labelRow) {
    const spans = labelRow.querySelectorAll("span");
    const labelPoints = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
    if (spans[0]) spans[0].textContent = `${points[0].offset} დღის წინ`;
    if (spans[1]) spans[1].textContent = labelPoints[1] ? `${labelPoints[1].offset} დღის წინ` : "";
    if (spans[2]) spans[2].textContent = "";
  }
}

// ---------------------------------------------------------------
// 5b. Scroll-spy navigation + on-scroll reveal animations
// ---------------------------------------------------------------
function setupScrollSpy() {
  const navGroups = document.querySelectorAll("nav[data-active-classes]");
  if (!navGroups.length) return;

  const setActive = (path) => {
    navGroups.forEach((nav) => {
      const activeClasses = nav.getAttribute("data-active-classes").split(/\s+/);
      nav.querySelectorAll("a[data-path]").forEach((link) => {
        const isActive = link.getAttribute("data-path") === path;
        activeClasses.forEach((cls) => link.classList.toggle(cls, isActive));
        link.classList.toggle("text-on-surface-variant", !isActive);
        if (isActive) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      });
    });
  };

  const sections = ["live-rates", "converter", "bank-comparison", "analytics", "branches"]
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible.length) setActive(visible[0].target.id);
    },
    { rootMargin: "-100px 0px -60% 0px", threshold: [0, 0.1, 0.25, 0.5] }
  );
  sections.forEach((s) => observer.observe(s));
}

function setupRevealAnimations() {
  const cards = document.querySelectorAll(".reveal-card");
  if (!cards.length) return;
  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: "0px 0px -40px 0px" }
  );
  cards.forEach((card) => observer.observe(card));
}

// ---------------------------------------------------------------
// 6. Chrome: mobile menu, back-to-top, cookie banner, subscribe form
// ---------------------------------------------------------------
function setupChrome() {
  const menuBtn = document.getElementById("mobile-menu-btn");
  const drawer = document.getElementById("mobile-nav-drawer");
  if (menuBtn && drawer) {
    menuBtn.addEventListener("click", () => drawer.classList.toggle("hidden"));
    drawer.querySelectorAll("a[data-path]").forEach((link) => {
      link.addEventListener("click", () => drawer.classList.add("hidden"));
    });
  }

  const topBtn = document.getElementById("back-to-top-btn");
  if (topBtn) {
    window.addEventListener("scroll", () => {
      const show = window.scrollY > 300;
      topBtn.classList.toggle("opacity-0", !show);
      topBtn.classList.toggle("pointer-events-none", !show);
      topBtn.classList.toggle("opacity-100", show);
    });
    topBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  const cookieBanner = document.getElementById("cookie-banner");
  const acceptBtn = document.getElementById("cookie-accept-btn");
  const rejectBtn = document.getElementById("cookie-reject-btn");
  const closeBtn = document.getElementById("cookie-close-btn");

  if (localStorage.getItem("geoexchange_cookie_consent") && cookieBanner) {
    cookieBanner.style.display = "none";
  }

  function dismissCookie(accepted) {
    localStorage.setItem("geoexchange_cookie_consent", accepted ? "accepted" : "rejected");
    if (cookieBanner) cookieBanner.style.display = "none";
  }

  if (acceptBtn) acceptBtn.addEventListener("click", () => dismissCookie(true));
  if (rejectBtn) rejectBtn.addEventListener("click", () => dismissCookie(false));
  if (closeBtn) closeBtn.addEventListener("click", () => dismissCookie(false));

  const subForm = document.getElementById("subscribe-form");
  const subSuccess = document.getElementById("sub-success-msg");
  const subBtn = document.getElementById("sub-submit-btn");
  if (subForm && subSuccess) {
    subForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("sub-email-input");
      if (input && input.value) {
        subBtn.disabled = true;
        subBtn.textContent = "მუშავდება...";
        setTimeout(() => {
          subBtn.classList.add("hidden");
          input.disabled = true;
          subSuccess.classList.remove("hidden");
        }, 400);
      }
    });
  }
}

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  setupConverter();
  setupBankTabs();
  setupChartTimeframes();
  setupChrome();
  setupScrollSpy();
  setupRevealAnimations();

  refreshLiveRates().then(() => updateBankRates("USD"));
  refreshCrypto();
  loadHistoricalChart(currentChartDays);

  setInterval(refreshLiveRates, REFRESH_MS);
  setInterval(refreshCrypto, REFRESH_MS);
});
