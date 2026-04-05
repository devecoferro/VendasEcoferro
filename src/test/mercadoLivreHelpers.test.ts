import { describe, expect, it } from "vitest";
import {
  buildDepositOptions,
  filterAndSortOrders,
  getBuyerType,
  hasBillingInfoSnapshot,
  getOperationalCardPresentation,
  getSelectedDepositLabel,
  isOrderInvoicePending,
  isOrderReadyForInvoiceLabel,
  isOrderReadyToPrintLabel,
  isOrderUnderReview,
  matchesOperationalSummaryRow,
  type MercadoLivreFilters,
  type ShipmentBucket,
} from "@/services/mercadoLivreHelpers";
import type { MLDashboardDeposit, MLOrder } from "@/services/mercadoLivreService";

function buildOrder(overrides: Partial<MLOrder> = {}): MLOrder {
  return {
    id: overrides.id || crypto.randomUUID(),
    order_id: overrides.order_id || "2000010000000001",
    sale_number: overrides.sale_number || "2000010000000001",
    sale_date: overrides.sale_date || "2026-04-01T10:00:00.000Z",
    buyer_name: overrides.buyer_name ?? "Cliente teste",
    buyer_nickname: overrides.buyer_nickname ?? "CLIENTETESTE",
    item_title: overrides.item_title ?? "Produto teste",
    item_id: overrides.item_id ?? "MLB123",
    product_image_url: overrides.product_image_url ?? null,
    sku: overrides.sku ?? "SKU001",
    quantity: overrides.quantity ?? 1,
    amount: overrides.amount ?? 100,
    order_status: overrides.order_status ?? "paid",
    items: overrides.items ?? [
      {
        item_title: overrides.item_title ?? "Produto teste",
        sku: overrides.sku ?? "SKU001",
        quantity: overrides.quantity ?? 1,
        amount: overrides.amount ?? 100,
        item_id: overrides.item_id ?? "MLB123",
        product_image_url: overrides.product_image_url ?? null,
      },
    ],
    raw_data: overrides.raw_data ?? {
      status: "paid",
      tags: [],
      payments: [{ status: "approved" }],
      shipment_snapshot: {
        status: "ready_to_ship",
        substatus: "invoice_pending",
        logistic_type: "cross_docking",
      },
      deposit_snapshot: {
        key: "store:1",
        label: "Ourinhos Rua Dario Alonso",
        logistic_type: "cross_docking",
      },
    },
  };
}

