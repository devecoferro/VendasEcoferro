import { describe, expect, it } from "vitest";

import { __dashboardTestables } from "../../api/ml/dashboard.js";

function buildOrder({
  saleDate = "2026-04-06T10:00:00.000-03:00",
  orderStatus = "paid",
  shipmentStatus = "ready_to_ship",
  shipmentSubstatus = "ready_for_pickup",
  expectedDate = "2026-04-06T00:00:00.000-03:00",
  depositKey = "store:79856028",
  logisticType = "cross_docking",
}: {
  saleDate?: string;
  orderStatus?: string;
  shipmentStatus?: string;
  shipmentSubstatus?: string;
  expectedDate?: string;
  depositKey?: string;
  logisticType?: string;
}) {
  return {
    sale_date: saleDate,
    order_status: shipmentStatus,
    raw_data: {
      status: orderStatus,
      shipment_snapshot: {
        status: shipmentStatus,
        substatus: shipmentSubstatus,
        logistic_type: logisticType,
        status_history: {},
        shipping_option: {
          estimated_delivery_limit: expectedDate,
        },
      },
      deposit_snapshot: {
        key: depositKey,
        logistic_type: logisticType,
      },
      sla_snapshot: {
        expected_date: expectedDate,
      },
    },
  };
}

describe("classifyCrossDockingOrder", () => {
  it("keeps ready_for_pickup in the today bucket", () => {
    const order = buildOrder({
      shipmentSubstatus: "ready_for_pickup",
      expectedDate: "2026-04-06T00:00:00.000-03:00",
    });

    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-06")).toBe("today");
  });

  it("keeps in_hub orders in upcoming (aligned with ML Seller Center)", () => {
    // ALINHAMENTO COM ML: in_hub (pedido no hub do transportador) fica em
    // "Próximos dias" no ML Seller Center, mesmo com SLA vencido. O pedido
    // já saiu da responsabilidade do vendedor, não precisa de ação imediata.
    // Antes o teste esperava "in_transit" (comportamento divergente do ML).
    const order = buildOrder({
      shipmentSubstatus: "in_hub",
      expectedDate: "2026-04-02T00:00:00.000-03:00",
    });

    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-06")).toBe(
      "upcoming"
    );
  });

  it("in_packing_list goes to today (aligned with ML UI — coleta diária)", () => {
    // ML Seller Center conta pedidos com substatus operacionais pendentes
    // em "Envios de hoje" independente de SLA — a coleta do dia vai passar,
    // vendedor precisa agir. Observado em comparação real: 58 pedidos em
    // ready_to_print/in_packing_list ficavam em upcoming no app mas ML
    // classificava como today. Sem SLA explícito, presumir "today".
    const order = buildOrder({
      shipmentSubstatus: "in_packing_list",
      expectedDate: "2026-04-10T00:00:00.000-03:00",
    });

    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-06")).toBe("today");
  });
});

describe("classifyNativeMercadoLivreOrder", () => {
  it("counts picked_up as in transit instead of today's shipments", () => {
    const order = buildOrder({
      shipmentSubstatus: "picked_up",
    });

    expect(__dashboardTestables.classifyNativeMercadoLivreOrder(order)).toBe("in_transit");
  });

  it("ignores buffered orders for native cross docking counters", () => {
    const order = buildOrder({
      shipmentStatus: "pending",
      shipmentSubstatus: "buffered",
      expectedDate: "",
    });

    expect(__dashboardTestables.classifyNativeMercadoLivreOrder(order)).toBeNull();
  });

  it("counts shipped orders without substatus as upcoming for store deposits", () => {
    const order = buildOrder({
      shipmentStatus: "shipped",
      shipmentSubstatus: "",
      expectedDate: "",
    });

    expect(__dashboardTestables.classifyNativeMercadoLivreOrder(order)).toBe("upcoming");
  });

  it("counts out_for_delivery as in transit for store deposits", () => {
    const order = buildOrder({
      shipmentStatus: "shipped",
      shipmentSubstatus: "out_for_delivery",
      expectedDate: "",
    });

    expect(__dashboardTestables.classifyNativeMercadoLivreOrder(order)).toBe("in_transit");
  });

  it("ignores waiting_for_withdrawal in the native store counters", () => {
    const order = buildOrder({
      shipmentStatus: "shipped",
      shipmentSubstatus: "waiting_for_withdrawal",
      expectedDate: "",
    });

    expect(__dashboardTestables.classifyNativeMercadoLivreOrder(order)).toBeNull();
  });

  it("counts returned store shipments as finalized", () => {
    const order = buildOrder({
      shipmentStatus: "not_delivered",
      shipmentSubstatus: "returned",
      expectedDate: "",
    });

    expect(__dashboardTestables.classifyNativeMercadoLivreOrder(order)).toBe("finalized");
  });
});

