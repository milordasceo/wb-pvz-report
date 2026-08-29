(function () {
  const MONTHS_RU = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  const MONTHS_SHORT = [
    "янв", "фев", "мар", "апр", "май", "июн",
    "июл", "авг", "сен", "окт", "ноя", "дек",
  ];

  const money = (n) => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n < 0 ? "−" : "";
    const abs = Math.abs(n);
    const [int, dec] = abs.toFixed(2).split(".");
    const spaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${sign}${spaced},${dec} ₽`;
  };

  const moneyShort = (n) => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n < 0 ? "−" : "";
    const abs = Math.round(Math.abs(n));
    return `${sign}${String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽`;
  };

  const parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();
  const monthKey = (year, monthIndex) =>
    `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const monthTitle = (key) => {
    const [y, m] = key.split("-").map(Number);
    const name = MONTHS_RU[m - 1];
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
  };
  const monthShort = (key) => {
    const [y, m] = key.split("-").map(Number);
    return `${MONTHS_SHORT[m - 1]}’${String(y).slice(2)}`;
  };

  const defaultsOf = (point) => ({
    fotPerDay: Number(point.costs?.fotPerDay) || 0,
    rentPerMonth: Number(point.costs?.rentPerMonth) || 0,
    internetPerMonth: Number(point.costs?.internetPerMonth) || 0,
    suppliesPerMonth: Number(point.costs?.suppliesPerMonth) || 0,
    adminPerMonth: Number(point.costs?.adminPerMonth) || 15000,
    taxPct: 6,
  });

  const fotDay = (point) => effectiveCosts(point).fotPerDay;
  const rentMonth = (point) => effectiveCosts(point).rentPerMonth;
  const internetMonth = (point) => effectiveCosts(point).internetPerMonth;
  const suppliesMonth = (point) => effectiveCosts(point).suppliesPerMonth;
  const adminMonth = (point) => effectiveCosts(point).adminPerMonth;
  const taxPctOf = (point) => effectiveCosts(point).taxPct;

  const proRate = (full, daysCovered, daysInMonth) =>
    daysInMonth > 0 ? (full * daysCovered) / daysInMonth : 0;

  function allocateWeekByMonths(week) {
    const start = parseDate(week.from);
    const end = parseDate(week.to);
    const dayMap = {};
    let totalDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = monthKey(d.getFullYear(), d.getMonth());
      dayMap[key] = (dayMap[key] || 0) + 1;
      totalDays += 1;
    }
    if (!totalDays) return [];
    const sales = Number(week.revenue) || 0;
    const subsidy = Number(week.subsidy) || 0;
    return Object.keys(dayMap)
      .sort()
      .map((key) => ({
        key,
        days: dayMap[key],
        revenue: (sales * dayMap[key]) / totalDays,
        subsidy: (subsidy * dayMap[key]) / totalDays,
        week,
      }));
  }

  function weekSplitsMonths(week) {
    const s = parseDate(week.from);
    const e = parseDate(week.to);
    const keys = new Set();
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      keys.add(monthKey(d.getFullYear(), d.getMonth()));
    }
    return keys.size > 1;
  }

  function buildMonths(point) {
    const map = {};
    const rate = fotDay(point);

    for (const week of point.weeks) {
      const split = weekSplitsMonths(week);
      for (const part of allocateWeekByMonths(week)) {
        if (!map[part.key]) {
          const [y, m] = part.key.split("-").map(Number);
          map[part.key] = {
            key: part.key,
            revenue: 0,
            subsidy: 0,
            daysCovered: 0,
            daysInMonth: daysInMonth(y, m - 1),
            weeks: [],
          };
        }
        const b = map[part.key];
        b.revenue += part.revenue;
        b.subsidy += part.subsidy;
        b.daysCovered += part.days;
        b.weeks.push({
          period: week.period,
          days: part.days,
          revenue: part.revenue,
          subsidy: part.subsidy,
          note: week.note || null,
          split,
        });
      }
    }

    const opts = getCostOpts(point.id);
    const costs = effectiveCosts(point);
    const netFull = costs.internetPerMonth;
    const supFull = costs.suppliesPerMonth;
    const admFull = opts.adminOn ? costs.adminPerMonth : 0;
    const taxPct = costs.taxPct;

    return Object.values(map)
      .map((m) => {
        const fot = costs.fotPerDay * m.daysCovered;
        const rentFull = opts.rentOn ? costs.rentPerMonth : 0;
        const rent = opts.rentOn
          ? proRate(rentFull, m.daysCovered, m.daysInMonth)
          : 0;
        const internet = proRate(netFull, m.daysCovered, m.daysInMonth);
        const supplies = proRate(supFull, m.daysCovered, m.daysInMonth);
        const admin = opts.adminOn
          ? proRate(admFull, m.daysCovered, m.daysInMonth)
          : 0;
        const tax = m.revenue * (taxPct / 100);
        const expenses = fot + rent + internet + supplies + admin + tax;
        const net = m.revenue + m.subsidy - expenses;
        return {
          ...m,
          fot,
          rent,
          rentFull,
          rentOn: opts.rentOn,
          adminOn: opts.adminOn,
          internet,
          supplies,
          admin,
          tax,
          taxPct,
          expenses,
          net,
          rate: costs.fotPerDay,
          partial: m.daysCovered < m.daysInMonth,
        };
      })
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }

  /** Месяцы от старых к новым */
  const chrono = (months) => [...months].sort((a, b) => (a.key > b.key ? 1 : -1));

  /** Последний «полный» месяц, иначе самый свежий */
  function lastUsefulMonth(months) {
    const full = months.filter((m) => !m.partial);
    if (full.length) return full[0]; // already newest-first
    return months[0] || null;
  }

  const EXCLUDE_KEY = "wb-pvz-excluded";
  const FORECAST_KEY = "wb-pvz-forecast-on";
  const MONTH_EXCLUDE_KEY = "wb-pvz-months-excluded";
  const COST_OPTS_KEY = "wb-pvz-cost-opts";

  function getCostOptsMap() {
    try {
      const raw = localStorage.getItem(COST_OPTS_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function numOr(v, fallback) {
    const n = Number(v);
    return v == null || v === "" || Number.isNaN(n) ? fallback : Math.max(0, n);
  }

  function getCostOpts(pointId) {
    const raw = getCostOptsMap()[pointId] || {};
    return {
      rentOn: raw.rentOn !== false,
      adminOn: raw.adminOn === true,
      fotPerDay: raw.fotPerDay,
      rentPerMonth: raw.rentPerMonth,
      internetPerMonth: raw.internetPerMonth,
      suppliesPerMonth: raw.suppliesPerMonth,
      adminPerMonth: raw.adminPerMonth,
      taxPct: raw.taxPct,
      open: raw.open === true,
    };
  }

  function setCostOpts(pointId, patch) {
    try {
      const map = getCostOptsMap();
      const cur = getCostOptsMap()[pointId] || {};
      map[pointId] = { ...cur, ...patch };
      localStorage.setItem(COST_OPTS_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }

  /** Итоговые ставки точки: defaults из data.js + overrides из настроек */
  function effectiveCosts(point) {
    const d = defaultsOf(point);
    const o = getCostOpts(point.id);
    return {
      fotPerDay: numOr(o.fotPerDay, d.fotPerDay),
      rentPerMonth: numOr(o.rentPerMonth, d.rentPerMonth),
      internetPerMonth: numOr(o.internetPerMonth, d.internetPerMonth),
      suppliesPerMonth: numOr(o.suppliesPerMonth, d.suppliesPerMonth),
      adminPerMonth: numOr(o.adminPerMonth, d.adminPerMonth),
      taxPct: numOr(o.taxPct, d.taxPct),
      rentOn: o.rentOn,
      adminOn: o.adminOn,
    };
  }

  function getExcludedIds() {
    try {
      const raw = localStorage.getItem(EXCLUDE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  function setExcludedIds(ids) {
    try {
      localStorage.setItem(EXCLUDE_KEY, JSON.stringify([...new Set(ids)]));
    } catch {
      /* ignore */
    }
  }

  function isForecastOn() {
    try {
      const raw = localStorage.getItem(FORECAST_KEY);
      if (raw === null) return true; // по умолчанию включён
      return raw === "1" || raw === "true";
    } catch {
      return true;
    }
  }

  function setForecastOn(on) {
    try {
      localStorage.setItem(FORECAST_KEY, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function renderForecastToggle() {
    const on = isForecastOn();
    return `
      <button type="button" class="forecast-toggle ${on ? "on" : "off"}" id="forecast-toggle" aria-pressed="${on}">
        <span class="ft-dot"></span>
        Прогноз: <strong>${on ? "вкл" : "выкл"}</strong>
      </button>`;
  }

  function bindForecastToggle(rerender) {
    const btn = document.getElementById("forecast-toggle");
    if (!btn) return;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setForecastOn(!isForecastOn());
      rerender();
    });
  }

  function renderPointSettings(point) {
    const c = effectiveCosts(point);
    const open = getCostOpts(point.id).open;
    const forecastOn = isForecastOn();
    return `
      <details class="settings-panel" id="settings-panel" ${open ? "open" : ""}>
        <summary class="settings-summary">
          <span>⚙ Настройки расходов</span>
          <span class="settings-hint">ФОТ · аренда · интернет · расходники · налоги</span>
        </summary>
        <div class="settings-body">
          <label class="settings-check">
            <input type="checkbox" id="set-forecast" ${forecastOn ? "checked" : ""} />
            <span>Показывать прогноз</span>
          </label>

          <div class="settings-grid">
            <label class="settings-field">
              <span>ФОТ, ₽ / день</span>
              <input type="number" min="0" step="100" inputmode="numeric" id="set-fot" value="${Math.round(c.fotPerDay)}" />
            </label>
            <label class="settings-field">
              <span>Интернет, ₽ / мес</span>
              <input type="number" min="0" step="100" inputmode="numeric" id="set-internet" value="${Math.round(c.internetPerMonth)}" />
            </label>
            <label class="settings-field">
              <span>Расходники, ₽ / мес</span>
              <input type="number" min="0" step="100" inputmode="numeric" id="set-supplies" value="${Math.round(c.suppliesPerMonth)}" />
            </label>
            <label class="settings-field">
              <span>Налог, %</span>
              <input type="number" min="0" max="100" step="0.1" inputmode="decimal" id="set-tax" value="${c.taxPct}" />
            </label>
          </div>

          <div class="settings-block">
            <label class="settings-check">
              <input type="checkbox" id="set-rent-on" ${c.rentOn ? "checked" : ""} />
              <span>Учитывать аренду</span>
            </label>
            <label class="settings-field">
              <span>Аренда, ₽ / мес (на все месяцы)</span>
              <input type="number" min="0" step="1000" inputmode="numeric" id="set-rent" value="${Math.round(c.rentPerMonth)}" ${c.rentOn ? "" : "disabled"} />
            </label>
          </div>

          <div class="settings-block">
            <label class="settings-check">
              <input type="checkbox" id="set-admin-on" ${c.adminOn ? "checked" : ""} />
              <span>Учитывать администратора</span>
            </label>
            <label class="settings-field">
              <span>Админ, ₽ / мес</span>
              <input type="number" min="0" step="500" inputmode="numeric" id="set-admin" value="${Math.round(c.adminPerMonth)}" ${c.adminOn ? "" : "disabled"} />
            </label>
          </div>

          <button type="button" class="settings-apply" id="settings-apply">Применить</button>
          <p class="settings-note">Ставки сразу пересчитают KPI, график, месяцы и прогноз. Сохраняются в этом браузере.</p>
        </div>
      </details>`;
  }

  function bindPointSettings(pointId, rerender) {
    const panel = document.getElementById("settings-panel");
    if (panel) {
      panel.addEventListener("toggle", () => {
        setCostOpts(pointId, { open: panel.open });
      });
    }

    const rentOn = document.getElementById("set-rent-on");
    const adminOn = document.getElementById("set-admin-on");
    const rentInput = document.getElementById("set-rent");
    const adminInput = document.getElementById("set-admin");
    if (rentOn && rentInput) {
      rentOn.addEventListener("change", () => {
        rentInput.disabled = !rentOn.checked;
      });
    }
    if (adminOn && adminInput) {
      adminOn.addEventListener("change", () => {
        adminInput.disabled = !adminOn.checked;
      });
    }

    const apply = document.getElementById("settings-apply");
    if (!apply) return;
    apply.addEventListener("click", () => {
      const read = (id) => {
        const el = document.getElementById(id);
        return el ? Number(String(el.value).replace(/\s/g, "").replace(",", ".")) : NaN;
      };
      setForecastOn(!!document.getElementById("set-forecast")?.checked);
      setCostOpts(pointId, {
        rentOn: !!document.getElementById("set-rent-on")?.checked,
        adminOn: !!document.getElementById("set-admin-on")?.checked,
        fotPerDay: read("set-fot"),
        rentPerMonth: read("set-rent"),
        internetPerMonth: read("set-internet"),
        suppliesPerMonth: read("set-supplies"),
        adminPerMonth: read("set-admin"),
        taxPct: read("set-tax"),
        open: true,
      });
      rerender();
    });
  }

  function getMonthExcludeMap() {
    try {
      const raw = localStorage.getItem(MONTH_EXCLUDE_KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function getExcludedMonths(pointId) {
    const map = getMonthExcludeMap();
    const arr = map[pointId];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  }

  function setExcludedMonths(pointId, keys) {
    try {
      const map = getMonthExcludeMap();
      map[pointId] = [...new Set(keys)];
      localStorage.setItem(MONTH_EXCLUDE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }

  function toggleExcludedMonth(pointId, monthKey) {
    const cur = getExcludedMonths(pointId);
    const next = cur.includes(monthKey)
      ? cur.filter((k) => k !== monthKey)
      : [...cur, monthKey];
    setExcludedMonths(pointId, next);
    return next;
  }

  function activeMonths(months, pointId) {
    const excl = new Set(getExcludedMonths(pointId));
    return months.filter((m) => !excl.has(m.key));
  }

  function bindMonthFilterBar(pointId, rerender, allMonthKeys) {
    document.querySelectorAll(".filter-chip[data-month-key]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const key = btn.getAttribute("data-month-key");
        if (!key) return;
        toggleExcludedMonth(pointId, key);
        const left = allMonthKeys.filter((k) => !getExcludedMonths(pointId).includes(k));
        if (left.length === 0) {
          toggleExcludedMonth(pointId, key); // нельзя выключить все
          return;
        }
        rerender();
      });
    });
  }

  function toggleExcluded(id) {
    const cur = getExcludedIds();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    setExcludedIds(next);
    return next;
  }

  function activePoints(points) {
    const excluded = new Set(getExcludedIds());
    return points.filter((p) => !excluded.has(p.id));
  }

  function renderFilterBar(points, excluded) {
    const excl = new Set(excluded);
    const active = points.filter((p) => !excl.has(p.id)).length;
    const chips = points
      .map((p) => {
        const on = !excl.has(p.id);
        return `
          <button type="button" class="filter-chip ${on ? "on" : "off"}" data-point-id="${p.id}" aria-pressed="${on}">
            <span class="chip-mark">${on ? "✓" : "×"}</span>
            ${p.title}
          </button>`;
      })
      .join("");

    return `
      <div class="filter-bar">
        <div class="filter-bar-head">
          <strong>В общей статистике</strong>
          <span>${active} из ${points.length}</span>
        </div>
        <div class="filter-chips">${chips}</div>
      </div>`;
  }

  function bindFilterBar(rerender) {
    document.querySelectorAll(".filter-chip").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = btn.getAttribute("data-point-id");
        if (!id) return;
        toggleExcluded(id);
        // нельзя исключить все — оставляем хотя бы одну
        if (activePoints(window.PVZ_DATA.points).length === 0) {
          toggleExcluded(id); // вернуть
          return;
        }
        rerender();
      });
    });
  }

  function buildNetworkMonths(points) {
    const map = {};
    for (const p of points) {
      for (const m of buildMonths(p)) {
        if (!map[m.key]) {
          map[m.key] = {
            key: m.key,
            revenue: 0,
            subsidy: 0,
            fot: 0,
            rent: 0,
            internet: 0,
            supplies: 0,
            admin: 0,
            tax: 0,
            expenses: 0,
            net: 0,
            daysInMonth: m.daysInMonth,
            daysCovered: 0,
            partial: false,
            byPoint: [],
          };
        }
        const b = map[m.key];
        b.revenue += m.revenue;
        b.subsidy += m.subsidy || 0;
        b.fot += m.fot;
        b.rent += m.rent;
        b.internet += m.internet;
        b.supplies += m.supplies;
        b.admin += m.admin;
        b.tax += m.tax;
        b.expenses += m.expenses;
        b.net += m.net;
        b.daysCovered = Math.max(b.daysCovered, m.daysCovered);
        if (m.partial) b.partial = true;
        b.byPoint.push({
          id: p.id,
          title: p.title,
          file: p.file,
          revenue: m.revenue,
          expenses: m.expenses,
          net: m.net,
          subsidy: m.subsidy || 0,
        });
      }
    }
    return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1));
  }

  function renderProfitChart(monthsDesc, opts = {}) {
    const hist = chrono(monthsDesc);
    const forecast = Array.isArray(opts.forecast) ? opts.forecast : [];
    const data = [...hist, ...forecast.map((f) => ({ ...f, isForecast: true }))];
    if (hist.length < 2) {
      return `<div class="chart-empty">Мало данных для графика</div>`;
    }
    const title = opts.title || "Прибыль по месяцам";
    const subtitle =
      opts.subtitle ||
      (forecast.length
        ? "факт + прогноз · нажми точку — сумма"
        : "нажми на точку месяца — увидишь сумму");

    const w = 640;
    const h = 220;
    const padL = 48;
    const padR = 12;
    const padT = 16;
    const padB = 36;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const values = data.map((d) => d.net);
    let minV = Math.min(0, ...values);
    let maxV = Math.max(0, ...values);
    if (minV === maxV) {
      maxV += 1;
      minV -= 1;
    }
    const span = maxV - minV;
    minV -= span * 0.08;
    maxV += span * 0.08;

    const xAt = (i) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const yAt = (v) => padT + ((maxV - v) / (maxV - minV)) * plotH;
    const y0 = yAt(0);

    const histPts = hist.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.net).toFixed(1)}`).join(" ");
    const areaPoints = `${xAt(0).toFixed(1)},${y0.toFixed(1)} ${histPts} ${xAt(hist.length - 1).toFixed(1)},${y0.toFixed(1)}`;

    // линия прогноза от последней факт. точки
    let forecastLine = "";
    if (forecast.length) {
      const start = hist.length - 1;
      const fpts = [];
      for (let i = start; i < data.length; i++) {
        fpts.push(`${xAt(i).toFixed(1)},${yAt(data[i].net).toFixed(1)}`);
      }
      forecastLine = `<polyline points="${fpts.join(" ")}" class="chart-line-forecast" fill="none" />`;
    }

    const ticks = [minV, 0, maxV].filter((v, i, a) => a.indexOf(v) === i);
    const tickSvg = ticks
      .map((v) => {
        const y = yAt(v);
        const label =
          Math.abs(v) >= 1000
            ? `${v < 0 ? "−" : ""}${Math.round(Math.abs(v) / 1000)}к`
            : `${Math.round(v)}`;
        return `
          <line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" class="chart-grid" />
          <text x="${padL - 6}" y="${y + 3}" text-anchor="end" class="chart-axis">${label}</text>`;
      })
      .join("");

    const step = Math.max(1, Math.ceil(data.length / 6));
    const labels = data
      .map((d, i) => {
        if (i % step !== 0 && i !== data.length - 1 && !d.isForecast) return "";
        if (d.isForecast || i % step === 0 || i === hist.length - 1 || i === data.length - 1) {
          return `<text x="${xAt(i).toFixed(1)}" y="${h - 10}" text-anchor="middle" class="chart-axis${d.isForecast ? " forecast-label" : ""}">${monthShort(d.key)}</text>`;
        }
        return "";
      })
      .join("");

    const dots = data
      .map((d, i) => {
        const isF = !!d.isForecast;
        const cls = isF ? "dot-forecast" : d.net >= 0 ? "dot-plus" : "dot-minus";
        const cx = xAt(i).toFixed(1);
        const cy = yAt(d.net).toFixed(1);
        const monthLabel = monthTitle(d.key) + (isF ? " · прогноз" : "");
        const tip = `${d.net >= 0 ? "+" : ""}${moneyShort(d.net)}`;
        return `
          <g class="chart-hit" role="button" tabindex="0"
             data-month="${monthLabel}" data-net="${d.net}" data-tip="${tip}"
             transform="translate(${cx}, ${cy})">
            <circle r="16" class="hit-area" />
            <circle r="4.5" class="${cls} chart-dot" />
          </g>`;
      })
      .join("");

    const cta = opts.href
      ? `<a class="chart-cta" href="${opts.href}">Подробности по сети →</a>`
      : "";

    return `
      <div class="chart-wrap">
        <div class="chart-head">
          <strong>${title}</strong>
          <span>${subtitle}</span>
        </div>
        <div class="chart-value" hidden></div>
        <svg class="profit-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">
          ${tickSvg}
          <line x1="${padL}" y1="${y0.toFixed(1)}" x2="${w - padR}" y2="${y0.toFixed(1)}" class="chart-zero" />
          <polygon points="${areaPoints}" class="chart-area" />
          <polyline points="${histPts}" class="chart-line" fill="none" />
          ${forecastLine}
          ${labels}
          ${dots}
        </svg>
        ${cta}
      </div>`;
  }

  function renderForecastPanel(forecast, opts = {}) {
    if (!forecast?.ok || !forecast.months?.length) {
      return `<div class="forecast-panel"><p class="forecast-note">Прогноз недоступен: ${forecast?.reason || "нет данных"}</p></div>`;
    }
    const rows = forecast.months
      .map((m) => {
        const cls = m.net >= 0 ? "plus" : "minus";
        return `
          <div class="forecast-row">
            <div class="forecast-row-main">
              <strong>${monthTitle(m.key)}</strong>
              ${m.event ? `<span class="tag">${m.event}</span>` : ""}
            </div>
            <div class="forecast-row-nums">
              <span class="ms-rev">выр. ${moneyShort(m.revenue)}</span>
              <span class="ms-net ${cls}">${m.net >= 0 ? "+" : ""}${moneyShort(m.net)}</span>
            </div>
          </div>`;
      })
      .join("");

    const sumNet = forecast.months.reduce((a, m) => a + m.net, 0);
    const sumCls = sumNet >= 0 ? "plus" : "minus";

    return `
      <section class="forecast-panel">
        <div class="forecast-head">
          <div>
            <strong>${opts.title || "Прогноз на 3 месяца"}</strong>
            <p>Сезонность (школа, зима, BF/11.11, НГ…) + тренд + шок складов WB и восстановление.</p>
          </div>
          <div class="forecast-sum ${sumCls}">${sumNet >= 0 ? "+" : ""}${moneyShort(sumNet)}<small>за 3 мес.</small></div>
        </div>
        <div class="forecast-list">${rows}</div>
        <p class="forecast-note">Оценка, не гарантия. Учтены: календарь WB, ваш факт, удары по складам с июля 2026 и осенний подъём спроса.</p>
      </section>`;
  }

  function bindChartHits() {
    document.querySelectorAll(".chart-wrap").forEach((wrap) => {
      const valueEl = wrap.querySelector(".chart-value");
      if (!valueEl) return;

      const selectHit = (hit) => {
        wrap.querySelectorAll(".chart-hit").forEach((h) => h.classList.remove("selected"));
        hit.classList.add("selected");
        const month = hit.getAttribute("data-month") || "";
        const tip = hit.getAttribute("data-tip") || "";
        const net = Number(hit.getAttribute("data-net"));
        valueEl.hidden = false;
        valueEl.className = `chart-value ${net >= 0 ? "plus" : "minus"}`;
        valueEl.innerHTML = `<span class="cv-month">${month}</span><span class="cv-net">${tip}</span>`;
      };

      wrap.querySelectorAll(".chart-hit").forEach((hit) => {
        hit.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          selectHit(hit);
        });
        hit.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectHit(hit);
          }
        });
      });
    });
  }

  function renderIndex() {
    const root = document.getElementById("app");
    if (!root || !window.PVZ_DATA) return;
    const { points, meta } = window.PVZ_DATA;
    const excluded = getExcludedIds();
    const selected = activePoints(points);

    const stats = points.map((p) => {
      const months = buildMonths(p);
      const totalNet = months.reduce((a, m) => a + m.net, 0);
      const totalRev = months.reduce((a, m) => a + m.revenue, 0);
      const last = lastUsefulMonth(months);
      const profitable = months.filter((m) => m.net >= 0).length;
      return { p, months, totalNet, totalRev, last, profitable, inNetwork: !excluded.includes(p.id) };
    });

    const selectedStats = stats.filter((s) => s.inNetwork);
    const allNet = selectedStats.reduce((a, s) => a + s.totalNet, 0);
    const allRev = selectedStats.reduce((a, s) => a + s.totalRev, 0);
    const best =
      selectedStats.length > 0
        ? selectedStats.reduce((a, s) => (s.totalNet > a.totalNet ? s : a), selectedStats[0])
        : null;
    const networkMonths = buildNetworkMonths(selected);
    const showForecast = isForecastOn();
    const netForecast = showForecast
      ? window.PVZ_FORECAST?.forecastNetwork?.(selected, buildMonths, 3) || {
          ok: false,
        }
      : { ok: false, months: [] };
    const networkChart = renderProfitChart(networkMonths, {
      title: "Прибыль сети",
      subtitle: showForecast
        ? selected.length === points.length
          ? "факт + прогноз · подробности →"
          : `без ${points.length - selected.length} · факт + прогноз`
        : selected.length === points.length
          ? "только факт · подробности →"
          : `без ${points.length - selected.length} · только факт`,
      href: "network.html",
      forecast: showForecast && netForecast.ok ? netForecast.months : [],
    });
    const forecastPanel = showForecast
      ? renderForecastPanel(netForecast, { title: "Прогноз сети · чистый плюс" })
      : "";

    const cards = stats
      .map(({ p, totalNet, last, profitable, months, inNetwork }) => {
        const netCls = totalNet >= 0 ? "plus" : "minus";
        const lastNet = last ? last.net : 0;
        const lastCls = lastNet >= 0 ? "plus" : "minus";
        return `
          <div class="point-card ${inNetwork ? "" : "excluded"}">
            <button type="button" class="filter-chip mini ${inNetwork ? "on" : "off"}" data-point-id="${p.id}" aria-pressed="${inNetwork}" title="${inNetwork ? "Исключить из сети" : "Включить в сеть"}">
              <span class="chip-mark">${inNetwork ? "✓" : "×"}</span>
              ${inNetwork ? "в сети" : "вне сети"}
            </button>
            <a class="point-link" href="${p.file}">
              <div class="meta">
                <strong>${p.title}</strong>
                <div class="point-stats">
                  <span>Плюс за период <b class="${netCls}">${totalNet >= 0 ? "+" : ""}${moneyShort(totalNet)}</b></span>
                  <span>Последний мес. <b class="${lastCls}">${last ? (lastNet >= 0 ? "+" : "") + moneyShort(lastNet) : "—"}</b>${last ? ` · ${monthShort(last.key)}` : ""}</span>
                  <span>Месяцев в плюсе <b>${profitable} из ${months.length}</b></span>
                </div>
              </div>
              <span class="arrow">→</span>
            </a>
          </div>`;
      })
      .join("");

    root.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <strong>Wildberries · ПВЗ</strong>
          <small>Новосибирск</small>
        </div>
        <span class="badge">${meta.period || ""}</span>
      </div>
      <div class="toolbar-row">${renderForecastToggle()}</div>
      <section class="hero compact">
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка продаж (сеть)</span><span class="value">${moneyShort(allRev)}</span></div>
          <div class="kpi"><span class="label">Чистый плюс (сеть)</span><span class="value ${allNet >= 0 ? "plus" : "minus"}">${allNet >= 0 ? "+" : ""}${moneyShort(allNet)}</span></div>
          <div class="kpi"><span class="label">Лучшая в выборке</span><span class="value" style="font-size:0.92rem">${best?.p.title || "—"}</span></div>
        </div>
      </section>
      ${renderFilterBar(points, excluded)}
      ${networkChart}
      ${forecastPanel}
      <div class="section-title"><h2>Точки</h2><span>✓ / × — в сети или нет</span></div>
      <div class="point-list">${cards}</div>
    `;

    bindFilterBar(renderIndex);
    bindForecastToggle(renderIndex);
    bindChartHits();
  }

  function renderNetwork() {
    const root = document.getElementById("app");
    if (!root || !window.PVZ_DATA) return;
    const { points, meta } = window.PVZ_DATA;
    const shareOnly = isShareMode();
    const excluded = getExcludedIds();
    const selected = activePoints(points);
    const months = buildNetworkMonths(selected);
    const totalRev = months.reduce((a, m) => a + m.revenue, 0);
    const totalSubsidy = months.reduce((a, m) => a + m.subsidy, 0);
    const totalExp = months.reduce((a, m) => a + m.expenses, 0);
    const totalNet = months.reduce((a, m) => a + m.net, 0);
    const last = lastUsefulMonth(months);
    const profitable = months.filter((m) => m.net >= 0).length;
    const showForecast = isForecastOn();
    const netForecast = showForecast
      ? window.PVZ_FORECAST?.forecastNetwork?.(selected, buildMonths, 3) || {
          ok: false,
        }
      : { ok: false, months: [] };
    const chart = renderProfitChart(months, {
      title: "Прибыль сети",
      subtitle: showForecast
        ? selected.length === points.length
          ? "факт + прогноз · 3 мес."
          : `${selected.length} из ${points.length} · факт + прогноз`
        : selected.length === points.length
          ? "только факт"
          : `${selected.length} из ${points.length} · только факт`,
      forecast: showForecast && netForecast.ok ? netForecast.months : [],
    });
    const forecastPanel = showForecast
      ? renderForecastPanel(netForecast, { title: "Прогноз сети · чистый плюс" })
      : "";

    const monthCards = months
      .map((m) => {
        const netCls = m.net >= 0 ? "plus" : "minus";
        const pointRows = [...m.byPoint]
          .sort((a, b) => b.net - a.net)
          .map((p) => {
            const cls = p.net >= 0 ? "plus" : "minus";
            const link = shareOnly
              ? `<span class="name">${p.title}</span>`
              : `<a class="name point-inline" href="${p.file}">${p.title}</a>`;
            return `
              <div class="row">
                ${link}
                <span class="amount ${cls}">${p.net >= 0 ? "+" : ""}${moneyShort(p.net)}</span>
              </div>`;
          })
          .join("");

        return `
          <details class="card month-card">
            <summary class="month-summary">
              <div class="month-summary-main">
                <strong>${monthTitle(m.key)}</strong>
                ${m.partial ? `<span class="tag">есть неполные точки</span>` : ""}
              </div>
              <div class="month-summary-nums">
                <span class="ms-rev">${moneyShort(m.revenue)}</span>
                <span class="ms-net ${netCls}">${m.net >= 0 ? "+" : ""}${moneyShort(m.net)}</span>
              </div>
            </summary>
            <div class="month-body">
              <div class="rows">
                <div class="row revenue"><span class="name">Выручка (продажи)</span><span class="amount">${money(m.revenue)}</span></div>
                ${
                  m.subsidy > 0
                    ? `<div class="row revenue"><span class="name">Субсидия WB <em>(не продажи)</em></span><span class="amount">${money(m.subsidy)}</span></div>`
                    : ""
                }
                <div class="row cost"><span class="name">ФОТ</span><span class="amount">${money(m.fot)}</span></div>
                ${m.rent > 0 ? `<div class="row cost"><span class="name">Аренда</span><span class="amount">${money(m.rent)}</span></div>` : ""}
                <div class="row cost"><span class="name">Интернет</span><span class="amount">${money(m.internet)}</span></div>
                <div class="row cost"><span class="name">Расходники</span><span class="amount">${money(m.supplies)}</span></div>
                ${m.admin > 0 ? `<div class="row cost"><span class="name">Администратор</span><span class="amount">${money(m.admin)}</span></div>` : ""}
                <div class="row cost"><span class="name">Налоги (6%)</span><span class="amount">${money(m.tax)}</span></div>
                <div class="row cost"><span class="name">Расходы всего</span><span class="amount">${money(m.expenses)}</span></div>
                <div class="row net ${m.net < 0 ? "negative" : ""}"><span class="name">Чистый плюс сети</span><span class="amount ${netCls}">${m.net >= 0 ? "+" : ""}${money(m.net)}</span></div>
              </div>
              <div class="week-block-title">По точкам</div>
              <div class="rows">${pointRows}</div>
            </div>
          </details>`;
      })
      .join("");

    root.innerHTML = `
      <div class="page-actions">
        ${
          shareOnly
            ? `<span class="share-hint">Только сеть · без списка ПВЗ</span>`
            : `<a class="back" href="index.html">← На главную</a>`
        }
        ${
          shareOnly
            ? ""
            : `<button type="button" class="share-btn" id="share-btn" aria-label="Поделиться">Поделиться</button>`
        }
      </div>
      <div class="topbar">
        <div class="brand">
          <strong>Сеть</strong>
          <small>${selected.length} из ${points.length} ПВЗ · ${meta.period || ""}</small>
        </div>
        <span class="badge">${months.length} мес.</span>
      </div>
      ${shareOnly ? "" : `<div class="toolbar-row">${renderForecastToggle()}</div>`}
      ${shareOnly ? "" : renderFilterBar(points, excluded)}
      <section class="hero compact">
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка (продажи)</span><span class="value">${moneyShort(totalRev)}</span></div>
          <div class="kpi"><span class="label">Расходы</span><span class="value">${moneyShort(totalExp)}</span></div>
          <div class="kpi"><span class="label">Плюс сети</span><span class="value ${totalNet >= 0 ? "plus" : "minus"}">${totalNet >= 0 ? "+" : ""}${moneyShort(totalNet)}</span></div>
          <div class="kpi"><span class="label">Последний мес.</span><span class="value ${last && last.net >= 0 ? "plus" : "minus"}">${last ? (last.net >= 0 ? "+" : "") + moneyShort(last.net) : "—"}</span></div>
          <div class="kpi"><span class="label">В плюсе</span><span class="value">${profitable}/${months.length}</span></div>
          ${
            totalSubsidy > 0
              ? `<div class="kpi"><span class="label">Субсидии WB</span><span class="value">${moneyShort(totalSubsidy)}</span></div>`
              : `<div class="kpi"><span class="label">Месяц</span><span class="value" style="font-size:0.9rem">${last ? monthShort(last.key) : "—"}</span></div>`
          }
        </div>
      </section>
      ${chart}
      ${forecastPanel}
      <div class="section-title"><h2>Месяцы сети</h2><span>нажми, чтобы открыть</span></div>
      <div class="cards">${monthCards}</div>
    `;

    if (!shareOnly) {
      const btn = document.getElementById("share-btn");
      if (btn) btn.addEventListener("click", () => copyShareLink(btn));
      bindFilterBar(renderNetwork);
      bindForecastToggle(renderNetwork);
    }
    if (shareOnly) document.body.classList.add("share-only");
    bindChartHits();
  }

  function isShareMode() {
    try {
      return new URLSearchParams(location.search).get("share") === "1";
    } catch {
      return false;
    }
  }

  function shareUrlForCurrentPage() {
    const u = new URL(location.href);
    u.searchParams.set("share", "1");
    // убираем лишний hash
    u.hash = "";
    return u.toString();
  }

  async function copyShareLink(btn) {
    const url = shareUrlForCurrentPage();
    try {
      if (navigator.share) {
        await navigator.share({
          title: document.title,
          text: "Отчёт ПВЗ",
          url,
        });
        return;
      }
    } catch (e) {
      // пользователь отменил share — не падаем, пробуем copy
      if (e && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = "Ссылка скопирована";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = prev;
          btn.classList.remove("copied");
        }, 1800);
      }
    } catch {
      prompt("Скопируйте ссылку:", url);
    }
  }

  function renderPoint(pointId) {
    const root = document.getElementById("app");
    const point = window.PVZ_DATA?.points?.find((p) => p.id === pointId);
    if (!root || !point) return;

    const shareOnly = isShareMode();
    const monthsAll = buildMonths(point);
    const excludedMonths = getExcludedMonths(pointId);
    const exclSet = new Set(excludedMonths);
    const months = activeMonths(monthsAll, pointId);
    const rate = fotDay(point);
    const totalRev = months.reduce((a, m) => a + m.revenue, 0);
    const totalSubsidy = months.reduce((a, m) => a + m.subsidy, 0);
    const totalExp = months.reduce((a, m) => a + m.expenses, 0);
    const totalNet = months.reduce((a, m) => a + m.net, 0);
    const last = lastUsefulMonth(months);
    const profitable = months.filter((m) => m.net >= 0).length;

    const showForecast = isForecastOn();
    const pointForecast = showForecast
      ? window.PVZ_FORECAST?.forecastPoint?.(point, months, 3) || { ok: false }
      : { ok: false, months: [] };
    const chart = renderProfitChart(months, {
      title: "Прибыль по месяцам",
      subtitle: showForecast
        ? exclSet.size
          ? `факт + прогноз · без ${exclSet.size} мес.`
          : "факт + прогноз · нажми точку — сумма"
        : exclSet.size
          ? `только факт · без ${exclSet.size} мес.`
          : "только факт · нажми точку — сумма",
      forecast: showForecast && pointForecast.ok ? pointForecast.months : [],
    });
    const forecastPanel = showForecast
      ? renderForecastPanel(pointForecast, { title: `Прогноз · ${point.title}` })
      : "";

    const monthCards = monthsAll
      .map((m) => {
        const inStats = !exclSet.has(m.key);
        const netCls = m.net >= 0 ? "plus" : "minus";
        const weeks = m.weeks
          .map((w) => {
            if (w.subsidy > 0) {
              const splitHint = w.split ? ` (${w.days} дн.)` : "";
              return `
            <div class="row">
              <span class="name">${w.period}${splitHint} · продажи</span>
              <span class="amount">${money(w.revenue)}</span>
            </div>
            <div class="row">
              <span class="name">${w.period}${splitHint} · <em>субсидия WB 180к, не продажи</em></span>
              <span class="amount">${money(w.subsidy)}</span>
            </div>`;
            }
            const note = w.note ? ` · ${w.note}` : "";
            return `
            <div class="row">
              <span class="name">${w.period}${w.split ? ` (${w.days} дн.)` : ""}${note}</span>
              <span class="amount">${money(w.revenue)}</span>
            </div>`;
          })
          .join("");

        return `
          <div class="month-card-wrap ${inStats ? "" : "excluded"}">
            ${
              shareOnly
                ? ""
                : `<button type="button" class="filter-chip mini ${inStats ? "on" : "off"}" data-month-key="${m.key}" aria-pressed="${inStats}" title="${inStats ? "Исключить из статистики" : "Включить в статистику"}">
              <span class="chip-mark">${inStats ? "✓" : "×"}</span>
              ${inStats ? "в статистике" : "вне статистики"}
            </button>`
            }
            <details class="card month-card">
              <summary class="month-summary">
                <div class="month-summary-main">
                  <strong>${monthTitle(m.key)}</strong>
                  ${m.partial ? `<span class="tag">неполный · ${m.daysCovered} дн.</span>` : ""}
                  ${!inStats ? `<span class="tag">не в KPI / графике</span>` : ""}
                </div>
                <div class="month-summary-nums">
                  <span class="ms-rev">${moneyShort(m.revenue)}</span>
                  <span class="ms-net ${netCls}">${m.net >= 0 ? "+" : ""}${moneyShort(m.net)}</span>
                </div>
              </summary>
              <div class="month-body">
                <div class="rows">
                  <div class="row revenue"><span class="name">Выручка (продажи)</span><span class="amount">${money(m.revenue)}</span></div>
                  ${
                    m.subsidy > 0
                      ? `<div class="row revenue"><span class="name">Субсидия WB <em>(не продажи)</em></span><span class="amount">${money(m.subsidy)}</span></div>`
                      : ""
                  }
                  <div class="row cost"><span class="name">ФОТ (${moneyShort(rate)} × ${m.daysCovered})</span><span class="amount">${money(m.fot)}</span></div>
                  ${m.rentOn ? `<div class="row cost"><span class="name">Аренда${m.partial ? ` (${m.daysCovered}/${m.daysInMonth})` : ""}</span><span class="amount">${money(m.rent)}</span></div>` : ""}
                  <div class="row cost"><span class="name">Интернет</span><span class="amount">${money(m.internet)}</span></div>
                  <div class="row cost"><span class="name">Расходники</span><span class="amount">${money(m.supplies)}</span></div>
                  ${m.adminOn ? `<div class="row cost"><span class="name">Администратор</span><span class="amount">${money(m.admin)}</span></div>` : ""}
                  <div class="row cost"><span class="name">Налоги (${m.taxPct}% от выручки)</span><span class="amount">${money(m.tax)}</span></div>
                  <div class="row cost"><span class="name">Расходы всего</span><span class="amount">${money(m.expenses)}</span></div>
                  <div class="row net ${m.net < 0 ? "negative" : ""}"><span class="name">Чистый плюс</span><span class="amount ${netCls}">${m.net >= 0 ? "+" : ""}${money(m.net)}</span></div>
                </div>
                <div class="week-block-title">По неделям</div>
                <div class="rows">${weeks}</div>
              </div>
            </details>
          </div>`;
      })
      .join("");

    root.innerHTML = `
      <div class="page-actions">
        ${
          shareOnly
            ? `<span class="share-hint">Только эта точка · без списка ПВЗ</span>`
            : `<a class="back" href="index.html">← Все точки</a>`
        }
        ${
          shareOnly
            ? ""
            : `<button type="button" class="share-btn" id="share-btn" aria-label="Поделиться">Поделиться</button>`
        }
      </div>
      <div class="topbar">
        <div class="brand">
          <strong>${point.title}</strong>
          <small>${point.address}</small>
        </div>
        <span class="badge">${months.length}/${monthsAll.length} мес.</span>
      </div>
      ${shareOnly ? "" : renderPointSettings(point)}
      <section class="hero compact">
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка (продажи)</span><span class="value">${moneyShort(totalRev)}</span></div>
          <div class="kpi"><span class="label">Расходы</span><span class="value">${moneyShort(totalExp)}</span></div>
          <div class="kpi"><span class="label">Плюс</span><span class="value ${totalNet >= 0 ? "plus" : "minus"}">${totalNet >= 0 ? "+" : ""}${moneyShort(totalNet)}</span></div>
          <div class="kpi"><span class="label">Последний мес.</span><span class="value ${last && last.net >= 0 ? "plus" : "minus"}">${last ? (last.net >= 0 ? "+" : "") + moneyShort(last.net) : "—"}</span></div>
          <div class="kpi"><span class="label">В плюсе</span><span class="value">${profitable}/${months.length}</span></div>
          ${
            totalSubsidy > 0
              ? `<div class="kpi"><span class="label">Субсидии WB</span><span class="value">${moneyShort(totalSubsidy)}</span></div>`
              : `<div class="kpi"><span class="label">Месяц</span><span class="value" style="font-size:0.9rem">${last ? monthShort(last.key) : "—"}</span></div>`
          }
        </div>
      </section>

      ${chart}
      ${forecastPanel}

      <div class="section-title"><h2>Месяцы</h2><span>✓ / × у карточки — в статистике</span></div>
      <div class="cards">${monthCards}</div>
    `;

    if (!shareOnly) {
      const btn = document.getElementById("share-btn");
      if (btn) {
        btn.addEventListener("click", () => copyShareLink(btn));
      }
      bindPointSettings(pointId, () => renderPoint(pointId));
      bindMonthFilterBar(
        pointId,
        () => renderPoint(pointId),
        monthsAll.map((m) => m.key)
      );
    }

    // в режиме share — не даём «случайно» уйти на index через history, если открыли с share
    if (shareOnly) {
      document.body.classList.add("share-only");
    }
    bindChartHits();
  }

  window.renderIndex = renderIndex;
  window.renderPoint = renderPoint;
  window.renderNetwork = renderNetwork;
})();
