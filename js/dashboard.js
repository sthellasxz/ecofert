/*
 * EcoFert — simulação visual do composto.
 * A lixeira ainda está em desenvolvimento: um modelo simples calcula a maturação
 * dia a dia e a ilustração mostra o adubo se transformando. Quando o hardware existir,
 * substitua o modelo pelas leituras reais do ESP32.
 */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ---------- Premissas do modelo (ilustrativas) ----------
  const DIAS_BASE = 30;              // dias até maturar em condições ideais
  const TEMP_IDEAL = [45, 60];       // °C
  const UMID_IDEAL = [50, 60];       // %
  const RELACAO_IDEAL = [1.0, 1.6];  // kg marrom por kg verde
  const UMID_ALVO = 55;
  const TEMP_PICO = 52;
  const TEMP_FINAL = 34;
  const KG_POR_CLIQUE = 0.5;
  const KG_CHEIO = 4;                // massa que enche a lixeira ilustrada

  const TIPO = {
    banana: 'verde', borra: 'verde',
    folhas: 'marrom', serragem: 'marrom',
    carne: 'proibido'
  };

  const FRESCO = [201, 164, 107];    // cor do resíduo recém-colocado
  const MADURO = [74, 51, 34];       // cor do composto pronto

  const INICIAL = { dia: 0, verde: 1.0, marrom: 1.2, proibido: 0, mat: 0, temp: 46, umid: 58, ultimaAdicao: -999 };
  let e = { ...INICIAL };
  let velocidade = 5;                // dias simulados por segundo real
  let prontoAvisado = false;
  let ultimaAdicaoReal = -99999;     // instante real (ms) da última adição, para animar a tampa

  // ---------- Modelo ----------
  function faixa(v, [min, max], tolerancia) {
    if (v >= min && v <= max) return 1;
    const distancia = v < min ? min - v : v - max;
    return Math.max(0.2, 1 - distancia / tolerancia);
  }

  function razao() {
    return e.verde > 0 ? e.marrom / e.verde : null;
  }

  function fatores() {
    const r = razao();
    const fT = faixa(e.temp, TEMP_IDEAL, 15);
    const fU = faixa(e.umid, UMID_IDEAL, 25);
    const fR = r === null ? 0.2 : faixa(r, RELACAO_IDEAL, 1.0);
    const fP = e.proibido > 0 ? 0.5 : 1;
    return { total: fT * fU * fR * fP };
  }

  function avancar(dt) {
    e.dia += dt;
    const alvoT = e.mat < 0.85 ? TEMP_PICO : TEMP_FINAL;
    e.temp += (alvoT - e.temp) * Math.min(1, 0.3 * dt);
    e.umid += (UMID_ALVO - e.umid) * Math.min(1, 0.05 * dt);
    e.mat = Math.min(1, e.mat + (1 / DIAS_BASE) * fatores().total * dt);
  }

  function previsao() {
    if (e.mat >= 1) return { pronto: true };
    const taxa = (1 / DIAS_BASE) * fatores().total;
    if (taxa <= 0) return { pronto: false, dias: null };
    return { pronto: false, dias: Math.ceil((1 - e.mat) / taxa) };
  }

  function totalKg() {
    return e.verde + e.marrom + e.proibido;
  }

  function adicionar(id) {
    const tipo = TIPO[id];
    if (!tipo) return;
    if (tipo === 'verde') { e.verde += KG_POR_CLIQUE; e.umid = Math.min(80, e.umid + 1.5); }
    if (tipo === 'marrom') { e.marrom += KG_POR_CLIQUE; e.umid = Math.max(30, e.umid - 1); }
    if (tipo === 'proibido') e.proibido += KG_POR_CLIQUE;
    e.ultimaAdicao = e.dia;
    ultimaAdicaoReal = performance.now();
    render();
  }

  // ---------- Ilustração ----------
  let svg, massa;

  function montarLixeira() {
    const alvo = $('#sim-bin');
    alvo.innerHTML = window.EcoFertBin.lixeiraSVG();
    svg = alvo.querySelector('svg');
    // Camada do resíduo: fica atrás do aquecimento e do visor
    alvo.querySelector('.heat').insertAdjacentHTML('beforebegin', '<rect class="massa" x="70" y="296" width="152" height="0" rx="22"/>');
    massa = alvo.querySelector('.massa');
  }

  function corMassa(mat) {
    const c = FRESCO.map((f, i) => Math.round(f + (MADURO[i] - f) * mat));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  }

  function estadoTexto(abrindo) {
    if (abrindo) return 'Tampa aberta: resíduo caindo';
    if (e.mat >= 1) return 'Composto maduro e pronto';
    if (e.temp > 40) return 'Massa aquecida: decomposição em andamento';
    if (e.dia < 0.5) return 'Aguardando resíduos';
    return 'Mistura em repouso';
  }

  // ---------- Tela ----------
  function render() {
    const altura = Math.round(Math.min(1, totalKg() / KG_CHEIO) * 150 * 10) / 10;
    massa.setAttribute('height', altura);
    massa.setAttribute('y', 296 - altura);
    massa.setAttribute('fill', corMassa(e.mat));

    const abrindo = performance.now() - ultimaAdicaoReal < 1200;
    svg.dataset.etapa = abrindo ? '1' : e.mat >= 1 ? '5' : e.temp > 40 ? '4' : '0';

    const pct = Math.round(e.mat * 100);
    $('#sim-dia').textContent = `Dia ${Math.floor(e.dia)}`;
    $('#sim-pct').textContent = `${pct}%`;
    $('#barra-mat').style.width = `${pct}%`;
    $('#barra-prog').setAttribute('aria-valuenow', String(pct));

    const p = previsao();
    let txt;
    if (p.pronto) txt = 'Pronto para colheita!';
    else if (p.dias === null) txt = 'Faltam condições para maturar';
    else txt = `Pronto em ~${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}`;
    $('#sim-previsao').textContent = txt;
    $('#sim-estado').textContent = estadoTexto(abrindo);

    const alerta = $('#alerta');
    alerta.classList.toggle('visivel', e.proibido > 0);
    alerta.textContent = e.proibido > 0
      ? 'Carne não pode ser compostada: a mistura desacelera e pode ter odor.'
      : '';
  }

  function reiniciar() {
    e = { ...INICIAL };
    prontoAvisado = false;
    render();
  }

  function marcarVelocidade() {
    document.querySelectorAll('[data-vel]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.vel) === velocidade));
    });
  }

  // ---------- Inicialização ----------
  montarLixeira();
  marcarVelocidade();

  document.querySelectorAll('.sim-item').forEach((b) => {
    b.addEventListener('click', () => adicionar(b.dataset.item));
  });
  document.querySelectorAll('[data-vel]').forEach((b) => {
    b.addEventListener('click', () => {
      velocidade = Number(b.dataset.vel);
      marcarVelocidade();
    });
  });
  $('#btn-reset').addEventListener('click', reiniciar);

  render();

  // Avança o modelo 10 vezes por segundo
  setInterval(() => {
    avancar(0.1 * velocidade);
    if (e.mat >= 1 && !prontoAvisado) prontoAvisado = true;
    render();
  }, 100);
})();
