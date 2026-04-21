import { useState, useMemo, type ReactNode } from "react";
import { AppLayout } from "@/components/AppLayout";
import {
  Activity,
  BookOpen,
  ClipboardCheck,
  History,
  LayoutDashboard,
  LogIn,
  Package,
  Printer,
  ScanLine,
  ShieldCheck,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  APP_VERSION_LABEL,
  APP_VERSION_DATE,
  APP_VERSION_HIGHLIGHTS,
} from "@/lib/version";

// ─── Conteúdo do manual ──────────────────────────────────────────────
//
// Cada seção representa uma tela / fluxo do sistema. Organizado em
// ordem de uso típico do operador:
//   1. Login + visão geral
//   2. Dashboard
//   3. Mercado Livre (telão operacional diário)
//   4. Conferência Venda (escanear no separação)
//   5. Estoque
//   6. Conferência (após compra)
//   7. Histórico (auditoria)
//   8. Usuários (admin)
//   9. Diagnóstico ML (admin)
//
// Cada seção é um JSX rico com subtitulos, passo-a-passo, dicas e
// avisos de atenção.

interface ManualSection {
  id: string;
  title: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  content: ReactNode;
}

// Componente visual reusável pros "cards de dica/aviso"
function Tip({
  variant = "tip",
  title,
  children,
}: {
  variant?: "tip" | "warning" | "important";
  title: string;
  children: ReactNode;
}) {
  const palette = {
    tip: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warning: "bg-amber-50 border-amber-200 text-amber-900",
    important: "bg-blue-50 border-blue-200 text-blue-900",
  }[variant];
  const emoji = { tip: "💡", warning: "⚠️", important: "📌" }[variant];
  return (
    <div className={`my-4 rounded-lg border p-3 text-[14px] ${palette}`}>
      <p className="font-semibold">
        {emoji} {title}
      </p>
      <div className="mt-1 leading-relaxed">{children}</div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="relative pl-10 text-[14px] leading-relaxed text-[#333]">
      <span className="absolute left-0 top-0 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#3483fa] text-[13px] font-bold text-white">
        {n}
      </span>
      {children}
    </li>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-block rounded border border-[#d1d5db] bg-[#f3f4f6] px-1.5 py-0.5 text-[12px] font-semibold text-[#111]">
      {children}
    </kbd>
  );
}

const SECTIONS: ManualSection[] = [
  {
    id: "introducao",
    title: "Visão Geral",
    icon: BookOpen,
    content: (
      <div>
        {/* Badge de versão */}
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl bg-gradient-to-br from-emerald-50 to-white p-4 ring-1 ring-emerald-200">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
              {APP_VERSION_LABEL}
            </span>
            <span className="text-[12px] font-medium text-emerald-900">
              Versão atual · release {APP_VERSION_DATE}
            </span>
          </div>
        </div>

        <p className="text-[15px] leading-relaxed text-[#333]">
          Bem-vindo ao <strong>EcoFerro Vendas · Etiquetas</strong>.
          Este sistema centraliza o fluxo de vendas do Mercado Livre
          da Ecoferro, desde receber o pedido até gerar etiqueta,
          conferir e despachar.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Novidades da V 3.0
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          {APP_VERSION_HIGHLIGHTS.map((highlight, idx) => (
            <li key={idx}>{highlight}</li>
          ))}
        </ul>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Para quem é este sistema?
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Operador</strong>: separa produtos, imprime etiquetas,
            confere pedidos, registra saídas.
          </li>
          <li>
            <strong>Administrador</strong>: tudo acima + cadastro de
            usuários, diagnóstico do ML, configurações do sistema.
          </li>
        </ul>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          O que você vai encontrar no menu
        </h3>
        <ul className="mt-2 space-y-2 text-[14px] text-[#333]">
          <li>
            <strong>Dashboard</strong>: visão geral de vendas, métricas
            do dia.
          </li>
          <li>
            <strong>Conferência</strong>: auditar pedidos recebidos via
            extração de PDF.
          </li>
          <li>
            <strong>Conferência Venda</strong>: bater QR code no
            separação pra validar a venda certa.
          </li>
          <li>
            <strong>Histórico</strong>: consultar vendas antigas já
            processadas.
          </li>
          <li>
            <strong>Estoque</strong>: gerenciar produtos cadastrados e
            saldo.
          </li>
          <li>
            <strong>EcoFerro</strong>: a <em>tela principal</em>, onde
            você roda o dia-a-dia do ML (separação, etiquetas,
            impressão). É aqui que 90% do tempo é gasto.
          </li>
          <li>
            <strong>Fantom</strong>: visualização alternativa da conta
            Fantom (secundária).
          </li>
        </ul>

        <Tip title="Dica de navegação">
          No canto superior esquerdo, clicando na seta do menu lateral
          você recolhe/expande a barra. Em telas pequenas (mobile), o
          menu aparece com um botão ≡.
        </Tip>
      </div>
    ),
  },

  {
    id: "login",
    title: "Entrar no sistema",
    icon: LogIn,
    content: (
      <div>
        <ol className="space-y-4">
          <Step n={1}>
            Acesse <code>vendas.ecoferro.com.br</code> no navegador
            (recomendado Chrome ou Edge no computador).
          </Step>
          <Step n={2}>
            Digite seu <strong>usuário</strong> e <strong>senha</strong>{" "}
            fornecidos pelo administrador.
          </Step>
          <Step n={3}>
            O sistema lembra seu login por 30 dias. Se fizer logout
            (botão <strong>Sair</strong> no canto inferior esquerdo do
            menu), precisa entrar de novo.
          </Step>
        </ol>

        <Tip variant="warning" title="Primeiro acesso">
          Se você acabou de receber o usuário, a senha é temporária. O
          administrador pode pedir pra você trocar no primeiro login.
        </Tip>

        <Tip variant="important" title="Conexão com o Mercado Livre">
          A primeira vez que o sistema abre, ele pode pedir pra conectar
          a conta ML. Isso é feito pelo <strong>administrador</strong>{" "}
          apenas uma vez. Se a conexão cair, aparece um banner vermelho
          pedindo reconexão.
        </Tip>
      </div>
    ),
  },

  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          É a primeira tela que aparece quando você entra. Mostra um
          resumo rápido de vendas, pedidos do dia e métricas recentes.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          O que tem aqui
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Cards de totais</strong>: vendas do dia, pedidos
            ativos, valor a receber.
          </li>
          <li>
            <strong>Gráficos</strong>: evolução de vendas, faturamento
            mensal.
          </li>
          <li>
            <strong>Atalhos rápidos</strong> pras telas mais usadas.
          </li>
        </ul>

        <Tip title="Tela de visão rápida">
          O Dashboard é bom para ter uma noção geral no início do dia.
          Para operação (separar, imprimir etiqueta, conferir), o
          ambiente correto é a tela <strong>EcoFerro</strong>.
        </Tip>
      </div>
    ),
  },

  {
    id: "mercado-livre",
    title: "EcoFerro (Tela Principal do ML)",
    icon: ShoppingCart,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Esta é a tela onde você passa a maior parte do dia.
          Replica o <strong>Seller Center do Mercado Livre</strong>:
          mostra os pedidos divididos por fase do envio, com os números
          <strong> 1:1 com o próprio ML</strong>.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Os 4 chips principais (classificações)
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[#333]">
          No topo da tela você tem 4 abas com os totais:
        </p>
        <ul className="mt-3 space-y-2 text-[14px] text-[#333]">
          <li>
            <strong>📦 Envios de hoje</strong> — pedidos que precisam
            ser enviados hoje (coleta passa na loja). É aqui que o
            operador começa o dia.
          </li>
          <li>
            <strong>📅 Próximos dias</strong> — pedidos que o ML agendou
            pra próximos dias. São etiquetas que você pode imprimir
            antecipadamente.
          </li>
          <li>
            <strong>🚚 Em trânsito</strong> — já saíram da loja, estão
            com o motorista ou a caminho do comprador.
          </li>
          <li>
            <strong>✅ Finalizadas</strong> — pedidos encerrados
            (entregues ou cancelados).
          </li>
        </ul>

        <Tip title="Indicador ML ao vivo">
          Acima dos 4 chips tem uma faixa verde <strong>🟢 ML ao vivo</strong>{" "}
          com a hora da última atualização. Esses números são
          capturados diretamente do ML Seller Center (não são cálculos
          locais). Se aparecer <strong>🟠 Fallback local</strong>, o
          sistema está usando o cálculo interno porque o ML está
          offline — pode haver pequenas divergências.
        </Tip>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Sub-classificações (cards abaixo dos chips)
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[#333]">
          Ao escolher um chip (ex: <strong>Envios de hoje</strong>),
          aparecem cards coloridos abaixo com os sub-status:
        </p>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Para enviar — Coleta</strong>: etiquetas prontas
            esperando o motorista
          </li>
          <li>
            <strong>Envios de devoluções</strong>: produtos voltando
            pra revisão
          </li>
          <li>
            <strong>Coleta do dia</strong>: produtos que o motorista
            leva hoje
          </li>
          <li>
            <strong>Próximas coletas</strong>: agrupados por data (22,
            23, 24 de abril...)
          </li>
          <li>
            <strong>Para retirar</strong>: comprador vai buscar no
            ponto
          </li>
          <li>
            <strong>A caminho</strong>: já com o motorista
          </li>
        </ul>
        <p className="mt-2 text-[14px] leading-relaxed text-[#333]">
          Clicando num card, a lista abaixo é filtrada pra mostrar só
          aqueles pedidos.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Filtros de loja (depósito)
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-[#333]">
          Abaixo dos sub-cards você vê "LOJA: Todas as lojas /
          Ourinhos Rua Dario Alonso / Mercado Envios Full". Clicando
          em uma loja, a lista filtra só aqueles pedidos.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Filtros de etiqueta impressa
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Todas</strong>: mostra tudo
          </li>
          <li>
            <strong>Sem etiqueta</strong>: só o que falta imprimir
            (painel do operador)
          </li>
          <li>
            <strong>Impressas</strong>: só as que já tem etiqueta
            (auditoria)
          </li>
          <li>
            <strong>Marcar impressa</strong> / <strong>Desmarcar</strong>:
            atualiza manualmente se você imprimiu fora do sistema
          </li>
        </ul>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Ações no pedido (botões amarelos e verdes)
        </h3>
        <ol className="mt-2 space-y-3 text-[14px] text-[#333]">
          <Step n={1}>
            <strong>Selecionar pedidos</strong>: marque os checkboxes à
            esquerda. Também dá pra clicar <strong>"Selecionar tudo"</strong>.
          </Step>
          <Step n={2}>
            <strong>Gerar NF-e</strong> (botão cinza): emite a nota
            fiscal no sistema. Use quando o pagamento foi aprovado e a
            etiqueta do ML já saiu.
          </Step>
          <Step n={3}>
            <strong>Imprimir etiqueta ML + DANFe</strong> (botão
            amarelo): baixa um PDF único com a etiqueta oficial do
            Mercado Livre + DANFe simplificado. É o que você gruda na
            caixa.
          </Step>
          <Step n={4}>
            <strong>Etiquetas Ecoferro</strong> (botão verde): baixa
            etiquetas internas da Ecoferro com info de separação
            (corredor, estante, prateleira). Use na área de picking pra
            achar o produto no estoque.
          </Step>
          <Step n={5}>
            <strong>Separação</strong> (botão azul): gera um PDF
            agrupado por SKU mostrando <em>quais produtos</em> e{" "}
            <em>quantas unidades</em> totais o operador precisa pegar.
            Muito útil quando vários pedidos do mesmo produto caem no
            dia.
          </Step>
        </ol>

        <Tip variant="warning" title="Ordem recomendada do dia">
          <ol className="mt-1 list-decimal pl-5">
            <li>Chega no chip "Envios de hoje"</li>
            <li>Seleciona tudo e gera o <strong>Relatório de Separação</strong></li>
            <li>Pega os produtos no estoque seguindo o PDF</li>
            <li>Volta no sistema, gera <strong>Etiquetas ML + DANFe</strong></li>
            <li>Imprime, gruda na caixa, bate QR code no{" "}
            <strong>Conferência Venda</strong></li>
            <li>Deixa a caixa na coleta</li>
          </ol>
        </Tip>

        <Tip variant="important" title="Atualizar dados em tempo real">
          Clicando no botão <strong>↻ Atualizar agora</strong> ao lado
          do "ML ao vivo", o sistema roda uma sincronização completa
          com o ML Seller Center. Demora ~90 segundos. Use quando
          acabou de receber um pedido novo e quer ver na tela na hora.
        </Tip>
      </div>
    ),
  },

  {
    id: "conferencia-venda",
    title: "Conferência Venda (QR Code)",
    icon: ScanLine,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Tela de <strong>validação no momento da separação</strong>.
          Ajuda a evitar enviar o produto errado pro comprador.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Como funciona
        </h3>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Abra esta tela no celular ou leitor de código de barras.
          </Step>
          <Step n={2}>
            Escaneie o <strong>QR code da etiqueta</strong> (ou da
            Etiqueta Ecoferro).
          </Step>
          <Step n={3}>
            O sistema mostra <strong>os produtos esperados</strong>
            pra aquela venda, com imagem + SKU + quantidade.
          </Step>
          <Step n={4}>
            O operador confere visualmente se o produto físico na mão
            bate com o mostrado na tela.
          </Step>
          <Step n={5}>
            Confirma — e aquele pedido é marcado como{" "}
            <strong>conferido</strong>.
          </Step>
        </ol>

        <Tip title="Por que usar">
          Sem conferência visual, um operador pode confundir dois
          produtos parecidos (ex: Slider Fazer 250 vs Slider XJ6).
          Enviar o produto errado gera custo de logística reversa +
          reputação no ML.
        </Tip>
      </div>
    ),
  },

  {
    id: "estoque",
    title: "Estoque",
    icon: Package,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Cadastro e consulta dos produtos físicos da Ecoferro com
          saldo em estoque.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          O que tem nesta tela
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Lista de produtos</strong> com SKU, nome, imagem,
            saldo atual, preço, corredor/estante/prateleira.
          </li>
          <li>
            <strong>Busca</strong>: pode procurar por SKU, nome, ou
            parte da descrição.
          </li>
          <li>
            <strong>Filtros</strong>: por data de entrada, por
            quantidade vendida no período (mais vendidos primeiro),
            por localização no estoque.
          </li>
          <li>
            <strong>Relatório PDF</strong>: gera lista completa com
            imagens, útil pra inventário.
          </li>
        </ul>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Editar um produto
        </h3>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Clique no produto na lista.
          </Step>
          <Step n={2}>
            Edite campos: nome, SKU, localização (corredor, estante),
            preço, saldo.
          </Step>
          <Step n={3}>
            Salvar — a mudança é refletida na próxima sincronização.
          </Step>
        </ol>

        <Tip variant="warning" title="Cuidado ao alterar SKU">
          O SKU conecta os pedidos do ML aos produtos físicos. Se
          alterar, todos os pedidos anteriores daquele produto podem
          perder a referência. Altere apenas com orientação do
          administrador.
        </Tip>
      </div>
    ),
  },

  {
    id: "conferencia",
    title: "Conferência (Extração PDF)",
    icon: ClipboardCheck,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Tela para processar PDFs de pedidos ou notas fiscais.
          Extrai automaticamente os dados (itens, valores, comprador)
          e permite conferir antes de registrar.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Fluxo típico
        </h3>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Suba o PDF (arrasta e solta, ou clica em "Adicionar").
          </Step>
          <Step n={2}>
            O sistema <strong>extrai automaticamente</strong> os campos
            (número da venda, cliente, SKU, qtd, valor).
          </Step>
          <Step n={3}>
            A tela mostra o que foi extraído com{" "}
            <strong>confiança visual</strong> (verde = certeza, amarelo
            = dúvida, vermelho = não achou).
          </Step>
          <Step n={4}>
            Corrija campos duvidosos manualmente.
          </Step>
          <Step n={5}>
            Clique <strong>Confirmar</strong> — a venda é registrada no
            sistema.
          </Step>
        </ol>

        <Tip title="Quando usar">
          Essa tela é útil pra vendas <em>fora do ML</em> (pedidos de
          revendedor, venda avulsa em PDF). Para vendas do próprio ML,
          a tela EcoFerro já tem tudo integrado.
        </Tip>
      </div>
    ),
  },

  {
    id: "historico",
    title: "Histórico",
    icon: History,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Consulta de vendas já processadas nos últimos dias/meses.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          O que dá pra fazer
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Buscar por número da venda</strong> (ex: digitar{" "}
            <code>#2000016073556476</code>).
          </li>
          <li>
            <strong>Filtrar por data</strong>: última semana, último
            mês, período custom.
          </li>
          <li>
            <strong>Filtrar por loja/depósito</strong>.
          </li>
          <li>
            <strong>Re-imprimir etiqueta</strong> de uma venda antiga
            (se o cliente perdeu).
          </li>
          <li>
            <strong>Ver histórico de mudanças</strong>: quem marcou
            impressa, quando, quem conferiu.
          </li>
        </ul>

        <Tip title="Auditoria">
          Use quando o cliente questionar "eu pedi X, recebi Y".
          Aqui você vê exatamente o que foi registrado no momento da
          venda.
        </Tip>
      </div>
    ),
  },

  {
    id: "impressao",
    title: "Como imprimir etiquetas (passo-a-passo)",
    icon: Printer,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Fluxo completo do "separar o pedido do dia" até "caixa
          pronta com etiqueta". Siga pela ordem.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Fluxo de manhã
        </h3>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Entre em <strong>EcoFerro</strong> no menu.
          </Step>
          <Step n={2}>
            Clique no chip <strong>Envios de hoje</strong> (no topo).
          </Step>
          <Step n={3}>
            Clique em <strong>Todas</strong> na aba de etiqueta
            impressa, ou em <strong>Sem etiqueta</strong> se quiser só
            as pendentes.
          </Step>
          <Step n={4}>
            Selecione os pedidos (
            <strong>Selecionar tudo</strong> marca todos visíveis).
          </Step>
          <Step n={5}>
            Clique <strong>Separação</strong> (botão azul) — baixa um
            PDF agrupado por produto com foto + SKU + quantidade total.
          </Step>
          <Step n={6}>
            Leve o PDF de separação até o estoque. Pegue os produtos na
            quantidade total do PDF.
          </Step>
          <Step n={7}>
            Volte no computador. Com os produtos na mão, clique{" "}
            <strong>Etiquetas ML + DANFe</strong> (botão amarelo).
            Baixa 1 PDF com 1 página por venda.
          </Step>
          <Step n={8}>
            Imprima em papel térmico (impressora da separação).
          </Step>
          <Step n={9}>
            (Opcional) Clique <strong>Etiquetas Ecoferro</strong>{" "}
            (botão verde) — gera etiqueta interna com localização.
            Útil quando você quer devolver o produto pro local certo.
          </Step>
          <Step n={10}>
            Gruda a etiqueta ML+DANFe na caixa. A caixa fica pronta pra
            coleta.
          </Step>
          <Step n={11}>
            Se quer conferência dupla, vá em{" "}
            <strong>Conferência Venda</strong>, escaneie o QR da
            etiqueta, confirme os produtos visualmente.
          </Step>
        </ol>

        <Tip variant="warning" title="Não tem etiqueta ML disponível?">
          O botão <strong>Etiquetas ML + DANFe</strong> fica cinza se o
          pedido ainda não gerou etiqueta no ML. Isso acontece quando:
          <ul className="mt-1 list-disc pl-5">
            <li>Pagamento ainda não aprovado</li>
            <li>Comprador não escolheu forma de envio</li>
            <li>Pedido muito recente (aguarda ML processar)</li>
          </ul>
          Aguarde alguns minutos e clique <strong>↻ Atualizar agora</strong>.
        </Tip>

        <Tip variant="important" title="Marcou impressa por engano?">
          Clique no filtro <strong>Impressas</strong>, selecione o
          pedido errado, clique <strong>Desmarcar</strong>. Volta pro
          status "sem etiqueta".
        </Tip>
      </div>
    ),
  },

  {
    id: "usuarios",
    title: "Usuários (Admin)",
    icon: ShieldCheck,
    adminOnly: true,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Cadastro e gerenciamento de quem acessa o sistema.
          <strong> Visível apenas para administradores.</strong>
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Cadastrar novo usuário
        </h3>
        <ol className="mt-3 space-y-3">
          <Step n={1}>
            Clique <strong>Novo usuário</strong>.
          </Step>
          <Step n={2}>
            Preencha <strong>nome de usuário</strong>, senha inicial e{" "}
            <strong>nível</strong> (Operador ou Administrador).
          </Step>
          <Step n={3}>
            Salve. Mande a senha temporária pro usuário trocar no
            primeiro login.
          </Step>
        </ol>

        <Tip variant="warning" title="Diferença entre Operador e Administrador">
          <strong>Operador</strong>: acessa todas as telas normais (ML,
          Estoque, Conferência, etc), mas NÃO vê Usuários nem
          Diagnóstico ML.
          <br />
          <strong>Administrador</strong>: acesso total, incluindo
          cadastro de usuários, reconexão ML e diagnóstico.
        </Tip>
      </div>
    ),
  },

  {
    id: "diagnostico-ml",
    title: "Diagnóstico ML (Admin)",
    icon: Activity,
    adminOnly: true,
    content: (
      <div>
        <p className="text-[15px] leading-relaxed text-[#333]">
          Painel técnico com o status da conexão com o Mercado Livre,
          logs de sync, comparação entre o que o sistema vê e o que o
          ML mostra.
        </p>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          O que você consegue ver
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            <strong>Status da conexão</strong>: token ativo, próxima
            renovação, última sync.
          </li>
          <li>
            <strong>Comparativo Seller Center</strong>: abre uma
            comparação lado-a-lado entre os números internos e os do
            ML Seller Center.
          </li>
          <li>
            <strong>Snapshots</strong>: capturas periódicas da situação
            do ML pra auditoria futura.
          </li>
          <li>
            <strong>Logs de sincronização</strong>: últimos 50 eventos
            (erro, sucesso, auto-heal).
          </li>
        </ul>

        <h3 className="mt-6 text-[17px] font-bold text-[#333]">
          Quando usar
        </h3>
        <ul className="mt-2 list-disc pl-6 text-[14px] leading-relaxed text-[#333]">
          <li>
            Operador reclamou que os números "estão errados" → conferir
            aqui se bate.
          </li>
          <li>
            Pedido sumiu do painel → ver logs.
          </li>
          <li>
            Tela ficou sem sincronizar → ver se o token expirou e
            reconectar.
          </li>
        </ul>

        <Tip variant="warning" title="Reconectar o ML">
          Se a conexão cair (banner vermelho na tela EcoFerro), vá em
          Diagnóstico ML → <strong>Reconectar</strong>. O sistema abre
          a janela de autorização do ML. Apenas o administrador tem
          permissão.
        </Tip>
      </div>
    ),
  },
];

