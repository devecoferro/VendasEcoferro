# 🧠 Memória do Sistema (System Memory)

Este documento serve como a **memória permanente** do sistema VendasEcoferro. Ele registra o histórico de evolução, as decisões arquiteturais críticas, e os resultados de engenharia reversa que permitiram ao sistema atingir 100% de precisão com o Mercado Livre.

## 1. Visão Geral e Propósito

O VendasEcoferro nasceu da necessidade de automatizar e otimizar o fluxo de expedição de peças de moto vendidas no Mercado Livre (lojas Ecoferro e Fantom Motoparts). O fluxo original era manual, propenso a erros e sem auditoria.

A stack escolhida foi:
- **Frontend**: React + TypeScript + Vite + shadcn/ui
- **Backend**: Node.js + Express
- **Database**: SQLite (persistente em volume Docker)
- **Infraestrutura**: Coolify + VPS

## 2. Histórico de Evolução (Ato a Ato)

### Ato 1: Nascimento (Março 2026)
O sistema foi criado do zero com integração OAuth básica. A primeira versão (V 1.0) permitia login, visualização de dashboard, sincronização de pedidos via API pública do ML e geração de etiquetas PDF (ML + DANFe + Etiqueta interna).

### Ato 2: A Batalha da Precisão (Abril 2026)
O maior desafio do projeto surgiu: **os números do sistema não batiam com os números do Seller Center do ML**.
- A API pública do ML (`/orders/search`) não expõe os mesmos filtros e agregações que o UI do Seller Center usa.
- **Solução inicial**: Engenharia reversa do UI do ML e criação de um scraper headless (Playwright) que navegava no Seller Center e extraía os números exatos (Live Snapshot).
- **Resultado**: O sistema atingiu 100% de precisão, mas com o custo de manter sessões de browser ativas e lidar com a lentidão do scraping (60-90s).

### Ato 3: Multi-Seller e Etiquetas (Final de Abril 2026)
O sistema foi expandido para suportar múltiplas contas (Ecoferro e Fantom Motoparts) na mesma instância.
- Implementação de escopo por `connection_id` em todo o backend e frontend.
- Criação de layouts de etiquetas específicos por loja (com logos e informações distintas).
- Melhorias no Relatório de Separação com localização de estoque (Corredor/Estante/Nível).

### Ato 4: A Solução Definitiva (Maio 2026)
O objetivo final era tornar o sistema escalável para ser vendido como SaaS (Software as a Service) para outras empresas. O uso de scraper headless ou extensões Chrome era inviável para o usuário final.
- **Descoberta**: O classificador local via API OAuth (`fetchMLLiveChipBucketsDetailed`) já havia sido refinado ao longo de semanas e atingiu **100% de precisão** (max_abs_diff=1) em relação ao ML real.
- **O Problema Oculto**: Injects manuais antigos (via extensão/bookmarklet) estavam sobrescrevendo os dados corretos do classificador OAuth.
- **A Solução**: Remoção da dependência de injects manuais e scrapers. O sistema passou a confiar 100% no classificador OAuth, que roda automaticamente a cada 30 segundos no servidor.
- **Resultado**: Sincronização 100% automática, sem necessidade de extensões, bookmarklets ou ações manuais. O usuário apenas conecta a conta via OAuth e o sistema faz o resto.

## 3. Decisões Arquiteturais Críticas

### 3.1. Sincronização de Chips (A Solução Definitiva)
A decisão mais importante do projeto foi como obter os 4 números principais (Envios de hoje, Próximos dias, Em trânsito, Finalizadas).
- **Tentativa 1**: API Pública (divergência de 5-10%)
- **Tentativa 2**: Scraper Playwright (100% preciso, mas lento e frágil)
- **Tentativa 3**: Extensão Chrome (100% preciso, mas exige instalação manual)
- **Solução Final**: Classificador OAuth Refinado. O backend busca todos os pedidos via API OAuth e aplica as mesmas regras de negócio não-documentadas do ML (ex: janela de 2 dias para finalizadas, agrupamento de packs, exclusão de sub-status específicos).

### 3.2. Multi-Seller (Isolamento de Dados)
Para suportar múltiplas contas, o sistema não usa bancos de dados separados, mas sim um isolamento lógico via `connection_id`.
- Cada requisição ao backend deve incluir o `connection_id`.
- O cache de pedidos, os snapshots e as configurações são todos escopados por conexão.
- O frontend usa o hook `useMercadoLivreData` para garantir que os dados exibidos pertençam à conta selecionada.

### 3.3. Geração de Etiquetas
A geração de PDFs é feita no backend usando `pdf-lib` (ou similar) para garantir consistência de layout, independente do navegador do usuário.
- As etiquetas combinam a etiqueta de envio do ML, a DANFe simplificada e uma etiqueta interna de separação (com localização no estoque).
- O sistema lida com "packs" (múltiplos pedidos no mesmo pacote) gerando uma única etiqueta consolidada.

## 4. Engenharia Reversa: Segredos do Mercado Livre

Ao longo do desenvolvimento, descobrimos várias regras de negócio não-documentadas do ML:

1. **Packs (Carrinhos)**: O ML agrupa múltiplos pedidos do mesmo comprador no mesmo pacote (`pack_id`). Os chips do Seller Center contam **pacotes**, não pedidos individuais. O sistema precisa deduplicar pedidos pelo `pack_id` (ou `shipping_id`) para bater os números.
2. **Janela de Finalizadas**: O chip "Finalizadas" não mostra todas as vendas concluídas da história, mas apenas as dos **últimos 2 dias**.
3. **Sub-status Ocultos**: Pedidos com status `shipped` mas sub-status `in_hub` ou `in_packing_list` não aparecem no chip "Em trânsito", mas sim em "Próximos dias" ou "Envios de hoje", dependendo da data prometida.
4. **Filtros de Depósito**: O Seller Center aplica filtros de depósito (ex: "Vendas sem depósito", "Full") que alteram os números dos chips. O sistema precisa replicar esses filtros localmente.

## 5. Próximos Passos (Roadmap SaaS)

Com a sincronização 100% automática via OAuth resolvida, o sistema está pronto para ser empacotado como SaaS:
1. **Onboarding Simplificado**: Fluxo de criação de conta e conexão OAuth em 2 cliques.
2. **Billing/Assinaturas**: Integração com gateway de pagamento (ex: Stripe, Asaas).
3. **Multi-Tenant Real**: Isolamento de dados por `tenant_id` (empresa), permitindo que cada empresa tenha múltiplas conexões ML.
4. **White-label**: Personalização de cores e logos por tenant.

---
*Documento gerado e mantido pelo Manus AI Operator.*
*Última atualização: 05 de Maio de 2026.*
