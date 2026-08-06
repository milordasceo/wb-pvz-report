(function () {
  const MONTHS_RU = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
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

  const sum = (arr, key) => arr.reduce((a, x) => a + (Number(x[key]) || 0), 0);

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

  const fotDay = (point) => Number(point.costs?.fotPerDay) || 0;
  const rentMonth = (point) => Number(point.costs?.rentPerMonth) || 0;
  const internetMonth = (point) => Number(point.costs?.internetPerMonth) || 0;
  const suppliesMonth = (point) => Number(point.costs?.suppliesPerMonth) || 0;
  const adminMonth = (point) => Number(point.costs?.adminPerMonth) || 0;

  /** Месячная статья × доля дней покрытия */
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
    return Object.keys(dayMap).sort().map((key) => ({
      key,
      days: dayMap[key],
      revenue: (week.revenue * dayMap[key]) / totalDays,
      week,
    }));
  }

  function buildMonths(point) {
    const map = {};
    const rate = fotDay(point);

    for (const week of point.weeks) {
      for (const part of allocateWeekByMonths(week)) {
        if (!map[part.key]) {
          const [y, m] = part.key.split("-").map(Number);
          map[part.key] = {
            key: part.key,
            revenue: 0,
            daysCovered: 0,
            daysInMonth: daysInMonth(y, m - 1),
            weeks: [],
          };
        }
        const b = map[part.key];
        b.revenue += part.revenue;
        b.daysCovered += part.days;
        b.weeks.push({
          period: week.period,
          days: part.days,
          revenue: part.revenue,
          split: Object.keys(
            (() => {
              const s = parseDate(week.from);
              const e = parseDate(week.to);
              const keys = new Set();
              for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
                keys.add(monthKey(d.getFullYear(), d.getMonth()));
              }
              return Object.fromEntries([...keys].map((k) => [k, 1]));
            })()
          ).length > 1,
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
        const expenses = fot + rent + internet + supplies + admin;
        return {
          ...m,
          fot,
          rent,
          internet,
          supplies,
          admin,
          expenses,
          net: m.revenue - expenses,
          rate,
        };
      })
      .sort((a, b) => (a.key < b.key ? 1 : -1));
  }

  function renderIndex() {
    const root = document.getElementById("app");
    if (!root || !window.PVZ_DATA) return;
    const { points, meta } = window.PVZ_DATA;

    const cards = points
      .map((p) => {
        const months = buildMonths(p);
        const net = months.reduce((a, m) => a + m.net, 0);
        return `
          <a class="point-link" href="${p.file}">
            <div class="meta">
              <strong>${p.title}</strong>
              <small>ФОТ ${moneyShort(fotDay(p))}/день · плюс за период ${moneyShort(net)}</small>
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
      <section class="hero">
        <h1>4 точки</h1>
        <p>Месяц → выручка, расходы, плюс. Подробности — по нажатию.</p>
      </section>
      <div class="point-list">${cards}</div>
      <p class="footer">На каждой: интернет 4 500 · расходники 5 000 · админ 15 000 ₽/мес</p>
    `;
  }

  function renderPoint(pointId) {
    const root = document.getElementById("app");
    const point = window.PVZ_DATA?.points?.find((p) => p.id === pointId);
    if (!root || !point) return;

    const months = buildMonths(point);
    const rate = fotDay(point);
    const totalRev = months.reduce((a, m) => a + m.revenue, 0);
    const totalExp = months.reduce((a, m) => a + m.expenses, 0);
    const totalNet = totalRev - totalExp;

    const monthCards = months
      .map((m, idx) => {
        const netCls = m.net >= 0 ? "plus" : "minus";
        const partial = m.daysCovered < m.daysInMonth;
        const weeks = m.weeks
          .map(
            (w) => `
            <div class="row">
              <span class="name">${w.period}${w.split ? ` (${w.days} дн.)` : ""}</span>
              <span class="amount">${money(w.revenue)}</span>
            </div>`
          )
          .join("");

        return `
          <details class="card month-card" ${idx === 0 ? "" : ""}>
            <summary class="month-summary">
              <div class="month-summary-main">
                <strong>${monthTitle(m.key)}</strong>
                ${partial ? `<span class="tag">неполный · ${m.daysCovered} дн.</span>` : ""}
              </div>
              <div class="month-summary-nums">
                <span class="ms-rev">${moneyShort(m.revenue)}</span>
                <span class="ms-net ${netCls}">${m.net >= 0 ? "+" : ""}${moneyShort(m.net)}</span>
              </div>
            </summary>
            <div class="month-body">
              <div class="rows">
                <div class="row revenue"><span class="name">Выручка</span><span class="amount">${money(m.revenue)}</span></div>
                <div class="row cost"><span class="name">ФОТ (${moneyShort(rate)} × ${m.daysCovered})</span><span class="amount">${money(m.fot)}</span></div>
                <div class="row cost"><span class="name">Аренда</span><span class="amount">${money(m.rent)}</span></div>
                <div class="row cost"><span class="name">Интернет</span><span class="amount">${money(m.internet)}</span></div>
                <div class="row cost"><span class="name">Расходники</span><span class="amount">${money(m.supplies)}</span></div>
                <div class="row cost"><span class="name">Администратор</span><span class="amount">${money(m.admin)}</span></div>
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
          <small>ФОТ ${moneyShort(rate)}/день · фикс. ${moneyShort(rentMonth(point) + internetMonth(point) + suppliesMonth(point) + adminMonth(point))}/мес</small>
        </div>
        <span class="badge">${months.length} мес.</span>
      </div>
      <section class="hero compact">
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка</span><span class="value">${moneyShort(totalRev)}</span></div>
          <div class="kpi"><span class="label">Расходы</span><span class="value">${moneyShort(totalExp)}</span></div>
          <div class="kpi"><span class="label">Плюс</span><span class="value ${totalNet >= 0 ? "plus" : "minus"}">${totalNet >= 0 ? "+" : ""}${moneyShort(totalNet)}</span></div>
        </div>
      </section>
      <div class="section-title"><h2>Месяцы</h2><span>нажми, чтобы открыть</span></div>
      <div class="cards">${monthCards}</div>
      <p class="footer">Расходы = ФОТ + аренда + интернет + расходники + админ. Неполный месяц — пропорционально дням.</p>
    `;
  }

  window.renderIndex = renderIndex;
  window.renderPoint = renderPoint;
})();
