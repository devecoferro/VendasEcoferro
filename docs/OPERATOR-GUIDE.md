---
title: "📖 Guia do Operador — Fluxo do Dia"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - operator-guide
---

# 📖 Guia do Operador — Fluxo do Dia

Guia passo-a-passo pro operador que usa o sistema no dia-a-dia (separar, imprimir etiquetas, conferir pedidos e despachar).

---

## Pré-requisitos

- Você recebeu **usuário e senha** do administrador
- Navegador recomendado: **Chrome** ou **Edge** no computador
- Sistema acessível em **vendas.ecoferro.com.br**

---

## Login

1. Acesse `vendas.ecoferro.com.br`
2. Digite seu **usuário** e **senha**
3. Clique **Entrar**
4. O sistema lembra de você por 30 dias

> 💡 Primeiro acesso? A senha é temporária — o admin pode pedir pra trocar.

---

## Visão geral do menu

| Item | Quando usar |
|------|-------------|
| 🏠 **Dashboard** | Olhar rápido de manhã (vendas, métricas) |
| ✅ **Conferência** | Processar PDFs externos (OCR) |
| 📱 **Conferência Venda** | QR code do separação — validar produto físico |
| 🕐 **Histórico** | Buscar venda antiga ou auditar |
| 📦 **Estoque** | Cadastrar produto, conferir saldo, localização |
| 🛒 **EcoFerro** | **A tela principal** — 90% do tempo aqui |
| 👻 **Fantom** | Conta secundária (se aplicável) |
| 📖 **Manual** | Este manual (ou /manual) |
| 🐛 **Report Debug** | Reportar bug ou sugerir melhoria |

---

## 🚀 Fluxo do dia típico — 11 passos

### Manhã (chegada no trabalho)

#### 1. Entrar em **EcoFerro**

No menu, clica no item **EcoFerro** (com logo verde). É aqui que você passa o dia.

#### 2. Conferir o banner "ML ao vivo"

No topo da tela, deve aparecer um indicador verde:

> 🟢 **ML ao vivo** · atualizado há X min

Se aparecer 🟠 **Fallback local (ML offline)**, avise o admin — os números do painel podem estar desatualizados.

#### 3. Olhar os 4 chips principais

- **Envios de hoje** — X pedidos
- **Próximos dias** — X pedidos
- **Em trânsito** — X pedidos
- **Finalizadas** — X pedidos

> 💡 Os números são **1:1 com o ML Seller Center**. Se quiser conferir, abre o ML em outra aba — deve bater exatamente.

#### 4. Clicar em **Envios de hoje**

A tela filtra pros pedidos que o ML considera como "envios de hoje". Pode incluir:
- Etiquetas prontas pra imprimir
- Pedidos "Processando CD"
- Vendas canceladas com devolução
- Pedidos "Vamos enviar pacote no dia X" (ML agrupa aqui também)

> Clique nos pills da "**Sub-classificação ao vivo (ML)**" pra ver detalhes por status.

---

### Separar os produtos (Picking)

#### 5. Filtrar por **Sem etiqueta**

Nos filtros de impressão (Todas / Sem etiqueta / Impressas), clica em **Sem etiqueta**. Mostra só o que falta imprimir.

#### 6. Selecionar todos

Clica no checkbox **"Selecionar tudo"** no topo da lista.

#### 7. Gerar relatório de separação

Clica em **"Separação"** (botão azul).

Baixa um PDF com:
- Imagem do produto
- SKU
- Nome
- Corredor/Estante/Nível
- **Quantidade total** (soma de vários pedidos)

> 💡 É muito mais rápido pegar tudo de uma vez seguindo o PDF do que pedido por pedido.

#### 8. Pegar produtos no estoque

Vai no estoque com o PDF impresso (ou celular). Pega as quantidades.

---

### Imprimir etiquetas

#### 9. Voltar no sistema, imprimir **Etiqueta ML + DANFe**

Com os produtos na bancada, clica em **"Etiqueta ML + DANFe"** (botão amarelo).

Baixa 1 PDF com:
- 1 página por venda
- Etiqueta oficial do Mercado Livre (com código de barras e endereço)
- DANFe simplificado (CFOP, CNPJ, valor)

Imprime tudo em papel térmico.

> 💡 Se o botão estiver cinza, o ML ainda não gerou a etiqueta. Causas comuns:
> - Pagamento não aprovado
> - Comprador não escolheu forma de envio
> - Aguardando processamento do ML
>
> Aguarda 1-2 min e clica **↻ Atualizar agora** (ao lado de "ML ao vivo").

