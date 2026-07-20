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
  const weekDayFmt = new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit"
  });

  const state = {
    report: null,
    managerId: "all",
    month: null,
    platform: "Усі",
    selectedAccounts: new Set(),
    activeWeekId: null,
    isLoading: false
  };

  const dom = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    installWeekDetailUi();
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
      "topSourceLinks", "dataNotice", "managerComparison", "kpiGrid", "weeklyOverviewGrid",
      "legendChats", "legendNumbers", "legendConversion", "chartChats",
      "chartNumbers", "chartConversion", "tableWrap", "sourceLinks",
      "chatsDescription", "numbersDescription", "conversionDescription",
      "weekDetailModal", "weekDetailBackdrop", "weekDetailClose",
      "weekDetailTitle", "weekDetailSubtitle", "weekDetailContent",
      "weekDetailPrev", "weekDetailNext"
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

    dom.weekDetailClose.addEventListener("click", closeWeekDetail);
    dom.weekDetailBackdrop.addEventListener("click", closeWeekDetail);
    dom.weekDetailPrev.addEventListener("click", () => moveWeekDetail(-1));
    dom.weekDetailNext.addEventListener("click", () => moveWeekDetail(1));

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.activeWeekId !== null) closeWeekDetail();
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
      setSyncStatus("ok", `Дані у звіті станом на ${formatGeneratedAt(report.generatedAt)}`);
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
    renderTopSourceLinks();
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
    if (state.activeWeekId !== null) renderWeekDetail();
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

  function renderTopSourceLinks() {
    if (!dom.topSourceLinks) return;

    const managers = state.managerId === "all"
      ? state.report.managers
      : state.report.managers.filter((manager) => manager.id === state.managerId);

    dom.topSourceLinks.innerHTML = managers.map((manager) => `
      <a class="top-source-link" href="${manager.spreadsheetUrl}" target="_blank" rel="noopener noreferrer"
         title="Відкрити Google Таблицю: ${escapeHtml(manager.name)}">
        <span class="sheet-link-icon" aria-hidden="true">▦</span>
        <span>Таблиця ${escapeHtml(manager.name)}</span>
        <span aria-hidden="true">↗</span>
      </a>`).join("");
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
        <button class="week-overview-card week-overview-button${week.hasData ? "" : " is-empty"}" type="button" data-week-id="${week.id}" aria-label="Відкрити детальний перегляд: тиждень ${week.id}, ${escapeHtml(week.label)}">
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
          <span class="week-open-hint">Детальніше <span aria-hidden="true">→</span></span>
        </button>`;
    }).join("");

    dom.weeklyOverviewGrid.querySelectorAll("[data-week-id]").forEach((button) => {
      button.addEventListener("click", () => openWeekDetail(Number(button.dataset.weekId)));
    });
  }

  function installWeekDetailUi() {
    const style = document.createElement("style");
    style.textContent = `
      .week-overview-button {
        width: 100%;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        appearance: none;
        transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
      }
      .week-overview-button:hover {
        transform: translateY(-3px);
        border-color: rgba(79,70,229,.34);
        box-shadow: 0 14px 30px rgba(23,32,51,.10);
      }
      .week-overview-button:focus-visible {
        outline: 3px solid rgba(79,70,229,.28);
        outline-offset: 3px;
      }
      .week-open-hint {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 12px;
        color: var(--primary);
        font-size: 11px;
        font-weight: 850;
        letter-spacing: .025em;
      }
      body.week-detail-open { overflow: hidden; }
      .week-detail-modal[hidden] { display: none; }
      .week-detail-modal {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .week-detail-backdrop {
        position: absolute;
        inset: 0;
        background: rgba(15,23,42,.58);
        backdrop-filter: blur(5px);
      }
      .week-detail-dialog {
        position: relative;
        width: min(1180px, 100%);
        max-height: calc(100vh - 48px);
        overflow: auto;
        overscroll-behavior: contain;
        background: #f7f9fd;
        border: 1px solid rgba(255,255,255,.72);
        border-radius: 24px;
        box-shadow: 0 28px 80px rgba(15,23,42,.28);
      }
      .week-detail-header {
        position: sticky;
        top: 0;
        z-index: 4;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        padding: 22px 24px;
        background: rgba(255,255,255,.96);
        border-bottom: 1px solid var(--line);
        backdrop-filter: blur(14px);
      }
      .week-detail-kicker {
        margin-bottom: 6px;
        color: var(--primary);
        font-size: 11px;
        font-weight: 850;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .week-detail-title {
        margin: 0;
        font-size: clamp(24px,3vw,36px);
        line-height: 1.08;
        letter-spacing: -.035em;
      }
      .week-detail-subtitle {
        margin: 7px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .week-detail-close {
        flex: 0 0 auto;
        width: 42px;
        height: 42px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: #fff;
        color: var(--text);
        font-size: 24px;
        line-height: 1;
        cursor: pointer;
      }
      .week-detail-content { padding: 22px 24px 26px; }
      .week-detail-kpis {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 12px;
        margin-bottom: 18px;
      }
      .week-detail-kpi {
        padding: 17px;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 16px;
      }
      .week-detail-kpi-label {
        color: var(--muted);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: .055em;
        text-transform: uppercase;
      }
      .week-detail-kpi-value {
        display: block;
        margin-top: 8px;
        font-size: 32px;
        line-height: 1;
        font-weight: 900;
        letter-spacing: -.04em;
      }
      .week-detail-section {
        margin-top: 18px;
        padding: 18px;
        background: #fff;
        border: 1px solid var(--line);
        border-radius: 18px;
      }
      .week-detail-section-head {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 13px;
      }
      .week-detail-section-title {
        margin: 0;
        font-size: 18px;
        letter-spacing: -.02em;
      }
      .week-detail-section-note {
        color: var(--muted);
        font-size: 11px;
      }
      .week-detail-manager-grid {
        display: grid;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 12px;
      }
      .week-detail-manager {
        padding: 15px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--card-soft);
      }
      .week-detail-manager-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 850;
      }
      .week-detail-manager-values {
        display: grid;
        grid-template-columns: repeat(3,1fr);
        gap: 8px;
        margin-top: 12px;
      }
      .week-detail-manager-values span {
        display: block;
        color: var(--muted);
        font-size: 10px;
      }
      .week-detail-manager-values strong {
        display: block;
        margin-top: 3px;
        color: var(--text);
        font-size: 18px;
      }
      .week-detail-table-wrap {
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 13px;
      }
      .week-detail-table {
        width: 100%;
        min-width: 680px;
        border-collapse: collapse;
        background: #fff;
      }
      .week-detail-table th,
      .week-detail-table td {
        padding: 11px 12px;
        border-bottom: 1px solid var(--line);
        text-align: right;
        font-size: 12px;
      }
      .week-detail-table th {
        background: #f7f9fc;
        color: var(--muted);
        font-size: 10px;
        letter-spacing: .045em;
        text-transform: uppercase;
      }
      .week-detail-table th:first-child,
      .week-detail-table td:first-child { text-align: left; }
      .week-detail-table tbody tr:last-child td { border-bottom: 0; }
      .week-detail-account-name {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 800;
      }
      .week-detail-account-meta {
        display: block;
        margin-top: 3px;
        color: var(--muted);
        font-size: 10px;
      }
      .week-detail-empty { color: var(--muted); }
      .week-detail-footer {
        position: sticky;
        bottom: 0;
        z-index: 4;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 24px;
        background: rgba(255,255,255,.96);
        border-top: 1px solid var(--line);
        backdrop-filter: blur(14px);
      }
      .week-nav-button {
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #fff;
        color: var(--text);
        padding: 10px 14px;
        font-weight: 800;
        cursor: pointer;
      }
      .week-nav-button:disabled { opacity: .38; cursor: not-allowed; }
      @media (max-width: 720px) {
        .week-detail-modal { padding: 8px; }
        .week-detail-dialog { max-height: calc(100vh - 16px); border-radius: 18px; }
        .week-detail-header { padding: 17px; }
        .week-detail-content { padding: 15px; }
        .week-detail-kpis { grid-template-columns: 1fr; }
        .week-detail-manager-grid { grid-template-columns: 1fr; }
        .week-detail-footer { padding: 12px 15px; }
      }
    `;
    document.head.appendChild(style);

    const modal = document.createElement("div");
    modal.id = "weekDetailModal";
    modal.className = "week-detail-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="week-detail-backdrop" id="weekDetailBackdrop"></div>
      <section class="week-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="weekDetailTitle">
        <header class="week-detail-header">
          <div>
            <div class="week-detail-kicker">Детальний перегляд тижня</div>
            <h2 class="week-detail-title" id="weekDetailTitle"></h2>
            <p class="week-detail-subtitle" id="weekDetailSubtitle"></p>
          </div>
          <button class="week-detail-close" id="weekDetailClose" type="button" aria-label="Закрити">×</button>
        </header>
        <div class="week-detail-content" id="weekDetailContent"></div>
        <footer class="week-detail-footer">
          <button class="week-nav-button" id="weekDetailPrev" type="button">← Попередній тиждень</button>
          <button class="week-nav-button" id="weekDetailNext" type="button">Наступний тиждень →</button>
        </footer>
      </section>`;
    document.body.appendChild(modal);
  }

  function openWeekDetail(weekId) {
    state.activeWeekId = weekId;
    renderWeekDetail();
    dom.weekDetailModal.hidden = false;
    document.body.classList.add("week-detail-open");
    window.setTimeout(() => dom.weekDetailClose.focus(), 0);
  }

  function closeWeekDetail() {
    state.activeWeekId = null;
    dom.weekDetailModal.hidden = true;
    document.body.classList.remove("week-detail-open");
  }

  function moveWeekDetail(direction) {
    if (state.activeWeekId === null) return;
    const next = state.activeWeekId + direction;
    if (next < 1 || next > getWeeks(state.month).length) return;
    state.activeWeekId = next;
    renderWeekDetail();
  }

  function renderWeekDetail() {
    if (state.activeWeekId === null || !state.month) return;
    const weeks = getWeeks(state.month);
    const week = weeks.find((item) => item.id === state.activeWeekId);
    if (!week) {
      closeWeekDetail();
      return;
    }

    const entries = getActiveAccountEntries();
    const accountRows = entries.map(({ manager, account }) => {
      const records = recordsInWeek(account, week);
      const chats = records.reduce((sum, record) => sum + numeric(record.chats), 0);
      const numbers = records.reduce((sum, record) => sum + numeric(record.numbers), 0);
      return {
        manager,
        account,
        chats,
        numbers,
        conversion: chats ? numbers / chats * 100 : 0,
        hasData: records.length > 0
      };
    }).sort((first, second) => (
      second.numbers - first.numbers || second.chats - first.chats || first.account.name.localeCompare(second.account.name, "uk")
    ));

    const chats = accountRows.reduce((sum, row) => sum + row.chats, 0);
    const numbers = accountRows.reduce((sum, row) => sum + row.numbers, 0);
    const conversion = chats ? numbers / chats * 100 : 0;
    const dailyRows = getDateRange(week.start, week.end).map((date) => {
      let dayChats = 0;
      let dayNumbers = 0;
      let hasData = false;
      entries.forEach(({ account }) => {
        account.records.forEach((record) => {
          if (record.date !== date) return;
          hasData = true;
          dayChats += numeric(record.chats);
          dayNumbers += numeric(record.numbers);
        });
      });
      return {
        date,
        chats: dayChats,
        numbers: dayNumbers,
        conversion: dayChats ? dayNumbers / dayChats * 100 : 0,
        hasData
      };
    });

    dom.weekDetailTitle.textContent = `Тиждень ${week.id} · ${week.label}`;
    dom.weekDetailSubtitle.textContent = `${formatMonth(state.month)} · ${entries.length} ${plural(entries.length, "акаунт", "акаунти", "акаунтів")} · ${state.managerId === "all" ? "Тая та Катерина" : getManagersInScope()[0]?.name || ""}`;
    dom.weekDetailPrev.disabled = week.id === 1;
    dom.weekDetailNext.disabled = week.id === weeks.length;

    const managerSection = state.managerId === "all" ? renderWeekManagerBreakdown(accountRows) : "";
    const dailyTableRows = dailyRows.map((day) => `
      <tr class="${day.hasData ? "" : "week-detail-empty"}">
        <td><strong>${escapeHtml(capitalize(weekDayFmt.format(parseIsoDate(day.date))))}</strong></td>
        <td>${day.hasData ? fmt.format(day.chats) : "—"}</td>
        <td>${day.hasData ? fmt.format(day.numbers) : "—"}</td>
        <td class="${day.hasData ? conversionClass(day.conversion) : ""}">${day.hasData ? `${day.conversion.toFixed(1)}%` : "немає даних"}</td>
      </tr>`).join("");

    const accountTableRows = accountRows.map(({ manager, account, chats: accountChats, numbers: accountNumbers, conversion: accountConversion, hasData }) => `
      <tr class="${hasData ? "" : "week-detail-empty"}">
        <td>
          <div class="week-detail-account-name"><span class="dot" style="background:${account.color}"></span>${escapeHtml(account.name)}</div>
          <span class="week-detail-account-meta">${escapeHtml(manager.name)} · ${escapeHtml(account.platform)}</span>
        </td>
        <td>${hasData ? fmt.format(accountChats) : "—"}</td>
        <td>${hasData ? fmt.format(accountNumbers) : "—"}</td>
        <td class="${hasData ? conversionClass(accountConversion) : ""}">${hasData ? `${accountConversion.toFixed(1)}%` : "немає даних"}</td>
      </tr>`).join("");

    dom.weekDetailContent.innerHTML = `
      <div class="week-detail-kpis">
        <div class="week-detail-kpi">
          <span class="week-detail-kpi-label">Усього чатів</span>
          <strong class="week-detail-kpi-value">${fmt.format(chats)}</strong>
        </div>
        <div class="week-detail-kpi">
          <span class="week-detail-kpi-label">Отримано номерів</span>
          <strong class="week-detail-kpi-value">${fmt.format(numbers)}</strong>
        </div>
        <div class="week-detail-kpi">
          <span class="week-detail-kpi-label">Конверсія тижня</span>
          <strong class="week-detail-kpi-value">${conversion.toFixed(1)}%</strong>
        </div>
      </div>

      ${managerSection}

      <section class="week-detail-section">
        <div class="week-detail-section-head">
          <h3 class="week-detail-section-title">Результати по днях</h3>
          <span class="week-detail-section-note">Чати, номери та CR за кожну дату</span>
        </div>
        <div class="week-detail-table-wrap">
          <table class="week-detail-table">
            <thead><tr><th>День</th><th>Чати</th><th>Номери</th><th>Конверсія</th></tr></thead>
            <tbody>${dailyTableRows}</tbody>
          </table>
        </div>
      </section>

      <section class="week-detail-section">
        <div class="week-detail-section-head">
          <h3 class="week-detail-section-title">Результати по акаунтах</h3>
          <span class="week-detail-section-note">Тільки вибрані у фільтрі акаунти</span>
        </div>
        <div class="week-detail-table-wrap">
          <table class="week-detail-table">
            <thead><tr><th>Акаунт</th><th>Чати</th><th>Номери</th><th>Конверсія</th></tr></thead>
            <tbody>${accountTableRows}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderWeekManagerBreakdown(accountRows) {
    const managerCards = state.report.managers.map((manager) => {
      const rows = accountRows.filter((row) => row.manager.id === manager.id);
      const chats = rows.reduce((sum, row) => sum + row.chats, 0);
      const numbers = rows.reduce((sum, row) => sum + row.numbers, 0);
      const conversion = chats ? numbers / chats * 100 : 0;
      return `
        <article class="week-detail-manager">
          <div class="week-detail-manager-name"><span class="dot" style="background:${manager.color}"></span>${escapeHtml(manager.name)}</div>
          <div class="week-detail-manager-values">
            <div><span>Чати</span><strong>${fmt.format(chats)}</strong></div>
            <div><span>Номери</span><strong>${fmt.format(numbers)}</strong></div>
            <div><span>CR</span><strong>${conversion.toFixed(1)}%</strong></div>
          </div>
        </article>`;
    }).join("");

    return `
      <section class="week-detail-section">
        <div class="week-detail-section-head">
          <h3 class="week-detail-section-title">Порівняння direct-менеджерів</h3>
          <span class="week-detail-section-note">Результати лише за вибраний тиждень</span>
        </div>
        <div class="week-detail-manager-grid">${managerCards}</div>
      </section>`;
  }

  function recordsInWeek(account, week) {
    return account.records.filter((record) => record.date >= week.start && record.date <= week.end);
  }

  function getDateRange(start, end) {
    const dates = [];
    const current = parseIsoDate(start);
    const finish = parseIsoDate(end);
    while (current <= finish) {
      dates.push(`${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }

  function capitalize(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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

    // Місяці завжди збираються глобально з обох Google Таблиць.
    // Тому, якщо серпень додано лише в Таї, кнопка «Серпень» все одно
    // буде видима у вкладках «Загалом», «Тая» та «Катерина».
    const months = new Set();
    state.report.managers.forEach((manager) => {
      manager.accounts.forEach((account) => {
        account.records.forEach((record) => {
          if (typeof record.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
            months.add(record.date.slice(0, 7));
          }
        });
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
    const firstDayOfWeek = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();

    // Тижні всередині місяця:
    // 1-й тиждень починається 1 числа і закінчується найближчої неділі.
    // Усі наступні тижні йдуть з понеділка до неділі.
    // Останній тиждень обрізається останнім днем місяця.
    const daysUntilSunday = (7 - firstDayOfWeek) % 7;
    const ranges = [];
    let startDay = 1;
    let endDay = Math.min(1 + daysUntilSunday, daysInMonth);

    ranges.push([startDay, endDay]);
    startDay = endDay + 1;

    while (startDay <= daysInMonth) {
      endDay = Math.min(startDay + 6, daysInMonth);
      ranges.push([startDay, endDay]);
      startDay = endDay + 1;
    }

    return ranges.map(([rangeStartDay, rangeEndDay], index) => ({
      id: index + 1,
      start: `${year}-${pad(monthNumber)}-${pad(rangeStartDay)}`,
      end: `${year}-${pad(monthNumber)}-${pad(rangeEndDay)}`,
      label: `${rangeStartDay}–${rangeEndDay} ${MONTHS_GENITIVE[monthNumber - 1]}`,
      shortLabel: `${pad(rangeStartDay)}–${pad(rangeEndDay)}`
    }));
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
