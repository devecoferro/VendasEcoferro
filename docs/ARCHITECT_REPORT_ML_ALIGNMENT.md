# Senior Architect Report: Mercado Livre Alignment & SaaS Scaling

**Author:** Manus AI
**Date:** May 11, 2026
**Project:** Ecoferro/Fantom Dashboard (vendas.ecoferro.com.br)

## 1. Executive Summary

This report confirms the successful resolution of the numerical mismatches between the Ecoferro/Fantom dashboard and the Mercado Livre Seller Center. Following a comprehensive audit of the codebase (commit `9175e2f` and subsequent fixes), the architecture now strictly adheres to the evidence gathered during the engineering reverse analysis [1]. The system relies exclusively on the official Mercado Livre public API and webhooks, avoiding prohibited scraping techniques and excessive pagination.

## 2. Unification of the Source of Truth (`pack_key`)

The root cause of the divergence between the operational chips and the orders grid was the aggregation key. The Seller Center counts *shipments* (packs), whereas the grid previously counted individual *orders* [2].

**Implementation Confirmed:**
- A shared utility module (`api/_lib/pack-utils.js`) was introduced to standardize the resolution of the pack key (`pack_id -> shipping_id -> order_id`).
- The dashboard chips (`api/ml/dashboard.js`) use `resolvePackKeyFromApiOrder` within `deduplicateOrdersToPacks` to group live API responses.
- The orders grid (`api/ml/orders.js`) uses `resolvePackKeyFromRow` to group database rows and explicitly exposes `pack_key` in the `CLIENT_RAW_DATA_KEYS` payload.
- **Result:** The grid and the chips now share the exact same aggregation logic. A pack containing multiple orders is counted as a single entity in the chips, and the grid provides the visual correlation via the `pack_key`, eliminating the numerical mismatch.

## 3. Substatus and Recency Filters Alignment

The operational buckets ("Envios de hoje", "Próximos dias", "Em trânsito", "Finalizadas") have been meticulously aligned with the Seller Center's internal logic [1].

**Implementation Confirmed:**
- **Cross-Docking Adjustments:** `TODAY_SUBSTATUSES` correctly includes `picked_up` and `authorized_by_carrier`. `SHIPPED_UPCOMING_SUBSTATUSES` correctly isolates `waiting_for_withdrawal` (packages at pickup points), moving them out of "Em trânsito" and into "Próximos dias".
- **Transit Threshold:** The `TRANSIT_MAX_DAYS` threshold is actively enforced, ensuring that packages stuck in transit for extended periods do not indefinitely inflate the operational counters.
- **Finalized Recency:** The "Finalizadas" bucket strictly filters for orders delivered *today* (`date_last_updated`), matching the Seller Center's daily reset behavior.

## 4. Webhook Cache Invalidation and Latency Reduction

To eliminate the latency caused by polling and ensure near real-time synchronization, the system now fully leverages Mercado Livre's official webhook infrastructure [3].

**Implementation Confirmed:**
- The `api/ml/notifications.js` module actively listens to the `orders_v2`, `shipments`, `invoices`, and `post_purchase` topics.
- Upon receiving a relevant notification, the system immediately triggers `invalidateDashboardCache(connection.id)` and `invalidateOrdersCache()`.
- Furthermore, surgical invalidation of the SLA cache (`invalidateShipmentSlaCache(resourceInfo0.id)`) is performed for shipment updates, preventing full cache rebuilds and optimizing performance.
- **Result:** The dashboard reflects state changes almost instantaneously, matching the responsiveness of the Seller Center without violating API rate limits.

## 5. Inherent API Limitations (Accepted Divergences)

While the codebase now perfectly mirrors the Seller Center's logic, minor numerical discrepancies (typically 1-3 orders) may occasionally appear. These are **not bugs**, but inherent limitations of the Mercado Livre public API [1] [2]:

1. **Eventual Consistency:** The Seller Center queries Mercado Livre's internal transactional databases directly. The public API, even with webhooks, is subject to replication delays.
2. **Internal Fulfillment Grouping:** Mercado Livre dynamically groups Full packages in the UI using internal logic that is not immediately reflected in the `pack_id` exposed via the public API.
3. **"Ghost" Orders:** Orders cancelled due to fraud before payment confirmation appear as "Cancelled" in the Seller Center but are often omitted from public API search results and webhook payloads.

**Conclusion:** No further code changes can resolve these specific edge cases. Attempting to do so via scraping or undocumented endpoints would compromise system stability and violate Mercado Livre's terms of service.

## 6. SaaS Scaling Recommendations

The architecture has been successfully prepared for a multi-tenant SaaS model. The `tenant_settings` table and API allow for dynamic branding (logos, company names, primary colors) per `profile_id`, ensuring data isolation [4].

**Recommendations for Future Scaling:**
1. **Automated Onboarding Flow:** Implement a self-serve OAuth 2.0 onboarding flow where new tenants can securely connect their Mercado Livre accounts without manual database intervention.
2. **Tenant-Specific Rate Limiting:** Introduce application-level rate limiting per `profile_id` to prevent a single high-volume tenant from exhausting the global Mercado Livre API quota.
3. **Customizable Label Templates:** Expand the `tenant_settings` to allow users to upload custom HTML/CSS templates for their internal labels, moving beyond the current hardcoded PDF generation.
4. **Maintain API Compliance:** Strictly adhere to the public API. Do not pursue the Developer Partner Program under the false assumption that it grants access to private data; it is a commercial program, not a technical necessity [1].

---
### References
[1] `AUDITORIA-MERCADO-LIVRE.md` - Auditoria Engenharia Reversa - Bling e LojaHub.
[2] `DIAGNOSTICO_ARQUITETURA_ML.md` - Diagnóstico Técnico: Divergências e Latência na Integração Mercado Livre.
[3] Mercado Livre API Documentation - Webhooks and Notifications.
[4] `api/_lib/migrations/20260511_add_tenant_settings.sql` - Multi-tenant schema definition.
