/*
 * EcoFert — simulação de compostagem com datas.
 * A pessoa registra o que colocou e em que dia. Cada material amadurece conforme o
 * tempo que passa na lixeira; o composto fica pronto quando todos os materiais
 * completam o prazo. Quando o hardware existir, os registros poderão vir do ESP32.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Premissas (ilustrativas) ----------
  const DIAS_MATURACAO = { pode: 30, moderacao: 45 };  // dias até cada categoria ficar pronta
  const KG_CHEIO = 5;                                  // massa que enche a ilustração
  const CHAVE = 'ecofert-simulacao-v1';
  const FRESCO = [201, 164, 107];
  const MADURO = [74, 51, 34];
  const ROTULO = { pode: 'Pode compostar', moderacao: 'Com moderação', nao: 'Não pode' };

  // ---------- Datas (sempre no fuso local, em formato AAAA-MM-DD) ----------
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
    try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch (_) { /* navegador sem armazenamento */ }
  }

  let estado = carregar() || { hoje: hojeISO(), itens: [] };
  let idSeq = Date.now();
  let svg, massa;
  let ultimaAdicaoReal = -99999;

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

  // O último material a terminar define o dia em que o composto fica pronto
  function diaPronto() {
    if (!estado.itens.length || temProibido()) return null;
    return estado.itens.map((it) => somarDias(it.data, DIAS_MATURACAO[it.cat])).sort().pop();
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

    const abrindo = performance.now() - ultimaAdicaoReal < 1200;
    svg.dataset.etapa = abrindo ? '1' : pronto() ? '5' : estado.itens.length ? '4' : '0';

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
    ultimaAdicaoReal = performance.now();
    setTimeout(render, 1250);
    salvar();
    render();
  }

  function mudarHoje(novo) {
    if (!novo) return;
    estado.hoje = novo;
    salvar();
    render();
  }

  function ligarEventos() {
    $('#form-add').addEventListener('submit', adicionar);

    $('#btn-mais1').addEventListener('click', () => mudarHoje(somarDias(estado.hoje, 1)));
    $('#btn-mais7').addEventListener('click', () => mudarHoje(somarDias(estado.hoje, 7)));
    $('#sim-hoje-input').addEventListener('change', (ev) => mudarHoje(ev.target.value));

    $('#sim-lista').addEventListener('click', (ev) => {
      const botao = ev.target.closest('[data-remover]');
      if (!botao) return;
      estado.itens = estado.itens.filter((it) => it.id !== botao.dataset.remover);
      salvar();
      render();
    });

    $('#btn-esvaziar').addEventListener('click', () => {
      if (!estado.itens.length) return;
      if (!window.confirm('Esvaziar a lixeira e apagar todos os registros?')) return;
      estado.itens = [];
      salvar();
      render();
    });
  }

  // ---------- Inicialização ----------
  montarLixeira();
  $('#lista-itens').innerHTML = window.EcoFertGuia.nomes.map((n) => `<option value="${esc(n)}"></option>`).join('');
  $('#sim-data').value = estado.hoje;
  $('#sim-data').max = estado.hoje;
  ligarEventos();
  render();
})();
