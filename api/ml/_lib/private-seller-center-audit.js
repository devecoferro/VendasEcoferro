const RETURN_KEYWORDS = ["devolu", "return"];
const REVIEW_KEYWORDS = ["revis", "review"];
const COMPLETED_KEYWORDS = ["concluid", "completed"];
const NOT_COMPLETED_KEYWORDS = ["nao conclu", "not completed"];
const UNREAD_MESSAGE_KEYWORDS = ["mensagens nao lidas", "unread"];

function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

function normalizeText(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function hasAnyKeyword(value, keywords) {
  const normalized = normalizeText(value);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function normalizeTasks(snapshot) {
  if (Array.isArray(snapshot?.tasks) && snapshot.tasks.length > 0) {
    return snapshot.tasks;
  }

  if (!Array.isArray(snapshot?.cards)) {
    return [];
  }

  return snapshot.cards.flatMap((card) =>
    (Array.isArray(card?.tasks) ? card.tasks : []).map((task) => ({
      ...task,
      card_key: card?.key || null,
      card_label: card?.label || null,
    }))
  );
}

function sumTaskCounts(tasks, predicate) {
  return tasks.reduce((total, task) => {
    if (!predicate(task)) {
      return total;
    }

    return total + normalizeInteger(task?.count);
  }, 0);
}

export function derivePrivateSellerCenterPostSaleMetrics(snapshot = {}) {
  const cards = Array.isArray(snapshot?.cards) ? snapshot.cards : [];
  const tasks = normalizeTasks(snapshot);
  const matchedCards = cards.filter((card) => hasAnyKeyword(card?.label, RETURN_KEYWORDS));
  const returnsInProgress = matchedCards.reduce(
    (total, card) => total + normalizeInteger(card?.count),
    0
  );
  const inReview = sumTaskCounts(tasks, (task) => hasAnyKeyword(task?.label, REVIEW_KEYWORDS));
  const notCompleted = sumTaskCounts(tasks, (task) =>
    hasAnyKeyword(task?.label, NOT_COMPLETED_KEYWORDS)
  );
  const unreadMessages = sumTaskCounts(tasks, (task) =>
    hasAnyKeyword(task?.label, UNREAD_MESSAGE_KEYWORDS)
  );
  const completed = sumTaskCounts(
    tasks,
    (task) =>
      hasAnyKeyword(task?.label, COMPLETED_KEYWORDS) &&
      !hasAnyKeyword(task?.label, NOT_COMPLETED_KEYWORDS)
  );
  const rawButtonCount = normalizeInteger(snapshot?.post_sale_count);
  const actionRequired = inReview + notCompleted + unreadMessages;

  let source = "none";
  let operationalCount = 0;

  if (
    returnsInProgress > 0 ||
    inReview > 0 ||
    completed > 0 ||
    notCompleted > 0 ||
    unreadMessages > 0
  ) {
    source = "cards_tasks";
    operationalCount =
      returnsInProgress > 0
        ? returnsInProgress
        : completed + notCompleted + inReview + unreadMessages;
  } else if (rawButtonCount > 0) {
    source = "button";
    operationalCount = rawButtonCount;
  }

  return {
    source,
    raw_button_count: rawButtonCount,
    operational_count: operationalCount,
    returns_in_progress: returnsInProgress,
    in_review: inReview,
    completed,
    not_completed: notCompleted,
    unread_messages: unreadMessages,
    action_required: actionRequired,
    matched_cards: matchedCards,
  };
}

export function buildPrivateSellerCenterPostSaleAudit(snapshots = [], snapshotStatus = {}) {
  const views = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => {
      const metrics = derivePrivateSellerCenterPostSaleMetrics(snapshot);
      return {
        store: snapshot?.store || "all",
        view_label: snapshot?.view_label || snapshot?.store || "Snapshot",
        selected_tab: snapshot?.selected_tab || "TAB_TODAY",
        selected_tab_label: snapshot?.selected_tab_label || snapshot?.selected_tab || "TAB_TODAY",
        captured_at: snapshot?.captured_at || null,
        source: metrics.source,
        operational_count: metrics.operational_count,
        raw_button_count: metrics.raw_button_count,
        returns_in_progress: metrics.returns_in_progress,
        in_review: metrics.in_review,
        completed: metrics.completed,
        not_completed: metrics.not_completed,
        unread_messages: metrics.unread_messages,
        action_required: metrics.action_required,
        cards: metrics.matched_cards,
      };
    })
    .filter(
      (view) =>
        view.operational_count > 0 ||
        view.raw_button_count > 0 ||
        view.completed > 0 ||
        view.not_completed > 0
    )
    .sort((left, right) => {
      const leftKey = `${left.store}::${left.selected_tab}::${left.captured_at || ""}`;
      const rightKey = `${right.store}::${right.selected_tab}::${right.captured_at || ""}`;
      return leftKey.localeCompare(rightKey);
    });

  const totals = views.reduce(
    (accumulator, view) => {
      accumulator.operational_total += normalizeInteger(view.operational_count);
      accumulator.raw_button_total += normalizeInteger(view.raw_button_count);
      accumulator.returns_in_progress += normalizeInteger(view.returns_in_progress);
      accumulator.in_review += normalizeInteger(view.in_review);
      accumulator.completed += normalizeInteger(view.completed);
      accumulator.not_completed += normalizeInteger(view.not_completed);
      accumulator.unread_messages += normalizeInteger(view.unread_messages);
      accumulator.action_required += normalizeInteger(view.action_required);
      return accumulator;
    },
    {
      operational_total: 0,
      raw_button_total: 0,
      returns_in_progress: 0,
      in_review: 0,
      completed: 0,
      not_completed: 0,
      unread_messages: 0,
      action_required: 0,
    }
  );

  return {
    status: views.length > 0 ? "available" : snapshotStatus?.status || "missing",
    note:
      views.length > 0
        ? "Auditoria privada do Seller Center derivada de cards e subtarefas. O count bruto do botão de pós-venda permanece auxiliar quando a UI não expõe um valor confiável."
        : "Sem captura privada suficiente para auditoria de pós-venda.",
    source: "private_seller_center_snapshot.cards+tasks",
    last_captured_at: snapshotStatus?.last_captured_at || null,
    totals,
    views,
  };
}
