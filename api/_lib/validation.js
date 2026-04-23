// Validação de input dos endpoints via zod.
// S6 do sprint de segurança — defesa de input.
//
// Uso:
//   import { validate, StockUpdateSchema } from "../_lib/validation.js";
//   const data = validate(StockUpdateSchema, req.body);
//   if (!data.ok) return res.status(400).json({ error: data.error });
//   // usar data.value (tipado e validado)

import { z } from "zod";

// ─── Schemas ─────────────────────────────────────────────────────────

// PATCH /api/ml/stock body
export const StockUpdateSchema = z
  .object({
    sku: z.string().max(128).nullable().optional(),
    title: z.string().max(512).nullable().optional(),
    location_corridor: z.string().max(32).nullable().optional(),
    location_shelf: z.string().max(32).nullable().optional(),
    location_level: z.string().max(32).nullable().optional(),
    location_notes: z.string().max(512).nullable().optional(),
  })
  .strict() // rejeita campos não listados — evita leak de colunas
  .refine((data) => Object.keys(data).length > 0, {
    message: "Nenhum campo válido pra atualizar",
  });

// POST /api/ml/labels/mark-printed body
export const LabelsMarkSchema = z.object({
  order_ids: z
    .array(z.string().min(1).max(64))
    .min(1, "Pelo menos 1 order_id")
    .max(1000, "Max 1000 order_ids por chamada"),
});

// POST /api/nfe/generate body
export const NFeGenerateSchema = z
  .object({
    order_id: z.string().min(1).max(64).optional(),
    orderId: z.string().min(1).max(64).optional(),
  })
  .refine((d) => d.order_id || d.orderId, { message: "order_id obrigatório" });

// ─── Helper ───────────────────────────────────────────────────────────

/**
 * Valida `input` contra o `schema`. Retorna ok+value ou error com
 * mensagem legível (pt-BR quando possível).
 */
export function validate(schema, input) {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const issues = result.error.issues
    .map((i) => {
      const path = i.path.length > 0 ? i.path.join(".") + ": " : "";
      return `${path}${i.message}`;
    })
    .slice(0, 5);
  return { ok: false, error: issues.join("; ") };
}
