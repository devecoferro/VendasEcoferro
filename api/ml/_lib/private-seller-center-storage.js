import { randomUUID } from "node:crypto";
import { db } from "../../_lib/db.js";

const STORE_LABEL_FALLBACKS = {
  all: "Todas as vendas",
  unknown: "Vendas sem depósito",
  full: "Full",
};

const TAB_LABEL_FALLBACKS = {
  TAB_TODAY: "Envios de hoje",
  TAB_NEXT_DAYS: "Próximos dias",
  TAB_IN_THE_WAY: "Em trânsito",
  TAB_FINISHED: "Finalizadas",
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

function parseJsonSafely(value, fallback) {
  if (!value) return fallback;

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSnapshotCounts(counts = {}) {
  const source =
    counts && typeof counts === "object" && !Array.isArray(counts) ? counts : {};

  return {
    today: normalizeInteger(
      source.today ?? source.tab_today_count ?? source.TAB_TODAY
    ),
    upcoming: normalizeInteger(
      source.upcoming ??
        source.next_days ??
        source.tab_next_days_count ??
        source.TAB_NEXT_DAYS
    ),
    in_transit: normalizeInteger(
      source.in_transit ??
        source.inTheWay ??
        source.tab_in_the_way_count ??
        source.TAB_IN_THE_WAY
    ),
    finalized: normalizeInteger(
      source.finalized ??
        source.finished ??
        source.tab_finished_count ??
        source.TAB_FINISHED
    ),
  };
}

function normalizeTask(task, index = 0) {
  if (!task || typeof task !== "object") {
    return null;
  }

  return {
    key: normalizeNullable(task.key) || `task-${index + 1}`,
    label: normalizeNullable(task.label) || `Tarefa ${index + 1}`,
    count: normalizeInteger(task.count),
  };
}

function normalizeCards(cards = []) {
  if (!Array.isArray(cards)) {
    return [];
  }

  return cards
    .map((card, index) => {
      if (!card || typeof card !== "object") {
        return null;
      }

      const normalizedTasks = Array.isArray(card.tasks)
        ? card.tasks.map(normalizeTask).filter(Boolean)
        : [];

      return {
        key: normalizeNullable(card.key) || `card-${index + 1}`,
        label: normalizeNullable(card.label) || `Card ${index + 1}`,
        count: normalizeInteger(card.count),
        tag: normalizeNullable(card.tag),
        tasks: normalizedTasks,
      };
    })
    .filter(Boolean);
}

function flattenTasksFromCards(cards) {
  return cards.flatMap((card) =>
    (Array.isArray(card.tasks) ? card.tasks : []).map((task) => ({
      card_key: card.key,
      card_label: card.label,
      key: task.key,
      label: task.label,
      count: normalizeInteger(task.count),
    }))
  );
}

function normalizeSnapshotRecord(record, defaults = {}) {
  const counts = normalizeSnapshotCounts(record?.tab_counts || record?.counts || record);
  const cards = normalizeCards(record?.cards);
  const tasks = Array.isArray(record?.tasks)
    ? record.tasks.map(normalizeTask).filter(Boolean)
    : flattenTasksFromCards(cards);
  const rawPayload =
    record?.raw_payload && typeof record.raw_payload === "object"
      ? record.raw_payload
      : record?.payload && typeof record.payload === "object"
        ? record.payload
        : record?.rawPayload && typeof record.rawPayload === "object"
          ? record.rawPayload
          : {};
  const capturedAt =
    normalizeNullable(record?.captured_at) ||
    normalizeNullable(defaults.captured_at) ||
    nowIso();
  const store =
    normalizeNullable(record?.store) ||
    normalizeNullable(record?.view_selector) ||
    normalizeNullable(defaults.store) ||
    "all";
  const selectedTab =
    normalizeNullable(record?.selected_tab) ||
    normalizeNullable(defaults.selected_tab) ||
    "TAB_TODAY";

  return {
    id: normalizeNullable(record?.id) || randomUUID(),
    connection_id:
      normalizeNullable(record?.connection_id) ||
      normalizeNullable(defaults.connection_id),
    seller_id:
      normalizeNullable(record?.seller_id) || normalizeNullable(defaults.seller_id),
    store,
    view_selector:
      normalizeNullable(record?.view_selector) ||
      normalizeNullable(defaults.view_selector) ||
      store,
    view_label:
      normalizeNullable(record?.view_label) ||
      normalizeNullable(defaults.view_label) ||
      STORE_LABEL_FALLBACKS[store] ||
      store,
    selected_tab: selectedTab,
    selected_tab_label:
      normalizeNullable(record?.selected_tab_label) ||
      normalizeNullable(defaults.selected_tab_label) ||
      TAB_LABEL_FALLBACKS[selectedTab] ||
      selectedTab,
    tab_today_count: counts.today,
    tab_next_days_count: counts.upcoming,
    tab_in_the_way_count: counts.in_transit,
    tab_finished_count: counts.finalized,
    post_sale_count: normalizeInteger(record?.post_sale_count ?? record?.postSaleCount),
    cards_payload: cards,
    tasks_payload: tasks,
    raw_payload: rawPayload,
    captured_at: capturedAt,
    created_at: normalizeNullable(record?.created_at) || nowIso(),
    updated_at: normalizeNullable(record?.updated_at) || nowIso(),
  };
}

function mapSnapshotRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    connection_id: row.connection_id,
    seller_id: row.seller_id,
    store: row.store,
    view_selector: row.view_selector,
    view_label: row.view_label,
    selected_tab: row.selected_tab,
    selected_tab_label: row.selected_tab_label,
    tab_counts: {
      today: normalizeInteger(row.tab_today_count),
      upcoming: normalizeInteger(row.tab_next_days_count),
      in_transit: normalizeInteger(row.tab_in_the_way_count),
      finalized: normalizeInteger(row.tab_finished_count),
    },
    post_sale_count: normalizeInteger(row.post_sale_count),
    cards: parseJsonSafely(row.cards_payload, []),
    tasks: parseJsonSafely(row.tasks_payload, []),
    raw_payload: parseJsonSafely(row.raw_payload, {}),
    captured_at: row.captured_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listPrivateSellerCenterSnapshots(options = {}) {
  const sellerId = normalizeNullable(options.sellerId);
  const store = normalizeNullable(options.store);
  const selectedTab = normalizeNullable(options.selectedTab);
  const parsedLimit = Number(options.limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 500))
    : 50;
  const filters = [];
  const params = [];

  if (sellerId) {
    filters.push("seller_id = ?");
    params.push(sellerId);
  }

  if (store) {
    filters.push("store = ?");
    params.push(store);
  }

  if (selectedTab) {
    filters.push("selected_tab = ?");
    params.push(selectedTab);
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

  return db
    .prepare(
      `SELECT * FROM private_seller_center_snapshots
       ${whereClause}
       ORDER BY datetime(captured_at) DESC
       LIMIT ?`
    )
    .all(...params, safeLimit)
    .map(mapSnapshotRow);
}

export function getLatestPrivateSellerCenterSnapshotByStore(options = {}) {
  const snapshots = listPrivateSellerCenterSnapshots({
    sellerId: options.sellerId,
    store: options.store,
    selectedTab: options.selectedTab,
    limit: 1,
  });

  return snapshots[0] || null;
}

export function getLatestPrivateSellerCenterSnapshotsByStore(options = {}) {
  const sellerId = normalizeNullable(options.sellerId);
  const rows = listPrivateSellerCenterSnapshots({
    sellerId,
    limit: options.limit || 200,
  });
  const latestByStore = new Map();

  for (const row of rows) {
    if (!latestByStore.has(row.store)) {
      latestByStore.set(row.store, row);
    }
  }

  return Array.from(latestByStore.values());
}

export function getLatestPrivateSellerCenterSnapshotsByStoreAndTab(options = {}) {
  const sellerId = normalizeNullable(options.sellerId);
  const parsedLimit = Number(options.limit);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 200))
    : 64;

  const query = sellerId
    ? `WITH ranked_snapshots AS (
         SELECT
           *,
           ROW_NUMBER() OVER (
             PARTITION BY store, COALESCE(selected_tab, 'TAB_TODAY')
             ORDER BY datetime(captured_at) DESC, datetime(updated_at) DESC, id DESC
           ) AS row_number
         FROM private_seller_center_snapshots
         WHERE seller_id = ?
       )
       SELECT *
       FROM ranked_snapshots
       WHERE row_number = 1
       ORDER BY datetime(captured_at) DESC, store ASC, selected_tab ASC
       LIMIT ?`
    : `WITH ranked_snapshots AS (
         SELECT
           *,
           ROW_NUMBER() OVER (
             PARTITION BY store, COALESCE(selected_tab, 'TAB_TODAY')
             ORDER BY datetime(captured_at) DESC, datetime(updated_at) DESC, id DESC
           ) AS row_number
         FROM private_seller_center_snapshots
       )
       SELECT *
       FROM ranked_snapshots
       WHERE row_number = 1
       ORDER BY datetime(captured_at) DESC, store ASC, selected_tab ASC
       LIMIT ?`;

  const rows = sellerId
    ? db.prepare(query).all(sellerId, safeLimit)
    : db.prepare(query).all(safeLimit);

  return rows.map(mapSnapshotRow);
}

