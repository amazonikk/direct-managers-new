(() => {
  "use strict";

  const DATA_URL = "data/report.json";
  const AUTO_REFRESH_MS = 5 * 60 * 1000;

  const ACCOUNT_PALETTE = [
    "#4f46e5", "#ec4899", "#059669", "#d97706", "#0891b2", "#7c3aed",
    "#dc2626", "#2563eb", "#65a30d", "#c026d3", "#0f766e", "#ea580c",
    "#475569", "#9333ea", "#0284c7", "#be123c", "#15803d", "#a16207"
  ];

  const MANAGER_COLORS = {
    taya: "#4f46e5",
    kateryna: "#ec4899"
  };

  const MONTHS_GENITIVE = [
    "січня", "лютого", "березня", "квітня", "травня", "червня",
    "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"
  ];

  const fmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
  const dateFmt = new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
  const dateTimeFmt = new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

  const state = {
    report: null,
    managerId: "all",
    month: null,
    platform: "Усі",
    selectedAccounts: new Set(),
    isLoading: false
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheDom();
    bindEvents();
    showLoadingShell();
    loadReport({ initial: true });
    window.setInterval(() => loadReport({ initial: false, silent: true }), AUTO_REFRESH_MS);
  }

  function cacheDom() {
    [
      "periodSubtitle", "syncStatus", "refreshButton", "printButton", "managerTabs",
      "monthTabs", "platformSelect", "accountGroups", "selectAll", "clearAll",
      "dataNotice", "managerComparison", "kpiGrid", "weeklyOverviewGrid",
      "legendChats", "legendNumbers", "legendConversion", "chartChats",
      "chartNumbers", "chartConversion", "tableWrap", "sourceLinks",
      "chatsDescription", "numbersDescription", "conversionDescription"
    ].forEach((id) => {
      dom[id] = document.getElementById(id);
    });
  }

  function bindEvents() {
    dom.refreshButton.addEventListener("click", () => loadReport({ initial: false }));
    dom.printButton.addEventListener("click", () => window.print());

    dom.platformSelect.addEventListener("change", () => {
      state.platform = dom.platformSelect.value;
      renderAll();
    });

    dom.selectAll.addEventListener("click", () => {
      getAccountsForSelectedMonth({ applyPlatform: true }).forEach(({ account }) => {
        state.selectedAccounts.add(account.id);
      });
      renderAll();
    });

    dom.clearAll.addEventListener("click", () => {
      getAccountsForSelectedMonth({ applyPlatform: true }).forEach(({ account }) => {
        state.selectedAccounts.delete(account.id);
      });
      renderAll();
    });

    window.addEventListener("resize", debounce(() => {
      if (!state.report) return;
      renderCharts();
    }, 140));
  }

  async function loadReport({ initial = false, silent = false } = {}) {
    if (state.isLoading) return;
    state.isLoading = true;
    dom.refreshButton.disabled = true;

    if (!silent || initial) {
      setSyncStatus("loading", "Оновлення даних…");
    }

    try {
      const response = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Не вдалося завантажити дані: HTTP ${response.status}`);
      }

      const report = await response.json();
      validateReport(report);
      decorateReport(report);

      const previousMonth = state.month;
      const previousManager = state.managerId;
      const previousSelection = new Set(state.selectedAccounts);

      state.report = report;

      if (!report.managers.some((manager) => manager.id === previousManager)) {
        state.managerId = "all";
      }

      const months = getAvailableMonths();
      state.month = months.includes(previousMonth) ? previousMonth : months.at(-1) || null;

      const validAccountIds = new Set(getAccountsForSelectedMonth({ applyPlatform: false }).map(({ account }) => account.id));
      state.selectedAccounts = new Set([...previousSelection].filter((id) => validAccountIds.has(id)));

      if (initial || state.selectedAccounts.size === 0) {
        selectAllAccountsForCurrentScope();
      }

      renderAll();
      setSyncStatus("ok", `Дані зібрано ${formatGeneratedAt(report.generatedAt)}`);
    } catch (error) {
      console.error(error);
      setSyncStatus("error", "Помилка оновлення даних");
      showErrorNotice(error.message || "Не вдалося завантажити дані.");

      if (!state.report) {
        showFatalError(error.message || "Не вдалося завантажити data/report.json.");
      }
    } finally {
      state.isLoading = false;
      dom.refreshButton.disabled = false;
    }
  }

  function validateReport(report) {
    if (!report || !Array.isArray(report.managers)) {
      throw new Error("Файл data/report.json має неправильну структуру.");
    }

    for (const manager of report.managers) {
      if (!manager.id || !manager.name || !Array.isArray(manager.accounts)) {
        throw new Error("У звіті пошкоджені дані одного з direct-менеджерів.");
      }
      for (const account of manager.accounts) {
        if (!account.id || !Array.isArray(account.records)) {
          throw new Error(`Пошкоджені дані акаунта ${account.name || account.sheetName || account.id}.`);
        }
      }
    }
  }

  function decorateReport(report) {
    let colorIndex = 0;
    report.managers.forEach((manager) => {
      manager.color = MANAGER_COLORS[manager.id] || ACCOUNT_PALETTE[colorIndex % ACCOUNT_PALETTE.length];
      manager.spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${manager.spreadsheetId}/edit`;

      manager.accounts.forEach((account) => {
        account.managerId = manager.id;
        account.managerName = manager.name;
        account.color = ACCOUNT_PALETTE[colorIndex % ACCOUNT_PALETTE.length];
        colorIndex += 1;
      });
    });
  }

  function renderAll() {
    if (!state.report || !state.month) return;

    ensureMonthIsValid();
    renderManagerTabs();
    renderMonthTabs();
    renderPlatformSelect();
    renderAccountGroups();
    renderNotice();
    renderManagerComparison();
    renderKpis();
    renderWeeklyOverview();
    renderCharts();
    renderTable();
    renderSourceLinks();
    renderDescriptions();
  }

  function renderManagerTabs() {
    const items = [{ id: "all", name: "Загалом" }, ...state.report.managers];
    dom.managerTabs.innerHTML = "";

    items.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `manager-btn${state.managerId === item.id ? " active" : ""}`;
      button.textContent = item.name;
      button.addEventListener("click", () => {
        if (state.managerId === item.id) return;
        state.managerId = item.id;
        state.platform = "Усі";
        const months = getAvailableMonths();
        if (!months.includes(state.month)) state.month = months.at(-1) || null;
        selectAllAccountsForCurrentScope();
        renderAll();
      });
      dom.managerTabs.appendChild(button);
    });
  }

  function renderMonthTabs() {
    const months = getAvailableMonths();
    dom.monthTabs.innerHTML = "";

    months.forEach((month) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `month-btn${state.month === month ? " active" : ""}`;
      button.textContent = formatMonth(month);
      button.addEventListener("click", () => {
        if (state.month === month) return;
        state.month = month;
        state.platform = "Усі";
        selectAllAccountsForCurrentScope();
        renderAll();
      });
      dom.monthTabs.appendChild(button);
    });
  }

  function renderPlatformSelect() {
    const platforms = [...new Set(
      getAccountsForSelectedMonth({ applyPlatform: false }).map(({ account }) => account.platform)
    )].filter(Boolean).sort((a, b) => a.localeCompare(b, "uk"));

    const options = ["Усі", ...platforms];
    if (!options.includes(state.platform)) state.platform = "Усі";

    dom.platformSelect.innerHTML = options.map((platform) => (
      `<option value="${escapeHtml(platform)}">${platform === "Усі" ? "Усі платформи" : escapeHtml(platform)}</option>`
    )).join("");
    dom.platformSelect.value = state.platform;
  }

  function renderAccountGroups() {
    const accounts = getAccountsForSelectedMonth({ applyPlatform: true });
    dom.accountGroups.innerHTML = "";

    if (!accounts.length) {
      dom.accountGroups.innerHTML = '<div class="empty" style="min-height:90px">У цьому місяці немає акаунтів із відповідними даними.</div>';
      return;
    }

    const groups = new Map();
    accounts.forEach((entry) => {
      if (!groups.has(entry.manager.id)) groups.set(entry.manager.id, { manager: entry.manager, entries: [] });
      groups.get(entry.manager.id).entries.push(entry);
    });

    groups.forEach(({ manager, entries }) => {
      const group = document.createElement("div");
      group.className = "account-group";

      if (state.managerId === "all") {
        const title = document.createElement("div");
        title.className = "account-group-title";
        title.innerHTML = `<span class="dot" style="background:${manager.color}"></span>${escapeHtml(manager.name)}`;
        group.appendChild(title);
      }

      const chips = document.createElement("div");
      chips.className = "account-chips";

      entries.forEach(({ account }) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `account-chip${state.selectedAccounts.has(account.id) ? "" : " off"}`;
        chip.setAttribute("aria-pressed", state.selectedAccounts.has(account.id) ? "true" : "false");
        chip.innerHTML = `<span class="dot" style="background:${account.color}"></span>${escapeHtml(account.name)}`;
        chip.addEventListener("click", () => {
          if (state.selectedAccounts.has(account.id)) state.selectedAccounts.delete(account.id);
          else state.selectedAccounts.add(account.id);
          renderAll();
        });
        chips.appendChild(chip);
      });

      group.appendChild(chips);
      dom.accountGroups.appendChild(group);
    });
  }

  function renderNotice() {
    const activeEntries = getActiveAccountEntries();
    const monthLabel = formatMonth(state.month);
    const records = activeEntries.flatMap(({ account }) => recordsInMonth(account, state.month));
    const latestDate = records.map((record) => record.date).sort().at(-1) || null;
    const selectedCount = activeEntries.length;
    const monthEnd = getMonthEndIso(state.month);
    const isPartial = latestDate && latestDate < monthEnd;

    dom.periodSubtitle.textContent = `${monthLabel}: чати, отримані номери та конверсія по календарних тижнях.`;
    dom.dataNotice.classList.remove("error");

    if (!latestDate) {
      dom.dataNotice.innerHTML = `<span>ⓘ</span><span><strong>${monthLabel}:</strong> для вибраних акаунтів немає внесених даних.</span>`;
      return;
    }

    dom.dataNotice.innerHTML = `
      <span>ⓘ</span>
      <span>
        ${isPartial
          ? `<strong>${monthLabel} — неповний період:</strong> остання активність за ${dateFmt.format(parseIsoDate(latestDate))}.`
          : `<strong>${monthLabel}:</strong> дані відображені до ${dateFmt.format(parseIsoDate(latestDate))}.`}
        На дашборді зараз ${selectedCount} ${plural(selectedCount, "акаунт", "акаунти", "акаунтів")}.
      </span>`;
  }

  function renderManagerComparison() {
    if (state.managerId !== "all") {
      dom.managerComparison.hidden = true;
      dom.managerComparison.innerHTML = "";
      return;
    }

    dom.managerComparison.hidden = false;
    const totalsByManager = getTotalsByManager();

    dom.managerComparison.innerHTML = state.report.managers.map((manager) => {
      const total = totalsByManager.get(manager.id) || { chats: 0, numbers: 0, accounts: 0 };
      const conversion = total.chats ? total.numbers / total.chats * 100 : 0;
      return `
        <article class="manager-card panel" style="--manager-soft:${hexToRgba(manager.color, 0.10)}">
          <div class="manager-card-head">
            <h2 class="manager-card-name"><span class="dot" style="background:${manager.color}"></span>${escapeHtml(manager.name)}</h2>
            <span class="manager-card-badge">${total.accounts} ${plural(total.accounts, "акаунт", "акаунти", "акаунтів")}</span>
          </div>
          <div class="manager-card-stats">
            <div class="manager-stat">
              <span class="manager-stat-label">Чати</span>
              <span class="manager-stat-value">${fmt.format(total.chats)}</span>
            </div>
            <div class="manager-stat">
              <span class="manager-stat-label">Номери</span>
              <span class="manager-stat-value">${fmt.format(total.numbers)}</span>
            </div>
            <div class="manager-stat">
              <span class="manager-stat-label">Конверсія</span>
              <span class="manager-stat-value">${conversion.toFixed(1)}%</span>
            </div>
          </div>
        </article>`;
    }).join("");
  }

  function renderKpis() {
    const totals = aggregateActiveAccounts();
    const leader = getLeader();

    const cards = [
      ["Усього чатів", fmt.format(totals.chats), "Сума вибраних акаунтів", false],
      ["Отримано номерів", fmt.format(totals.numbers), "За весь обраний місяць", false],
      ["Загальна конверсія", `${totals.conversion.toFixed(1)}%`, "Номери ÷ чати", false],
      [
        state.managerId === "all" ? "Лідер серед direct-менеджерів" : "Лідер за номерами",
        leader ? leader.name : "—",
        leader ? `${fmt.format(leader.numbers)} ${plural(leader.numbers, "номер", "номери", "номерів")} із ${fmt.format(leader.chats)} чатів` : "Немає вибраних акаунтів",
        true
      ]
    ];

    dom.kpiGrid.innerHTML = cards.map(([label, value, note, isName]) => `
      <article class="kpi panel">
        <div class="kpi-label">${label}</div>
        <div class="kpi-value${isName ? " is-name" : ""}">${escapeHtml(String(value))}</div>
        <div class="kpi-note">${escapeHtml(String(note))}</div>
      </article>`).join("");
  }

  function renderWeeklyOverview() {
    const weeks = getWeeks(state.month);
    const weeklyTotals = aggregateWeekly(getActiveAccountEntries(), weeks);

    if (!getActiveAccountEntries().length) {
      dom.weeklyOverviewGrid.innerHTML = '<div class="empty" style="grid-column:1/-1;min-height:160px">Оберіть хоча б один акаунт.</div>';
      return;
    }

    dom.weeklyOverviewGrid.innerHTML = weeklyTotals.map((week) => {
      const conversion = week.chats ? week.numbers / week.chats * 100 : null;
      const conversionText = conversion === null ? "—" : `${conversion.toFixed(1)}%`;
      const conversionWidth = conversion === null ? 0 : Math.min(conversion, 100);

      return `
        <article class="week-overview-card${week.hasData ? "" : " is-empty"}">
          <div class="week-overview-top">
            <div>
              <h3 class="week-overview-title">Тиждень ${week.id}</h3>
              <div class="week-overview-range">${escapeHtml(week.label)}</div>
            </div>
            <div class="week-conversion-badge">${conversionText}</div>
          </div>

          <div class="week-flow">
            <div class="week-flow-metric">
              <span class="week-flow-label">Чати</span>
              <span class="week-flow-value">${fmt.format(week.chats)}</span>
            </div>
            <div class="week-flow-arrow">→</div>
            <div class="week-flow-metric">
              <span class="week-flow-label">Номери</span>
              <span class="week-flow-value">${fmt.format(week.numbers)}</span>
            </div>
          </div>

          <div class="week-conversion-track" title="${conversionText}">
            <div class="week-conversion-fill" style="width:${conversionWidth}%"></div>
          </div>

          <div class="week-overview-foot">
            <span>Конверсія номерів</span>
            <strong>${fmt.format(week.numbers)} із ${fmt.format(week.chats)}</strong>
          </div>
        </article>`;
    }).join("");
  }

  function renderCharts() {
    renderLineChart(dom.chartChats, dom.legendChats, "chats");
    renderLineChart(dom.chartNumbers, dom.legendNumbers, "numbers");
    renderLineChart(dom.chartConversion, dom.legendConversion, "conversion");
  }

  function renderLineChart(container, legend, metric) {
    const weeks = getWeeks(state.month);
    const series = getChartSeries(weeks);

    legend.innerHTML = series.map((item) => `
      <span class="legend-item">
        <span class="legend-line" style="background:${item.color}"></span>
        ${escapeHtml(item.name)}
      </span>`).join("");

    if (!series.length) {
      container.innerHTML = '<div class="empty">Оберіть хоча б один акаунт для відображення графіка.</div>';
      return;
    }

    const width = Math.max(container.clientWidth - 24, 760);
    const height = 355;
    const margin = { top: 28, right: 26, bottom: 55, left: 58 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const values = series.flatMap((item) => item.weeks.map((week) => {
      if (!week.hasData) return null;
      if (metric === "conversion") return week.chats ? week.numbers / week.chats * 100 : 0;
      return week[metric];
    })).filter((value) => value !== null && Number.isFinite(value));

    const maxValue = niceMax(Math.max(...values, 0), metric);
    const svg = svgElement("svg", {
      class: "chart-svg",
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": `Графік ${metric}`
    });

    svg.appendChild(svgElement("rect", { x: 0, y: 0, width, height, rx: 15, fill: "#ffffff" }));

    const gridSteps = 5;
    for (let index = 0; index <= gridSteps; index += 1) {
      const y = margin.top + plotHeight * index / gridSteps;
      const value = maxValue * (1 - index / gridSteps);
      svg.appendChild(svgElement("line", {
        x1: margin.left,
        x2: width - margin.right,
        y1: y,
        y2: y,
        stroke: "#e8edf5",
        "stroke-width": 1
      }));
      svg.appendChild(svgElement("text", {
        x: margin.left - 10,
        y: y + 4,
        "text-anchor": "end",
        fill: "#7b8495",
        "font-size": 11
      }, metric === "conversion" ? `${value.toFixed(0)}%` : fmt.format(Math.round(value))));
    }

    const xAt = (index) => weeks.length === 1
      ? margin.left + plotWidth / 2
      : margin.left + plotWidth * index / (weeks.length - 1);

    weeks.forEach((week, index) => {
      const x = xAt(index);
      svg.appendChild(svgElement("line", {
        x1: x,
        x2: x,
        y1: margin.top,
        y2: margin.top + plotHeight,
        stroke: "#f0f3f8",
        "stroke-width": 1
      }));
      svg.appendChild(svgElement("text", {
        x,
        y: height - 27,
        "text-anchor": "middle",
        fill: "#4f5868",
        "font-size": 12,
        "font-weight": 750
      }, `Тиждень ${week.id}`));
      svg.appendChild(svgElement("text", {
        x,
        y: height - 10,
        "text-anchor": "middle",
        fill: "#8a93a3",
        "font-size": 10
      }, week.shortLabel));
    });

    series.forEach((item) => {
      const points = item.weeks.map((week, index) => {
        if (!week.hasData) return null;
        const value = metric === "conversion"
          ? (week.chats ? week.numbers / week.chats * 100 : 0)
          : week[metric];
        const x = xAt(index);
        const y = margin.top + plotHeight - value / maxValue * plotHeight;
        return { x, y, value, week };
      });

      contiguousSegments(points).forEach((segment) => {
        if (segment.length < 2) return;
        svg.appendChild(svgElement("polyline", {
          points: segment.map((point) => `${point.x},${point.y}`).join(" "),
          fill: "none",
          stroke: item.color,
          "stroke-width": 3,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          opacity: 0.92
        }));
      });

      points.filter(Boolean).forEach((point) => {
        const circle = svgElement("circle", {
          cx: point.x,
          cy: point.y,
          r: 4.5,
          fill: "#fff",
          stroke: item.color,
          "stroke-width": 3
        });
        const label = metric === "conversion" ? `${point.value.toFixed(2)}%` : fmt.format(point.value);
        circle.appendChild(svgElement("title", {}, `${item.name} · тиждень ${point.week.id} (${point.week.label}): ${label}`));
        svg.appendChild(circle);
      });
    });

    container.innerHTML = "";
    container.appendChild(svg);
  }

  function renderTable() {
    const weeks = getWeeks(state.month);
    const rows = getActiveAccountEntries().map((entry) => ({
      ...entry,
      totals: aggregateAccount(entry.account, state.month),
      weeks: aggregateWeekly([entry], weeks)
    })).sort((first, second) => (
      first.manager.name.localeCompare(second.manager.name, "uk") ||
      second.totals.numbers - first.totals.numbers ||
      second.totals.chats - first.totals.chats
    ));

    if (!rows.length) {
      dom.tableWrap.innerHTML = '<div class="empty">Немає вибраних акаунтів.</div>';
      return;
    }

    const weekHeaders = weeks.map((week) => `<th>Тиждень ${week.id}<br>${escapeHtml(week.shortLabel)}</th>`).join("");
    const tableRows = rows.map(({ manager, account, totals, weeks: weekValues }) => {
      const weekCells = weekValues.map((week) => {
        if (!week.hasData) {
          return '<td class="week-cell"><b>—</b><span>немає даних</span><span>—</span></td>';
        }
        const conversion = week.chats ? week.numbers / week.chats * 100 : 0;
        return `
          <td class="week-cell">
            <b>${fmt.format(week.chats)} чатів</b>
            <span>${fmt.format(week.numbers)} номерів</span>
            <span class="${conversionClass(conversion)}">${conversion.toFixed(1)}%</span>
          </td>`;
      }).join("");

      return `
        <tr>
          <td>
            <div class="account-name"><span class="dot" style="background:${account.color}"></span>${escapeHtml(account.name)}</div>
            <span class="account-meta">${escapeHtml(manager.name)} · ${escapeHtml(account.platform)} · аркуш «${escapeHtml(account.sheetName)}»</span>
          </td>
          <td><strong>${fmt.format(totals.chats)}</strong></td>
          <td><strong>${fmt.format(totals.numbers)}</strong></td>
          <td class="${conversionClass(totals.conversion)}">${totals.conversion.toFixed(1)}%</td>
          ${weekCells}
        </tr>`;
    }).join("");

    dom.tableWrap.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Акаунт</th>
            <th>Чати</th>
            <th>Номери</th>
            <th>CR</th>
            ${weekHeaders}
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`;
  }

  function renderSourceLinks() {
    dom.sourceLinks.innerHTML = getManagersInScope().map((manager) => `
      <a class="source-link" href="${manager.spreadsheetUrl}" target="_blank" rel="noopener noreferrer">
        Google Таблиця · ${escapeHtml(manager.name)} ↗
      </a>`).join("");
  }

  function renderDescriptions() {
    const modeText = state.managerId === "all"
      ? "Лінії показують окремо Таю та Катерину."
      : "Лінії показують окремі акаунти вибраного direct-менеджера.";
    dom.chatsDescription.textContent = `Сума чатів за кожен календарний тиждень. ${modeText}`;
    dom.numbersDescription.textContent = `Кількість отриманих номерів за кожен тиждень. ${modeText}`;
    dom.conversionDescription.textContent = `Отримані номери ÷ загальні чати × 100%. ${modeText}`;
  }

  function getChartSeries(weeks) {
    const entries = getActiveAccountEntries();
    if (state.managerId === "all") {
      return getManagersInScope().map((manager) => {
        const managerEntries = entries.filter((entry) => entry.manager.id === manager.id);
        return {
          id: manager.id,
          name: manager.name,
          color: manager.color,
          weeks: aggregateWeekly(managerEntries, weeks)
        };
      }).filter((series) => series.weeks.some((week) => week.hasData));
    }

    return entries.map(({ account }) => ({
      id: account.id,
      name: account.name,
      color: account.color,
      weeks: aggregateWeekly([{ manager: getManagerById(account.managerId), account }], weeks)
    }));
  }

  function aggregateActiveAccounts() {
    let chats = 0;
    let numbers = 0;
    getActiveAccountEntries().forEach(({ account }) => {
      const total = aggregateAccount(account, state.month);
      chats += total.chats;
      numbers += total.numbers;
    });
    return {
      chats,
      numbers,
      conversion: chats ? numbers / chats * 100 : 0
    };
  }

  function getTotalsByManager() {
    const map = new Map();
    state.report.managers.forEach((manager) => map.set(manager.id, { chats: 0, numbers: 0, accounts: 0 }));

    getActiveAccountEntries().forEach(({ manager, account }) => {
      const total = aggregateAccount(account, state.month);
      const managerTotal = map.get(manager.id);
      managerTotal.chats += total.chats;
      managerTotal.numbers += total.numbers;
      managerTotal.accounts += 1;
    });

    return map;
  }

  function getLeader() {
    const entries = getActiveAccountEntries();
    if (!entries.length) return null;

    if (state.managerId === "all") {
      const totals = getTotalsByManager();
      return state.report.managers.map((manager) => ({
        name: manager.name,
        ...totals.get(manager.id)
      })).sort((first, second) => second.numbers - first.numbers || second.chats - first.chats)[0];
    }

    return entries.map(({ account }) => ({
      name: account.name,
      ...aggregateAccount(account, state.month)
    })).sort((first, second) => second.numbers - first.numbers || second.chats - first.chats)[0];
  }

  function aggregateAccount(account, month) {
    const records = recordsInMonth(account, month);
    const chats = records.reduce((sum, record) => sum + numeric(record.chats), 0);
    const numbers = records.reduce((sum, record) => sum + numeric(record.numbers), 0);
    return {
      chats,
      numbers,
      conversion: chats ? numbers / chats * 100 : 0,
      hasData: records.length > 0
    };
  }

  function aggregateWeekly(entries, weeks) {
    return weeks.map((week) => {
      let chats = 0;
      let numbers = 0;
      let hasData = false;

      entries.forEach(({ account }) => {
        account.records.forEach((record) => {
          if (record.date < week.start || record.date > week.end) return;
          hasData = true;
          chats += numeric(record.chats);
          numbers += numeric(record.numbers);
        });
      });

      return { ...week, chats, numbers, hasData };
    });
  }

  function getActiveAccountEntries() {
    return getAccountsForSelectedMonth({ applyPlatform: true }).filter(({ account }) => state.selectedAccounts.has(account.id));
  }

  function getAccountsForSelectedMonth({ applyPlatform }) {
    if (!state.report || !state.month) return [];
    const entries = [];

    getManagersInScope().forEach((manager) => {
      manager.accounts.forEach((account) => {
        if (!recordsInMonth(account, state.month).length) return;
        if (applyPlatform && state.platform !== "Усі" && account.platform !== state.platform) return;
        entries.push({ manager, account });
      });
    });

    return entries;
  }

  function getManagersInScope() {
    if (!state.report) return [];
    if (state.managerId === "all") return state.report.managers;
    return state.report.managers.filter((manager) => manager.id === state.managerId);
  }

  function getManagerById(id) {
    return state.report.managers.find((manager) => manager.id === id);
  }

  function getAvailableMonths() {
    if (!state.report) return [];
    const months = new Set();
    getManagersInScope().forEach((manager) => {
      manager.accounts.forEach((account) => {
        account.records.forEach((record) => months.add(record.date.slice(0, 7)));
      });
    });
    return [...months].sort();
  }

  function ensureMonthIsValid() {
    const months = getAvailableMonths();
    if (!months.includes(state.month)) {
      state.month = months.at(-1) || null;
      selectAllAccountsForCurrentScope();
    }
  }

  function selectAllAccountsForCurrentScope() {
    state.selectedAccounts = new Set(
      getAccountsForSelectedMonth({ applyPlatform: false }).map(({ account }) => account.id)
    );
  }

  function recordsInMonth(account, month) {
    return account.records.filter((record) => record.date.startsWith(month));
  }

  function getWeeks(month) {
    const [year, monthNumber] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const ranges = [[1, 7], [8, 14], [15, 21], [22, 28], [29, daysInMonth]];

    return ranges.map(([startDay, endDay], index) => {
      const safeEnd = Math.min(endDay, daysInMonth);
      return {
        id: index + 1,
        start: `${year}-${pad(monthNumber)}-${pad(startDay)}`,
        end: `${year}-${pad(monthNumber)}-${pad(safeEnd)}`,
        label: `${startDay}–${safeEnd} ${MONTHS_GENITIVE[monthNumber - 1]}`,
        shortLabel: `${pad(startDay)}–${pad(safeEnd)}`
      };
    });
  }

  function getMonthEndIso(month) {
    const [year, monthNumber] = month.split("-").map(Number);
    const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return `${year}-${pad(monthNumber)}-${pad(day)}`;
  }

  function formatMonth(month) {
    if (!month) return "";
    const [year, monthNumber] = month.split("-").map(Number);
    const value = new Intl.DateTimeFormat("uk-UA", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function formatGeneratedAt(value) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? dateTimeFmt.format(date) : "—";
  }

  function parseIsoDate(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  function numeric(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function niceMax(value, metric) {
    if (metric === "conversion") {
      if (value <= 10) return 10;
      return Math.ceil(value / 5) * 5;
    }
    if (value <= 10) return 10;
    const magnitude = 10 ** Math.floor(Math.log10(value));
    const normalized = value / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  function conversionClass(value) {
    if (value >= 20) return "conversion-good";
    if (value >= 10) return "conversion-mid";
    return "conversion-low";
  }

  function contiguousSegments(points) {
    const segments = [];
    let segment = [];
    points.forEach((point) => {
      if (point) segment.push(point);
      else if (segment.length) {
        segments.push(segment);
        segment = [];
      }
    });
    if (segment.length) segments.push(segment);
    return segments;
  }

  function svgElement(tag, attributes = {}, text = "") {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    if (text !== "") node.textContent = text;
    return node;
  }

  function setSyncStatus(type, text) {
    dom.syncStatus.className = `sync-status${type === "loading" ? " loading" : type === "error" ? " error" : ""}`;
    dom.syncStatus.innerHTML = `<span class="sync-dot"></span><span>${escapeHtml(text)}</span>`;
  }

  function showLoadingShell() {
    dom.kpiGrid.innerHTML = Array.from({ length: 4 }, () => '<article class="kpi panel loading-shell"></article>').join("");
    dom.weeklyOverviewGrid.innerHTML = Array.from({ length: 5 }, () => '<article class="week-overview-card loading-shell" style="height:180px"></article>').join("");
  }

  function showErrorNotice(message) {
    dom.dataNotice.classList.add("error");
    dom.dataNotice.innerHTML = `<span>⚠</span><span><strong>Не вдалося оновити:</strong> ${escapeHtml(message)} Поточні завантажені дані залишено на екрані.</span>`;
  }

  function showFatalError(message) {
    const block = `<div class="empty"><div><strong>Дашборд не може завантажити дані.</strong><br>${escapeHtml(message)}<br><br>Перевірте, чи GitHub Actions успішно створив файл <code>data/report.json</code>.</div></div>`;
    dom.kpiGrid.innerHTML = block;
    dom.weeklyOverviewGrid.innerHTML = block;
    dom.chartChats.innerHTML = block;
    dom.chartNumbers.innerHTML = block;
    dom.chartConversion.innerHTML = block;
    dom.tableWrap.innerHTML = block;
  }

  function plural(number, one, few, many) {
    const absolute = Math.abs(number) % 100;
    const last = absolute % 10;
    if (absolute > 10 && absolute < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const value = Number.parseInt(clean.length === 3 ? clean.split("").map((char) => char + char).join("") : clean, 16);
    const red = value >> 16 & 255;
    const green = value >> 8 & 255;
    const blue = value & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function debounce(callback, wait) {
    let timeout;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => callback(...args), wait);
    };
  }
})();
