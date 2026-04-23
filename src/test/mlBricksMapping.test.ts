// Testes de cobertura do mapping ML TASK_IDs → MLSubStatus do app.
// Base de referência: docs/ml-bricks-reverse-engineered.md
// (21 TASK_IDs canônicos capturados via deep-reverse-engineer-ml.mjs)
//
// Objetivo: garantir que nenhuma mudança no classifier/labels quebre o
// alinhamento 1:1 com o ML Seller Center.

import { describe, expect, it } from "vitest";
import { SUBSTATUS_LABELS } from "../services/mlSubStatusClassifier";

describe("Bricks mapping — labels ML ↔ App", () => {
  // Labels canônicos capturados via scraper do ML Seller Center (2026-04-23).
  // Cada entrada: TASK_ID → label exato que o ML mostra + sub-status do app.
  const bricksMappings: Array<{
    taskId: string;
    mlLabel: string;
    appSubStatus: keyof typeof SUBSTATUS_LABELS;
  }> = [
    // Today bucket
    { taskId: "TASK_CANCELLED_DONT_DISPATCH", mlLabel: "Canceladas. Não enviar", appSubStatus: "cancelled_no_send" },
    { taskId: "TASK_READY_TO_DISPATCH", mlLabel: "Prontas para enviar", appSubStatus: "ready_to_send" },
    { taskId: "TASK_READY_TO_PRINT", mlLabel: "Etiquetas para imprimir", appSubStatus: "ready_to_print" },
    { taskId: "TASK_ARRIVING_TODAY", mlLabel: "Chegarão hoje", appSubStatus: "return_arriving_today" },
    // Upcoming bucket
    { taskId: "TASK_INVOICES_TO_BE_MANAGED", mlLabel: "NF-e para gerenciar", appSubStatus: "invoice_pending" },
    { taskId: "TASK_TRANSPORTATION_TO_BE_ASSIGNED", mlLabel: "Em processamento", appSubStatus: "in_processing" },
    { taskId: "TASK_TRANSPORTATION_SLOW_DELIVERY_TO_BE_ASSIGNED", mlLabel: "Por envio padrão", appSubStatus: "standard_shipping" },
    { taskId: "TASK_PENDING_REVIEW", mlLabel: "Revisão pendente", appSubStatus: "return_pending_review" },
    { taskId: "TASK_RETURN_IN_THE_WAY", mlLabel: "A caminho", appSubStatus: "return_in_transit" },
    { taskId: "TASK_IN_REVIEW_WH", mlLabel: "Em revisão pelo Mercado Livre", appSubStatus: "return_in_ml_review" },
    // In transit bucket
    { taskId: "TASK_PENDING_BUYER_WITHDRAW", mlLabel: "Esperando retirada do comprador", appSubStatus: "waiting_buyer_pickup" },
    { taskId: "TASK_CROSS_DOCKING", mlLabel: "Coleta", appSubStatus: "shipped_collection" },
    { taskId: "TASK_FULL", mlLabel: "Full", appSubStatus: "shipped_full" },
    { taskId: "TASK_FULFILLMENT", mlLabel: "No centro de distribuição", appSubStatus: "in_distribution_center" },
    // Finalized bucket
    { taskId: "TASK_WITH_CLAIMS_OR_MEDIATIONS", mlLabel: "Com reclamação ou mediação", appSubStatus: "claim_or_mediation" },
    { taskId: "TASK_DELIVERED", mlLabel: "Entregues", appSubStatus: "delivered" },
    { taskId: "TASK_NOT_DELIVERED", mlLabel: "Não entregues", appSubStatus: "not_delivered" },
    { taskId: "TASK_CANCELLED", mlLabel: "Canceladas", appSubStatus: "cancelled_final" },
    { taskId: "TASK_RETURNS_COMPLETED", mlLabel: "Devoluções concluídas", appSubStatus: "returns_completed" },
    { taskId: "TASK_RETURNS_NOT_COMPLETED", mlLabel: "Devoluções não concluídas", appSubStatus: "returns_not_completed" },
    { taskId: "UNREAD_MESSAGES", mlLabel: "Com mensagens não lidas", appSubStatus: "with_unread_messages" },
  ];

  it("cobre exatamente os 21 TASK_IDs capturados", () => {
    expect(bricksMappings).toHaveLength(21);
  });

  for (const { taskId, mlLabel, appSubStatus } of bricksMappings) {
    it(`${taskId} → "${mlLabel}" (appSubStatus=${appSubStatus})`, () => {
      const appLabel = SUBSTATUS_LABELS[appSubStatus];
      expect(appLabel).toBe(mlLabel);
    });
  }

  // Específicos de regressão capturados hoje (2026-04-23)
  describe("regressões conhecidas — não quebrar de novo", () => {
    it('return_arriving_today: ML diz "Chegarão hoje", não "Chegada hoje"', () => {
      expect(SUBSTATUS_LABELS.return_arriving_today).toBe("Chegarão hoje");
    });

    it('invoice_pending: ML usa "para" (não "pra")', () => {
      expect(SUBSTATUS_LABELS.invoice_pending).toBe("NF-e para gerenciar");
    });

    it('ready_to_print: ML usa "para" (não "pra")', () => {
      expect(SUBSTATUS_LABELS.ready_to_print).toBe("Etiquetas para imprimir");
    });
  });
});
