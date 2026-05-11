# Relatório Final: Classificador SLA-aware dos Chips (A-I)

## Resumo Executivo

A atualização do classificador OAuth dos chips do VendasEcoferro para a versão SLA-aware foi concluída com sucesso. O sistema agora utiliza o endpoint `GET /shipments/{id}/sla` como fonte primária para a promessa operacional, resolvendo a divergência de 1 dia em pedidos de final de semana/feriados.

A implementação foi feita de forma segura, utilizando feature flags para rollout gradual, shadow mode para validação em produção sem impacto, e cache inteligente para garantir performance.

## Tarefas Concluídas

| Tarefa | Descrição | Status |
| :--- | :--- | :--- |
| **1** | Implementar `fetchShipmentSla` com cache de 120s | ✅ Concluído |
| **2** | Busca paralela de SLA para packs RTS (batch de 20) | ✅ Concluído |
| **3** | Implementar `normalizeShipmentOperationalPromise` | ✅ Concluído |
| **4** | Atualizar classificador no loop RTS (today vs upcoming) | ✅ Concluído |
| **5** | Exportar funções para testes em `__dashboardTestables` | ✅ Concluído |
| **6** | Feature flags `ML_USE_SHIPMENT_SLA_FOR_PROMISES` e `ML_SLA_SHADOW_COMPARE` | ✅ Concluído |
| **7** | Shadow mode com log `[SLA-shadow]` de divergências | ✅ Concluído |
| **8** | Cache SLA por shipment com invalidação cirúrgica no webhook | ✅ Concluído |
| **9** | Suite de testes `test-chips-sla-classifier.js` (53 testes) | ✅ Concluído |
| **10** | Validação real em staging | ✅ Concluído |
| **11** | Commit, push e relatório final | ✅ Concluído |

## Detalhes Técnicos

### 1. Feature Flags e Rollout

A implementação introduziu duas novas variáveis de ambiente no `app-config.js`:

- `ML_USE_SHIPMENT_SLA_FOR_PROMISES`: Quando `true`, o sistema usa a data do endpoint `/sla` como fonte primária para decidir se um pedido vai para "Envios de hoje" ou "Próximos dias". Padrão: `false`.
- `ML_SLA_SHADOW_COMPARE`: Quando `true`, o sistema executa a lógica antiga e a nova em paralelo, logando divergências com o prefixo `[SLA-shadow]` sem alterar o resultado final. Padrão: `false`.

### 2. Performance e Cache

Para evitar impacto na performance do dashboard (que já faz chamadas paralelas para `/shipments`), a busca de SLA foi otimizada:

- **Filtro Inteligente**: Apenas pedidos `ready_to_ship` (RTS) têm o SLA buscado, pois são os únicos que dependem dessa data para classificação.
- **Concorrência**: As chamadas são feitas em lotes de 20 (mesmo padrão do `fetchShipmentDetails`).
- **Cache por Shipment**: Implementado `shipmentSlaCache` com TTL de 120s.
- **Invalidação Cirúrgica**: O webhook de `shipments` (`notifications.js`) agora invalida apenas o `shipment_id` específico no cache SLA, evitando recálculos desnecessários.

### 3. Observabilidade

O payload do dashboard agora inclui um objeto `sla_classifier_observability` (quando as flags estão ativas) que permite monitorar o comportamento do classificador em tempo real:

```json
"sla_classifier_observability": {
  "promise_source_counts": {
    "sla_api": 45,
    "shipment_edl": 2
  },
  "sla_api_fetched": 47,
  "sla_api_resolved": 45,
  "sla_api_errors": 0,
  "use_sla_for_promises": true,
  "shadow_compare": false
}
```

### 4. Testes e Qualidade

A suite de testes `test-chips-sla-classifier.js` foi criada com 53 asserções cobrindo toda a lógica do novo classificador. Além disso, a suite de regressão `test-chips-oauth.js` foi atualizada e continua passando com 17/17 testes, garantindo que os invariantes da arquitetura OAuth foram preservados.

## Próximos Passos

1. Fazer deploy em produção com as flags desativadas (comportamento atual mantido).
2. Ativar `ML_SLA_SHADOW_COMPARE=true` em produção e monitorar os logs `[SLA-shadow]` por 24-48 horas.
3. Validar se as divergências logadas correspondem exatamente aos casos de final de semana/feriados.
4. Ativar `ML_USE_SHIPMENT_SLA_FOR_PROMISES=true` para todos os tenants.
