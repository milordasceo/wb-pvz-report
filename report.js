(function () {
  const money = (n) => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n < 0 ? "−" : "";
    const abs = Math.abs(n);
    const [int, dec] = abs.toFixed(2).split(".");
    const spaced = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${sign}${spaced},${dec} ₽`;
  };

  const sum = (arr, key) => arr.reduce((a, x) => a + (Number(x[key]) || 0), 0);

  const weekCosts = (point, week) => {
    if (!point.costs) return null;
    if (Array.isArray(point.costs)) {
      const row = point.costs.find((c) => c.from === week.from);
      return row || null;
    }
    // fixed weekly costs object: { fot, internet, supplies, rent }
    return point.costs;
  };

  const netOf = (revenue, costs) => {
    if (!costs) return null;
    const totalCost =
      (costs.fot || 0) +
      (costs.internet || 0) +
      (costs.supplies || 0) +
      (costs.rent || 0);
    return revenue - totalCost;
  };

  function renderIndex() {
    const root = document.getElementById("app");
    if (!root || !window.PVZ_DATA) return;
    const { points, meta } = window.PVZ_DATA;

    const cards = points
      .map((p) => {
        const rev = sum(p.weeks, "revenue");
        const last4 = p.weeks.slice(-4);
        const last4Sum = sum(last4, "revenue");
        const m31 = (last4Sum / 28) * 31;
        return `
          <a class="point-link" href="${p.file}">
            <div class="meta">
              <strong>${p.title}</strong>
              <small>ПВЗ #${p.code} · ${p.weeks.length} нед. · выручка ${money(rev)}</small>
              <small>Оценка / 31 дн.: ${money(m31)}</small>
            </div>
            <span class="arrow">→</span>
          </a>`;
      })
      .join("");

    const weekCount = points[0]?.weeks?.length || 0;
    const mergeLines = (meta.merges || []).map((m) => `• ${m}`).join("<br>");

    root.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <strong>Wildberries · ПВЗ</strong>
          <small>Новосибирск · выручка «к выплате»</small>
        </div>
        <span class="badge">16 мар – 2 авг 2026</span>
      </div>
      <section class="hero">
        <h1>4 пункта выдачи</h1>
        <p>Недельная выручка из ЛК. Дубли адресов/кодов склеены в одну точку.</p>
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Точек</span><span class="value">4</span></div>
          <div class="kpi"><span class="label">Недель</span><span class="value">${weekCount}</span></div>
          <div class="kpi"><span class="label">Затраты</span><span class="value">ждут</span></div>
        </div>
      </section>
      <div class="section-title"><h2>Точки</h2><span>открыть отчёт</span></div>
      <div class="point-list">${cards}</div>
      <div class="note">${meta.note}<br><br>${mergeLines}<br><br>${meta.monthFormula}</div>
      <p class="footer">WB ПВЗ · Новосибирск</p>
    `;
  }

  function renderPoint(pointId) {
    const root = document.getElementById("app");
    const point = window.PVZ_DATA?.points?.find((p) => p.id === pointId);
    if (!root || !point) return;

    const weeks = [...point.weeks].reverse(); // newest first
    const totalRev = sum(point.weeks, "revenue");
    const last4 = point.weeks.slice(-4);
    const last4Sum = sum(last4, "revenue");
    const perDay = last4Sum / 28;
    const m30 = perDay * 30;
    const m31 = perDay * 31;

    const weekCards = weeks
      .map((w, i) => {
        const n = point.weeks.length - i;
        const costs = weekCosts(point, w);
        const net = netOf(w.revenue, costs);
        const pill =
          net == null
            ? `<span class="profit-pill" style="color:#c8bfff;background:rgba(124,92,255,.12);border-color:rgba(124,92,255,.35)">выручка</span>`
            : net >= 0
              ? `<span class="profit-pill plus">+${money(net).replace(" ₽", "")} ₽</span>`
              : `<span class="profit-pill minus">${money(net)}</span>`;

        const costRows = costs
          ? `
            <div class="row cost"><span class="name">ФОТ</span><span class="amount">${money(costs.fot)}</span></div>
            <div class="row cost"><span class="name">Интернет</span><span class="amount">${money(costs.internet)}</span></div>
            <div class="row cost"><span class="name">Расходники</span><span class="amount">${money(costs.supplies)}</span></div>
            <div class="row cost"><span class="name">Аренда</span><span class="amount">${money(costs.rent)}</span></div>
            <div class="row net ${net < 0 ? "negative" : ""}"><span class="name">Чистый плюс</span><span class="amount ${net >= 0 ? "plus" : "minus"}">${net >= 0 ? "+" : ""}${money(net)}</span></div>
          `
          : `
            <div class="row cost"><span class="name">ФОТ</span><span class="amount">—</span></div>
            <div class="row cost"><span class="name">Интернет</span><span class="amount">—</span></div>
            <div class="row cost"><span class="name">Расходники</span><span class="amount">—</span></div>
            <div class="row cost"><span class="name">Аренда</span><span class="amount">—</span></div>
            <div class="row net"><span class="name">Чистый плюс</span><span class="amount">нужны затраты</span></div>
          `;

        const mergeNote = w.note
          ? `<div class="row" style="background:transparent;padding:0.2rem 0.65rem 0;"><span class="name" style="font-size:0.75rem">склейка: ${w.note}</span><span></span></div>`
          : "";

        return `
          <article class="card">
            <div class="card-head">
              <div>
                <h3>Неделя ${n}</h3>
                <span class="week-range">${w.period}</span>
              </div>
              ${pill}
            </div>
            <div class="rows">
              <div class="row revenue"><span class="name">Выручка (к выплате)</span><span class="amount">${money(w.revenue)}</span></div>
              ${mergeNote}
              ${costRows}
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
        <span class="badge">${point.weeks.length} нед.</span>
      </div>
      <section class="hero">
        <h1>Финансовый отчёт</h1>
        <p>Выручка по неделям. Оценка месяца — по 4 последним неделям.</p>
        <div class="kpi-grid">
          <div class="kpi"><span class="label">Выручка (10 нед.)</span><span class="value">${money(totalRev)}</span></div>
          <div class="kpi"><span class="label">4 нед. (сумма)</span><span class="value">${money(last4Sum)}</span></div>
          <div class="kpi"><span class="label">В день (4 нед./28)</span><span class="value">${money(perDay)}</span></div>
          <div class="kpi"><span class="label">Оценка ×30</span><span class="value">${money(m30)}</span></div>
          <div class="kpi"><span class="label">Оценка ×31</span><span class="value">${money(m31)}</span></div>
          <div class="kpi"><span class="label">Чистый плюс</span><span class="value">ждём затраты</span></div>
        </div>
      </section>
      <div class="section-title">
        <h2>По неделям</h2>
        <span>новые сверху</span>
      </div>
      <div class="cards">${weekCards}</div>
      <div class="note">
        <strong>Месяц:</strong> (сумма 4 недель ÷ 28) × 30/31.<br>
        Последние 4 недели: 27 апр – 24 мая → день ${money(perDay)}, месяц 30д ${money(m30)}, 31д ${money(m31)}.<br>
        Затраты (ФОТ, интернет, расходники, аренда) пока не внесены.
      </div>
      <p class="footer">${point.title} · #${point.code}</p>
    `;
  }

  window.renderIndex = renderIndex;
  window.renderPoint = renderPoint;
})();
