import { describe, expect, it } from "vitest";

import { __nfeTestables } from "../../api/nfe/_lib/mercado-livre-faturador.js";

function buildReadinessContext(overrides = {}) {
  return {
    logistic_type: "cross_docking",
    order_id: "200001",
    shipment_id: "300001",
    shipment_status: "ready_to_ship",
    shipment_substatus: "invoice_pending",
    billing_info_status: "available",
    order: {
      order_status: "paid",
      items: [{ item_id: "MLB123", quantity: 1 }],
    },
    billing_info_snapshot: {
      buyer: {
        billing_info: {
          identification: {
            type: "CPF",
            number: "12345678900",
          },
          address: {
            street_name: "Rua Teste",
            street_number: "123",
            city_name: "Ourinhos",
            zip_code: "19900000",
            country_id: "BR",
          },
        },
      },
    },
    ...overrides,
  };
}

describe("validateGenerationReadiness", () => {
  it("blocks fulfillment orders from manual generation", () => {
    const readiness = __nfeTestables.validateGenerationReadiness(
      buildReadinessContext({
        logistic_type: "fulfillment",
      }),
      null
    );

    expect(readiness.allowed).toBe(false);
    expect(readiness.status).toBe("managed_by_marketplace");
  });

  it("marks invoice_pending orders as ready_to_emit", () => {
    const readiness = __nfeTestables.validateGenerationReadiness(
      buildReadinessContext(),
      null
    );

    expect(readiness).toMatchObject({
      allowed: true,
      status: "ready_to_emit",
    });
  });

  it("blocks issuance when buyer fiscal data is incomplete", () => {
    const readiness = __nfeTestables.validateGenerationReadiness(
      buildReadinessContext({
        billing_info_snapshot: {
          buyer: {
            billing_info: {
              identification: {
                type: "CPF",
                number: "",
              },
              address: {
                street_name: "",
                street_number: "",
                city_name: "Ourinhos",
                zip_code: "",
                country_id: "BR",
              },
            },
          },
        },
      }),
      null
    );

    expect(readiness.allowed).toBe(false);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blocking_reasons).toContain("Comprador possui documento fiscal");
    expect(readiness.blocking_reasons).toContain("Comprador possui endereco fiscal minimo");
  });

  it("blocks issuance when an external fiscal prerequisite fails", () => {
    const readiness = __nfeTestables.validateGenerationReadiness(
      buildReadinessContext(),
      null,
      [
        {
          key: "sku_fiscal_information:MT002",
          label: "SKU MT002 cadastrado no faturador do Mercado Livre",
          passed: false,
          blocking: true,
          value: "MT002",
          detail: "Sku not found by sku: MT002 and caller.id: 75043688",
        },
      ]
    );

    expect(readiness.allowed).toBe(false);
    expect(readiness.status).toBe("blocked");
    expect(readiness.blocking_reasons).toContain(
      "SKU MT002 cadastrado no faturador do Mercado Livre"
    );
  });
});

describe("mapDocumentStatus", () => {
  it("maps authorized invoices to authorized status", () => {
    expect(
      __nfeTestables.mapDocumentStatus({
        status: "authorized",
        transaction_status: "authorized",
      })
    ).toBe("authorized");
  });

  it("maps processing invoices to emitting status", () => {
    expect(
      __nfeTestables.mapDocumentStatus({
        status: "processing",
        transaction_status: "pending",
      })
    ).toBe("emitting");
  });

  it("treats invoices with key and protocol as authorized even when transaction_status is canceled", () => {
    expect(
      __nfeTestables.mapDocumentStatus(
        {
          status: "pending_configuration",
          transaction_status: "canceled",
          invoice_number: "116547",
          invoice_series: "2",
          invoice_key: "35260412671507000156550020001165471613602297",
          authorization_protocol: "135261328771772",
          authorized_at: "2026-04-08T19:10:00.000Z",
        },
        { xmlAvailable: true }
      )
    ).toBe("authorized");
  });

  it("maps canceled transaction spelling variant to rejected when there is no authorization evidence", () => {
    expect(
      __nfeTestables.mapDocumentStatus({
        status: "pending_configuration",
        transaction_status: "canceled",
      })
    ).toBe("rejected");
  });
});

describe("resolveOrderIdsFromNotificationPayload", () => {
  it("collects order, shipment and invoice references from nested payloads", () => {
    const refs = __nfeTestables.collectReferenceIds({
      resource: "/orders/200001",
      shipment: { id: "300001" },
      invoice: { id: "400001" },
      nested: [{ url: "https://api.mercadolibre.com/shipments/300001" }],
    });

    expect([...refs.orderIds]).toContain("200001");
    expect([...refs.shipmentIds]).toContain("300001");
    expect([...refs.invoiceIds]).toContain("400001");
  });
});
