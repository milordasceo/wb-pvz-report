/**
 * Прогноз выручки и чистого плюса ПВЗ Wildberries.
 *
 * Метод (с учётом короткого ряда ~1 год):
 * 1) Сезонность = смесь (индексы из факта + календарные priors RU e-commerce).
 * 2) Тренд по десезонализированному ряду (взвешенный, свежие месяцы важнее).
 * 3) Шок логистики WB (удары по складам с июля 2026) + путь восстановления.
 * 4) Календарные события: школа, зимняя одежда, 11.11 / BF, НГ, 23 фев, 8 мар.
 * 5) Расходы считаются из известных ставок точки → чистый плюс.
 */
(function () {
  /** Календарные priors относительно «среднего» месяца (1.0). RU marketplace / WB. */
  const CALENDAR_PRIOR = {
    1: 0.82, // после НГ — спад
    2: 0.95, // 23 февраля
    3: 1.08, // 8 марта
    4: 0.94,
    5: 0.9,
    6: 0.88, // лето слабее
    7: 0.86,
    8: 1.06, // подготовка к школе
    9: 1.18, // школа: рюкзаки, тетради, форма
    10: 1.14, // зимняя одежда / обувь
    11: 1.28, // 11.11, Black Friday / распродажи
    12: 1.32, // НГ подарки
  };

  /** Доп. события (мультипликатор поверх месяца). */
  const EVENT_NOTES = {
    1: "послепраздничный спад",
    2: "23 февраля",
    3: "8 марта",
    8: "подготовка к школе",
    9: "школьный сезон (рюкзаки, канцы)",
    10: "сезон зимней одежды",
    11: "11.11 / Black Friday",
    12: "новогодние покупки",
  };

  /**
   * Шок складов WB: удары с ~июля 2026, выручка ПВЗ −15…20% в среднем.
   * recovery[k] — множитель к «нормальной» модели для k-го месяца вперёд (1 = первый прогнозный).
   * Предпосылка: логистика частично восстанавливается + включается осенний сезон.
   */
  const SHOCK = {
    startKey: "2026-07",
    depth: 0.82, // факт последних месяцев уже частично внутри ряда; для forward — остаточный гэп
    // путь: ещё давление → ослабление → почти норма к 3-му месяцу на фоне сезона
    recovery: [0.88, 0.95, 1.02],
  };

  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  const monthNum = (key) => Number(key.split("-")[1]);

  function nextMonthKey(key) {
    const [y, m] = key.split("-").map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, "0")}`;
  }

  function daysInMonthKey(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  /** Взвешенная линейная регрессия y = a + b*t */
  function weightedTrend(ys, weights) {
    const n = ys.length;
    if (n < 2) return { a: ys[0] || 0, b: 0 };
    let sw = 0,
      st = 0,
      sy = 0,
      stt = 0,
      sty = 0;
    for (let i = 0; i < n; i++) {
      const w = weights[i] ?? 1;
      const t = i;
      const y = ys[i];
      sw += w;
      st += w * t;
      sy += w * y;
      stt += w * t * t;
      sty += w * t * y;
    }
    const den = sw * stt - st * st;
    if (Math.abs(den) < 1e-9) return { a: sy / sw, b: 0 };
    const b = (sw * sty - st * sy) / den;
    const a = (sy - b * st) / sw;
    return { a, b };
  }

  /**
   * Сезонные индексы: blend факта и календаря.
   * alpha — вес факта (0..1). При одном наблюдении на месяц факта мало → больше календарь.
   */
  function seasonalIndices(series) {
    const byM = {};
    for (const row of series) {
      const m = monthNum(row.key);
      (byM[m] ||= []).push(row.revenue);
    }
    const overall = mean(series.map((r) => r.revenue)) || 1;
    const idx = {};
    for (let m = 1; m <= 12; m++) {
      const prior = CALENDAR_PRIOR[m];
      const vals = byM[m] || [];
      if (!vals.length) {
        idx[m] = prior;
        continue;
      }
      const empiric = mean(vals) / overall;
      // чем больше наблюдений на месяц, тем сильнее факт
      const alpha = Math.min(0.65, 0.25 + vals.length * 0.2);
      idx[m] = alpha * empiric + (1 - alpha) * prior;
    }
    // нормализация среднего индекса ≈ 1
    const avg = mean(Object.values(idx)) || 1;
    for (let m = 1; m <= 12; m++) idx[m] /= avg;
    return idx;
  }

  function readCostOpts(pointId) {
    try {
      const raw = localStorage.getItem("wb-pvz-cost-opts");
      const map = raw ? JSON.parse(raw) : {};
      return (map && map[pointId]) || {};
    } catch {
      return {};
    }
  }

  function numOr(v, fallback) {
    const n = Number(v);
    return v == null || v === "" || Number.isNaN(n) ? fallback : Math.max(0, n);
  }

  function expensesForMonth(point, revenue, days, monthKey) {
    const c = point?.costs || {};
    const o = readCostOpts(point?.id);
    const rentOn = o.rentOn !== false;
    const adminOn = o.adminOn === true;
    const fotDay = numOr(o.fotPerDay, Number(c.fotPerDay) || 0);
    const rentRate = numOr(o.rentPerMonth, Number(c.rentPerMonth) || 0);
    const internet = numOr(o.internetPerMonth, Number(c.internetPerMonth) || 0);
    const supplies = numOr(o.suppliesPerMonth, Number(c.suppliesPerMonth) || 0);
    const adminRate = numOr(o.adminPerMonth, Number(c.adminPerMonth) || 15000);
    const taxPct = numOr(o.taxPct, 6);

    const fot = fotDay * days;
    const rent = rentOn ? rentRate : 0;
    const admin = adminOn ? adminRate : 0;
    const tax = revenue * (taxPct / 100);
    const total = fot + rent + internet + supplies + admin + tax;
    return { fot, rent, internet, supplies, admin, tax, total };
  }

  /**
   * @param {Array<{key, revenue, net?, partial?}>} monthsChrono — по возрастанию key
   * @param {object|null} point — для расходов; null = только выручка (сеть суммируется снаружи)
   * @param {number} horizon
   */
  function forecastRevenueSeries(monthsChrono, horizon = 3) {
    const series = monthsChrono
      .filter((m) => m.revenue > 0 && !m.skipForecast)
      .map((m) => ({ key: m.key, revenue: m.revenue, partial: !!m.partial }));

    if (series.length < 3) {
      return { ok: false, reason: "мало истории", months: [] };
    }

    const season = seasonalIndices(series);
    const deseas = series.map((r) => r.revenue / (season[monthNum(r.key)] || 1));

    // веса: свежее важнее; июл–авг 2026 (шок) чуть приглушаем для тренда
    const weights = series.map((r, i) => {
      let w = 0.55 + (0.45 * (i + 1)) / series.length;
      if (r.key >= SHOCK.startKey && r.key <= "2026-08") w *= 0.55;
      if (r.partial) w *= 0.7;
      return w;
    });

    const { a, b } = weightedTrend(deseas, weights);
    const lastKey = series[series.length - 1].key;
    const lastIdx = series.length - 1;

    // оценка «дыры» шока: факт последних полных месяцев vs модель без шока
    const recent = series.filter((r) => r.key >= SHOCK.startKey && !r.partial);
    let shockGap = 1;
    if (recent.length) {
      const ratios = recent.map((r, j) => {
        const t = series.findIndex((x) => x.key === r.key);
        const model = (a + b * t) * (season[monthNum(r.key)] || 1);
        return model > 0 ? r.revenue / model : 1;
      });
      shockGap = Math.min(1, Math.max(0.7, mean(ratios)));
    }

    const out = [];
    let key = lastKey;
    for (let h = 1; h <= horizon; h++) {
      key = nextMonthKey(key);
      const m = monthNum(key);
      const t = lastIdx + h;
      const baseDeseas = a + b * t;
      const seas = season[m] || 1;
      let rev = Math.max(0, baseDeseas * seas);

      // остаточное давление шока × путь восстановления
      const recover = SHOCK.recovery[h - 1] ?? 1;
      // если факт уже «в яме», не давим дважды: смешиваем
      const shockAdj = shockGap * recover + (1 - shockGap) * recover;
      rev *= Math.min(1.15, Math.max(0.75, shockAdj));

      // лёгкий потолок/пол относительно среднего последних 4 полных месяцев
      const last4 = series.filter((r) => !r.partial).slice(-4);
      if (last4.length) {
        const avg4 = mean(last4.map((r) => r.revenue));
        rev = Math.min(rev, avg4 * seas * 1.45);
        rev = Math.max(rev, avg4 * seas * 0.55);
      }

      out.push({
        key,
        month: m,
        revenue: rev,
        seasonIndex: seas,
        event: EVENT_NOTES[m] || "",
        shockFactor: shockAdj,
        trendLevel: baseDeseas,
      });
    }

    return {
      ok: true,
      season,
      trend: { a, b },
      shockGap,
      lastKey,
      months: out,
      method:
        "сезонность (факт+календарь) + взвешенный тренд + шок складов WB + восстановление",
    };
  }

  function forecastPoint(point, monthsDescNewestFirst, horizon = 3) {
    const chrono = [...monthsDescNewestFirst].sort((a, b) => (a.key > b.key ? 1 : -1));
    const fr = forecastRevenueSeries(chrono, horizon);
    if (!fr.ok) return fr;

    const months = fr.months.map((row) => {
      const days = daysInMonthKey(row.key);
      const exp = expensesForMonth(point, row.revenue, days, row.key);
      const net = row.revenue - exp.total;
      return {
        ...row,
        days,
        expenses: exp.total,
        expenseBreak: exp,
        net,
        isForecast: true,
      };
    });

    return { ...fr, months, pointId: point.id };
  }

  function forecastNetwork(points, buildMonthsFn, horizon = 3) {
    // прогноз по каждой точке → сумма (корректнее, чем один ряд: разные затраты/уровни)
    const perPoint = points.map((p) => forecastPoint(p, buildMonthsFn(p), horizon));
    if (perPoint.some((p) => !p.ok)) {
      return { ok: false, reason: "не хватает истории по части точек", perPoint };
    }

    const keys = perPoint[0].months.map((m) => m.key);
    const months = keys.map((key, i) => {
      let revenue = 0,
        expenses = 0,
        net = 0;
      const parts = [];
      for (const fp of perPoint) {
        const row = fp.months[i];
        revenue += row.revenue;
        expenses += row.expenses;
        net += row.net;
        parts.push({ id: fp.pointId, title: points.find((x) => x.id === fp.pointId)?.title, net: row.net, revenue: row.revenue });
      }
      const m = Number(key.split("-")[1]);
      return {
        key,
        month: m,
        revenue,
        expenses,
        net,
        event: EVENT_NOTES[m] || "",
        seasonIndex: perPoint[0].months[i].seasonIndex,
        byPoint: parts,
        isForecast: true,
      };
    });

    return {
      ok: true,
      months,
      perPoint,
      method: perPoint[0].method,
    };
  }

  window.PVZ_FORECAST = {
    CALENDAR_PRIOR,
    EVENT_NOTES,
    SHOCK,
    forecastPoint,
    forecastNetwork,
    forecastRevenueSeries,
    expensesForMonth,
  };
})();
