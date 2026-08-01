# GCM Matão — Painel de Inteligência Operacional

## Arquivos deste pacote
- `index.html` — estrutura da página
- `style.css` — todo o visual do painel
- `script.js` — toda a lógica (importação de planilhas, filtros, gráficos, tabela, exportações)
- `manifest.json` — permite "instalar" o painel como app (PWA) no celular/computador
- `sw.js` — service worker: guarda em cache o app e as bibliotecas externas na primeira vez que abrir com internet, para funcionar depois **offline**
- `icon-192.png` / `icon-512.png` — ícone do app (usado na instalação PWA)
- `brasao.png` — brasão da Guarda Civil Municipal, usado no topo do painel

Os 6 arquivos + os 2 ícones precisam ficar **na mesma pasta**, com esses nomes exatos.

## Como publicar (GitHub Pages, igual aos outros apps da GCM)
1. Crie (ou reutilize) um repositório no GitHub.
2. Envie estes arquivos para a raiz do repositório (ou para uma subpasta, ex. `/painel`).
3. Em *Settings → Pages*, ative o GitHub Pages apontando para a branch/pasta usada.
4. Acesse a URL gerada (ex. `https://seuusuario.github.io/repositorio/`).

## Primeiro uso (importante)
Na **primeira vez** que abrir o painel, é preciso estar **com internet**, para:
- baixar Bootstrap, Chart.js, SheetJS (leitura de planilhas), jsPDF e html2canvas via CDN;
- o service worker guardar essas bibliotecas em cache.

Depois desse primeiro carregamento, o painel volta a abrir **normalmente offline** (inclusive as planilhas já importadas ficam salvas no navegador, mesmo sem internet).

Se abrir a página e aparecer um aviso vermelho no topo dizendo que alguma biblioteca não carregou, é sinal de que a rede/firewall do local está bloqueando o CDN (`cdnjs.cloudflare.com`) — tente outra rede uma vez só, para o cache offline ser criado.

## Instalar como aplicativo
No Chrome/Edge (computador ou Android): abra o painel → menu → "Instalar app" (ou o ícone de instalação na barra de endereço).
No iPhone (Safari): Compartilhar → "Adicionar à Tela de Início".

## Formato esperado das planilhas
Cada arquivo `.xlsx` (ou `.csv`) importado deve conter, idealmente, estas abas:
- **Página1** (Ocorrências): `Data, Equipe, N_AO, Codigo_Catalogo, Descricao_Ocorrencia, Natureza, Bairro`
- **Página2** (Rondas): `Data, Equipe, Viatura, Locais_Visitadas, Pré determinado, Rondas_Extras, Total_Geral_Rondas`
- **Página3** (Viaturas): `Data, Equipe, Viatura, KM_Inicial, KM_Final, KM_Rodado, Status_Freios, Status_Farois, Avarias_Observacoes`
- **Página4** (Apreensões): `Data, Equipe, N_AO, Materiais_Apreendidos`

O painel também tenta reconhecer variações de nome de aba/coluna automaticamente.

## Gráficos
- Cada gráfico tem um botão de download (ícone ⬇) individual no canto do card, exportando um PNG com **fundo branco**.
- O item "Exportar → Todos os gráficos (PNG)" também exporta com fundo branco.
- O gráfico "Ocorrências por Código do Catálogo" agrupa por categoria (letra inicial do código), não pelo código bruto.
- O gráfico "Distribuição por Bairro" é um donut com o percentual de cada bairro e uma legenda ao lado.
- O gráfico "Ocorrências por Natureza" mostra as 10 naturezas mais frequentes; as demais (baixa frequência) são somadas em uma barra cinza "Outras naturezas", para os números não ficarem espremidos quando há muitas naturezas diferentes.

## Limites
- Até 15 planilhas carregadas ao mesmo tempo.
- Os dados ficam salvos no `localStorage` do navegador (por dispositivo/navegador — não são sincronizados entre aparelhos).
