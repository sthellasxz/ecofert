/*
 * EcoFert — simulação de compostagem com datas e etapas.
 * A pessoa registra o que colocou e em que dia. Cada material amadurece conforme o
 * tempo que passa na lixeira, e a lixeira virtual mostra a etapa atual do processo.
 * Quando o hardware existir, os registros e as etapas poderão vir do ESP32.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Premissas (ilustrativas) ----------
  const DIAS_MATURACAO = { pode: 30, moderacao: 45 };
  const KG_CHEIO = 5;
  const CHAVE = 'ecofert-simulacao-v1';
  const FRESCO = [201, 164, 107];
  const MADURO = [74, 51, 34];
  const ROTULO = { pode: 'Pode compostar', moderacao: 'Com moderação', nao: 'Não pode' };
  const TOTAL_ETAPAS = ETAPAS.length;

  // ---------- Datas (fuso local, formato AAAA-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const paraISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hojeISO = () => paraISO(new Date());
  const dataDe = (iso) => new Date(`${iso}T00:00:00`);
  const diasEntre = (a, b) => Math.round((dataDe(b) - dataDe(a)) / 86400000);
  const somarDias = (iso, n) => { const d = dataDe(iso); d.setDate(d.getDate() + n); return paraISO(d); };
  const formatarData = (iso) => dataDe(iso).toLocaleDateString('pt-BR');
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  // ---------- Estado ----------
  function carregar() {
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE));
      return s && s.hoje && Array.isArray(s.itens) ? s : null;
    } catch (_) { return null; }
  }
  function salvar() {
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (_) { /* sem armazenamento */ }
  }

  let estado = carregar() || { hoje: hojeISO(), itens: [] };
  let idSeq = Date.now();
  let svg, massa;

  // Etapa escolhida pela pessoa nos botões 1 a 5 (null = automática)
  let etapaManual = null;
  // Etapa durante a animação logo após registrar um resíduo
  let etapaAnim = null;
  let timersAnim = [];
  let ultimaEtapaTexto = -1;

  // ---------- Modelo ----------
  const idadeDias = (it) => Math.max(0, diasEntre(it.data, estado.hoje));
  const progressoItem = (it) => (it.cat === 'nao' ? 0 : Math.min(1, idadeDias(it) / DIAS_MATURACAO[it.cat]));
  const temProibido = () => estado.itens.some((it) => it.cat === 'nao');
  const pronto = () => estado.itens.length > 0 && !temProibido() && estado.itens.every((it) => progressoItem(it) >= 1);
  const totalKg = () => estado.itens.reduce((s, it) => s + it.kg, 0);

  function progressoTotal() {
    const t = totalKg();
    return t ? estado.itens.reduce((s, it) => s + it.kg * progressoItem(it), 0) / t : 0;
  }

  function diaPronto() {
    if (!estado.itens.length || temProibido()) return null;
    return estado.itens.map((it) => somarDias(it.data, DIAS_MATURACAO[it.cat])).sort().pop();
  }

  // Etapa que corresponde ao andamento real do composto
  // 0 = lixeira vazia · 3 = tratamento (mistura recém-feita) · 4 = compostagem · 5 = reaproveitamento
  function etapaAutomatica() {
    if (!estado.itens.length) return 0;
    if (pronto()) return 5;
    return progressoTotal() > 0 ? 4 : 3;
  }

  function etapaVisivel() {
    if (etapaAnim !== null) return etapaAnim;
    if (etapaManual !== null) return etapaManual;
    return etapaAutomatica();
  }

  // ---------- Ilustração ----------
  function montarLixeira() {
    const alvo = $('#sim-bin');
    alvo.innerHTML = window.EcoFertBin.lixeiraSVG();
    svg = alvo.querySelector('svg');
    alvo.querySelector('.heat').insertAdjacentHTML('beforebegin', '<rect class="massa" x="70" y="296" width="152" height="0" rx="22"/>');
    massa = alvo.querySelector('.massa');
  }

  function corMassa(p) {
    const c = FRESCO.map((f, i) => Math.round(f + (MADURO[i] - f) * p));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  // ---------- Etapas (trilha 1 a 5 e texto explicativo) ----------
  function montarTrilha() {
    $('#trilha').innerHTML = ETAPAS.map((e, i) => `
      <button type="button" class="trilha-passo" data-passo="${i}" aria-pressed="false">
        <span class="bolinha">${i + 1}</span>
        <span class="rotulo">${e.titulo}</span>
      </button>`).join('');
  }

  function mostrarTextoEtapa(ref) {
    const e = ETAPAS[ref - 1];
    const det = $('#detalhe');
    det.classList.remove('entrar');
    void det.offsetWidth;
    det.classList.add('entrar');
    $('#etapa-num').textContent = `Etapa ${ref} de ${TOTAL_ETAPAS}`;
    $('#etapa-titulo').textContent = e.titulo;
    $('#etapa-sub').textContent = e.subtitulo;
    $('#etapa-texto').textContent = e.texto;
    $('#etapa-comps').innerHTML = e.sensores.map((k) => `
      <li><button type="button" data-sensor="${k}"><b>${SENSORES[k].nome}</b>${SENSORES[k].resumo}</button></li>`).join('');
  }

  function renderEtapa(n) {
    svg.dataset.etapa = String(n);

    $('#trilha').querySelectorAll('.trilha-passo').forEach((b, j) => {
      b.setAttribute('aria-pressed', String(j === n - 1));
      b.classList.toggle('concluido', n > 0 && j < n - 1);
    });

    const sensores = n > 0 ? ETAPAS[n - 1].sensores : [];
    $('#sim-bin').querySelectorAll('.hotspot').forEach((h) => {
      h.classList.toggle('destaque', sensores.includes(h.dataset.sensor));
    });

    const ref = Math.max(1, n);
    if (ref !== ultimaEtapaTexto) {
      ultimaEtapaTexto = ref;
      mostrarTextoEtapa(ref);
    }
    $('#contador').textContent = `${ref} / ${TOTAL_ETAPAS}`;
    $('#prev').disabled = ref <= 1;
    $('#next').disabled = ref >= TOTAL_ETAPAS;
  }

  function irParaEtapa(n) {
    limparAnimacao();
    etapaManual = Math.max(1, Math.min(TOTAL_ETAPAS, n));
    render();
  }

  // Após registrar um resíduo, a lixeira mostra o caminho: descarte → trituração → tratamento
  function animarAdicao() {
    limparAnimacao();
    etapaManual = null;
    etapaAnim = 1;
    timersAnim.push(setTimeout(() => { etapaAnim = 2; render(); }, 1400));
    timersAnim.push(setTimeout(() => { etapaAnim = 3; render(); }, 2800));
    timersAnim.push(setTimeout(() => { etapaAnim = null; render(); }, 4200));
  }

  function limparAnimacao() {
    timersAnim.forEach(clearTimeout);
    timersAnim = [];
    etapaAnim = null;
  }

  // ---------- Tela ----------
  function render() {
    $('#sim-hoje').textContent = formatarData(estado.hoje);
    $('#sim-hoje-input').value = estado.hoje;

    const p = progressoTotal();
    const pct = Math.round(p * 100);
    const altura = Math.round(Math.min(1, totalKg() / KG_CHEIO) * 150 * 10) / 10;
    massa.setAttribute('height', altura);
    massa.setAttribute('y', 296 - altura);
    massa.setAttribute('fill', corMassa(p));

    $('#sim-pct').textContent = `${pct}%`;
    $('#barra-mat').style.width = `${pct}%`;
    $('#barra-prog').setAttribute('aria-valuenow', String(pct));

    const status = $('#sim-status');
    if (!estado.itens.length) {
      status.className = 'sim-status';
      status.textContent = 'A lixeira está vazia. Registre o primeiro resíduo abaixo.';
    } else if (temProibido()) {
      status.className = 'sim-status erro';
      status.textContent = 'Há material que não pode ser compostado. Remova-o da lixeira para o composto amadurecer.';
    } else if (pronto()) {
      status.className = 'sim-status pronto';
      status.textContent = 'Composto pronto para colheita!';
    } else {
      const dias = diasEntre(estado.hoje, diaPronto());
      status.className = 'sim-status';
      status.textContent = `Fica pronto em ${plural(dias, 'dia', 'dias')}, no dia ${formatarData(diaPronto())}`;
    }

    renderEtapa(etapaVisivel());
    renderLista();
  }

  function renderLista() {
    const lista = $('#sim-lista');
    if (!estado.itens.length) {
      lista.innerHTML = '<li class="vazio">Nada registrado ainda.</li>';
      return;
    }
    lista.innerHTML = estado.itens
      .slice()
      .sort((a, b) => a.data.localeCompare(b.data))
      .map((it) => {
        const idade = idadeDias(it);
        const pr = Math.round(progressoItem(it) * 100);
        let situacao;
        if (it.cat === 'nao') situacao = 'Não pode: remova para o composto amadurecer';
        else if (pr >= 100) situacao = 'Pronto';
        else situacao = `Faltam ${plural(DIAS_MATURACAO[it.cat] - idade, 'dia', 'dias')}`;
        return `
          <li class="cat-${it.cat}">
            <div class="sim-info">
              <b>${esc(it.nome)}</b>
              <span>${it.kg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kg · ${ROTULO[it.cat]} · colocado em ${formatarData(it.data)} · há ${plural(idade, 'dia', 'dias')}</span>
            </div>
            <button type="button" class="sim-remover" data-remover="${it.id}" aria-label="Remover ${esc(it.nome)}">×</button>
            <div class="sim-mini"><i style="width:${pr}%"></i></div>
            <small>${situacao}</small>
          </li>`;
      })
      .join('');
  }

  // ---------- Ações ----------
  function adicionar(ev) {
    ev.preventDefault();
    const erro = $('#sim-erro');
    erro.textContent = '';

    const texto = $('#sim-texto').value.trim();
    if (!texto) {
      erro.textContent = 'Escreva o que você colocou ou escolha uma sugestão.';
      $('#sim-texto').focus();
      return;
    }

    const kg = Math.round(Number($('#sim-kg').value) * 10) / 10;
    if (!(kg >= 0.1 && kg <= 5)) {
      erro.textContent = 'A quantidade deve ficar entre 0,1 e 5 kg.';
      return;
    }

    const data = $('#sim-data').value || estado.hoje;
    if (data > estado.hoje) {
      erro.textContent = 'O dia em que colocou não pode ser depois de hoje.';
      return;
    }

    let cat = $('#sim-cat').value;
    let nome = texto;
    if (cat === 'auto') {
      const achado = window.EcoFertGuia.buscarGuia(texto)[0];
      if (!achado) {
        erro.textContent = 'Não reconheci este item. Escolha a categoria acima.';
        $('#sim-cat').focus();
        return;
      }
      cat = achado.cat;
      nome = achado.item.nome;
    }

    estado.itens.push({ id: String(++idSeq), nome, cat, kg, data });
    $('#sim-texto').value = '';
    $('#sim-cat').value = 'auto';
    salvar();
    animarAdicao();
    render();
  }

  function mudarHoje(novo) {
    if (!novo) return;
    estado.hoje = novo;
    etapaManual = null;
    salvar();
    render();
  }

  function ligarEventos() {
    $('#form-add').addEventListener('submit', adicionar);

    $('#btn-mais1').addEventListener('click', () => mudarHoje(somarDias(estado.hoje, 1)));
    $('#btn-mais7').addEventListener('click', () => mudarHoje(somarDias(estado.hoje, 7)));
    $('#sim-hoje-input').addEventListener('change', (ev) => mudarHoje(ev.target.value));

    $('#trilha').addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-passo]');
      if (botao) irParaEtapa(Number(botao.dataset.passo) + 1);
    });
    $('#prev').addEventListener('click', () => irParaEtapa(etapaVisivel() - 1));
    $('#next').addEventListener('click', () => irParaEtapa(etapaVisivel() + 1));

    $('#sim-lista').addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-remover]');
      if (!botao) return;
      estado.itens = estado.itens.filter((it) => it.id !== botao.dataset.remover);
      etapaManual = null;
      salvar();
      render();
    });

    $('#btn-esvaziar').addEventListener('click', () => {
      if (!estado.itens.length) return;
      if (!window.confirm('Esvaziar a lixeira e apagar todos os registros?')) return;
      limparAnimacao();
      estado.itens = [];
      etapaManual = null;
      salvar();
      render();
    });
  }

  // ---------- Inicialização ----------
  montarLixeira();
  montarTrilha();
  $('#lista-itens').innerHTML = window.EcoFertGuia.nomes.map((n) => `<option value="${esc(n)}"></option>`).join('');
  $('#sim-data').value = estado.hoje;
  $('#sim-data').max = estado.hoje;
  ligarEventos();
  render();
})();
