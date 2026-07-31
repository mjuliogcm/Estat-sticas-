/* ==========================================================================
   GCM — Painel de Inteligência Operacional
   script.js — lógica completa da aplicação (sem frameworks)
   ========================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------
     0. CONSTANTES
  --------------------------------------------------------------------- */
  const STORAGE_KEY = 'gcm_dashboard_files_v1';
  const MAX_ARQUIVOS = 15;

  const MESES_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const EQUIPE_COLORS = { Alpha: '#1565C0', Bravo: '#0B2342', Delta: '#B3261E' };
  const PALETTE = ['#1565C0','#0B2342','#4C8DDA','#B3261E','#0F7B47','#8A5A00','#6D4AA6','#0E7C86','#B0475A','#4B5563'];

  // Categorias de ocorrência conforme a letra inicial do Código do Catálogo
  const CATALOGO_LETRAS = {
    A: 'OC. CONTRA PESSOA',
    B: 'OC. CONTRA PATRIMÔNIO',
    C: 'OC. CONTRA A PAZ PÚBLICA',
    D: 'OC. CONTRA OS COSTUMES',
    E: 'OC. CONTRA A ADM. PÚBLICA',
    F: 'OC. COM ENTORPECENTE',
    G: 'OC. COM PRESOS',
    H: 'OC. DE MANIFESTAÇÃO PÚBLICA',
    I: 'OC. CONTRA O MEIO AMBIENTE',
    O: 'OUTRAS OC. ILÍCITOS PENAIS',
    P: 'OC. DE TRÂNSITO',
    R: 'OC. DE AUXÍLIO AO PÚBLICO',
    S: 'OC. DE BOMBEIRO',
    T: 'APOIO A INSTITUIÇÃO PÚBLICA',
    V: 'OUTROS ATENDIMENTOS',
    X: 'VIOLÊNCIA DOMÉSTICA'
  };

  function letraDoCodigo(codigo){
    const s = String(codigo || '').trim();
    const m = s.match(/[A-Za-z]/);
    return m ? m[0].toUpperCase() : '';
  }

  function categoriaDoCodigo(codigo){
    const letra = letraDoCodigo(codigo);
    const nome = CATALOGO_LETRAS[letra] || (letra ? `OUTROS (${letra})` : 'NÃO IDENTIFICADO');
    return { letra, nome, label: letra ? `${letra} — ${nome}` : nome };
  }

  /* ---------------------------------------------------------------------
     1. ESTADO GLOBAL
  --------------------------------------------------------------------- */
  const state = {
    files: [],           // [{id, filename, uploadDate, monthLabel, ocorrencias, rondas, viaturas, apreensoes}]
    filters: {
      equipe: 'Todas',
      meses: ['Todos'],
      dataIni: '',
      dataFim: '',
      bairro: 'Todos',
      natureza: 'Todos',
      viatura: 'Todos'
    },
    charts: {},
    table: { search: '', sortField: '_date', sortDir: 'desc', page: 1, pageSize: 10 },
    tableSource: []
  };

  /* ---------------------------------------------------------------------
     2. UTILITÁRIOS
  --------------------------------------------------------------------- */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function uid(){ return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function normalizeKey(str){
    return String(str || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[^a-z0-9]/g,'');
  }

  // Mapeia variações de cabeçalho para o nome canônico do campo
  const FIELD_ALIASES = {
    data: 'Data',
    equipe: 'Equipe',
    nao: 'N_AO',
    codigocatalogo: 'Codigo_Catalogo',
    codigo: 'Codigo_Catalogo',
    descricaoocorrencia: 'Descricao_Ocorrencia',
    descricao: 'Descricao_Ocorrencia',
    natureza: 'Natureza',
    bairro: 'Bairro',
    viatura: 'Viatura',
    locaisvisitadas: 'Locais_Visitadas',
    predeterminado: 'Pre_determinado',
    rondasextras: 'Rondas_Extras',
    totalgeralrondas: 'Total_Geral_Rondas',
    kminicial: 'KM_Inicial',
    kmfinal: 'KM_Final',
    kmrodado: 'KM_Rodado',
    statusfreios: 'Status_Freios',
    statusfarois: 'Status_Farois',
    avariasobservacoes: 'Avarias_Observacoes',
    materiaisapreendidos: 'Materiais_Apreendidos'
  };

  function mapRowKeys(row){
    const out = {};
    Object.keys(row).forEach(k => {
      const norm = normalizeKey(k);
      const canon = FIELD_ALIASES[norm] || k;
      out[canon] = row[k];
    });
    return out;
  }

  function excelSerialToDate(serial){
    // Excel epoch (1900 system) — xlsx.js já entrega objetos Date quando cellDates:true,
    // esta função é um fallback para valores numéricos crus.
    const utcDays = Math.floor(serial - 25569);
    const utcValue = utcDays * 86400;
    return new Date(utcValue * 1000);
  }

  function parseDateValue(v){
    if (v instanceof Date && !isNaN(v)) return v;
    if (typeof v === 'number') return excelSerialToDate(v);
    if (typeof v === 'string'){
      const s = v.trim();
      // dd/mm/yyyy
      let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (m){
        let [, d, mo, y] = m;
        if (y.length === 2) y = '20' + y;
        const dt = new Date(+y, +mo - 1, +d);
        if (!isNaN(dt)) return dt;
      }
      // yyyy-mm-dd
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m){
        const [, y, mo, d] = m;
        const dt = new Date(+y, +mo - 1, +d);
        if (!isNaN(dt)) return dt;
      }
      const dt2 = new Date(s);
      if (!isNaN(dt2)) return dt2;
    }
    return null;
  }

  function dateKey(dt){
    if (!dt) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }

  function monthLabelOf(dt){
    if (!dt) return '';
    return `${MESES_PT[dt.getMonth()]}/${dt.getFullYear()}`;
  }

  function fmtInt(n){ return Math.round(n || 0).toLocaleString('pt-BR'); }
  function fmtPct(n){ return (n>=0?'+':'') + n.toFixed(1).replace('.', ',') + '%'; }

  function toast(msg, type = 'primary'){
    const id = 'tt' + Date.now();
    const el = document.createElement('div');
    el.className = `toast align-items-center text-bg-${type} border-0`;
    el.id = id;
    el.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
    $('#toastContainer').appendChild(el);
    const t = new bootstrap.Toast(el, { delay: 3500 });
    t.show();
    el.addEventListener('hidden.bs.toast', () => el.remove());
  }

  /* ---------------------------------------------------------------------
     3. PERSISTÊNCIA (localStorage)
  --------------------------------------------------------------------- */
  function persist(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.files));
    }catch(e){
      toast('Armazenamento local cheio. Remova alguma planilha antiga para liberar espaço.', 'danger');
      console.error(e);
    }
  }

  function loadPersisted(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Datas voltam como string do JSON — mantemos como string ISO e reconvertendo ao usar
      state.files = parsed || [];
    }catch(e){
      console.error('Falha ao carregar dados salvos', e);
    }
  }

  /* ---------------------------------------------------------------------
     4. IMPORTAÇÃO E PARSING DAS PLANILHAS
  --------------------------------------------------------------------- */
  function detectSheetKind(sheetName, headers){
    const n = normalizeKey(sheetName);
    if (n.includes('pagina1') || n.includes('ocorrenc')) return 'ocorrencias';
    if (n.includes('pagina2') || n.includes('rond')) return 'rondas';
    if (n.includes('pagina3') || n.includes('viatura')) return 'viaturas';
    if (n.includes('pagina4') || n.includes('apreens')) return 'apreensoes';

    // fallback por cabeçalhos (útil para CSV com aba única)
    const hs = headers.map(normalizeKey);
    if (hs.includes('materiaisapreendidos')) return 'apreensoes';
    if (hs.includes('totalgeralrondas')) return 'rondas';
    if (hs.includes('kmrodado')) return 'viaturas';
    if (hs.includes('natureza') || hs.includes('bairro')) return 'ocorrencias';
    return null;
  }

  function readWorkbookFile(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Erro de leitura do arquivo'));
      reader.onload = (e) => {
        try{
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array', cellDates: true });
          resolve(wb);
        }catch(err){ reject(err); }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function processFile(file){
    const wb = await readWorkbookFile(file);
    const bucket = { ocorrencias: [], rondas: [], viaturas: [], apreensoes: [] };

    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!json.length) return;
      const headers = Object.keys(json[0]);
      const kind = detectSheetKind(sheetName, headers);
      if (!kind) return;

      json.forEach(rawRow => {
        const row = mapRowKeys(rawRow);
        const dt = parseDateValue(row.Data);
        row._date = dt ? dt.toISOString() : null;
        row._dateKey = dt ? dateKey(dt) : '';
        row._month = dt ? monthLabelOf(dt) : '';
        bucket[kind].push(row);
      });
    });

    // mês predominante do arquivo (para exibição no gerenciamento)
    const allDates = [...bucket.ocorrencias, ...bucket.rondas, ...bucket.viaturas, ...bucket.apreensoes]
      .map(r => r._month).filter(Boolean);
    const freq = {};
    allDates.forEach(m => freq[m] = (freq[m]||0)+1);
    const monthLabel = Object.keys(freq).sort((a,b)=>freq[b]-freq[a])[0] || '—';

    return {
      id: uid(),
      filename: file.name,
      uploadDate: new Date().toISOString(),
      monthLabel,
      ...bucket
    };
  }

  function libsFaltando(){
    const faltando = [];
    if (typeof bootstrap === 'undefined') faltando.push('Bootstrap');
    if (typeof Chart === 'undefined') faltando.push('Chart.js');
    if (typeof XLSX === 'undefined') faltando.push('SheetJS (XLSX)');
    if (!window.jspdf) faltando.push('jsPDF');
    if (typeof html2canvas === 'undefined') faltando.push('html2canvas');
    return faltando;
  }

  async function handleFiles(fileList){
    const faltando = libsFaltando();
    if (faltando.length){
      $('#avisoLibsModal').classList.remove('d-none');
      $('#avisoLibsModal').innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Não é possível importar: as seguintes bibliotecas não carregaram: <strong>${faltando.join(', ')}</strong>. Verifique sua conexão com a internet e recarregue a página.`;
      $('#avisoLibsGlobal').classList.remove('d-none');
      toast('Falha ao carregar bibliotecas necessárias. Recarregue a página.', 'danger');
      return;
    }

    const files = Array.from(fileList).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!files.length){ toast('Selecione arquivos .xlsx, .xls ou .csv.', 'warning'); return; }

    const espacoDisponivel = MAX_ARQUIVOS - state.files.length;
    if (espacoDisponivel <= 0){
      toast(`Limite de ${MAX_ARQUIVOS} planilhas atingido. Remova alguma antes de adicionar novas.`, 'danger');
      return;
    }
    const toProcess = files.slice(0, espacoDisponivel);
    const lista = $('#listaImportacao');
    lista.innerHTML = '';
    $('#statusImportacao').textContent = `Processando ${toProcess.length} arquivo(s)...`;
    $('#btnConcluirImportacao').classList.add('d-none');

    let sucesso = 0, falha = 0;

    for (const file of toProcess){
      const row = document.createElement('div');
      row.className = 'gcm-import-row';
      row.innerHTML = `<i class="bi bi-hourglass-split"></i><span class="nome">${file.name}</span><span class="status">processando…</span>`;
      lista.appendChild(row);
      try{
        const parsed = await processFile(file);
        const totalLinhas = parsed.ocorrencias.length + parsed.rondas.length + parsed.viaturas.length + parsed.apreensoes.length;
        if (totalLinhas === 0){
          throw new Error('Nenhuma aba reconhecida (esperado: Página1, Página2, Página3 e/ou Página4, ou cabeçalhos compatíveis).');
        }
        state.files.push(parsed);
        sucesso++;
        row.querySelector('i').className = 'bi bi-check-circle-fill status-ok';
        row.querySelector('.status').innerHTML = `<span class="status-ok">${parsed.monthLabel} · ${parsed.ocorrencias.length} ocorrências</span>`;
      }catch(err){
        falha++;
        console.error(err);
        row.querySelector('i').className = 'bi bi-x-circle-fill status-erro';
        row.querySelector('.status').innerHTML = `<span class="status-erro" title="${(err && err.message) || ''}">Falha ao processar${err && err.message ? ': ' + err.message : ''}</span>`;
      }
    }

    try{
      persist();
      rebuildFilterOptions();
      renderAll();
      updateArquivosBadge();
    }catch(err){
      reportError('Ao atualizar o painel — ' + (err && err.message || err));
      $('#statusImportacao').innerHTML = `<span class="status-erro"><i class="bi bi-x-circle-fill"></i> Planilha(s) importada(s), mas houve um erro ao montar o painel. Veja a mensagem no topo da página.</span>`;
      $('#btnConcluirImportacao').classList.remove('d-none');
      return;
    }

    if (sucesso && !falha){
      $('#statusImportacao').innerHTML = `<span class="status-ok"><i class="bi bi-check-circle-fill"></i> ${sucesso} planilha(s) importada(s) com sucesso.</span>`;
      toast(`${sucesso} planilha(s) importada(s) com sucesso.`, 'success');
      // Fecha o modal automaticamente e leva o usuário direto ao painel
      setTimeout(() => {
        const modalEl = $('#modalImportar');
        const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
        inst.hide();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 700);
    } else if (sucesso && falha){
      $('#statusImportacao').innerHTML = `<span class="status-ok">${sucesso} importada(s)</span> · <span class="status-erro">${falha} com falha</span>`;
      toast(`${sucesso} planilha(s) importada(s), ${falha} com falha. Veja os detalhes.`, 'warning');
      $('#btnConcluirImportacao').classList.remove('d-none');
    } else {
      $('#statusImportacao').innerHTML = `<span class="status-erro"><i class="bi bi-x-circle-fill"></i> Nenhuma planilha pôde ser importada.</span>`;
      toast('Nenhuma planilha pôde ser importada. Veja os detalhes na lista.', 'danger');
      $('#btnConcluirImportacao').classList.remove('d-none');
    }

    if (files.length > toProcess.length){
      toast(`Somente ${toProcess.length} de ${files.length} arquivos foram importados (limite de ${MAX_ARQUIVOS}).`, 'warning');
    }
  }

  function removeFile(id){
    state.files = state.files.filter(f => f.id !== id);
    persist();
    rebuildFilterOptions();
    renderAll();
    updateArquivosBadge();
    renderGerenciarTable();
    toast('Planilha removida.', 'secondary');
  }

  function clearAllFiles(){
    state.files = [];
    persist();
    rebuildFilterOptions();
    renderAll();
    updateArquivosBadge();
    renderGerenciarTable();
    toast('Todas as planilhas foram removidas.', 'secondary');
  }

  function updateArquivosBadge(){
    $('#qtdArquivosBadge').textContent = state.files.length;
    const years = new Set();
    state.files.forEach(f => (f.ocorrencias||[]).forEach(r => { if (r._date) years.add(new Date(r._date).getFullYear()); }));
    $('#anoBase').textContent = years.size ? Array.from(years).sort().join('/') : '—';
  }

  /* ---------------------------------------------------------------------
     5. AGREGAÇÃO / FILTROS
  --------------------------------------------------------------------- */
  function allRows(kind){
    const out = [];
    state.files.forEach(f => (f[kind]||[]).forEach(r => out.push(r)));
    return out;
  }

  function passesFilters(row){
    const f = state.filters;
    if (f.equipe !== 'Todas' && row.Equipe !== f.equipe) return false;
    if (!f.meses.includes('Todos') && row._month && !f.meses.includes(row._month)) return false;
    if (f.dataIni && row._dateKey && row._dateKey < f.dataIni) return false;
    if (f.dataFim && row._dateKey && row._dateKey > f.dataFim) return false;
    if (f.bairro !== 'Todos' && 'Bairro' in row && row.Bairro !== f.bairro) return false;
    if (f.natureza !== 'Todos' && 'Natureza' in row && row.Natureza !== f.natureza) return false;
    if (f.viatura !== 'Todos' && 'Viatura' in row && row.Viatura !== f.viatura) return false;
    return true;
  }

  function filtered(kind){
    return allRows(kind).filter(passesFilters);
  }

  // Descrição textual do período em uso (para o cabeçalho/introdução do relatório executivo)
  function periodoLabel(){
    const meses = state.filters.meses;
    if (!meses || meses.includes('Todos') || !meses.length) return 'todo o período disponível nos dados importados';
    const ordered = MESES_PT.flatMap(m => meses.filter(v => String(v).startsWith(m + '/'))).filter((v,i,a)=>a.indexOf(v)===i);
    if (ordered.length === 1) return ordered[0];
    if (ordered.length === 2) return `${ordered[0]} e ${ordered[1]}`;
    return `${ordered.slice(0,-1).join(', ')} e ${ordered[ordered.length-1]}`;
  }

  function rebuildFilterOptions(){
    const bairros = new Set(), naturezas = new Set(), viaturas = new Set(), mesesSet = new Set();
    const addVal = (set, v) => { const s = String(v == null ? '' : v).trim(); if (s) set.add(s); };
    allRows('ocorrencias').forEach(r => { addVal(bairros, r.Bairro); addVal(naturezas, r.Natureza); addVal(mesesSet, r._month); });
    [...allRows('rondas'), ...allRows('viaturas')].forEach(r => { addVal(viaturas, r.Viatura); addVal(mesesSet, r._month); });
    allRows('apreensoes').forEach(r => { addVal(mesesSet, r._month); });

    fillSelect('#fBairro', bairros);
    fillSelect('#fNatureza', naturezas);
    fillSelect('#fViatura', viaturas);
    buildMesesMenu(mesesSet);
  }

  function fillSelect(sel, values){
    const el = $(sel);
    const current = el.value;
    const sorted = Array.from(values).map(v => String(v)).sort((a,b)=>a.localeCompare(b,'pt-BR'));
    el.innerHTML = `<option value="Todos">Todos</option>` + sorted.map(v => `<option value="${v}">${v}</option>`).join('');
    if (sorted.includes(current)) el.value = current;
  }

  function buildMesesMenu(mesesSet){
    const ordered = MESES_PT.flatMap(m => Array.from(mesesSet).map(v => String(v)).filter(v => v.startsWith(m + '/'))).sort();
    const uniqueOrdered = Array.from(new Set(ordered));
    const list = $('#fMesesList');
    list.innerHTML = `
      <li><div class="form-check"><input class="form-check-input" type="checkbox" value="Todos" id="mesTodos" checked><label class="form-check-label" for="mesTodos"><strong>Todos</strong></label></div></li>
      <li><hr class="dropdown-divider"></li>` +
      uniqueOrdered.map((m,i) => `
      <li><div class="form-check"><input class="form-check-input mes-item" type="checkbox" value="${m}" id="mes${i}"><label class="form-check-label" for="mes${i}">${m}</label></div></li>`).join('');

    $('#mesTodos').addEventListener('change', (e) => {
      $$('.mes-item').forEach(cb => cb.checked = false);
      if (e.target.checked) applyMesesSelection();
      else applyMesesSelection();
    });
    $$('.mes-item').forEach(cb => cb.addEventListener('change', () => {
      if (cb.checked) $('#mesTodos').checked = false;
      applyMesesSelection();
    }));
  }

  function applyMesesSelection(){
    const checked = $$('.mes-item:checked').map(cb => cb.value);
    if (!checked.length){
      state.filters.meses = ['Todos'];
      $('#mesTodos').checked = true;
      $('#fMesesLabel').textContent = 'Todos os meses';
    } else {
      state.filters.meses = checked;
      $('#fMesesLabel').textContent = checked.length === 1 ? checked[0] : `${checked.length} meses selecionados`;
    }
    renderAll();
  }

  /* ---------------------------------------------------------------------
     6. CONTADORES ANIMADOS
  --------------------------------------------------------------------- */
  function animateCounter(el, to){
    const from = Number(el.getAttribute('data-counter')) || 0;
    const duration = 600;
    const start = performance.now();
    function step(now){
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = Math.round(from + (to - from) * eased);
      el.textContent = fmtInt(val);
      if (p < 1) requestAnimationFrame(step);
      else el.setAttribute('data-counter', to);
    }
    requestAnimationFrame(step);
  }

  /* ---------------------------------------------------------------------
     7. RENDERIZAÇÃO PRINCIPAL
  --------------------------------------------------------------------- */
  function reportError(msg){
    console.error(msg);
    try{
      const el = document.getElementById('avisoErroJs');
      if (el){
        el.textContent = '⚠ Erro no painel: ' + msg + '\n\nTire um print desta mensagem e envie para o suporte.';
        el.classList.remove('d-none');
      }
    }catch(e){ /* ignora */ }
  }

  function renderAll(){
    const hasData = state.files.length > 0;
    $('#emptyState').classList.toggle('d-none', hasData);
    $('#dashboardContent').classList.toggle('d-none', !hasData);
    $('#filterBar').style.visibility = hasData ? 'visible' : 'hidden';
    if (!hasData) return;

    const oc = filtered('ocorrencias');
    const ro = filtered('rondas');
    const vi = filtered('viaturas');
    const ap = filtered('apreensoes').filter(r => String(r.Materiais_Apreendidos||'').trim() !== '');

    // Cada seção roda isolada: se uma falhar, as outras ainda aparecem no painel.
    try{ renderKpis(oc, ro, vi, ap); }catch(err){ reportError('KPIs — ' + (err && err.message || err)); }
    try{ renderCharts(oc, ro, vi, ap); }catch(err){ reportError('Gráficos — ' + (err && err.message || err)); }
    try{ renderIntel(oc, ro, vi, ap); }catch(err){ reportError('Inteligência operacional — ' + (err && err.message || err)); }
    try{ renderTable(oc); }catch(err){ reportError('Tabela — ' + (err && err.message || err)); }
  }

  function renderKpis(oc, ro, vi, ap){
    animateCounter($('#kpiOcorrencias'), oc.length);
    const totalRondas = ro.reduce((s,r) => s + (Number(r.Total_Geral_Rondas) || 0), 0);
    animateCounter($('#kpiRondas'), totalRondas);
    const totalKm = vi.reduce((s,r) => s + (Number(r.KM_Rodado) || 0), 0);
    animateCounter($('#kpiKm'), totalKm);
    animateCounter($('#kpiApreensoes'), ap.length);
  }

  /* ---------- Charts ---------- */
  function groupCount(rows, field){
    const map = {};
    rows.forEach(r => { const k = (r[field] ?? '—') || '—'; map[k] = (map[k]||0)+1; });
    return map;
  }
  function groupSum(rows, groupField, sumField){
    const map = {};
    rows.forEach(r => { const k = (r[groupField] ?? '—') || '—'; map[k] = (map[k]||0) + (Number(r[sumField])||0); });
    return map;
  }
  function sortDesc(map){ return Object.entries(map).sort((a,b)=>b[1]-a[1]); }
  function monthSortedEntries(map){
    return Object.entries(map).sort((a,b) => {
      const da = parseCompLabel(a[0]), db = parseCompLabel(b[0]);
      return da - db;
    });
  }
  function parseCompLabel(label){
    const [mesNome, ano] = String(label).split('/');
    const idx = MESES_PT.indexOf(mesNome);
    return (Number(ano)||0) * 100 + (idx>=0?idx:0);
  }

  function upsertChart(id, config){
    if (state.charts[id]) state.charts[id].destroy();
    const ctx = document.getElementById(id).getContext('2d');
    state.charts[id] = new Chart(ctx, config);
    return state.charts[id];
  }

  const barValueLabel = {
    id: 'barValueLabel',
    afterDatasetsDraw(chart){
      const { ctx } = chart;
      const suffix = (chart.options.plugins && chart.options.plugins.barValueLabel && chart.options.plugins.barValueLabel.suffix) || '';
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((bar, i) => {
          const val = ds.data[i];
          if (val === undefined || val === null) return;
          ctx.save();
          ctx.font = '600 11px Inter, sans-serif';
          ctx.fillStyle = '#0B2342';
          if (chart.config.type === 'bar' && chart.options.indexAxis === 'y'){
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(fmtInt(val) + suffix, bar.x + 6, bar.y);
          } else {
            ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
            ctx.fillText(fmtInt(val) + suffix, bar.x, bar.y - 4);
          }
          ctx.restore();
        });
      });
    }
  };

  // Gradiente horizontal (esquerda→direita) usado nas barras dos rankings modernos.
  // Recalcula a cada draw porque a chartArea só existe depois do primeiro layout.
  function hGradient(ctx, chartArea, colorStart, colorEnd){
    if (!chartArea) return colorEnd;
    const g = ctx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
    g.addColorStop(0, colorStart);
    g.addColorStop(1, colorEnd);
    return g;
  }

  // Linha vertical tracejada marcando a média + rótulo, para leitura rápida
  // de quem está acima/abaixo da média no ranking (KM por Viatura / Rondas por Equipe).
  const avgLinePlugin = {
    id: 'avgLine',
    afterDraw(chart){
      const cfg = chart.options.plugins && chart.options.plugins.avgLine;
      if (!cfg || !cfg.value) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      const xPos = xScale.getPixelForValue(cfg.value);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = '#B3261E';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xPos, chartArea.top);
      ctx.lineTo(xPos, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillStyle = '#B3261E';
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText(cfg.label || 'Média', xPos, chartArea.top - 2);
      ctx.restore();
    }
  };

  function renderCharts(oc, ro, vi, ap){
    const total = oc.length || 1;

    // 1. Ocorrências por Natureza — barras horizontais, ordenado desc
    const natMap = sortDesc(groupCount(oc, 'Natureza'));
    upsertChart('chartNatureza', {
      type: 'bar',
      data: { labels: natMap.map(e=>e[0]), datasets: [{ data: natMap.map(e=>e[1]), backgroundColor: '#1565C0', borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display:false }, tooltip: { callbacks: {
          label: (c) => `Quantidade: ${fmtInt(c.raw)} (${((c.raw/total)*100).toFixed(1)}%)` } } },
        scales: { x: { grace: '15%', grid:{ color:'#EEF1F5'} }, y:{ grid:{ display:false } } }
      },
      plugins: [barValueLabel]
    });

    // 2. Distribuição por Bairro — Donut (proporção por bairro) + legenda com percentuais
    const bMap = sortDesc(groupCount(oc, 'Bairro'));
    const bTotal = bMap.reduce((s,e)=>s+e[1],0) || 1;
    upsertChart('chartBairroDonut', {
      type: 'doughnut',
      data: { labels: bMap.map(e=>e[0]), datasets: [{
        data: bMap.map(e=>e[1]),
        backgroundColor: bMap.map((e,i)=>PALETTE[i % PALETTE.length]),
        borderColor: '#fff', borderWidth: 2
      }] },
      options: {
        responsive:true, maintainAspectRatio:false, cutout:'55%',
        plugins:{ legend:{ display:false }, tooltip:{ callbacks:{
          label: (c) => `${c.label}: ${fmtInt(c.raw)} (${((c.raw/bTotal)*100).toFixed(1).replace('.',',')}%)` } } }
      }
    });
    const legendEl = $('#bairroDonutLegend');
    if (legendEl){
      legendEl.innerHTML = bMap.map((e,i) => `
        <div class="gcm-donut-legend-item">
          <span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>
          <span class="nome">${e[0]}</span>
          <span class="pct">${fmtInt(e[1])} · ${((e[1]/bTotal)*100).toFixed(0)}%</span>
        </div>`).join('');
    }

    // 3. Evolução mensal das Rondas — linha
    const roEvMap = {};
    ro.forEach(r => { if (r._month) roEvMap[r._month] = (roEvMap[r._month]||0) + (Number(r.Total_Geral_Rondas)||0); });
    const roEv = monthSortedEntries(roEvMap);
    upsertChart('chartEvolRondas', {
      type: 'line',
      data: { labels: roEv.map(e=>e[0]), datasets: [{ data: roEv.map(e=>e[1]), borderColor:'#0B2342', backgroundColor:'#0B234222', fill:true, tension:.3, pointRadius:4, pointBackgroundColor:'#0B2342' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label: c => fmtInt(c.raw) } } },
        scales:{ y:{ grid:{color:'#EEF1F5'} }, x:{ grid:{display:false} } } }
    });

    // 4. Ocorrências por Código do Catálogo — agrupado pela letra inicial (categoria)
    const catMap = {};
    oc.forEach(r => {
      const { label } = categoriaDoCodigo(r.Codigo_Catalogo);
      catMap[label] = (catMap[label]||0) + 1;
    });
    const codMap = sortDesc(catMap);
    upsertChart('chartCodigo', {
      type: 'bar',
      data: { labels: codMap.map(e=>e[0]), datasets: [{ data: codMap.map(e=>e[1]), backgroundColor:'#4C8DDA', borderRadius:4 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label: c => `Quantidade: ${fmtInt(c.raw)}` } } },
        scales:{ y:{ grace:'15%', grid:{color:'#EEF1F5'} }, x:{ grid:{display:false}, ticks:{ maxRotation:60, minRotation:30, autoSkip:false, font:{size:9} } } } }
    });

    // 5. Top 10 Bairros
    const top10 = bMap.slice(0,10);
    upsertChart('chartTop10Bairros', {
      type: 'bar',
      data: { labels: top10.map(e=>e[0]), datasets: [{ data: top10.map(e=>e[1]), backgroundColor:'#0B2342', borderRadius:4 }] },
      options: { indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} },
        scales:{ x:{ grace:'15%', grid:{color:'#EEF1F5'} }, y:{ grid:{display:false} } } }
    });

    // 6. Rondas por Equipe — ranking horizontal, maior valor no topo, gradiente e média
    const roEquipeMap = groupSum(ro, 'Equipe', 'Total_Geral_Rondas');
    const roEqEntries = sortDesc(roEquipeMap); // já desc; para barra horizontal "no topo" invertemos ao desenhar
    const roEqLabels = roEqEntries.map(e=>e[0]).reverse();
    const roEqData = roEqEntries.map(e=>e[1]).reverse();
    const roEqAvg = roEqData.length ? roEqData.reduce((s,v)=>s+v,0) / roEqData.length : 0;
    const roEqMaxIdx = roEqData.indexOf(Math.max(...roEqData));
    upsertChart('chartRondasEquipe', {
      type: 'bar',
      data: { labels: roEqLabels, datasets: [{
        data: roEqData,
        backgroundColor: (c) => {
          if (c.dataIndex === roEqMaxIdx) return hGradient(c.chart.ctx, c.chart.chartArea, '#D9A400', '#F2C744');
          return hGradient(c.chart.ctx, c.chart.chartArea, '#0B2342', '#4C8DDA');
        },
        borderRadius: 8, borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.8
      }] },
      options: {
        indexAxis: 'y', responsive:true, maintainAspectRatio:false,
        layout: { padding: { top: 18, right: 34 } },
        plugins: {
          legend:{display:false},
          avgLine: { value: roEqAvg, label: `Média: ${fmtInt(Math.round(roEqAvg))}` },
          barValueLabel: {},
          tooltip:{ callbacks:{ label: c => `${fmtInt(c.raw)} rondas${c.dataIndex===roEqMaxIdx?' · maior volume':''}` } }
        },
        scales:{ x:{ grace:'20%', grid:{color:'#EEF1F5'}, beginAtZero:true }, y:{ grid:{display:false}, ticks:{ font:{ weight:600, size:11 } } } }
      },
      plugins: [barValueLabel, avgLinePlugin]
    });

    // 7. KM Rodado por Viatura — mesmo estilo, com sufixo "km" no rótulo
    const kmViaturaMap = sortDesc(groupSum(vi, 'Viatura', 'KM_Rodado'));
    const kmLabels = kmViaturaMap.map(e=>e[0]).reverse();
    const kmData = kmViaturaMap.map(e=>Math.round(e[1])).reverse();
    const kmAvg = kmData.length ? kmData.reduce((s,v)=>s+v,0) / kmData.length : 0;
    const kmMaxIdx = kmData.indexOf(Math.max(...kmData));
    upsertChart('chartKmViatura', {
      type: 'bar',
      data: { labels: kmLabels, datasets: [{
        data: kmData,
        backgroundColor: (c) => {
          if (c.dataIndex === kmMaxIdx) return hGradient(c.chart.ctx, c.chart.chartArea, '#8A5A00', '#D99A2B');
          return hGradient(c.chart.ctx, c.chart.chartArea, '#123058', '#1565C0');
        },
        borderRadius: 8, borderSkipped: false, barPercentage: 0.62, categoryPercentage: 0.8
      }] },
      options: {
        indexAxis: 'y', responsive:true, maintainAspectRatio:false,
        layout: { padding: { top: 18, right: 46 } },
        plugins: {
          legend:{display:false},
          avgLine: { value: kmAvg, label: `Média: ${fmtInt(Math.round(kmAvg))} km` },
          barValueLabel: { suffix: ' km' },
          tooltip:{ callbacks:{ label: c => `${fmtInt(c.raw)} km${c.dataIndex===kmMaxIdx?' · maior rodagem':''}` } }
        },
        scales:{ x:{ grace:'20%', grid:{color:'#EEF1F5'}, beginAtZero:true }, y:{ grid:{display:false}, ticks:{ font:{ weight:600, size:11 } } } }
      },
      plugins: [barValueLabel, avgLinePlugin]
    });

    // 8. Evolução mensal das Ocorrências
    const ocEvMap = {};
    oc.forEach(r => { if (r._month) ocEvMap[r._month] = (ocEvMap[r._month]||0) + 1; });
    const ocEv = monthSortedEntries(ocEvMap);
    upsertChart('chartEvolOcorrencias', {
      type: 'line',
      data: { labels: ocEv.map(e=>e[0]), datasets: [{ data: ocEv.map(e=>e[1]), borderColor:'#1565C0', backgroundColor:'#1565C022', fill:true, tension:.3, pointRadius:4, pointBackgroundColor:'#1565C0' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} },
        scales:{ y:{ grid:{color:'#EEF1F5'} }, x:{ grid:{display:false} } } }
    });

    // 9. Evolução do KM Rodado
    const kmEvMap = {};
    vi.forEach(r => { if (r._month) kmEvMap[r._month] = (kmEvMap[r._month]||0) + (Number(r.KM_Rodado)||0); });
    const kmEv = monthSortedEntries(kmEvMap);
    upsertChart('chartEvolKm', {
      type: 'line',
      data: { labels: kmEv.map(e=>e[0]), datasets: [{ data: kmEv.map(e=>Math.round(e[1])), borderColor:'#8A5A00', backgroundColor:'#8A5A0022', fill:true, tension:.3, pointRadius:4, pointBackgroundColor:'#8A5A00' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false},
        tooltip:{ callbacks:{ label: c => `${fmtInt(c.raw)} km` } } },
        scales:{ y:{ grid:{color:'#EEF1F5'} }, x:{ grid:{display:false} } } }
    });

    // 10. Evolução das Apreensões
    const apEvMap = {};
    ap.forEach(r => { if (r._month) apEvMap[r._month] = (apEvMap[r._month]||0) + 1; });
    const apEv = monthSortedEntries(apEvMap);
    upsertChart('chartEvolApreensoes', {
      type: 'line',
      data: { labels: apEv.map(e=>e[0]), datasets: [{ data: apEv.map(e=>e[1]), borderColor:'#B3261E', backgroundColor:'#B3261E22', fill:true, tension:.3, pointRadius:4, pointBackgroundColor:'#B3261E' }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} },
        scales:{ y:{ grid:{color:'#EEF1F5'} }, x:{ grid:{display:false} } } }
    });
  }

  /* ---------- Inteligência Operacional ---------- */
  function renderIntel(oc, ro, vi, ap){
    const bairroTop = sortDesc(groupCount(oc, 'Bairro'))[0];
    const naturezaTop = sortDesc(groupCount(oc, 'Natureza'))[0];
    const equipeTop = sortDesc(groupSum(ro, 'Equipe', 'Total_Geral_Rondas'))[0];
    const viaturaTop = sortDesc(groupSum(vi, 'Viatura', 'KM_Rodado'))[0];

    const diasOc = new Set(oc.map(r => r._dateKey).filter(Boolean)).size || 1;
    const diasRo = new Set(ro.map(r => r._dateKey).filter(Boolean)).size || 1;
    const mediaOcDia = oc.length / diasOc;
    const totalRondas = ro.reduce((s,r)=> s + (Number(r.Total_Geral_Rondas)||0), 0);
    const mediaRondaDia = totalRondas / diasRo;
    const totalKm = vi.reduce((s,r)=> s + (Number(r.KM_Rodado)||0), 0);
    const mediaKmPorRonda = totalRondas ? totalKm / totalRondas : 0;

    // variação mês a mês (últimos dois meses presentes no conjunto filtrado)
    const ocPorMes = {};
    oc.forEach(r => { if (r._month) ocPorMes[r._month] = (ocPorMes[r._month]||0)+1; });
    const mesesOrd = monthSortedEntries(ocPorMes);
    let variacao = null;
    if (mesesOrd.length >= 2){
      const [, atual] = mesesOrd[mesesOrd.length - 1];
      const [, anterior] = mesesOrd[mesesOrd.length - 2];
      variacao = anterior ? ((atual - anterior) / anterior) * 100 : null;
    }

    const totalApreensoesAno = ap.length;
    const totalOcorrenciasAno = oc.length;
    const totalRondasAno = totalRondas;
    const totalKmAno = totalKm;

    const cards = [
      { lbl:'Bairro com mais ocorrências', val: bairroTop ? bairroTop[0] : '—', sub: bairroTop ? `${fmtInt(bairroTop[1])} registros` : '' },
      { lbl:'Natureza mais frequente', val: naturezaTop ? naturezaTop[0] : '—', sub: naturezaTop ? `${fmtInt(naturezaTop[1])} registros` : '' },
      { lbl:'Equipe com mais rondas', val: equipeTop ? equipeTop[0] : '—', sub: equipeTop ? `${fmtInt(equipeTop[1])} rondas` : '' },
      { lbl:'Viatura que mais rodou', val: viaturaTop ? viaturaTop[0] : '—', sub: viaturaTop ? `${fmtInt(viaturaTop[1])} km` : '' },
      { lbl:'Média diária de ocorrências', val: mediaOcDia.toFixed(1).replace('.',','), sub:'ocorrências/dia' },
      { lbl:'Média de rondas por dia', val: mediaRondaDia.toFixed(1).replace('.',','), sub:'rondas/dia' },
      { lbl:'Média de KM por ronda', val: mediaKmPorRonda.toFixed(1).replace('.',','), sub:'km/ronda' },
      { lbl:'Variação vs. mês anterior', val: variacao !== null ? fmtPct(variacao) : '—', sub:'ocorrências', cls: variacao > 0 ? 'up' : (variacao < 0 ? 'down' : '') },
      { lbl:'Total anual de ocorrências', val: fmtInt(totalOcorrenciasAno), sub:'no período filtrado' },
      { lbl:'Total anual de rondas', val: fmtInt(totalRondasAno), sub:'no período filtrado' },
      { lbl:'Total anual de quilômetros', val: fmtInt(totalKmAno), sub:'km rodados' },
      { lbl:'Total anual de apreensões', val: fmtInt(totalApreensoesAno), sub:'no período filtrado' }
    ];

    $('#intelGrid').innerHTML = cards.map(c => `
      <div class="gcm-intel-card">
        <div class="lbl">${c.lbl}</div>
        <div class="val ${c.cls||''}">${c.val}<small>${c.sub||''}</small></div>
      </div>`).join('');
  }

  /* ---------- Tabela (busca, ordenação e paginação nativas) ---------- */
  const TABLE_FIELDS = ['_date','Equipe','N_AO','Codigo_Catalogo','Natureza','Bairro','Descricao_Ocorrencia'];

  function renderTable(oc){
    state.tableSource = oc; // guarda o conjunto filtrado completo para busca/ordenação/paginação

    // 1. busca textual em todas as colunas visíveis
    const term = normalizeKey(state.table.search);
    let rows = oc;
    if (term){
      rows = oc.filter(r => TABLE_FIELDS.some(f => {
        const raw = f === '_date' ? (r._date ? new Date(r._date).toLocaleDateString('pt-BR') : '') : (r[f] || '');
        return normalizeKey(String(raw)).includes(term);
      }));
    }

    // 2. ordenação
    const { sortField, sortDir } = state.table;
    rows = [...rows].sort((a,b) => {
      let va = sortField === '_date' ? (a._date || '') : (a[sortField] || '');
      let vb = sortField === '_date' ? (b._date || '') : (b[sortField] || '');
      if (sortField === '_date'){ va = va || ''; vb = vb || ''; }
      const cmp = String(va).localeCompare(String(vb), 'pt-BR', { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // 3. paginação
    const total = rows.length;
    const pageSize = state.table.pageSize;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (state.table.page > totalPages) state.table.page = totalPages;
    const startIdx = (state.table.page - 1) * pageSize;
    const pageRows = rows.slice(startIdx, startIdx + pageSize);

    // 4. render tbody
    const tbody = $('#tabelaBody');
    if (!pageRows.length){
      tbody.innerHTML = `<tr><td colspan="7" class="gcm-no-results"><i class="bi bi-inbox"></i> Nenhum registro encontrado para os filtros/pesquisa atuais.</td></tr>`;
    } else {
      tbody.innerHTML = pageRows.map(r => `
        <tr>
          <td>${r._date ? new Date(r._date).toLocaleDateString('pt-BR') : ''}</td>
          <td>${r.Equipe || ''}</td>
          <td>${r.N_AO || ''}</td>
          <td>${r.Codigo_Catalogo || ''}</td>
          <td>${r.Natureza || ''}</td>
          <td>${r.Bairro || ''}</td>
          <td>${r.Descricao_Ocorrencia || ''}</td>
        </tr>`).join('');
    }

    // 5. cabeçalho com indicador de ordenação
    $$('#tabelaOcorrencias thead th').forEach(th => {
      const f = th.getAttribute('data-field');
      th.classList.toggle('sorted', f === sortField);
      const icon = th.querySelector('i');
      icon.className = f === sortField ? (sortDir === 'asc' ? 'bi bi-sort-up' : 'bi bi-sort-down') : 'bi bi-arrow-down-up';
    });

    // 6. rodapé — info + paginação
    $('#tabelaInfo').textContent = total
      ? `Mostrando ${startIdx + 1} a ${Math.min(startIdx + pageSize, total)} de ${fmtInt(total)} registros`
      : 'Nenhum registro encontrado';
    renderPagination(totalPages);
  }

  function renderPagination(totalPages){
    const el = $('#tabelaPaginacao');
    const cur = state.table.page;
    let html = `<button data-page="prev" ${cur<=1?'disabled':''}><i class="bi bi-chevron-left"></i></button>`;
    const windowSize = 2;
    for (let p = 1; p <= totalPages; p++){
      if (p === 1 || p === totalPages || Math.abs(p - cur) <= windowSize){
        html += `<button data-page="${p}" class="${p===cur?'active':''}">${p}</button>`;
      } else if (Math.abs(p - cur) === windowSize + 1){
        html += `<button disabled>…</button>`;
      }
    }
    html += `<button data-page="next" ${cur>=totalPages?'disabled':''}><i class="bi bi-chevron-right"></i></button>`;
    el.innerHTML = html;
    el.querySelectorAll('button[data-page]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-page');
        if (p === 'prev') state.table.page -= 1;
        else if (p === 'next') state.table.page += 1;
        else state.table.page = Number(p);
        renderTable(state.tableSource);
      });
    });
  }

  function exportTablePdf(){
    const oc = state.tableSource || [];
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('l', 'pt', 'a4');
    pdf.setFontSize(14); pdf.setTextColor('#0B2342');
    pdf.text('Guarda Civil Municipal — Registro Detalhado de Ocorrências', 30, 30);
    pdf.autoTable({
      startY: 45,
      head: [['Data','Equipe','N° AO','Código','Natureza','Bairro','Descrição']],
      body: oc.map(r => [
        r._date ? new Date(r._date).toLocaleDateString('pt-BR') : '', r.Equipe||'', r.N_AO||'',
        r.Codigo_Catalogo||'', r.Natureza||'', r.Bairro||'', r.Descricao_Ocorrencia||''
      ]),
      headStyles: { fillColor: [11,35,66] },
      styles: { fontSize: 8 }
    });
    pdf.save(`gcm_tabela_ocorrencias_${Date.now()}.pdf`);
  }

  function printTable(){
    const oc = state.tableSource || [];
    const win = window.open('', '_blank');
    const rowsHtml = oc.map(r => `<tr>
        <td>${r._date ? new Date(r._date).toLocaleDateString('pt-BR') : ''}</td>
        <td>${r.Equipe||''}</td><td>${r.N_AO||''}</td><td>${r.Codigo_Catalogo||''}</td>
        <td>${r.Natureza||''}</td><td>${r.Bairro||''}</td><td>${r.Descricao_Ocorrencia||''}</td>
      </tr>`).join('');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>GCM — Registro de Ocorrências</title>
      <style>
        body{ font-family: Arial, sans-serif; padding:24px; color:#0B2342; }
        h1{ font-size:16px; margin-bottom:4px; } p{ color:#64748B; font-size:11px; margin-top:0; }
        table{ width:100%; border-collapse: collapse; font-size:10px; }
        th,td{ border:1px solid #E3E8EF; padding:5px 7px; text-align:left; }
        th{ background:#0B2342; color:#fff; text-transform:uppercase; font-size:9px; }
        tr:nth-child(even){ background:#F4F6F9; }
      </style></head><body>
      <h1>Guarda Civil Municipal — Registro Detalhado de Ocorrências</h1>
      <p>Gerado em ${new Date().toLocaleString('pt-BR')} · ${oc.length} registro(s)</p>
      <table><thead><tr><th>Data</th><th>Equipe</th><th>N° AO</th><th>Código</th><th>Natureza</th><th>Bairro</th><th>Descrição</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  /* ---------- Gerenciamento ---------- */
  function renderGerenciarTable(){
    const tbody = $('#tbodyGerenciar');
    if (!state.files.length){
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Nenhuma planilha carregada.</td></tr>`;
      return;
    }
    tbody.innerHTML = state.files.map(f => {
      const km = (f.viaturas||[]).reduce((s,r)=>s+(Number(r.KM_Rodado)||0),0);
      const apCount = (f.apreensoes||[]).filter(r => String(r.Materiais_Apreendidos||'').trim()!=='').length;
      return `<tr>
        <td><i class="bi bi-file-earmark-spreadsheet text-primary"></i> ${f.filename}</td>
        <td>${f.monthLabel}</td>
        <td>${fmtInt((f.ocorrencias||[]).length)}</td>
        <td>${fmtInt((f.rondas||[]).reduce((s,r)=>s+(Number(r.Total_Geral_Rondas)||0),0))}</td>
        <td>${fmtInt(km)}</td>
        <td>${fmtInt(apCount)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-danger" data-remove="${f.id}"><i class="bi bi-trash3"></i> Remover</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => removeFile(btn.getAttribute('data-remove')));
    });
  }

  /* ---------------------------------------------------------------------
     8. EXPORTAÇÕES
  --------------------------------------------------------------------- */
  function exportExcel(){
    const oc = filtered('ocorrencias');
    const ws = XLSX.utils.json_to_sheet(oc.map(r => ({
      Data: r._date ? new Date(r._date).toLocaleDateString('pt-BR') : '', Equipe:r.Equipe, N_AO:r.N_AO,
      Codigo_Catalogo:r.Codigo_Catalogo, Natureza:r.Natureza, Bairro:r.Bairro, Descricao_Ocorrencia:r.Descricao_Ocorrencia
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ocorrencias_Filtradas');
    XLSX.writeFile(wb, `gcm_dados_filtrados_${Date.now()}.xlsx`);
  }

  function exportCsv(){
    const oc = filtered('ocorrencias');
    const header = ['Data','Equipe','N_AO','Codigo_Catalogo','Natureza','Bairro','Descricao_Ocorrencia'];
    const lines = [header.join(';')];
    oc.forEach(r => {
      const line = [
        r._date ? new Date(r._date).toLocaleDateString('pt-BR') : '', r.Equipe, r.N_AO, r.Codigo_Catalogo, r.Natureza, r.Bairro,
        String(r.Descricao_Ocorrencia||'').replace(/;/g,',')
      ];
      lines.push(line.join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gcm_dados_filtrados_${Date.now()}.csv`;
    a.click();
  }

  // Gera um PNG com fundo branco a partir de um gráfico Chart.js (o canvas original é transparente)
  function chartToWhitePng(chart){
    const src = chart.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0);
    return out.toDataURL('image/png', 1.0);
  }

  function exportSingleChartPng(chartId){
    const chart = state.charts[chartId];
    if (!chart){ toast('Gráfico ainda não está disponível para exportar.', 'warning'); return; }
    const a = document.createElement('a');
    a.href = chartToWhitePng(chart);
    a.download = `gcm_${chartId}_${Date.now()}.png`;
    a.click();
  }

  function exportChartsPng(){
    const ids = Object.keys(state.charts);
    if (!ids.length){ toast('Nenhum gráfico disponível para exportar.', 'warning'); return; }
    ids.forEach((id, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = chartToWhitePng(state.charts[id]);
        a.download = `gcm_${id}.png`;
        a.click();
      }, i * 250);
    });
  }

  function wireChartDownloadButtons(){
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.gcm-chart-dl');
      if (!btn) return;
      e.preventDefault();
      exportSingleChartPng(btn.getAttribute('data-chart-id'));
    });
  }

  async function exportDashboardPdf(){
    toast('Gerando PDF do dashboard, aguarde…', 'primary');
    const el = $('#capturaDashboard');
    const canvas = await html2canvas(el, { scale: 1.3, backgroundColor: '#F4F6F9', useCORS: true });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = canvas.height * (imgW / canvas.width);
    let heightLeft = imgH, position = 0;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0){
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(`gcm_dashboard_${Date.now()}.pdf`);
  }

  /* ---------- Relatório Executivo (Word / .docx) ---------- */
  function dataUrlToUint8Array(dataUrl){
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function chartDocxSize(chartId, maxWidth){
    const chart = state.charts[chartId];
    const w = maxWidth || 460;
    if (!chart || !chart.canvas || !chart.canvas.width) return { width: w, height: Math.round(w * 0.5) };
    const ratio = chart.canvas.height / chart.canvas.width;
    return { width: w, height: Math.round(w * ratio) };
  }

  async function fetchImageBytes(url){
    try{
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    }catch(e){ return null; }
  }

  function docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, text, widthPct){
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      shading: { fill: '0B2342', type: ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
      children: [ new Paragraph({ children: [ new TextRun({ text, bold: true, color: 'FFFFFF', size: 18 }) ] }) ]
    });
  }

  function docxCell(TableCell, Paragraph, TextRun, WidthType, text, widthPct, opts){
    opts = opts || {};
    return new TableCell({
      width: { size: widthPct, type: WidthType.PERCENTAGE },
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: [ new Paragraph({ children: [ new TextRun({ text: String(text == null ? '—' : text), bold: !!opts.bold, size: 18 }) ] }) ]
    });
  }

  async function exportExecutiveReportDocx(){
    if (typeof docx === 'undefined'){
      toast('A biblioteca de geração de Word (docx) ainda não carregou. Verifique a conexão e recarregue a página.', 'danger');
      return;
    }
    toast('Gerando relatório executivo em Word, aguarde…', 'primary');

    try{
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
              HeadingLevel, AlignmentType, WidthType, ShadingType, BorderStyle } = docx;

      const thinBorder = { style: BorderStyle.SINGLE, size: 2, color: 'D0D7E2' };
      const tableBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder, insideHorizontal: thinBorder, insideVertical: thinBorder };

      const oc = filtered('ocorrencias');
      const ro = filtered('rondas');
      const vi = filtered('viaturas');
      const ap = filtered('apreensoes').filter(r => String(r.Materiais_Apreendidos||'').trim() !== '');

      const totalRondas = ro.reduce((s,r) => s + (Number(r.Total_Geral_Rondas)||0), 0);
      const totalKm = vi.reduce((s,r) => s + (Number(r.KM_Rodado)||0), 0);

      // ---- Brasão (imagem no cabeçalho) ----
      const brasaoBytes = await fetchImageBytes('brasao.png');

      // ---- Gráficos como imagem (fundo branco) ----
      const chartImgs = {};
      ['chartNatureza','chartCodigo','chartBairroDonut'].forEach(id => {
        if (state.charts[id]) chartImgs[id] = dataUrlToUint8Array(chartToWhitePng(state.charts[id]));
      });

      const docChildren = [];

      // ---- Cabeçalho com brasão ----
      if (brasaoBytes){
        docChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [ new ImageRun({ type: 'png', data: brasaoBytes, transformation: { width: 80, height: 80 } }) ]
        }));
      }
      docChildren.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        children: [ new TextRun({ text: 'GUARDA CIVIL MUNICIPAL DE MATÃO', bold: true, color: '0B2342' }) ]
      }));
      docChildren.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [ new TextRun({ text: 'Relatório Executivo — Painel de Inteligência Operacional', italics: true, color: '475467', size: 22 }) ]
      }));
      docChildren.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [ new TextRun({ text: `Período de referência: ${periodoLabel()}`, bold: true, color: '0B2342', size: 20 }) ]
      }));
      docChildren.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [ new TextRun({ text: `Gerado em ${new Date().toLocaleString('pt-BR')}`, color: '64748B', size: 18 }) ]
      }));

      // ---- Introdução ----
      docChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 100, after: 120 },
        children: [ new TextRun({ text: 'Introdução', bold: true, color: '0B2342' }) ] }));
      docChildren.push(new Paragraph({ spacing: { after: 200 },
        children: [ new TextRun({
          text: `Este relatório apresenta, de forma objetiva, os indicadores operacionais da Guarda Civil Municipal de Matão referentes a ${periodoLabel()}, com base nos registros de ocorrências, rondas, viaturas e apreensões importados no painel. Os dados a seguir têm caráter quantitativo e visam subsidiar o acompanhamento gerencial e o planejamento das ações da corporação.`,
          size: 20
        }) ] }));

      // ---- Indicadores gerais ----
      docChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 120 },
        children: [ new TextRun({ text: 'Indicadores Gerais', bold: true, color: '0B2342' }) ] }));

      const kpiRows = [
        new TableRow({ children: [
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Indicador', 60),
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Valor', 40)
        ]}),
        ...[
          ['Ocorrências Registradas', fmtInt(oc.length)],
          ['Rondas Preventivas', fmtInt(totalRondas)],
          ['KM Rodado', fmtInt(totalKm)],
          ['Apreensões', fmtInt(ap.length)]
        ].map(([a,b]) => new TableRow({ children: [
          docxCell(TableCell, Paragraph, TextRun, WidthType, a, 60, { bold:true }),
          docxCell(TableCell, Paragraph, TextRun, WidthType, b, 40)
        ]}))
      ];
      docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows: kpiRows }));

      // ---- Gráfico: Natureza ----
      if (chartImgs.chartNatureza){
        docChildren.push(new Paragraph({ spacing: { before: 260 }, children: [] }));
        docChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [ new ImageRun({ type:'png', data: chartImgs.chartNatureza, transformation: chartDocxSize('chartNatureza', 460) }) ]
        }));
      }

      // ---- Natureza por categoria (3 colunas: categoria / quantidade / descrição breve) ----
      docChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 },
        children: [ new TextRun({ text: 'Ocorrências por Categoria (Código do Catálogo)', bold: true, color: '0B2342' }) ] }));
      docChildren.push(new Paragraph({ spacing: { after: 120 },
        children: [ new TextRun({ text: 'Categorias definidas pela letra inicial do Código do Catálogo de cada ocorrência.', italics: true, color: '64748B', size: 18 }) ] }));

      const catGroups = {};
      oc.forEach(r => {
        const cat = categoriaDoCodigo(r.Codigo_Catalogo);
        if (!catGroups[cat.label]) catGroups[cat.label] = [];
        catGroups[cat.label].push(r);
      });
      const catEntries = Object.entries(catGroups).sort((a,b) => b[1].length - a[1].length);

      const catRows = [
        new TableRow({ children: [
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Natureza (Categoria)', 40),
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Quantidade', 15),
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'O que mais houve na categoria', 45)
        ]}),
        ...catEntries.map(([label, rows]) => {
          const nMap = sortDesc(groupCount(rows, 'Natureza'));
          const top = nMap[0];
          const desc = top
            ? `Predominância de "${top[0]}" — ${fmtInt(top[1])} de ${fmtInt(rows.length)} ocorrências (${((top[1]/rows.length)*100).toFixed(0)}%)`
            : '—';
          return new TableRow({ children: [
            docxCell(TableCell, Paragraph, TextRun, WidthType, label, 40, { bold:true }),
            docxCell(TableCell, Paragraph, TextRun, WidthType, fmtInt(rows.length), 15),
            docxCell(TableCell, Paragraph, TextRun, WidthType, desc, 45)
          ]});
        })
      ];
      docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows: catRows }));

      if (chartImgs.chartCodigo){
        docChildren.push(new Paragraph({ spacing: { before: 260 }, children: [] }));
        docChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [ new ImageRun({ type:'png', data: chartImgs.chartCodigo, transformation: chartDocxSize('chartCodigo', 460) }) ]
        }));
      }

      // ---- Distribuição por Bairro (Top 10) ----
      docChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 },
        children: [ new TextRun({ text: 'Distribuição por Bairro (Top 10)', bold: true, color: '0B2342' }) ] }));
      const bMap = sortDesc(groupCount(oc, 'Bairro')).slice(0, 10);
      const bTotal = oc.length || 1;
      const bairroRows = [
        new TableRow({ children: [
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Bairro', 55),
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Ocorrências', 20),
          docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, '% do total', 25)
        ]}),
        ...bMap.map(([nome, qtd]) => new TableRow({ children: [
          docxCell(TableCell, Paragraph, TextRun, WidthType, nome, 55, { bold:true }),
          docxCell(TableCell, Paragraph, TextRun, WidthType, fmtInt(qtd), 20),
          docxCell(TableCell, Paragraph, TextRun, WidthType, ((qtd/bTotal)*100).toFixed(1).replace('.',',') + '%', 25)
        ]}))
      ];
      docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows: bairroRows }));

      if (chartImgs.chartBairroDonut){
        docChildren.push(new Paragraph({ spacing: { before: 260 }, children: [] }));
        docChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [ new ImageRun({ type:'png', data: chartImgs.chartBairroDonut, transformation: chartDocxSize('chartBairroDonut', 320) }) ]
        }));
      }

      // ---- Materiais Apreendidos ----
      docChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 },
        children: [ new TextRun({ text: 'Materiais Apreendidos', bold: true, color: '0B2342' }) ] }));

      if (!ap.length){
        docChildren.push(new Paragraph({ children: [ new TextRun({ text: 'Nenhuma apreensão registrada no período filtrado.', italics: true, color: '64748B' }) ] }));
      } else {
        const apRows = [
          new TableRow({ children: [
            docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Data', 15),
            docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Equipe', 15),
            docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'N° AO', 15),
            docxHeaderCell(TableCell, Paragraph, TextRun, WidthType, ShadingType, 'Descrição dos materiais apreendidos', 55)
          ]}),
          ...ap.map(r => new TableRow({ children: [
            docxCell(TableCell, Paragraph, TextRun, WidthType, r._date ? new Date(r._date).toLocaleDateString('pt-BR') : '—', 15),
            docxCell(TableCell, Paragraph, TextRun, WidthType, r.Equipe, 15),
            docxCell(TableCell, Paragraph, TextRun, WidthType, r.N_AO, 15),
            docxCell(TableCell, Paragraph, TextRun, WidthType, r.Materiais_Apreendidos, 55)
          ]}))
        ];
        docChildren.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: tableBorders, rows: apRows }));
      }

      // ---- Análise Operacional e Conclusão (texto objetivo, gerado a partir dos dados — sem nome de responsável) ----
      docChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 120 },
        children: [ new TextRun({ text: 'Análise Operacional e Conclusão', bold: true, color: '0B2342' }) ] }));

      const topCategoria = catEntries[0];
      const topBairro = bMap[0];
      const roEqTop = sortDesc(groupSum(ro, 'Equipe', 'Total_Geral_Rondas'))[0];
      const kmViaturaTop = sortDesc(groupSum(vi, 'Viatura', 'KM_Rodado'))[0];

      const analisePartes = [];
      analisePartes.push(`No período analisado foram registradas ${fmtInt(oc.length)} ocorrência(s), ${fmtInt(totalRondas)} ronda(s) e ${fmtInt(Math.round(totalKm))} km rodado(s) pelas viaturas, além de ${fmtInt(ap.length)} registro(s) de apreensão.`);
      if (topCategoria) analisePartes.push(`A categoria com maior volume de ocorrências foi "${topCategoria[0]}", com ${fmtInt(topCategoria[1].length)} registro(s).`);
      if (topBairro) analisePartes.push(`O bairro com maior número de ocorrências foi ${topBairro[0]}, concentrando ${fmtInt(topBairro[1])} registro(s) (${((topBairro[1]/bTotal)*100).toFixed(1).replace('.',',')}% do total).`);
      if (roEqTop) analisePartes.push(`Em rondas, a equipe ${roEqTop[0]} apresentou o maior volume, com ${fmtInt(roEqTop[1])} ronda(s) realizadas.`);
      if (kmViaturaTop) analisePartes.push(`Em quilometragem, a viatura ${kmViaturaTop[0]} teve a maior rodagem, totalizando ${fmtInt(Math.round(kmViaturaTop[1]))} km.`);

      docChildren.push(new Paragraph({ spacing: { after: 160 },
        children: [ new TextRun({ text: analisePartes.join(' '), size: 20 }) ] }));

      docChildren.push(new Paragraph({ spacing: { after: 200 },
        children: [ new TextRun({
          text: 'Os indicadores apresentados devem subsidiar o planejamento estratégico da corporação, orientando a alocação de efetivo e viaturas conforme a concentração de ocorrências por categoria e região, e a manutenção do acompanhamento periódico dos volumes de rondas, quilometragem e apreensões.',
          size: 20
        }) ] }));

      docChildren.push(new Paragraph({ spacing: { before: 100 },
        children: [ new TextRun({ text: 'Relatório gerado automaticamente pelo Painel de Inteligência Operacional da Guarda Civil Municipal de Matão, com base nos dados importados pelo usuário.', italics: true, color: '64748B', size: 18 }) ] }));

      const wordDoc = new Document({
        sections: [{ properties: {}, children: docChildren }]
      });

      const blob = await Packer.toBlob(wordDoc);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gcm_relatorio_executivo_${Date.now()}.docx`;
      link.click();
      URL.revokeObjectURL(url);
      toast('Relatório executivo (Word) gerado com sucesso.', 'success');
    }catch(err){
      console.error(err);
      toast('Falha ao gerar o relatório executivo em Word: ' + (err && err.message || err), 'danger');
    }
  }

  /* ---------------------------------------------------------------------
     9. INICIALIZAÇÃO / EVENTOS
  --------------------------------------------------------------------- */
  function debounce(fn, wait){
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function wireTableEvents(){
    $('#tabelaBusca').addEventListener('input', debounce(e => {
      state.table.search = e.target.value;
      state.table.page = 1;
      renderTable(state.tableSource);
    }, 220));

    $('#tabelaPageSize').value = String(state.table.pageSize);
    $('#tabelaPageSize').addEventListener('change', e => {
      state.table.pageSize = Number(e.target.value);
      state.table.page = 1;
      renderTable(state.tableSource);
    });

    $$('#tabelaOcorrencias thead th').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.getAttribute('data-field');
        if (state.table.sortField === field){
          state.table.sortDir = state.table.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.table.sortField = field;
          state.table.sortDir = 'asc';
        }
        renderTable(state.tableSource);
      });
    });

    $('#btnTabelaExcel').addEventListener('click', exportExcel);
    $('#btnTabelaCsv').addEventListener('click', exportCsv);
    $('#btnTabelaPdf').addEventListener('click', exportTablePdf);
    $('#btnTabelaImprimir').addEventListener('click', printTable);
  }

  function wireFilterEvents(){
    $('#fEquipe').addEventListener('change', e => { state.filters.equipe = e.target.value; renderAll(); });
    $('#fBairro').addEventListener('change', e => { state.filters.bairro = e.target.value; renderAll(); });
    $('#fNatureza').addEventListener('change', e => { state.filters.natureza = e.target.value; renderAll(); });
    $('#fViatura').addEventListener('change', e => { state.filters.viatura = e.target.value; renderAll(); });
    $('#fDataIni').addEventListener('change', e => { state.filters.dataIni = e.target.value; renderAll(); });
    $('#fDataFim').addEventListener('change', e => { state.filters.dataFim = e.target.value; renderAll(); });

    $('#btnLimparFiltros').addEventListener('click', () => {
      state.filters = { equipe:'Todas', meses:['Todos'], dataIni:'', dataFim:'', bairro:'Todos', natureza:'Todos', viatura:'Todos' };
      $('#fEquipe').value = 'Todas'; $('#fBairro').value = 'Todos'; $('#fNatureza').value = 'Todos'; $('#fViatura').value = 'Todos';
      $('#fDataIni').value = ''; $('#fDataFim').value = '';
      $('#fMesesLabel').textContent = 'Todos os meses';
      $$('.mes-item').forEach(cb => cb.checked = false);
      if ($('#mesTodos')) $('#mesTodos').checked = true;
      renderAll();
    });
  }

  function wireImportEvents(){
    const dz = $('#dropzone'), input = $('#inputArquivos'), modalEl = $('#modalImportar');
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
    ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });

    $('#btnConcluirImportacao').addEventListener('click', () => {
      const inst = bootstrap.Modal.getInstance(modalEl) || new bootstrap.Modal(modalEl);
      inst.hide();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Ao reabrir o modal para uma nova importação, limpa o estado visual da vez anterior
    modalEl.addEventListener('show.bs.modal', () => {
      $('#listaImportacao').innerHTML = '';
      $('#statusImportacao').textContent = '';
      $('#btnConcluirImportacao').classList.add('d-none');
      if (!libsFaltando().length) $('#avisoLibsModal').classList.add('d-none');
    });
  }

  function wireExportEvents(){
    $('#expDashPdf').addEventListener('click', e => { e.preventDefault(); exportDashboardPdf(); });
    $('#expExecDocx').addEventListener('click', e => { e.preventDefault(); exportExecutiveReportDocx(); });
    $('#expExcel').addEventListener('click', e => { e.preventDefault(); exportExcel(); });
    $('#expCsv').addEventListener('click', e => { e.preventDefault(); exportCsv(); });
    $('#expGraficosPng').addEventListener('click', e => { e.preventDefault(); exportChartsPng(); });
  }

  function wireGerenciarEvents(){
    $('#btnGerenciar').addEventListener('click', renderGerenciarTable);
    $('#modalGerenciar').addEventListener('show.bs.modal', renderGerenciarTable);
    $('#btnLimparTudo').addEventListener('click', () => {
      if (confirm('Remover todas as planilhas carregadas? Esta ação não pode ser desfeita.')) clearAllFiles();
    });
  }

  function startClock(){
    function tick(){
      $('#relogio').textContent = new Date().toLocaleString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    }
    tick(); setInterval(tick, 1000);
  }

  function init(){
    try{
      const faltando = libsFaltando();
      if (faltando.length) $('#avisoLibsGlobal').classList.remove('d-none');

      loadPersisted();
      wireTableEvents();
      wireFilterEvents();
      wireImportEvents();
      wireExportEvents();
      wireGerenciarEvents();
      wireChartDownloadButtons();
      startClock();
      rebuildFilterOptions();
      updateArquivosBadge();
      renderAll();
    }catch(err){
      console.error('Falha ao iniciar o painel:', err);
      const banner = document.createElement('div');
      banner.className = 'alert alert-danger rounded-0 mb-0 text-center py-2';
      banner.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> Ocorreu um erro ao carregar o painel: ${err && err.message ? err.message : err}. Recarregue a página.`;
      document.body.prepend(banner);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // script.js agora é carregado dinamicamente após as bibliotecas externas,
    // então o DOMContentLoaded pode já ter disparado antes dele existir.
    init();
  }
})();