#### 10. (Opcional) Imprimir **Etiqueta Ecoferro**

Clica em **"Etiquetas Ecoferro"** (botão verde). Gera etiqueta interna da Ecoferro com:
- Corredor / Estante / Nível / Variação

Ajuda quando você quer devolver o produto pro local correto depois.

---

### Conferência final e despacho

#### 11. (Recomendado) Conferir no **Conferência Venda**

No menu, abre **Conferência Venda**. Com o celular ou leitor:

1. Escaneia o QR code da etiqueta que você acabou de imprimir
2. Sistema mostra o **produto esperado** (imagem + SKU + qty)
3. Compara com o produto físico na mão
4. Se bateu → **Confirma** (pedido vira "conferido")
5. Se não bateu → **Avisa o supervisor** (pode ter pego produto errado)

#### 12. Grudar etiqueta e deixar na coleta

Gruda a etiqueta ML+DANFe na caixa (deixa o código de barras visível). Coloca na área de coleta.

Pronto. 🎉

---

## Fluxos específicos

### 🔄 Já imprimi, mas fiz errado

Vá em **EcoFerro** → filtro **Impressas** → ache o pedido → clica **Desmarcar**.

Volta pra status "sem etiqueta", e o botão "Etiqueta ML + DANFe" fica disponível de novo.

### 🔎 Achei um pedido antigo que preciso ver

Menu → **Histórico** → busca pelo número (ex: `#2000016073556476`) ou período.

### 📦 Cliente ligou dizendo que chegou produto errado

1. Menu → **Histórico** → busca pelo número da venda
2. Vê a etiqueta Ecoferro do dia (Corredor X, SKU Y)
3. Compara com o que o cliente diz ter recebido
4. Se bater, foi erro no estoque (produto etiquetado errado lá)
5. Se não bater, problema de separação (operador errou na hora)

### 📱 Quero reportar um bug ou sugerir melhoria

Menu → **🐛 Report Debug** → preenche o form:
- Tipo: Bug / Sugestão / Dúvida
- Título curto
- Descrição detalhada
- **Anexa prints** (arraste arquivos ou clique "Adicionar imagens")
- Prioridade: Baixa / Média / Alta

Clica **Enviar report**. Admin é notificado e responde.

---

## Dicas gerais

### ⏰ Horários importantes

- **Coleta Ecoferro**: passa de manhã (horário varia por dia). Etiquetas de "Envios de hoje" devem estar prontas antes.
- **Últimos pedidos do dia**: chegam até ~22h. Verifica antes de sair.

### 🖨️ Impressora com problema?

- Papel térmico acabou → chama o supervisor
- Impressora desligada → religa e tenta de novo
- PDF não baixa → clica em "↻ Atualizar agora" no banner ML e tenta de novo

### 💾 Perdi conexão com internet

- O sistema **requer internet**. Sem ela, os números não atualizam.
- Quando voltar, clica **↻ Atualizar agora** pra sincronizar com ML

### 🔒 Esqueci minha senha

Só o admin pode resetar. Chama ele via WhatsApp ou conversa interna.

---

## Atalhos visuais

### Cores dos status

- 🟢 **Verde** = pronto pra ação / entregue / sucesso
- 🟠 **Laranja/Amarelo** = atenção / precisa agir / pendente
- 🔴 **Vermelho** = cancelado / reclamação / crítico
- 🔵 **Azul** = neutro / em trânsito / informativo

### Badges dos pedidos

- **Para coleta** — ML vai buscar (você só imprime e deixa)
- **Para retirar** — cliente vai buscar (coloca na área de retirada)
- **Full** — Mercado Envios Full (vai direto pro Mercado Livre, não precisa imprimir etiqueta)
- **Sem etiqueta** — falta imprimir
- **Impressa** — já foi impressa e registrada

---

## Performance esperada

Com 50-150 pedidos/dia, um operador bem treinado leva **~2-3h** pra fazer todo o fluxo:
- 15 min: checar dashboard + sub-cards
- 30 min: pegar produtos no estoque (guiado pelo relatório de separação)
- 30 min: imprimir etiquetas + DANFe
- 30 min: conferência QR code
- 15 min: empacotar e deixar na coleta

---

_Última atualização: 2026-04-20 (V 3.0)_
