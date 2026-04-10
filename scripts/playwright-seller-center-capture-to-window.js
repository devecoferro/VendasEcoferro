async (page) => {
  const SELLER_CENTER_BASE_URL = "https://www.mercadolivre.com.br/vendas/omni/lista";

  const STORE_VIEWS = [
    { store: "all", view_selector: "all", view_label: "Todas as vendas" },
    { store: "unknown", view_selector: "unknown", view_label: "Vendas sem deposito" },
    { store: "79856028", view_selector: "79856028", view_label: "Ourinhos Rua Dario Alonso" },
    { store: "full", view_selector: "full", view_label: "Full" },
  ];

  const TAB_LABELS = {
    TAB_TODAY: "Envios de hoje",
    TAB_NEXT_DAYS: "Proximos dias",
    TAB_IN_THE_WAY: "Em transito",
    TAB_FINISHED: "Finalizadas",
  };

  const TARGET_PRIVATE_PATHS = {
    tabs: "/sales-omni/packs/marketshops/operations-dashboard/tabs",
    actions: "/sales-omni/packs/marketshops/operations-dashboard/actions",
    dashboard: "/sales-omni/packs/marketshops/operations-dashboard",
    list: "/sales-omni/packs/marketshops/list",
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeString(value, fallback = "") {
    if (value == null) return fallback;
    const normalized = String(value).trim();
    return normalized || fallback;
  }

  function normalizeInteger(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.trunc(parsed));
  }

  function parseJsonSafely(value, fallback = null) {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function isObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function walkDeep(value, visitor, currentPath = []) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walkDeep(entry, visitor, [...currentPath, index]));
      return;
    }
    if (!isObject(value)) return;
    visitor(value, currentPath);
    for (const [key, child] of Object.entries(value)) {
      walkDeep(child, visitor, [...currentPath, key]);
    }
  }

  function findFirstDeep(root, predicate) {
    let found = null;
    walkDeep(root, (node, currentPath) => {
      if (!found && predicate(node, currentPath)) {
        found = node;
      }
    });
    return found;
  }

  function objectContainsEndpoint(node, endpointPath) {
    if (!isObject(node)) return false;
    return Object.values(node).some(
      (value) => typeof value === "string" && value.includes(endpointPath)
    );
  }

  function pickNestedPayload(node) {
    if (!node) return null;
    for (const key of ["data", "payload", "response", "body", "result", "value", "props"]) {
      if (node?.[key] != null) return node[key];
    }
    return node;
  }

  function extractCountFromUnknown(value) {
    if (value == null) return 0;
    if (typeof value === "number") return normalizeInteger(value);
    if (typeof value === "string") {
      const matched = value.match(/\d+/);
      return matched ? normalizeInteger(Number.parseInt(matched[0], 10)) : 0;
    }
    if (isObject(value)) {
      for (const key of ["count", "value", "quantity", "total", "badge", "number"]) {
        if (key in value) {
          const resolved = extractCountFromUnknown(value[key]);
          if (resolved > 0) return resolved;
        }
      }
    }
    return 0;
  }

  function normalizeTabKey(segment) {
    return (
      normalizeString(segment?.id) ||
      normalizeString(segment?.key) ||
      normalizeString(segment?.value) ||
      normalizeString(segment?.tab)
    );
  }

  function extractTabsPayload(rawPayload) {
    const tabsNode =
      findFirstDeep(
        rawPayload,
        (node) => node?.uiType === "segmented_actions" && Array.isArray(node?.data?.segments)
      ) ||
      findFirstDeep(rawPayload, (node) =>
        Array.isArray(node?.segments) &&
        node.segments.some((segment) => TAB_LABELS[normalizeTabKey(segment)])
      ) ||
      findFirstDeep(rawPayload, (node) => objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.tabs));

    if (!tabsNode) return null;

    const resolvedNode =
      tabsNode?.uiType === "segmented_actions" && Array.isArray(tabsNode?.data?.segments)
        ? tabsNode.data
        : pickNestedPayload(tabsNode);
    const segments = Array.isArray(resolvedNode?.segments)
      ? resolvedNode.segments
      : Array.isArray(resolvedNode)
        ? resolvedNode
        : [];

    const counts = { today: 0, upcoming: 0, in_transit: 0, finalized: 0 };
    const normalizedSegments = segments.map((segment) => {
      const tabKey = normalizeTabKey(segment);
      const count = extractCountFromUnknown(segment?.count ?? segment);
      if (tabKey === "TAB_TODAY") counts.today = count;
      if (tabKey === "TAB_NEXT_DAYS") counts.upcoming = count;
      if (tabKey === "TAB_IN_THE_WAY") counts.in_transit = count;
      if (tabKey === "TAB_FINISHED") counts.finalized = count;
      return {
        key: tabKey,
        label:
          normalizeString(segment?.text) ||
          normalizeString(segment?.label) ||
          normalizeString(segment?.title) ||
          TAB_LABELS[tabKey] ||
          tabKey,
        count,
      };
    });

    return { counts, segments: normalizedSegments, raw: resolvedNode };
  }

  function extractActionsPayload(rawPayload) {
    const actionsNode =
      findFirstDeep(rawPayload, (node) => node?.id === "post_sale_button_marketshops") ||
      findFirstDeep(rawPayload, (node) => isObject(node?.post_sale_button_marketshops));
    if (!actionsNode) return null;

    const resolvedNode =
      actionsNode?.id === "post_sale_button_marketshops"
        ? actionsNode?.data || actionsNode
        : isObject(actionsNode?.post_sale_button_marketshops)
          ? pickNestedPayload(actionsNode.post_sale_button_marketshops)
          : pickNestedPayload(actionsNode);

    let count = extractCountFromUnknown(resolvedNode);
    if (count === 0 && Array.isArray(resolvedNode?.events)) {
      for (const event of resolvedNode.events) {
        const quantity = event?.data?.tracks?.[0]?.data?.eventData?.quantity;
        count = extractCountFromUnknown(quantity);
        if (count > 0) break;
      }
    }

    return { count, raw: resolvedNode };
  }

  function scoreCardArray(candidate) {
    if (!Array.isArray(candidate) || candidate.length === 0) return 0;
    let score = 0;
    for (const item of candidate.slice(0, 6)) {
      if (!isObject(item)) continue;
      if (
        normalizeString(item.label) ||
        normalizeString(item.title) ||
        normalizeString(item.name) ||
        normalizeString(item.headline)
      ) {
        score += 2;
      }
      if (extractCountFromUnknown(item) > 0 || extractCountFromUnknown(item.badge) > 0) {
        score += 1;
      }
      if (
        Array.isArray(item.tasks) ||
        Array.isArray(item.items) ||
        Array.isArray(item.rows) ||
        Array.isArray(item.children)
      ) {
        score += 3;
      }
    }
    return score;
  }

  function findBestCardArray(rawPayload) {
    const candidates = [];
    walkDeep(rawPayload, (node) => {
      if (Array.isArray(node)) {
        const score = scoreCardArray(node);
        if (score > 0) candidates.push({ score, value: node });
      }
      if (Array.isArray(node?.cards)) {
        candidates.push({ score: scoreCardArray(node.cards) + 5, value: node.cards });
      }
      if (Array.isArray(node?.bricks)) {
        candidates.push({ score: scoreCardArray(node.bricks) + 4, value: node.bricks });
      }
    });
    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.value || [];
  }

  function extractTasksFromCard(card) {
    const source = [card?.tasks, card?.items, card?.rows, card?.children].find(Array.isArray) || [];
    return source
      .map((task, index) => {
        if (!isObject(task)) return null;
        const label =
          normalizeString(task.label) ||
          normalizeString(task.title) ||
          normalizeString(task.name) ||
          `Tarefa ${index + 1}`;
        return {
          key: normalizeString(task.key) || normalizeString(task.id) || `task-${index + 1}`,
          label,
          count: extractCountFromUnknown(task),
        };
      })
      .filter(Boolean);
  }

  function normalizeCards(cards) {
    return cards
      .map((card, index) => {
        if (!isObject(card)) return null;
        const label =
          normalizeString(card.label) ||
          normalizeString(card.title) ||
          normalizeString(card.name) ||
          normalizeString(card.headline) ||
          `Card ${index + 1}`;
        return {
          key: normalizeString(card.key) || normalizeString(card.id) || `card-${index + 1}`,
          label,
          count: extractCountFromUnknown(card),
          tag: normalizeString(card.tag),
          tasks: extractTasksFromCard(card),
        };
      })
      .filter(Boolean);
  }

  function extractDashboardPayload(rawPayload) {
    const cardNodes = [];

    walkDeep(rawPayload, (node) => {
      if (
        node?.uiType === "dashboard_operations_card" &&
        typeof node?.id === "string" &&
        !node.id.startsWith("card_placeholder")
      ) {
        cardNodes.push(node);
      }
    });

    if (cardNodes.length > 0) {
      const cards = cardNodes.map((card, index) => ({
        key: normalizeString(card?.id) || `card-${index + 1}`,
        label: normalizeString(card?.data?.label) || `Card ${index + 1}`,
        count: extractCountFromUnknown(card?.data?.count),
        tag: normalizeString(card?.data?.tag),
        tasks: Array.isArray(card?.bricks)
          ? card.bricks
              .filter((task) => task?.uiType === "dashboard_operations_task")
              .map((task, taskIndex) => ({
                key: normalizeString(task?.id) || `task-${taskIndex + 1}`,
                label: normalizeString(task?.data?.label) || `Tarefa ${taskIndex + 1}`,
                count: extractCountFromUnknown(task?.data?.count),
              }))
          : [],
      }));

      return {
        cards,
        raw: rawPayload,
      };
    }

    const dashboardNode =
      findFirstDeep(rawPayload, (node) =>
        objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.dashboard)
      ) || rawPayload;
    const resolvedNode = pickNestedPayload(dashboardNode);
    return {
      cards: normalizeCards(findBestCardArray(resolvedNode)),
      raw: resolvedNode,
    };
  }

  function extractListPayload(rawPayload) {
    const listNode = findFirstDeep(rawPayload, (node) =>
      objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.list)
    );
    if (!listNode) return null;
    const resolvedNode = pickNestedPayload(listNode);
    return {
      total: extractCountFromUnknown(resolvedNode?.total ?? resolvedNode?.count),
      raw: resolvedNode,
    };
  }

  function buildSellerCenterUrl(store, selectedTab) {
    const params = [
      ["search", ""],
      ["limit", "50"],
      ["offset", "0"],
      ["selectedTab", selectedTab],
      ["store", store],
      ["filters", selectedTab],
      ["subFilters", ""],
      ["startPeriod", ""],
    ];

    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

    return `${SELLER_CENTER_BASE_URL}?${query}`;
  }

  async function extractFallbackUiSnapshot(selectedTab, selectedTabLabel) {
    return page.evaluate(({ selectedTab, selectedTabLabel }) => {
      function normalizeIntegerInner(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.trunc(parsed));
      }

      function extractCountFromText(text, label) {
        if (!text) return null;
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`${escaped}\\s*(\\d+)`, "i");
        const matched = text.match(regex);
        return matched ? normalizeIntegerInner(Number.parseInt(matched[1], 10)) : null;
      }

      function extractCountFromLabels(text, labels) {
        for (const label of labels) {
          const value = extractCountFromText(text, label);
          if (value != null) return value;
        }
        return null;
      }

      const bodyText = document.body.innerText || "";
      const counts = {
        today:
          (() => {
            const match = bodyText.match(/(\d+)\s+Envios de hoje/i);
            return match ? normalizeIntegerInner(Number.parseInt(match[1], 10)) : 0;
          })(),
        upcoming:
          (() => {
            const match = bodyText.match(/(\d+)\s+Pr[óo]ximos dias/i);
            return match ? normalizeIntegerInner(Number.parseInt(match[1], 10)) : 0;
          })(),
        in_transit:
          (() => {
            const match = bodyText.match(/(\d+)\s+Em tr[âa]nsito/i);
            return match ? normalizeIntegerInner(Number.parseInt(match[1], 10)) : 0;
          })(),
        finalized:
          (() => {
            const match = bodyText.match(/(\d+)\s+Finalizadas/i);
            return match ? normalizeIntegerInner(Number.parseInt(match[1], 10)) : 0;
          })(),
      };
      const postSaleCount =
        extractCountFromLabels(bodyText, ["Gerenciar Pos-venda", "Gerenciar Pós-venda"]) ?? 0;
      const gridCount = (() => {
        const match = bodyText.match(/(\d+)\s+vendas/i);
        return match ? normalizeIntegerInner(Number.parseInt(match[1], 10)) : 0;
      })();

      const cards = [];
      const seenLabels = new Set();
      const cardNodes = Array.from(document.querySelectorAll("div"))
        .filter((node) => {
          const text = (node.innerText || "").trim();
          return text && text.length < 500 && /\d/.test(text) && text.split("\n").length >= 2;
        })
        .slice(0, 80);

      for (const node of cardNodes) {
        const lines = (node.innerText || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length < 2) continue;
        const label = lines[0];
        if (seenLabels.has(label)) continue;
        const tasks = lines.slice(1).map((line, index) => {
          const matched = line.match(/^(.*?)(\d+)$/);
          return {
            key: `task-${index + 1}`,
            label: matched ? matched[1].trim() : line,
            count: matched ? normalizeIntegerInner(Number.parseInt(matched[2], 10)) : 0,
          };
        });
        cards.push({
          key: `dom-${cards.length + 1}`,
          label,
          count: tasks.reduce((total, task) => total + task.count, 0),
          tag: "",
          tasks,
        });
        seenLabels.add(label);
      }

      return {
        selected_tab: selectedTab,
        selected_tab_label: selectedTabLabel,
        tab_counts: counts,
        post_sale_count: postSaleCount,
        grid_count: gridCount,
        cards,
      };
    }, { selectedTab, selectedTabLabel });
  }

  function createCollector() {
    const captured = {
      events: [],
      tabs: null,
      actions: null,
      dashboard: null,
      list: null,
    };

    function scoreTabs(candidate) {
      if (!candidate) return -1;
      const counts = candidate.counts || {};
      const nonZero = ["today", "upcoming", "in_transit", "finalized"].filter(
        (key) => normalizeInteger(counts[key]) > 0
      ).length;
      return nonZero * 100 + (Array.isArray(candidate.segments) ? candidate.segments.length : 0);
    }

    function scoreActions(candidate) {
      if (!candidate) return -1;
      return normalizeInteger(candidate.count);
    }

    function scoreDashboard(candidate) {
      if (!candidate || !Array.isArray(candidate.cards)) return -1;
      return candidate.cards.reduce(
        (total, card) => total + 1 + (Array.isArray(card.tasks) ? card.tasks.length : 0),
        0
      );
    }

    function scoreList(candidate) {
      if (!candidate) return -1;
      return normalizeInteger(candidate.total);
    }

    return {
      async handleResponse(response) {
        const url = response.url();
        if (!url.includes("/vendas/omni/lista/api/channels/event-request")) {
          return;
        }
        let requestBody = null;
        let responseBody = null;
        try {
          requestBody = parseJsonSafely(response.request().postData(), null);
        } catch {}
        try {
          responseBody = await response.json();
        } catch {}

        captured.events.push({
          captured_at: nowIso(),
          request: requestBody,
          response: responseBody,
        });

        const tabsCandidate = extractTabsPayload(responseBody);
        if (scoreTabs(tabsCandidate) > scoreTabs(captured.tabs)) {
          captured.tabs = tabsCandidate;
        }

        const actionsCandidate = extractActionsPayload(responseBody);
        if (scoreActions(actionsCandidate) > scoreActions(captured.actions)) {
          captured.actions = actionsCandidate;
        }

        const dashboardCandidate = extractDashboardPayload(responseBody);
        if (scoreDashboard(dashboardCandidate) > scoreDashboard(captured.dashboard)) {
          captured.dashboard = dashboardCandidate;
        }

        const listCandidate = extractListPayload(responseBody);
        if (scoreList(listCandidate) > scoreList(captured.list)) {
          captured.list = listCandidate;
        }
      },
      hasMinimumData() {
        return Boolean(captured.tabs || captured.actions || captured.dashboard || captured.list);
      },
      getState() {
        return captured;
      },
      buildRawPayload() {
        return {
          captured_at: nowIso(),
          tabs: captured.tabs?.raw || null,
          actions: captured.actions?.raw || null,
          dashboard: captured.dashboard?.raw || null,
          list: captured.list?.raw || null,
          event_requests: captured.events,
        };
      },
    };
  }

  async function captureViewTab(view, selectedTab, selectedTabLabel) {
    const collector = createCollector();
    const responseListener = (response) => {
      void collector.handleResponse(response);
    };
    page.on("response", responseListener);

    try {
      await page.goto(buildSellerCenterUrl(view.store, selectedTab), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && !collector.hasMinimumData()) {
        await page.waitForTimeout(500);
      }

      const fallbackUi = await extractFallbackUiSnapshot(selectedTab, selectedTabLabel);
      const state = collector.getState();
      return {
        store: view.store,
        view_selector: view.view_selector,
        view_label: view.view_label,
        selected_tab: selectedTab,
        selected_tab_label: selectedTabLabel,
        tab_counts: state.tabs?.counts || fallbackUi.tab_counts,
        post_sale_count: normalizeInteger(state.actions?.count) || fallbackUi.post_sale_count || 0,
        grid_count: normalizeInteger(state.list?.total) || fallbackUi.grid_count || 0,
        cards:
          (Array.isArray(state.dashboard?.cards) && state.dashboard.cards.length > 0
            ? state.dashboard.cards
            : fallbackUi.cards) || [],
        raw_payload: {
          tabs: state.tabs?.raw || null,
          actions: state.actions?.raw || null,
          dashboard: state.dashboard?.raw || null,
          list: state.list?.raw || null,
          page_url: page.url(),
          page_title: await page.title(),
        },
        captured_at: nowIso(),
      };
    } finally {
      page.off("response", responseListener);
    }
  }

  await page.waitForURL(/\/vendas\/omni\/lista/i, { timeout: 15000 });

  const snapshots = [];
  for (const [selectedTab, selectedTabLabel] of Object.entries(TAB_LABELS)) {
    for (const view of STORE_VIEWS) {
      snapshots.push(await captureViewTab(view, selectedTab, selectedTabLabel));
    }
  }

  const report = {
    captured_at: nowIso(),
    snapshot_count: snapshots.length,
    snapshots,
  };

  await page.evaluate((value) => {
    window.__ecoferroSellerAudit = value;
    window.sessionStorage.setItem("__ecoferroSellerAuditMeta", JSON.stringify({
      captured_at: value.captured_at,
      snapshot_count: value.snapshot_count,
    }));
  }, report);

  return {
    captured_at: report.captured_at,
    snapshot_count: report.snapshot_count,
    first_rows: snapshots.slice(0, 4).map((snapshot) => ({
      store: snapshot.store,
      selected_tab: snapshot.selected_tab,
      tab_counts: snapshot.tab_counts,
      post_sale_count: snapshot.post_sale_count,
      grid_count: snapshot.grid_count,
    })),
  };
}