export function insertPrivateSellerCenterSnapshots(records, defaults = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  const stmt = db.prepare(
    `INSERT INTO private_seller_center_snapshots (
      id,
      connection_id,
      seller_id,
      store,
      view_selector,
      view_label,
      selected_tab,
      selected_tab_label,
      tab_today_count,
      tab_next_days_count,
      tab_in_the_way_count,
      tab_finished_count,
      post_sale_count,
      cards_payload,
      tasks_payload,
      raw_payload,
      captured_at,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @connection_id,
      @seller_id,
      @store,
      @view_selector,
      @view_label,
      @selected_tab,
      @selected_tab_label,
      @tab_today_count,
      @tab_next_days_count,
      @tab_in_the_way_count,
      @tab_finished_count,
      @post_sale_count,
      @cards_payload,
      @tasks_payload,
      @raw_payload,
      @captured_at,
      @created_at,
      @updated_at
    )
    ON CONFLICT(seller_id, store, selected_tab, captured_at) DO UPDATE SET
      connection_id = excluded.connection_id,
      view_selector = excluded.view_selector,
      view_label = excluded.view_label,
      selected_tab_label = excluded.selected_tab_label,
      tab_today_count = excluded.tab_today_count,
      tab_next_days_count = excluded.tab_next_days_count,
      tab_in_the_way_count = excluded.tab_in_the_way_count,
      tab_finished_count = excluded.tab_finished_count,
      post_sale_count = excluded.post_sale_count,
      cards_payload = excluded.cards_payload,
      tasks_payload = excluded.tasks_payload,
      raw_payload = excluded.raw_payload,
      updated_at = excluded.updated_at`
  );

  const normalized = records
    .map((record) => normalizeSnapshotRecord(record, defaults))
    .filter((record) => Boolean(record.seller_id));

  const transaction = db.transaction((rows) => {
    for (const row of rows) {
      const existing = db
        .prepare(
          `SELECT id, created_at
           FROM private_seller_center_snapshots
           WHERE seller_id = ?
             AND store = ?
             AND selected_tab = ?
             AND captured_at = ?
           LIMIT 1`
        )
        .get(row.seller_id, row.store, row.selected_tab, row.captured_at);

      stmt.run({
        ...row,
        id: existing?.id || row.id,
        created_at: existing?.created_at || row.created_at,
        cards_payload: JSON.stringify(row.cards_payload || []),
        tasks_payload: JSON.stringify(row.tasks_payload || []),
        raw_payload: JSON.stringify(row.raw_payload || {}),
      });
    }
  });

  transaction(normalized);

  return normalized.map((record) =>
    getLatestPrivateSellerCenterSnapshotByStore({
      sellerId: record.seller_id,
      store: record.store,
      selectedTab: record.selected_tab,
    })
  );
}

export function getPrivateSellerCenterSnapshotStatus(options = {}) {
  const sellerId = normalizeNullable(options.sellerId);
  const row = sellerId
    ? db
        .prepare(
          `SELECT COUNT(*) AS total, MAX(captured_at) AS last_captured_at
           FROM private_seller_center_snapshots
           WHERE seller_id = ?`
        )
        .get(sellerId)
    : db
        .prepare(
          `SELECT COUNT(*) AS total, MAX(captured_at) AS last_captured_at
           FROM private_seller_center_snapshots`
        )
        .get();

  return {
    status: Number(row?.total || 0) > 0 ? "available" : "missing",
    total_snapshots: Number(row?.total || 0),
    last_captured_at: row?.last_captured_at || null,
  };
}