describe("mercadoLivreHelpers", () => {
  it("separa pedido liberado no fluxo e pedido realmente imprimível", () => {
    const order = buildOrder();

    expect(isOrderReadyForInvoiceLabel(order)).toBe(true);
    expect(isOrderInvoicePending(order)).toBe(true);
    expect(isOrderReadyToPrintLabel(order)).toBe(false);
  });

  it("detecta comprador negocio a partir da tag b2b", () => {
    const order = buildOrder({
      raw_data: {
        status: "paid",
        tags: ["b2b"],
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          substatus: "invoice_pending",
          logistic_type: "cross_docking",
        },
      },
    });

    expect(getBuyerType(order)).toBe("business");
  });

  it("detecta pedido em revisao por pagamento pendente", () => {
    const order = buildOrder({
      order_status: "payment_required",
      raw_data: {
        status: "payment_required",
        payments: [{ status: "pending" }],
        shipment_snapshot: {
          status: "pending",
          substatus: "waiting_for_review",
        },
      },
    });

    expect(isOrderUnderReview(order)).toBe(true);
    expect(isOrderReadyForInvoiceLabel(order)).toBe(false);
  });

  it("aplica filtros suportados e ordenacao no dataset atual", () => {
    const filters: MercadoLivreFilters = {
      sort: "sale_date_desc",
      buyerTypes: ["person"],
      statuses: ["invoice_pending"],
      deliveryForms: ["collection"],
    };

    const matchingOrder = buildOrder({
      sale_number: "2000010000000002",
      sale_date: "2026-04-01T11:00:00.000Z",
    });
    const filteredOut = buildOrder({
      sale_number: "2000010000000003",
      sale_date: "2026-04-01T09:00:00.000Z",
      raw_data: {
        status: "paid",
        tags: ["b2b"],
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          substatus: "invoice_pending",
          logistic_type: "fulfillment",
        },
      },
    });

    const result = filterAndSortOrders([filteredOut, matchingOrder], "200001", filters);

    expect(result).toHaveLength(1);
    expect(result[0]?.sale_number).toBe("2000010000000002");
  });

  it("monta as opcoes do dropdown de vendas com sem deposito e full separados", () => {
    const ourinhosOrder = buildOrder({
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          logistic_type: "cross_docking",
        },
        deposit_snapshot: {
          key: "store:1",
          label: "Ourinhos Rua Dario Alonso",
          logistic_type: "cross_docking",
        },
      },
    });
    const fullOrder = buildOrder({
      id: "full-order",
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "handling",
          logistic_type: "fulfillment",
        },
        deposit_snapshot: {
          key: "logistic:fulfillment",
          label: "Full",
          logistic_type: "fulfillment",
        },
      },
    });
    const withoutDepositOrder = buildOrder({
      id: "without-deposit",
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          logistic_type: "cross_docking",
        },
        deposit_snapshot: {
          key: "without-deposit",
          label: "Vendas sem deposito",
          logistic_type: "cross_docking",
        },
      },
    });

    const options = buildDepositOptions([ourinhosOrder, fullOrder, withoutDepositOrder]);

    expect(options.map((option) => option.displayLabel)).toEqual([
      "Vendas sem depósito",
      "Ourinhos Rua Dario Alonso",
      "Full",
    ]);
    expect(
      getSelectedDepositLabel(["without-deposit", "store:1"], options)
    ).toBe("Vendas sem depósito + Ourinhos Rua Dario Alonso");
  });

  it("reconhece quando o sync trouxe billing_info real da venda", () => {
    const order = buildOrder({
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          substatus: "invoice_pending",
          logistic_type: "cross_docking",
        },
        billing_info_status: "available",
        billing_info_snapshot: {
          doc_type: "CPF",
          doc_number: "12345678900",
        },
      },
    });

    expect(hasBillingInfoSnapshot(order)).toBe(true);
  });

  it("monta o card operacional de cross docking com linhas do seller center", () => {
    const deposit: MLDashboardDeposit = {
      key: "store:1",
      label: "Ourinhos Rua Dario Alonso",
      logistic_type: "cross_docking",
      lane: "PROGRAMADA",
      headline: "Coleta | Ourinhos Rua Dario Alonso",
      counts: { today: 4, upcoming: 0, in_transit: 0, finalized: 0 },
      order_ids_by_bucket: { today: [], upcoming: [], in_transit: [], finalized: [] },
      operational_source: "shipment_sla+shipment_snapshot",
      total_count: 4,
      summary_rows: [],
    };

    const cancelledOrder = buildOrder({
      id: "cancelled",
      raw_data: {
        status: "cancelled",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "cancelled",
          logistic_type: "cross_docking",
        },
        deposit_snapshot: {
          key: "store:1",
          label: "Ourinhos Rua Dario Alonso",
          logistic_type: "cross_docking",
        },
      },
    });
    const overdueOrder = buildOrder({
      id: "overdue",
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "handling",
          logistic_type: "cross_docking",
          shipping_option: {
            estimated_delivery_limit: "2026-03-30T10:00:00.000Z",
          },
        },
        deposit_snapshot: {
          key: "store:1",
          label: "Ourinhos Rua Dario Alonso",
          logistic_type: "cross_docking",
        },
      },
    });
    const invoicePendingOrder = buildOrder();
    const readyOrder = buildOrder({
      id: "ready",
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          substatus: "ready_for_pickup",
          logistic_type: "cross_docking",
        },
        deposit_snapshot: {
          key: "store:1",
          label: "Ourinhos Rua Dario Alonso",
          logistic_type: "cross_docking",
        },
      },
    });

    const presentation = getOperationalCardPresentation(deposit, [
      cancelledOrder,
      overdueOrder,
      invoicePendingOrder,
      readyOrder,
    ], "today");

    expect(presentation.totalCount).toBe(4);
    expect(presentation.summaryRows).toEqual([
      { key: "cancelled", label: "Canceladas. Não enviar", count: 1 },
      { key: "overdue", label: "Atrasadas. Enviar", count: 1 },
      { key: "invoice_pending", label: "NF-e para gerenciar", count: 1 },
      { key: "ready", label: "Prontas para enviar", count: 1 },
    ]);
  });

  it("monta o card operacional de full com linha de centro de distribuicao", () => {
    const deposit: MLDashboardDeposit = {
      key: "logistic:fulfillment",
      label: "Full",
      logistic_type: "fulfillment",
      lane: "EM ANDAMENTO",
      headline: "Full",
      counts: { today: 2, upcoming: 0, in_transit: 0, finalized: 0 },
      order_ids_by_bucket: { today: [], upcoming: [], in_transit: [], finalized: [] },
      operational_source: "shipment_snapshot+fulfillment_operations",
      total_count: 2,
      summary_rows: [],
    };

    const presentation = getOperationalCardPresentation(
      deposit,
      [
        buildOrder({
          id: "full-1",
          raw_data: {
            status: "paid",
            payments: [{ status: "approved" }],
            shipment_snapshot: {
              status: "handling",
              substatus: "in_warehouse",
              logistic_type: "fulfillment",
            },
            deposit_snapshot: {
              key: "logistic:fulfillment",
              label: "Full",
              logistic_type: "fulfillment",
            },
          },
        }),
        buildOrder({
          id: "full-2",
          raw_data: {
            status: "paid",
            payments: [{ status: "approved" }],
            shipment_snapshot: {
              status: "handling",
              substatus: "ready_to_pack",
              logistic_type: "fulfillment",
            },
            deposit_snapshot: {
              key: "logistic:fulfillment",
              label: "Full",
              logistic_type: "fulfillment",
            },
          },
        }),
      ],
      "today" as ShipmentBucket
    );

    expect(presentation.lane).toBe("EM ANDAMENTO");
    expect(presentation.summaryRows).toEqual([
      { key: "fulfillment", label: "No centro de distribuição", count: 2 },
    ]);
  });

  it("usa a mesma regra do card para focar apenas pedidos prontos para enviar", () => {
    const readyOrder = buildOrder({
      id: "ready-row",
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          substatus: "ready_for_pickup",
          logistic_type: "cross_docking",
        },
        deposit_snapshot: {
          key: "store:1",
          label: "Ourinhos Rua Dario Alonso",
          logistic_type: "cross_docking",
        },
      },
    });
    const invoicePendingOrder = buildOrder({
      id: "invoice-row",
      raw_data: {
        status: "paid",
        payments: [{ status: "approved" }],
        shipment_snapshot: {
          status: "ready_to_ship",
          substatus: "invoice_pending",
          logistic_type: "cross_docking",
        },
        deposit_snapshot: {
          key: "store:1",
          label: "Ourinhos Rua Dario Alonso",
          logistic_type: "cross_docking",
        },
      },
    });

    expect(matchesOperationalSummaryRow(readyOrder, "ready", "today")).toBe(true);
    expect(matchesOperationalSummaryRow(invoicePendingOrder, "ready", "today")).toBe(false);
    expect(matchesOperationalSummaryRow(invoicePendingOrder, "invoice_pending", "today")).toBe(
      true
    );
  });
});

