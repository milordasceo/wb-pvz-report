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

  const moneyInt = (n) => {
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

  const otherCosts = (point) => {
    const c = point.costs || {};
    return (Number(c.internet) || 0) + (Number(c.supplies) || 0) + (Number(c.rent) || 0);
  };

  /** Разбивает недельную выручку по календарным месяцам пропорционально дням */
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

  function buildMonths(point) {
    const map = {};
    const rate = fotDay(point);

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

    return Object.values(map)
      .map((m) => {
        const fot = rate * m.daysCovered;
        const other = otherCosts(point); // пока не размазаны по месяцу
        const costs = fot + other;
        const net = m.revenue - costs;
        const fullFot = rate * m.daysInMonth;
        const revPerDay = m.daysCovered > 0 ? m.revenue / m.daysCovered : 0;
        const fullRev = revPerDay * m.daysInMonth;
        const fullNet = fullRev - fullFot - other;
        return {
          ...m,
          fot,
          costs,
          net,
          fullRev,
          fullFot,
          fullNet,
          fotPerDay: rate,
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
        const rev = sum(p.weeks, "revenue");
        const netTotal = months.reduce((a, m) => a + m.net, 0);
        const rate = fotDay(p);
        const monthLines = months
          .slice(0, 4)
          .map((m) => `${monthTitle(m.key)}: ${money(m.revenue)} / плюс ${money(m.net)}`)
          .join(" · ");
        return `
          <a class="point-link" href="${p.file}">
            <div class="meta">
              <strong>${p.title}</strong>
              <small>ФОТ ${moneyInt(rate)}/день · выручка ${money(rev)} · плюс (после ФОТ) ${money(netTotal)}</small>
              <small class="month-preview">${monthLines}${months.length > 4 ? " · …" : ""}</small>
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
          <small>Новосибирск · выручка и ФОТ по месяцам</small>
        </div>
        <span class="badge">${meta.period || "период"}</span>
      </div>
      <section class="hero">
        <h1>4 пункта выдачи</h1>
        <p>Месяц → выручка, ФОТ (ставка × дни), чистый плюс. Остальные затраты — позже.</p>
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Точек</span><span class="value">4</span></div>
          <div class="kpi"><span class="label">Недель</span><span class="value">${points[0]?.weeks?.length || "—"}</span></div>
          <div class="kpi"><span class="label">ФОТ</span><span class="value">внесён</span></div>
        </div>
      </section>
      <div class="section-title"><h2>Точки</h2><span>открыть отчёт</span></div>
      <div class="point-list">${cards}</div>
      <div class="note">
        ${meta.note}<br><br>${mergeLines}<br><br>
        <strong>ФОТ в день:</strong> Тамбовская 2 400 · Кропоткина 2 700 · Железнодорожная 2 000 · Герцена 2 000.<br>
        <strong>Чистый плюс (сейчас)</strong> = выручка − ФОТ. Интернет / расходники / аренда ещё не вычтены.
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
    const totalFot = months.reduce((a, m) => a + m.fot, 0);
    const totalNet = months.reduce((a, m) => a + m.net, 0);
    const rate = fotDay(point);
    const fullMonths = months.filter((m) => m.daysCovered >= m.daysInMonth);
    const bestNet = months.reduce(
      (a, b) => (b.net > (a?.net || -Infinity) ? b : a),
      null
    );

    const monthCards = months
      .map((m) => {
        const partial = m.daysCovered < m.daysInMonth;
        const coverage = `${m.daysCovered} из ${m.daysInMonth} дн.`;
        const netClass = m.net >= 0 ? "plus" : "minus";
        const pillClass = m.net >= 0 ? "plus" : "minus";
        const pillText = (m.net >= 0 ? "+" : "") + money(m.net);

        const weekRows = m.weeks
          .map((w) => {
            const splitHint = w.split ? ` · ${w.daysInMonth} дн.` : "";
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
                <span class="week-range">${coverage}${partial ? " · неполный" : " · полный"}</span>
              </div>
              <span class="profit-pill ${pillClass}">${pillText}</span>
            </div>
            <div class="rows">
              <div class="row revenue">
                <span class="name">Выручка</span>
                <span class="amount">${money(m.revenue)}</span>
              </div>
              <div class="row cost">
                <span class="name">ФОТ (${moneyInt(rate)} × ${m.daysCovered} дн.)</span>
                <span class="amount">${money(m.fot)}</span>
              </div>
              <div class="row cost">
                <span class="name">Интернет / расходники / аренда</span>
                <span class="amount">—</span>
              </div>
              <div class="row net ${m.net < 0 ? "negative" : ""}">
                <span class="name">Чистый плюс (после ФОТ)</span>
                <span class="amount ${netClass}">${m.net >= 0 ? "+" : ""}${money(m.net)}</span>
              </div>
              ${
                partial
                  ? `
              <div class="week-block-title">Оценка на полный месяц</div>
              <div class="row">
                <span class="name">Выручка (день × ${m.daysInMonth})</span>
                <span class="amount">${money(m.fullRev)}</span>
              </div>
              <div class="row cost">
                <span class="name">ФОТ (${moneyInt(rate)} × ${m.daysInMonth})</span>
                <span class="amount">${money(m.fullFot)}</span>
              </div>
              <div class="row net ${m.fullNet < 0 ? "negative" : ""}">
                <span class="name">Плюс на полный месяц</span>
                <span class="amount ${m.fullNet >= 0 ? "plus" : "minus"}">${m.fullNet >= 0 ? "+" : ""}${money(m.fullNet)}</span>
              </div>`
                  : ""
              }
              <div class="week-block-title">Недели (выручка)</div>
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
          <small>ПВЗ #${point.code} · ФОТ ${moneyInt(rate)}/день</small>
        </div>
        <span class="badge">${months.length} мес.</span>
      </div>
      <section class="hero">
        <h1>Отчёт по месяцам</h1>
        <p>${point.address}. Чистый плюс = выручка − ФОТ (прочие затраты ещё не вычтены).</p>
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка всего</span><span class="value">${money(totalRev)}</span></div>
          <div class="kpi"><span class="label">ФОТ всего</span><span class="value">${money(totalFot)}</span></div>
          <div class="kpi"><span class="label">Плюс после ФОТ</span><span class="value ${totalNet >= 0 ? "plus" : "minus"}">${totalNet >= 0 ? "+" : ""}${money(totalNet)}</span></div>
          <div class="kpi"><span class="label">ФОТ / день</span><span class="value">${moneyInt(rate)}</span></div>
          <div class="kpi"><span class="label">Полных месяцев</span><span class="value">${fullMonths.length}</span></div>
          <div class="kpi"><span class="label">Лучший плюс</span><span class="value" style="font-size:0.85rem">${bestNet ? monthTitle(bestNet.key) : "—"}</span></div>
        </div>
      </section>

      <div class="section-title">
        <h2>Месяцы</h2>
        <span>новые сверху</span>
      </div>
      <div class="cards">${monthCards}</div>

      <div class="note">
        <strong>ФОТ</strong> = ${moneyInt(rate)} × число дней покрытия в месяце.<br>
        <strong>Чистый плюс</strong> сейчас без интернета, расходников и аренды — добавим, когда будут цифры.<br>
        Недели на стыке месяцев делятся по дням.
      </div>
      <p class="footer">${point.title} · #${point.code}</p>
    `;
  }

  window.renderIndex = renderIndex;
  window.renderPoint = renderPoint;
})();
