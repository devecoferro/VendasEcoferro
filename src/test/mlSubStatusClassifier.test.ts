import { describe, it, expect } from "vitest";
import type { MLOrder } from "@/services/mercadoLivreService";
import {
  getOrderPrimaryBucket,
  getOrderSubstatus,
  getOrderPickupDateLabel,
  orderHasUnreadMessages,
  getOrderStoreKey,
} from "@/services/mlSubStatusClassifier";

// Cobre as regras introduzidas no sprint de fixes:
// - orderHasUnreadMessages (tag + messenger + messages_unread)
// - separacao ready_to_print vs ready_to_send no today
// - not_delivered + substatus ativo -> in_transit
// - parsePickupDate com campos nested (shipping_option.estimated_schedule_limit
//   e lead_time.estimated_schedule_limit)

function makeOrder(overrides: Partial<MLOrder> = {}, rawOverrides: Record<string, unknown> = {}): MLOrder {
  return {
    id: "test-1",
    connection_id: "conn-1",
    order_id: "O-1",
    sale_number: "SN-1",
    sale_date: new Date().toISOString(),
    buyer_name: "Tester",
    buyer_nickname: "tester",
    item_title: "Item",
    item_id: "MLB1",
    product_image_url: null,
    sku: "SKU1",
    quantity: 1,
    amount: 100,
    order_status: "paid",
    shipping_id: "S1",
    pickup_scheduled_date: null,
    pickup_date_label: null,
    label_printed_at: null,
    raw_data: {
      status: "paid",
      tags: [],
      ...rawOverrides,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as unknown as MLOrder;
}

describe("mlSubStatusClassifier", () => {
  describe("orderHasUnreadMessages", () => {
    it("detecta tag messages_with_unread_messages", () => {
      const order = makeOrder({}, { tags: ["paid", "messages_with_unread_messages"] });
      expect(orderHasUnreadMessages(order)).toBe(true);
    });

    it("detecta flag messages_unread direto no raw", () => {
      const order = makeOrder({}, { messages_unread: true });
      expect(orderHasUnreadMessages(order)).toBe(true);
    });

    it("detecta messenger.new_messages_amount > 0", () => {
      const order = makeOrder({}, { messenger: { new_messages_amount: 2 } });
      expect(orderHasUnreadMessages(order)).toBe(true);
    });

    it("retorna false quando nao ha indicio", () => {
      const order = makeOrder({}, { tags: ["paid"] });
      expect(orderHasUnreadMessages(order)).toBe(false);
    });
  });

  describe("getOrderPrimaryBucket — not_delivered", () => {
    it("not_delivered puro vai pra finalized", () => {
      const order = makeOrder(
        {},
        { shipment_snapshot: { status: "not_delivered", substatus: "" } }
      );
      expect(getOrderPrimaryBucket(order)).toBe("finalized");
    });

    it("not_delivered + returning_to_sender fica em in_transit (alinhado com backend)", () => {
      const order = makeOrder(
        {},
        {
          shipment_snapshot: {
            status: "not_delivered",
            substatus: "returning_to_sender",
          },
        }
      );
      expect(getOrderPrimaryBucket(order)).toBe("in_transit");
    });

    it("not_delivered + returning_to_hub fica em in_transit", () => {
      const order = makeOrder(
        {},
        {
          shipment_snapshot: {
            status: "not_delivered",
            substatus: "returning_to_hub",
          },
        }
      );
      expect(getOrderPrimaryBucket(order)).toBe("in_transit");
    });

    it("not_delivered + delayed fica em in_transit", () => {
      const order = makeOrder(
        {},
        { shipment_snapshot: { status: "not_delivered", substatus: "delayed" } }
      );
      expect(getOrderPrimaryBucket(order)).toBe("in_transit");
    });
  });

  describe("getOrderSubstatus — today bucket split", () => {
    it("shipSubstatus=ready_to_print retorna ready_to_print em today (para pickup hoje)", () => {
      const today = new Date().toISOString().slice(0, 10);
      const order = makeOrder(
        {},
        {
          status: "paid",
          shipment_snapshot: {
            status: "ready_to_ship",
            substatus: "ready_to_print",
            logistic_type: "cross_docking",
            pickup_date: `${today}T12:00:00Z`,
          },
        }
      );
      expect(getOrderPrimaryBucket(order)).toBe("today");
      expect(getOrderSubstatus(order, "today")).toBe("ready_to_print");
    });

    it("shipSubstatus=printed retorna ready_to_send em today", () => {
      const today = new Date().toISOString().slice(0, 10);
      const order = makeOrder(
        {},
        {
          status: "paid",
          shipment_snapshot: {
            status: "ready_to_ship",
            substatus: "printed",
            logistic_type: "cross_docking",
            pickup_date: `${today}T12:00:00Z`,
          },
        }
      );
      expect(getOrderSubstatus(order, "today")).toBe("ready_to_send");
    });
  });

  describe("getOrderPickupDateLabel — campos nested", () => {
    it("le shipping_option.estimated_schedule_limit.date", () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString();
      const order = makeOrder(
        {},
        {
          shipment_snapshot: {
            status: "ready_to_ship",
            shipping_option: {
              estimated_schedule_limit: { date: tomorrow },
            },
          },
        }
      );
      expect(getOrderPickupDateLabel(order)).toBe("Amanhã");
    });

    it("le lead_time.estimated_schedule_limit como string", () => {
      const dayAfter = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
      const order = makeOrder(
        {},
        {
          shipment_snapshot: {
            status: "ready_to_ship",
            lead_time: {
              estimated_schedule_limit: dayAfter,
            },
          },
        }
      );
      const label = getOrderPickupDateLabel(order);
      expect(label).not.toBe("Sem data definida");
    });

    it("retorna 'Sem data definida' quando nada bate", () => {
      const order = makeOrder({}, { shipment_snapshot: { status: "paid" } });
      expect(getOrderPickupDateLabel(order)).toBe("Sem data definida");
    });
  });

  describe("getOrderStoreKey", () => {
    it("logistic_type=fulfillment retorna full", () => {
      const order = makeOrder(
        {},
        { shipment_snapshot: { logistic_type: "fulfillment" } }
      );
      expect(getOrderStoreKey(order)).toBe("full");
    });

    it("logistic_type=cross_docking retorna outros", () => {
      const order = makeOrder(
        {},
        { shipment_snapshot: { logistic_type: "cross_docking" } }
      );
      expect(getOrderStoreKey(order)).toBe("outros");
    });
  });
});
