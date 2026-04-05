function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export const ML_ORDER_OPERATIONAL_SELECT_FIELDS = [
  "order_status_raw:raw_data->>status",
  "payments:raw_data->payments",
  "tags:raw_data->tags",
  "context:raw_data->context",
  "shipment_snapshot:raw_data->shipment_snapshot",
  "sla_snapshot:raw_data->sla_snapshot",
  "deposit_snapshot:raw_data->deposit_snapshot",
  "billing_info_status:raw_data->>billing_info_status",
];

export function buildOperationalSelect(fields) {
  return [...fields, ...ML_ORDER_OPERATIONAL_SELECT_FIELDS].join(",");
}

export function buildMinimalRawData(row) {
  return {
    status: row?.order_status_raw ?? null,
    payments: asArray(row?.payments),
    tags: asArray(row?.tags),
    context: asObject(row?.context),
    shipment_snapshot: asObject(row?.shipment_snapshot),
    sla_snapshot: asObject(row?.sla_snapshot),
    deposit_snapshot: asObject(row?.deposit_snapshot),
    billing_info_status:
      typeof row?.billing_info_status === "string" && row.billing_info_status.trim()
        ? row.billing_info_status.trim()
        : "unknown",
  };
}
