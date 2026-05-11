# Diagnóstico Técnico: Divergência de Números Mercado Livre (Ecoferro vs Fantom)

Este documento apresenta a análise técnica definitiva sobre a divergência de números entre o painel Ecoferro/Fantom e o Seller Center do Mercado Livre, baseada na auditoria de engenharia reversa de plataformas de mercado (Bling, LojaHub) e na documentação oficial do Mercado Livre.

## 1. Causa Raiz da Divergência

A divergência de números **não é um bug do sistema, nem um problema de falta de certificação**. Ela ocorre porque o Seller Center do Mercado Livre e a API pública operam com entidades e regras de negócio fundamentalmente diferentes.

### 1.1. Pedidos (Orders) vs. Envios (Packs/Shipments)
A principal causa da divergência numérica é a diferença na unidade de contagem:
- **Painel Ecoferro/Fantom (API Pública):** Conta **Pedidos** (`orders`). Se um cliente compra 3 itens diferentes no mesmo carrinho, a API retorna 3 pedidos distintos.
- **Seller Center (Interface Visual):** Conta **Envios** (`packs` ou `shipments`). O Mercado Livre agrupa os 3 pedidos acima em 1 único pacote físico (pack dedup estrito) [1].

**Evidência:** A auditoria interna (`ml-classification-reference.md`) comprovou essa proporção na prática. Em um cenário analisado, havia 30 pedidos com status `shipped/*`, mas o Seller Center exibia apenas 11 envios no chip "Em trânsito" (uma proporção de 2.7:1, típica de operações cross-docking) [1].

### 1.2. Filtros Ocultos da Interface (UI)
O Seller Center aplica filtros de exibição que não são documentados na API pública e variam conforme o fluxo logístico:
- **Janelas de tempo restritas:** O chip visual exclui pedidos que já saíram da alçada do vendedor, mesmo que a API ainda os retorne como ativos.
- **Tratamento de Substatus:** Pedidos com substatus `in_hub` ou `in_packing_list` (cross-docking) já saíram da loja e estão no fluxo da transportadora. O Seller Center os move para abas secundárias ou os oculta do contador principal, enquanto a API continua retornando-os [1].

## 2. O Papel da Certificação (Developer Partner Program)

A certificação no Developer Partner Program (DPP) do Mercado Livre **não resolve a divergência de números**.

### 2.1. O que o DPP oferece
A documentação oficial do programa de parceiros (`pasted_content_19.txt`) deixa claro que o DPP é um programa comercial e de suporte. Seus benefícios incluem:
- Suporte técnico com SLA garantido.
- Visibilidade no diretório de parceiros (App Store).
- Acesso a comunidades e eventos exclusivos [2].

### 2.2. O que o DPP NÃO oferece
**Não existem "APIs secretas" ou "endpoints VIP"** que exponham os contadores exatos do Seller Center para parceiros certificados. Plataformas gigantes e certificadas, como Bling e LojaHub, utilizam exatamente a mesma API pública (OAuth 2.0 + Webhooks) que o painel Ecoferro/Fantom utiliza [3].

**Evidência:** A auditoria do LojaHub e Bling (`AUDITORIA-MERCADO-LIVRE.md`) confirma que essas plataformas **não tentam replicar os chips do Seller Center**. Elas importam os pedidos via API pública e criam seus próprios status operacionais internos (ex: "Aguardando Nota Fiscal", "Pendente de Envio") [3].

## 3. Solução Definitiva e Próximos Passos

A tentativa de espelhar perfeitamente os chips do Seller Center é um anti-pattern na integração com o Mercado Livre. A solução definitiva envolve alinhar a expectativa do usuário e otimizar o código para a realidade operacional.

### 3.1. Ajustes no Código (Classificação e Deduplicação)
Para aproximar os números e melhorar a usabilidade, o sistema deve:
1. **Implementar Deduplicação por Pack:** Agrupar pedidos (`orders`) que compartilham o mesmo `pack_id` ou `shipment_id` antes de exibi-los no dashboard. Isso reduzirá drasticamente a divergência visual.
2. **Refinar Filtros de Substatus:** Pedidos com substatus `in_hub` e `in_packing_list` (cross-docking) devem ser classificados como "Em trânsito" (já saíram da loja), removendo-os da fila de ação do operador ("Próximos dias") [1].
3. **Limitar Dias em Trânsito:** Implementar um filtro de tempo (ex: ignorar pedidos em trânsito há mais de X dias) para evitar o acúmulo de pedidos "fantasmas" que o Mercado Livre demora a atualizar para `delivered`.

### 3.2. Mudança de Paradigma (Operacional vs. Espelhamento)
O painel Ecoferro/Fantom deve assumir sua identidade como um **ERP/Hub Operacional**, seguindo o padrão de mercado (Bling/LojaHub):
- **Abandonar o Scraping:** Remover qualquer dependência de scripts que tentam ler a tela do Seller Center (`seller-center-scraper.js`). Isso é frágil e gera dívida técnica [1].
- **Focar na Ação:** Os contadores do painel devem refletir o que o operador precisa fazer (ex: "Etiquetas para Imprimir", "NF-e Pendente"), e não tentar adivinhar o que o algoritmo visual do Mercado Livre está mostrando ao cliente final.

### 3.3. Arquitetura de Sincronização
A arquitetura atual (OAuth 2.0) está correta. Para garantir que os dados estejam sempre atualizados sem sobrecarregar a API:
- **Implementar Webhooks (Notifications):** Assinar os tópicos `orders_v2` e `shipments` para receber atualizações em tempo real, eliminando a necessidade de polling constante [3] [4].

## Conclusão

A divergência numérica é uma característica arquitetural da API do Mercado Livre (Pedidos vs. Envios) e não uma limitação de acesso ou certificação. A solução não é buscar uma API mágica, mas sim implementar deduplicação por pacotes no código e educar os usuários de que o painel Ecoferro/Fantom é uma ferramenta de gestão operacional, com contadores próprios e acionáveis, superior aos chips visuais do Seller Center.

---
### Referências
[1] `ml-classification-reference.md` - Classificação de pedidos Mercado Livre — Referência.
[2] `pasted_content_19.txt` - Documentação Oficial: Developer Partner Program.
[3] `AUDITORIA-MERCADO-LIVRE.md` - Auditoria Engenharia Reversa - Bling e LojaHub.
[4] `pasted_content_18.txt` - Documentação Oficial: Notificações (Webhooks).
