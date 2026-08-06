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

  const sum = (arr, key) => arr.reduce((a, x) => a + (Number(x[key]) || 0), 0);

  const parseDate = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const ymd = (dt) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

  const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

  const monthKey = (year, monthIndex) =>
    `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  const monthTitle = (key) => {
    const [y, m] = key.split("-").map(Number);
    const name = MONTHS_RU[m - 1];
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
  };

  /** Разбивает недельную выручку по календарным месяцам пропорционально дням */
  function allocateWeekByMonths(week) {
    const start = parseDate(week.from);
    const end = parseDate(week.to);
    const dayMap = {}; // key -> day count
    let totalDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = monthKey(d.getFullYear(), d.getMonth());
      dayMap[key] = (dayMap[key] || 0) + 1;
      totalDays += 1;
    }
    if (totalDays === 0) return [];
    return Object.keys(dayMap)
      .sort()
      .map((key) => ({
        key,
        days: dayMap[key],
        revenue: (week.revenue * dayMap[key]) / totalDays,
        week,
      }));
  }

  /** Месяцы точки: выручка, дни покрытия, недели */
  function buildMonths(point) {
    const map = {};

    for (const week of point.weeks) {
      const parts = allocateWeekByMonths(week);
      for (const part of parts) {
        if (!map[part.key]) {
          const [y, m] = part.key.split("-").map(Number);
          map[part.key] = {
            key: part.key,
            year: y,
            monthIndex: m - 1,
            revenue: 0,
            daysCovered: 0,
            daysInMonth: daysInMonth(y, m - 1),
            weeks: [],
          };
        }
        const bucket = map[part.key];
        bucket.revenue += part.revenue;
        bucket.daysCovered += part.days;
        bucket.weeks.push({
          period: week.period,
          from: week.from,
          to: week.to,
          weekRevenue: week.revenue,
          daysInMonth: part.days,
          revenueInMonth: part.revenue,
          note: week.note || null,
          split: parts.length > 1,
        });
      }
    }

    return Object.values(map).sort((a, b) => (a.key < b.key ? 1 : -1)); // new first
  }

  function renderIndex() {
    const root = document.getElementById("app");
    if (!root || !window.PVZ_DATA) return;
    const { points, meta } = window.PVZ_DATA;

    const cards = points
      .map((p) => {
        const months = buildMonths(p);
        const rev = sum(p.weeks, "revenue");
        const monthLines = months
          .map((m) => `${monthTitle(m.key)}: ${money(m.revenue)}`)
          .join(" · ");
        return `
          <a class="point-link" href="${p.file}">
            <div class="meta">
              <strong>${p.title}</strong>
              <small>ПВЗ #${p.code} · всего ${money(rev)}</small>
              <small class="month-preview">${monthLines}</small>
            </div>
            <span class="arrow">→</span>
          </a>`;
      })
      .join("");

    const mergeLines = (meta.merges || []).map((m) => `• ${m}`).join("<br>");

    root.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <strong>Wildberries · ПВЗ</strong>
          <small>Новосибирск · выручка по месяцам</small>
        </div>
        <span class="badge">16 мар – 2 авг 2026</span>
      </div>
      <section class="hero">
        <h1>4 пункта выдачи</h1>
        <p>Отчёт сгруппирован <strong>по месяцам</strong>. Недели, пересекающие границу месяца, делятся по дням.</p>
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Точек</span><span class="value">4</span></div>
          <div class="kpi"><span class="label">Месяцев</span><span class="value">6</span></div>
          <div class="kpi"><span class="label">Затраты</span><span class="value">ждут</span></div>
        </div>
      </section>
      <div class="section-title"><h2>Точки</h2><span>открыть отчёт</span></div>
      <div class="point-list">${cards}</div>
      <div class="note">
        ${meta.note}<br><br>${mergeLines}<br><br>
        <strong>Как считается месяц:</strong> сумма долей недельной выручки, попавших в календарный месяц (пропорция по дням).
      </div>
      <p class="footer">WB ПВЗ · Новосибирск</p>
    `;
  }

  function renderPoint(pointId) {
    const root = document.getElementById("app");
    const point = window.PVZ_DATA?.points?.find((p) => p.id === pointId);
    if (!root || !point) return;

    const months = buildMonths(point);
    const totalRev = sum(point.weeks, "revenue");
    const fullMonths = months.filter((m) => m.daysCovered >= m.daysInMonth);
    const bestMonth = months.reduce(
      (a, b) => (b.revenue > (a?.revenue || -Infinity) ? b : a),
      null
    );

    const monthCards = months
      .map((m) => {
        const partial = m.daysCovered < m.daysInMonth;
        const perDay = m.daysCovered > 0 ? m.revenue / m.daysCovered : 0;
        const fullEstimate = perDay * m.daysInMonth;
        const coverage = `${m.daysCovered} из ${m.daysInMonth} дн.`;

        const weekRows = m.weeks
          .map((w) => {
            const splitHint = w.split
              ? ` · ${w.daysInMonth} дн. в этом месяце`
              : "";
            const note = w.note ? ` · ${w.note}` : "";
            return `
              <div class="row">
                <span class="name">${w.period}${splitHint}${note}</span>
                <span class="amount">${money(w.revenueInMonth)}</span>
              </div>`;
          })
          .join("");

        return `
          <article class="card month-card">
            <div class="card-head">
              <div>
                <h3>${monthTitle(m.key)}</h3>
                <span class="week-range">${coverage}${partial ? " · неполный месяц" : " · полный месяц"}</span>
              </div>
              <span class="profit-pill" style="color:#c8bfff;background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.35)">
                ${money(m.revenue)}
              </span>
            </div>
            <div class="rows">
              <div class="row revenue">
                <span class="name">Выручка за месяц</span>
                <span class="amount">${money(m.revenue)}</span>
              </div>
              ${
                partial
                  ? `<div class="row">
                      <span class="name">Оценка на полный месяц (день × ${m.daysInMonth})</span>
                      <span class="amount">${money(fullEstimate)}</span>
                    </div>`
                  : ""
              }
              <div class="week-block-title">Недели в составе</div>
              ${weekRows}
            </div>
          </article>`;
      })
      .join("");

    root.innerHTML = `
      <a class="back" href="index.html">← Все точки</a>
      <div class="topbar">
        <div class="brand">
          <strong>${point.title}</strong>
          <small>ПВЗ #${point.code} · ${point.address}</small>
        </div>
        <span class="badge">${months.length} мес.</span>
      </div>
      <section class="hero">
        <h1>Выручка по месяцам</h1>
        <p>Сводка: месяц → сумма. Ниже — из каких недель она сложилась.</p>
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Всего за период</span><span class="value">${money(totalRev)}</span></div>
          <div class="kpi"><span class="label">Месяцев</span><span class="value">${months.length}</span></div>
          <div class="kpi"><span class="label">Полных месяцев</span><span class="value">${fullMonths.length}</span></div>
          <div class="kpi"><span class="label">Лучший месяц</span><span class="value" style="font-size:0.9rem">${bestMonth ? monthTitle(bestMonth.key) : "—"}</span></div>
          <div class="kpi"><span class="label">Сумма лучшего</span><span class="value">${bestMonth ? money(bestMonth.revenue) : "—"}</span></div>
          <div class="kpi"><span class="label">Чистый плюс</span><span class="value">ждём затраты</span></div>
        </div>
      </section>

      <div class="section-title">
        <h2>Месяцы</h2>
        <span>новые сверху</span>
      </div>
      <div class="cards">${monthCards}</div>

      <div class="note">
        <strong>Месячная выручка</strong> = сумма долей недельных выплат, попавших в календарный месяц (деление по дням, если неделя на стыке).<br>
        <strong>Неполный месяц</strong> (март с 16-го, август до 2-го): показана фактическая сумма и оценка «на полный месяц» = (факт / дни покрытия) × дней в месяце.<br>
        Затраты (ФОТ, интернет, расходники, аренда) пока не внесены.
      </div>
      <p class="footer">${point.title} · #${point.code}</p>
    `;
  }

  window.renderIndex = renderIndex;
  window.renderPoint = renderPoint;
})();
