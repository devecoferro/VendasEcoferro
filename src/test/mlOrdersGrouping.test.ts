import { describe, expect, it } from "vitest";
import { consolidateOrders } from "../../api/ml/orders.js";

describe("consolidateOrders", () => {
  it("agrupa registros com o mesmo order_id em um unico pedido consolidado", () => {
    const consolidated = consolidateOrders([
      {
        id: "row-1",
        order_id: "2001",
        sale_number: "2001",
        sale_date: "2026-04-02T12:00:00Z",
        buyer_name: "Jose",
        buyer_nickname: "JOSE123",
        item_title: "Produto A",
        item_id: "A",
        product_image_url: "https://example.com/a.png",
        sku: "SKU-A",
        quantity: 2,
        amount: 15,
        order_status: "paid",
        raw_data: { shipping: { id: 1 } },
      },
      {
        id: "row-2",
        order_id: "2001",
        sale_number: "2001",
        sale_date: "2026-04-02T12:00:00Z",
        buyer_name: "Jose",
        buyer_nickname: "JOSE123",
        item_title: "Produto B",
        item_id: "B",
        product_image_url: "https://example.com/b.png",
        sku: "SKU-B",
        quantity: 1,
        amount: 30,
        order_status: "paid",
        raw_data: { shipping: { id: 1 } },
      },
    ]);

    expect(consolidated).toHaveLength(1);
    expect(consolidated[0]).toMatchObject({
      id: "row-1",
      order_id: "2001",
      buyer_name: "Jose",
      sale_date: "2026-04-02T12:00:00Z",
      quantity: 3,
      amount: 45,
    });
    expect(consolidated[0].items).toEqual([
      {
        item_title: "Produto A",
        sku: "SKU-A",
        quantity: 2,
        amount: 15,
        item_id: "A",
        product_image_url: "https://example.com/a.png",
      },
      {
        item_title: "Produto B",
        sku: "SKU-B",
        quantity: 1,
        amount: 30,
        item_id: "B",
        product_image_url: "https://example.com/b.png",
      },
    ]);
  });

  it("mantem pedidos diferentes separados e ignora linhas sem order_id", () => {
    const consolidated = consolidateOrders([
      {
        id: "row-1",
        order_id: "2001",
        sale_number: "2001",
        sale_date: "2026-04-02T12:00:00Z",
        buyer_name: "Jose",
        buyer_nickname: "JOSE123",
        item_title: "Produto A",
        item_id: "A",
        product_image_url: null,
        sku: "SKU-A",
        quantity: 1,
        amount: 15,
        order_status: "paid",
        raw_data: null,
      },
      {
        id: "row-2",
        order_id: "2002",
        sale_number: "2002",
        sale_date: "2026-04-02T13:00:00Z",
        buyer_name: "Maria",
        buyer_nickname: "MARIA123",
        item_title: "Produto B",
        item_id: "B",
        product_image_url: null,
        sku: "SKU-B",
        quantity: 1,
        amount: 25,
        order_status: "paid",
        raw_data: null,
      },
      {
        id: "row-3",
        order_id: "",
        quantity: 1,
        amount: 10,
      },
    ]);

    expect(consolidated).toHaveLength(2);
    expect(consolidated.map((order) => order.order_id)).toEqual(["2001", "2002"]);
  });
});
