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

  const fotDay = (point) => Number(point.costs?.fotPerDay) || 0;
  const rentMonth = (point) => Number(point.costs?.rentPerMonth) || 0;
  const internetMonth = (point) => Number(point.costs?.internetPerMonth) || 0;
  const suppliesMonth = (point) => Number(point.costs?.suppliesPerMonth) || 0;
  const adminMonth = (point) => Number(point.costs?.adminPerMonth) || 0;

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

    const rentFull = rentMonth(point);
    const netFull = internetMonth(point);
    const supFull = suppliesMonth(point);
    const admFull = adminMonth(point);

    return Object.values(map)
      .map((m) => {
        const fot = rate * m.daysCovered;
        const rent = proRate(rentFull, m.daysCovered, m.daysInMonth);
        const internet = proRate(netFull, m.daysCovered, m.daysInMonth);
        const supplies = proRate(supFull, m.daysCovered, m.daysInMonth);
        const admin = proRate(admFull, m.daysCovered, m.daysInMonth);
        const tax = m.revenue * 0.06; // 6% только от выручки продаж
        const expenses = fot + rent + internet + supplies + admin + tax;
        // субсидия — отдельный доход, не продажи; в плюс входит
        const net = m.revenue + m.subsidy - expenses;
        return {
          ...m,
          fot,
          rent,
          internet,
          supplies,
          admin,
          tax,
          expenses,
          net,
          rate,
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

  function renderProfitChart(monthsDesc) {
    const data = chrono(monthsDesc);
    if (data.length < 2) {
      return `<div class="chart-empty">Мало данных для графика</div>`;
    }

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
    // padding 8%
    const span = maxV - minV;
    minV -= span * 0.08;
    maxV += span * 0.08;

    const xAt = (i) => padL + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    const yAt = (v) => padT + ((maxV - v) / (maxV - minV)) * plotH;
    const y0 = yAt(0);

    const points = data.map((d, i) => `${xAt(i).toFixed(1)},${yAt(d.net).toFixed(1)}`).join(" ");
    const areaPoints = `${xAt(0).toFixed(1)},${y0.toFixed(1)} ${points} ${xAt(data.length - 1).toFixed(1)},${y0.toFixed(1)}`;

    // grid labels
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

    // show ~5 labels on x
    const step = Math.max(1, Math.ceil(data.length / 5));
    const labels = data
      .map((d, i) => {
        if (i % step !== 0 && i !== data.length - 1) return "";
        return `<text x="${xAt(i).toFixed(1)}" y="${h - 10}" text-anchor="middle" class="chart-axis">${monthShort(d.key)}</text>`;
      })
      .join("");

    const dots = data
      .map((d, i) => {
        const cls = d.net >= 0 ? "dot-plus" : "dot-minus";
        return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.net).toFixed(1)}" r="4" class="${cls}" />`;
      })
      .join("");

    return `
      <div class="chart-wrap">
        <div class="chart-head">
          <strong>Прибыль по месяцам</strong>
          <span>выше 0 — в плюсе, ниже — убыток</span>
        </div>
        <svg class="profit-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="График прибыли по месяцам">
          ${tickSvg}
          <line x1="${padL}" y1="${y0.toFixed(1)}" x2="${w - padR}" y2="${y0.toFixed(1)}" class="chart-zero" />
          <polygon points="${areaPoints}" class="chart-area" />
          <polyline points="${points}" class="chart-line" fill="none" />
          ${dots}
          ${labels}
        </svg>
      </div>`;
  }

  function renderIndex() {
    const root = document.getElementById("app");
    if (!root || !window.PVZ_DATA) return;
    const { points, meta } = window.PVZ_DATA;

    const stats = points.map((p) => {
      const months = buildMonths(p);
      const totalNet = months.reduce((a, m) => a + m.net, 0);
      const totalRev = months.reduce((a, m) => a + m.revenue, 0);
      const last = lastUsefulMonth(months);
      const profitable = months.filter((m) => m.net >= 0).length;
      return { p, months, totalNet, totalRev, last, profitable };
    });

    const allNet = stats.reduce((a, s) => a + s.totalNet, 0);
    const allRev = stats.reduce((a, s) => a + s.totalRev, 0); // только продажи
    const best = stats.reduce((a, s) => (s.totalNet > a.totalNet ? s : a), stats[0]);

    const cards = stats
      .map(({ p, totalNet, last, profitable, months }) => {
        const netCls = totalNet >= 0 ? "plus" : "minus";
        const lastNet = last ? last.net : 0;
        const lastCls = lastNet >= 0 ? "plus" : "minus";
        return `
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
          </a>`;
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
      <section class="hero compact">
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка продаж (все)</span><span class="value">${moneyShort(allRev)}</span></div>
          <div class="kpi"><span class="label">Чистый плюс</span><span class="value ${allNet >= 0 ? "plus" : "minus"}">${allNet >= 0 ? "+" : ""}${moneyShort(allNet)}</span></div>
          <div class="kpi"><span class="label">Лучшая точка</span><span class="value" style="font-size:0.92rem">${best?.p.title || "—"}</span></div>
        </div>
      </section>
      <div class="section-title"><h2>Точки</h2><span>открыть отчёт</span></div>
      <div class="point-list">${cards}</div>
    `;
  }

  function renderPoint(pointId) {
    const root = document.getElementById("app");
    const point = window.PVZ_DATA?.points?.find((p) => p.id === pointId);
    if (!root || !point) return;

    const months = buildMonths(point);
    const rate = fotDay(point);
    const totalRev = months.reduce((a, m) => a + m.revenue, 0);
    const totalSubsidy = months.reduce((a, m) => a + m.subsidy, 0);
    const totalExp = months.reduce((a, m) => a + m.expenses, 0);
    const totalNet = months.reduce((a, m) => a + m.net, 0);
    const last = lastUsefulMonth(months);
    const profitable = months.filter((m) => m.net >= 0).length;

    const chart = renderProfitChart(months);

    const monthCards = months
      .map((m) => {
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
          <details class="card month-card">
            <summary class="month-summary">
              <div class="month-summary-main">
                <strong>${monthTitle(m.key)}</strong>
                ${m.partial ? `<span class="tag">неполный · ${m.daysCovered} дн.</span>` : ""}
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
                ${m.rent > 0 ? `<div class="row cost"><span class="name">Аренда</span><span class="amount">${money(m.rent)}</span></div>` : ""}
                <div class="row cost"><span class="name">Интернет</span><span class="amount">${money(m.internet)}</span></div>
                <div class="row cost"><span class="name">Расходники</span><span class="amount">${money(m.supplies)}</span></div>
                <div class="row cost"><span class="name">Администратор</span><span class="amount">${money(m.admin)}</span></div>
                <div class="row cost"><span class="name">Налоги (6% от выручки)</span><span class="amount">${money(m.tax)}</span></div>
                <div class="row cost"><span class="name">Расходы всего</span><span class="amount">${money(m.expenses)}</span></div>
                <div class="row net ${m.net < 0 ? "negative" : ""}"><span class="name">Чистый плюс</span><span class="amount ${netCls}">${m.net >= 0 ? "+" : ""}${money(m.net)}</span></div>
              </div>
              <div class="week-block-title">По неделям</div>
              <div class="rows">${weeks}</div>
            </div>
          </details>`;
      })
      .join("");

    root.innerHTML = `
      <a class="back" href="index.html">← Все точки</a>
      <div class="topbar">
        <div class="brand">
          <strong>${point.title}</strong>
          <small>${point.address}</small>
        </div>
        <span class="badge">${months.length} мес.</span>
      </div>
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

      <div class="section-title"><h2>Месяцы</h2><span>нажми, чтобы открыть</span></div>
      <div class="cards">${monthCards}</div>
    `;
  }

  window.renderIndex = renderIndex;
  window.renderPoint = renderPoint;
})();