describe("classifySellerCenterMirrorEntity", () => {
  it("keeps active returns in the upcoming bucket", () => {
    expect(
      __dashboardTestables.classifySellerCenterMirrorEntity("returns", {
        raw_status: "opened",
      })
    ).toBe("upcoming");
  });

  it("moves closed claims to finalized", () => {
    expect(
      __dashboardTestables.classifySellerCenterMirrorEntity("claims", {
        raw_status: "closed",
      })
    ).toBe("finalized");
  });

  it("moves transit-like post-sale entities to in_transit", () => {
    expect(
      __dashboardTestables.classifySellerCenterMirrorEntity("returns", {
        raw_status: "in_transit_back_to_seller",
      })
    ).toBe("in_transit");
  });

  it("does not count packs directly as mirror buckets", () => {
    expect(
      __dashboardTestables.classifySellerCenterMirrorEntity("packs", {
        raw_status: "released",
      })
    ).toBeNull();
  });
});

describe("isOrderUnderReview", () => {
  it("flags cancelled operational exceptions for attention", () => {
    const order = buildOrder({
      shipmentStatus: "not_delivered",
      shipmentSubstatus: "returned",
      expectedDate: "",
    });

    expect(__dashboardTestables.isOrderUnderReview(order)).toBe(true);
  });

  it("ignores ready_to_ship orders without review signals", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "ready_for_pickup",
    });

    expect(__dashboardTestables.isOrderUnderReview(order)).toBe(false);
  });
});

describe("isOrderForCollection", () => {
  it("keeps ready_for_pickup orders in the collection queue", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "ready_for_pickup",
    });

    expect(__dashboardTestables.isOrderForCollection(order)).toBe(true);
  });

  it("does not include invoice_pending orders in the collection queue", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "invoice_pending",
    });

    expect(__dashboardTestables.isOrderForCollection(order)).toBe(false);
  });
});

// Regressões específicas descobertas em 2026-04-23 via engenharia reversa
// do ML Seller Center (ver docs/ml-bricks-reverse-engineered.md).
describe("classifyCrossDockingOrder — regressoes 2026-04-23", () => {
  it("pedido 2000016018511684: in_packing_list + paid → today (SLA vencido)", () => {
    // Cenario real: nosso DB tem substatus=in_packing_list, ML UI ja moveu
    // pra "A caminho" mas a API dele ainda retorna in_packing_list. O
    // classifier LOCAL acerta em mandar pra today (regra linha 566-570
    // do dashboard.js), e o fix do snapshot subtrai do bucket no frontend.
    const order = buildOrder({
      orderStatus: "paid",
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "in_packing_list",
      expectedDate: "2026-04-22T23:59:59.000-03:00",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("today");
  });

  it("picked_up vai pra in_transit (nao today)", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "picked_up",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("in_transit");
  });

  it("authorized_by_carrier vai pra in_transit", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "authorized_by_carrier",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("in_transit");
  });

  it("cancelled fica em finalized (nao today, mesmo com SLA hoje)", () => {
    const order = buildOrder({
      orderStatus: "cancelled",
      shipmentStatus: "cancelled",
      shipmentSubstatus: "",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("finalized");
  });

  it("packed vai pra today (pronto pra envio)", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "packed",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("today");
  });

  it("ready_to_print vai pra today (coleta do dia passa)", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "ready_to_print",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("today");
  });

  it("invoice_pending vai pra upcoming (aguardando NF)", () => {
    const order = buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "invoice_pending",
    });
    expect(__dashboardTestables.classifyCrossDockingOrder(order, "2026-04-23"))
      .toBe("upcoming");
  });
});

describe("classifyFulfillmentOrder — cobertura basica", () => {
  function buildFulfillmentOrder(overrides: Record<string, unknown> = {}) {
    return buildOrder({
      shipmentStatus: "ready_to_ship",
      shipmentSubstatus: "in_warehouse",
      depositKey: "logistic:fulfillment",
      logisticType: "fulfillment",
      ...overrides,
    });
  }

  it("status cancelled → finalized", () => {
    const order = buildFulfillmentOrder({ orderStatus: "cancelled" });
    expect(
      __dashboardTestables.classifyFulfillmentOrder(order, "2026-04-23", null)
    ).toBe("finalized");
  });

  it("status delivered → finalized", () => {
    const order = buildFulfillmentOrder({
      orderStatus: "paid",
      shipmentStatus: "delivered",
      shipmentSubstatus: "",
    });
    expect(
      __dashboardTestables.classifyFulfillmentOrder(order, "2026-04-23", null)
    ).toBe("finalized");
  });
});
