/*
 * EcoFert — simulação do processo de compostagem.
 * A lixeira ainda está em desenvolvimento: este painel usa um modelo simples para
 * calcular como o adubo evolui a cada dia simulado. Quando o hardware existir,
 * substitua `avancar` e as leituras pelos dados reais do ESP32.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ---------- Premissas do modelo (ilustrativas; ajuste conforme o trabalho) ----------
  const DIAS_BASE = 30;              // dias até maturar em condições ideais
  const TEMP_IDEAL = [45, 60];       // °C: faixa ideal da massa em compostagem quente
  const UMID_IDEAL = [50, 60];       // %: umidade ideal
  const RELACAO_IDEAL = [1.0, 1.6];  // kg de material marrom por kg de material verde
  const UMID_ALVO = 55;              // a umidade tende a esse valor sem adição de líquidos
  const TEMP_PICO = 52;              // temperatura alcançada durante a fase ativa
  const TEMP_FINAL = 34;             // temperatura na fase de cura

  // Resíduos que podem ser adicionados na simulação
  const ITENS = [
    { id: 'banana', nome: 'Casca de banana', tipo: 'verde' },
    { id: 'fruta', nome: 'Restos de frutas', tipo: 'verde' },
    { id: 'vegetal', nome: 'Vegetais crus', tipo: 'verde' },
    { id: 'borra', nome: 'Borra de café', tipo: 'verde' },
    { id: 'folhas', nome: 'Folhas secas', tipo: 'marrom' },
    { id: 'serragem', nome: 'Serragem (sem tinta)', tipo: 'marrom' },
    { id: 'ovo', nome: 'Cascas de ovo', tipo: 'neutro' },
    { id: 'carne', nome: 'Carne (não pode)', tipo: 'proibido' },
    { id: 'laticinio', nome: 'Laticínio (não pode)', tipo: 'proibido' }
  ];

  const INICIAL = { dia: 0, verde: 1.0, marrom: 0.8, neutro: 0, proibido: 0, mat: 0, temp: 31, umid: 58, ultimaAdicao: -999 };
  let e = { ...INICIAL };
  let velocidade = 5;     // dias simulados por segundo real
  let pausado = false;
  let prontoAvisado = false;

  const historico = { temp: [], umid: [] };
  const MAX_PONTOS = 30;
  const limites = { temp: [20, 60], umid: [30, 90] };

  const limitar = (v, min, max) => Math.min(max, Math.max(min, v));
  const fmt = (n, casas = 1) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

  // Histórico inicial para o gráfico não começar vazio
  for (let i = 0; i < 20; i++) {
    historico.temp.push(31 + (Math.random() - 0.5) * 2);
    historico.umid.push(58 + (Math.random() - 0.5) * 4);
  }

  // ---------- Modelo ----------
  // 1 quando o valor está na faixa ideal; cai linearmente fora dela até um mínimo de 20%
  function faixa(v, [min, max], tolerancia) {
    if (v >= min && v <= max) return 1;
    const distancia = v < min ? min - v : v - max;
    return Math.max(0.2, 1 - distancia / tolerancia);
  }

  function razao() {
    return e.verde > 0 ? e.marrom / e.verde : null;
  }

  // Fatores que aceleram ou atrasam a maturação (cada um vai de 0 a 1)
  function fatores() {
    const r = razao();
    const fT = faixa(e.temp, TEMP_IDEAL, 15);
    const fU = faixa(e.umid, UMID_IDEAL, 25);
    const fR = r === null ? 0.2 : faixa(r, RELACAO_IDEAL, 1.0);
    const fP = e.proibido > 0 ? 0.5 : 1;   // item que não pode reduz o ritmo
    return { fT, fU, fR, fP, total: fT * fU * fR * fP };
  }

  // Avança a simulação em `dt` dias
  function avancar(dt) {
    e.dia += dt;
    const alvoT = e.mat < 0.85 ? TEMP_PICO : TEMP_FINAL;
    e.temp += (alvoT - e.temp) * Math.min(1, 0.3 * dt);
    e.umid += (UMID_ALVO - e.umid) * Math.min(1, 0.05 * dt);
    e.mat = Math.min(1, e.mat + (1 / DIAS_BASE) * fatores().total * dt);
  }

  // Estimativa de dias restantes com as condições atuais
  function previsao() {
    if (e.mat >= 1) return { pronto: true };
    const taxa = (1 / DIAS_BASE) * fatores().total;
    if (taxa <= 0) return { pronto: false, dias: null };
    return { pronto: false, dias: Math.ceil((1 - e.mat) / taxa) };
  }

  // Adiciona um resíduo escolhido na lixeira simulada
  function adicionar(id, kg) {
    const item = ITENS.find((i) => i.id === id);
    if (!item || !(kg > 0)) return;

    if (item.tipo === 'verde') { e.verde += kg; e.umid = limitar(e.umid + 3 * kg, 30, 80); }
    if (item.tipo === 'marrom') { e.marrom += kg; e.umid = limitar(e.umid - 2 * kg, 30, 80); }
    if (item.tipo === 'neutro') e.neutro += kg;
    if (item.tipo === 'proibido') e.proibido += kg;
    e.ultimaAdicao = e.dia;

    registrar(`${fmt(kg)} kg de ${item.nome.toLowerCase()} adicionados.`);
    if (item.tipo === 'proibido') {
      registrar('Item que não pode ser compostado: o ritmo cai e há risco de odor.', 'alerta');
    }
    render();
  }

  // ---------- Registro de eventos ----------
  function registrar(msg, tipo = '') {
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const li = document.createElement('li');
    if (tipo) li.className = tipo;
    const t = document.createElement('time');
    t.textContent = hora;
    li.append(t, document.createTextNode(msg));
    const log = $('#log');
    log.prepend(li);
    while (log.children.length > 14) log.lastElementChild.remove();
  }

  // ---------- Tela ----------
  function render() {
    const massa = e.verde + e.marrom + e.neutro + e.proibido;
    $('#m-peso').textContent = `${fmt(massa)} kg`;
    $('#m-temp').textContent = `${Math.round(e.temp)} °C`;
    $('#m-umid').textContent = `${Math.round(e.umid)} %`;
    $('#m-dia').textContent = `Dia ${Math.floor(e.dia)}`;

    const pct = Math.round(e.mat * 100);
    $('#barra-mat').style.width = `${pct}%`;
    $('#barra-prog').setAttribute('aria-valuenow', String(pct));
    $('#mat-pct').textContent = `${pct}%`;
    $('#estagio-texto').textContent = e.mat >= 1 ? 'Composto pronto para colheita' : `Maturação: ${pct}%`;

    const p = previsao();
    let txtPrevisao;
    if (p.pronto) txtPrevisao = 'Pronto para colheita';
    else if (p.dias === null) txtPrevisao = 'Sem previsão: faltam condições para maturar';
    else txtPrevisao = `Previsão: ~${p.dias} ${p.dias === 1 ? 'dia' : 'dias'} simulados`;
    $('#previsao').textContent = txtPrevisao;

    const f = fatores();
    $('#ritmo').textContent = `Ritmo atual: ${Math.round(f.total * 100)}% do ideal`;

    const r = razao();
    let txtRel;
    if (r === null) txtRel = 'Sem material verde ainda';
    else if (r < RELACAO_IDEAL[0]) txtRel = 'Muito verde: falta material marrom';
    else if (r > RELACAO_IDEAL[1]) txtRel = 'Muito marrom: falta material verde';
    else txtRel = 'Equilibrada';
    $('#relacao').textContent = r === null ? txtRel : `${txtRel} (marrom/verde: ${fmt(r)})`;

    const alerta = $('#alerta');
    alerta.classList.toggle('visivel', e.proibido > 0);
    alerta.textContent = e.proibido > 0
      ? 'Há material que não pode ser compostado nesta mistura. Na lixeira real, ele seria recusado ou separado.'
      : '';

    const recente = e.dia - e.ultimaAdicao < 0.15;
    marcarAtuador('entrada', recente, 'Aberta', 'Fechada');
    marcarAtuador('trit', recente, 'Ligada', 'Parada');
    marcarAtuador('aquec', e.temp > 40, 'Ativo', 'Parado');

    atualizarGrafico();
  }

  function marcarAtuador(nome, ativo, textoOn, textoOff) {
    const li = document.querySelector(`#atuadores [data-ator="${nome}"]`);
    li.classList.toggle('ligado', ativo);
    li.querySelector('b').textContent = ativo ? textoOn : textoOff;
  }

  // ---------- Gráfico (SVG puro) ----------
  function caminho(valores, [min, max]) {
    const W = 600, H = 200, P = 14;
    const passo = (W - 2 * P) / (MAX_PONTOS - 1);
    const pontos = valores.map((v, i) => ({
      x: P + (MAX_PONTOS - valores.length + i) * passo,
      y: H - P - ((limitar(v, min, max) - min) / (max - min)) * (H - 2 * P)
    }));
    const d = pontos.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return { d, ultimo: pontos[pontos.length - 1] };
  }

  function atualizarGrafico() {
    const t = caminho(historico.temp, limites.temp);
    const u = caminho(historico.umid, limites.umid);
    $('#linha-temp').setAttribute('d', t.d);
    $('#linha-umid').setAttribute('d', u.d);
    $('#ponto-temp').setAttribute('cx', t.ultimo.x); $('#ponto-temp').setAttribute('cy', t.ultimo.y);
    $('#ponto-umid').setAttribute('cx', u.ultimo.x); $('#ponto-umid').setAttribute('cy', u.ultimo.y);

    const mm = (lista) => [Math.min(...lista), Math.max(...lista)].map((v) => Math.round(v));
    const [tMin, tMax] = mm(historico.temp);
    const [uMin, uMax] = mm(historico.umid);
    $('#t-min').textContent = `${tMin} °C`;
    $('#t-max').textContent = `${tMax} °C`;
    $('#u-min').textContent = `${uMin} %`;
    $('#u-max').textContent = `${uMax} %`;
  }

  function empurrar(lista, valor) {
    lista.push(valor);
    if (lista.length > MAX_PONTOS) lista.shift();
  }

  // ---------- Controles ----------
  function preencherItens() {
    $('#item').innerHTML = ITENS.map((i) => `<option value="${i.id}">${i.nome}</option>`).join('');
  }

  function marcarVelocidade() {
    document.querySelectorAll('[data-vel]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.vel) === velocidade));
    });
  }

  function reiniciar() {
    e = { ...INICIAL };
    prontoAvisado = false;
    $('#log').innerHTML = '';
    registrar('Nova simulação iniciada com 1,8 kg de mistura inicial.');
    render();
  }

  function ligarEventos() {
    $('#form-add').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const kg = Number($('#kg').value);
      adicionar($('#item').value, Math.round(kg * 10) / 10);
    });

    document.querySelectorAll('[data-vel]').forEach((b) => {
      b.addEventListener('click', () => {
        velocidade = Number(b.dataset.vel);
        marcarVelocidade();
      });
    });

    $('#btn-pausa').addEventListener('click', (ev) => {
      pausado = !pausado;
      ev.currentTarget.textContent = pausado ? 'Continuar' : 'Pausar';
      registrar(pausado ? 'Simulação pausada.' : 'Simulação retomada.');
    });

    $('#btn-reset').addEventListener('click', reiniciar);
  }

  // ---------- Inicialização ----------
  preencherItens();
  ligarEventos();
  marcarVelocidade();
  registrar('Simulação iniciada com 1,8 kg de mistura inicial.');
  render();

  // Avança o modelo 10 vezes por segundo
  setInterval(() => {
    if (pausado) return;
    avancar(0.1 * velocidade);
    if (e.mat >= 1 && !prontoAvisado) {
      prontoAvisado = true;
      registrar('Composto pronto para colheita.', 'pronto');
    }
    render();
  }, 100);

  // Amostra o histórico do gráfico a cada segundo real
  setInterval(() => {
    empurrar(historico.temp, e.temp);
    empurrar(historico.umid, e.umid);
  }, 1000);
})();