export default function ManualPage() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);

  const activeSection = useMemo(
    () => SECTIONS.find((s) => s.id === activeId) || SECTIONS[0],
    [activeId]
  );

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        {/* ─── Índice lateral (sticky no desktop) ────────────────── */}
        <aside className="lg:sticky lg:top-6 lg:h-[calc(100vh-64px)] lg:w-[280px] lg:flex-shrink-0 lg:overflow-y-auto">
          <div className="rounded-2xl border border-[#e6e6e6] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 border-b border-[#e6e6e6] pb-3">
              <BookOpen className="h-5 w-5 text-[#3483fa]" />
              <h2 className="text-[15px] font-bold text-[#333]">
                Manual do Sistema
              </h2>
              <span
                className="ml-auto inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200"
                title={`Release ${APP_VERSION_DATE}`}
              >
                {APP_VERSION_LABEL}
              </span>
            </div>
            <nav className="flex flex-col gap-1">
              {SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = section.id === activeId;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => {
                      setActiveId(section.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors",
                      isActive
                        ? "bg-[#3483fa] font-semibold text-white"
                        : "text-[#555] hover:bg-[#f3f3f3]"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 flex-shrink-0",
                        isActive ? "text-white" : "text-[#3483fa]"
                      )}
                    />
                    <span className="truncate">{section.title}</span>
                    {section.adminOnly && (
                      <span
                        className={cn(
                          "ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-amber-100 text-amber-700"
                        )}
                      >
                        Admin
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="mt-4 rounded-2xl border border-[#e6e6e6] bg-[#f9fafb] p-4 text-[12px] leading-relaxed text-[#666]">
            <p className="font-semibold text-[#333]">Precisa de ajuda?</p>
            <p className="mt-1">
              Se não encontrou o que procura ou algo não está
              funcionando, avise o administrador pela conversa interna
              ou WhatsApp.
            </p>
          </div>
        </aside>

        {/* ─── Conteúdo principal ────────────────────────────────── */}
        <main className="flex-1 min-w-0">
          <div className="rounded-2xl border border-[#e6e6e6] bg-white p-6 shadow-sm sm:p-8">
            <header className="mb-6 flex items-start gap-4 border-b border-[#e6e6e6] pb-5">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[#eef4ff]">
                <activeSection.icon className="h-6 w-6 text-[#3483fa]" />
              </div>
              <div className="flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#999]">
                  Manual · {SECTIONS.findIndex((s) => s.id === activeId) + 1}/
                  {SECTIONS.length}
                </div>
                <h1 className="mt-0.5 text-[22px] font-bold text-[#333] sm:text-[26px]">
                  {activeSection.title}
                </h1>
              </div>
            </header>

            <article className="prose-sm max-w-none">
              {activeSection.content}
            </article>

            {/* Navegação pé-de-página */}
            <footer className="mt-10 flex items-center justify-between border-t border-[#e6e6e6] pt-5">
              {(() => {
                const idx = SECTIONS.findIndex((s) => s.id === activeId);
                const prev = idx > 0 ? SECTIONS[idx - 1] : null;
                const next =
                  idx < SECTIONS.length - 1 ? SECTIONS[idx + 1] : null;
                return (
                  <>
                    {prev ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveId(prev.id);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#e6e6e6] bg-white px-4 py-2 text-[13px] font-medium text-[#3483fa] transition hover:bg-[#eef4ff]"
                      >
                        ← {prev.title}
                      </button>
                    ) : (
                      <div />
                    )}
                    {next ? (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveId(next.id);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-[#3483fa] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#2968c8]"
                      >
                        {next.title} →
                      </button>
                    ) : (
                      <div />
                    )}
                  </>
                );
              })()}
            </footer>
          </div>
        </main>
      </div>
    </AppLayout>
  );
}
