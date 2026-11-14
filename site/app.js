/* Fio a Fio · WebAR
 * Dois modos a partir da câmera, os dois reconhecendo o quadro com MindAR:
 *   "ar"   → o filme é ancorado sobre o quadro (realidade aumentada)
 *   "tela" → ao reconhecer o quadro, o filme abre em tela cheia
 * Plano B: "Assistir sem câmera" e qualquer erro de câmera abrem o filme em tela cheia.
 */
(() => {
  'use strict';

  const VIDEO_AR = 'assets/fio_a_fio_ar.mp4?v=1';   // 720x1280 (textura do AR, mais leve)
  const VIDEO_HD = 'assets/fio_a_fio_hd.mp4?v=1';   // 1080x1920 (tela cheia)
  const ALVO = 'targets/quadro.mind?v=1';

  // Geometria do encaixe:
  // o alvo impresso (941x1680 px, 42x75 cm) é o frame INTEIRO do vídeo (1080x1920),
  // levemente comprimido na vertical. No MindAR o alvo tem largura 1 e fica centrado
  // na origem; então o plano do vídeo usa exatamente a proporção do alvo, centrado,
  // e cada ponto do vídeo cai sobre o mesmo ponto do quadro.
  const PLANO_LARGURA = 1;
  const PLANO_ALTURA = 1680 / 941; // 1.78533

  /* ---------- Ajustes de precisão do rastreamento ----------
   * Valores padrão; podem ser testados no celular pela URL, ex.: ?fov=60&beta=500
   * e, no modo ?calibrar=1, com controles deslizantes na tela.
   *  fov   — campo de visão vertical (graus) assumido para a câmera. O MindAR usa 45°,
   *          mas a câmera principal dos celulares em pé tem ~60–70°; com o valor errado
   *          os cantos "escorregam" quando o quadro é visto de lado.
   *  res   — resolução pedida à câmera (lado maior). Mais pixels = cantos mais precisos.
   *  minCF/beta — filtro One Euro: minCF baixo = parado mais estável;
   *          beta alto = acompanha o movimento sem atraso.
   *  sx/sy/dx/dy — ajuste fino do plano sobre o quadro impresso (escala e deslocamento,
   *          em unidades da largura do quadro: 0,001 ≈ 0,4 mm no quadro de 42 cm).
   */
  const URLP = new URLSearchParams(location.search);
  const num = (k, padrao) => { const v = parseFloat(URLP.get(k)); return Number.isFinite(v) ? v : padrao; };
  const CONFIG = {
    fov: num('fov', 63),
    res: num('res', 1280),
    minCF: num('minCF', 0.001),
    beta: num('beta', 1000),
    sx: num('sx', 1), sy: num('sy', 1), dx: num('dx', 0), dy: num('dy', 0),
  };
  const CALIBRAR = URLP.has('calibrar');
  window.MINDAR_FOVY = CONFIG.fov;
  if (CONFIG.res > 0) {
    // pede HD; o navegador entrega a mais próxima que a câmera suportar
    window.MINDAR_VIDEO = { width: { ideal: CONFIG.res }, height: { ideal: Math.round(CONFIG.res * 9 / 16) } };
  }

  const $ = (id) => document.getElementById(id);
  const inicio = $('inicio'), camera = $('camera'), cinema = $('cinema');
  const palco = $('palco'), mira = $('mira'), miraTexto = $('miraTexto');
  const carregando = $('carregando'), carregandoTexto = $('carregandoTexto');
  const controlesAR = $('controlesAR'), progressoAR = $('progressoAR');
  const filmeAR = $('filmeAR'), filmeHD = $('filmeHD');
  const fim = $('fim'), btnSom = $('btnSom');

  let modo = null;          // 'ar' | 'tela'
  let cena = null;          // <a-scene>
  let arRodando = false;
  let alvoVisivel = false;

  /* ---------- Ambiente ---------- */
  const ua = navigator.userAgent || '';
  const navegadorDeApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|Snapchat|LinkedInApp|Pinterest/i.test(ua);
  const temCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  if (navegadorDeApp || !temCamera) $('avisoApp').classList.remove('escondido');
  if (!temCamera && !navegadorDeApp) {
    $('avisoApp').innerHTML = '<strong>Este navegador não liberou a câmera.</strong>Abra o link no Safari (iPhone) ou no Chrome (Android), ou assista ao filme sem câmera.';
  }

  /* ---------- Bibliotecas (carregadas em segundo plano depois da landing) ---------- */
  let libs = null;
  function carregarScript(src) {
    return new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = src; s.async = false; s.onload = ok; s.onerror = erro;
      document.head.appendChild(s);
    });
  }
  function carregarLibs() {
    if (!libs) {
      libs = carregarScript('vendor/aframe.min.js?v=2')
        .then(() => carregarScript('vendor/mindar-image-aframe.prod.js?v=2'));
      libs.catch(() => { libs = null; });
    }
    return libs;
  }
  window.addEventListener('load', () => { if (temCamera) setTimeout(carregarLibs, 400); });

  /* ---------- Áudio/vídeo: desbloqueio no toque (regra do iOS/Android) ---------- */
  function prepararVideo(v, src) {
    if (!v.getAttribute('src')) { v.src = src; v.preload = 'auto'; v.load(); }
  }
  function desbloquear(v) {
    v.muted = false;
    const p = v.play();
    if (p && p.then) {
      p.then(() => { if (!v.dataset.tocar) v.pause(); })
       .catch(() => { v.muted = true; atualizarBotaoSom(); });
    }
  }
  function atualizarBotaoSom() { btnSom.classList.toggle('mudo', filmeAR.muted); }

  /* ---------- Cena AR ---------- */
  function criarCena() {
    if (cena) return Promise.resolve(cena);
    palco.innerHTML = `
      <a-scene
        mindar-image="imageTargetSrc: ${ALVO}; autoStart: false; uiLoading: no; uiScanning: no; uiError: no;
                      filterMinCF: ${CONFIG.minCF}; filterBeta: ${CONFIG.beta}; missTolerance: 10; warmupTolerance: 3"
        color-space="sRGB"
        renderer="colorManagement: true; antialias: true; precision: medium; alpha: true"
        vr-mode-ui="enabled: false"
        device-orientation-permission-ui="enabled: false"
        loading-screen="enabled: false"
        embedded>
        <a-camera position="0 0 0" look-controls="enabled: false" wasd-controls="enabled: false"></a-camera>
        <a-entity id="alvo" mindar-image-target="targetIndex: 0">
          <a-plane id="telaAR" width="${PLANO_LARGURA * CONFIG.sx}" height="${PLANO_ALTURA * CONFIG.sy}"
                   position="${CONFIG.dx} ${CONFIG.dy} 0.001"
                   material="shader: flat; src: #filmeAR; transparent: true; opacity: 0; side: front"
                   visible="false"></a-plane>
        </a-entity>
      </a-scene>`;
    cena = palco.querySelector('a-scene');

    cena.addEventListener('arReady', () => {
      arRodando = true;
      carregando.classList.add('oculta');
    });
    cena.addEventListener('arError', () => {
      arRodando = false;
      abrirCinema({ motivo: 'erro' });
    });
    const alvo = cena.querySelector('#alvo');
    alvo.addEventListener('targetFound', aoEncontrar);
    alvo.addEventListener('targetLost', aoPerder);

    return new Promise((ok) => {
      if (cena.hasLoaded) ok(cena); else cena.addEventListener('loaded', () => ok(cena), { once: true });
    });
  }

  function sistemaAR() { return cena && cena.systems['mindar-image-system']; }

  async function iniciarCamera(m) {
    modo = m;
    // 1) dentro do gesto: desbloqueia o vídeo que vai tocar, com som
    if (modo === 'ar') { prepararVideo(filmeAR, VIDEO_AR); desbloquear(filmeAR); }
    else { prepararVideo(filmeHD, VIDEO_HD); desbloquear(filmeHD); }

    inicio.classList.add('escondido');
    camera.classList.remove('escondido');
    carregando.classList.remove('oculta');
    mira.classList.remove('oculta');
    controlesAR.classList.add('escondido');
    progressoAR.classList.add('escondido');
    miraTexto.textContent = modo === 'ar'
      ? 'Enquadre o quadro inteiro na tela'
      : 'Aponte para o quadro para abrir o filme';
    carregandoTexto.textContent = 'Preparando a câmera…';

    // 2) carrega libs (normalmente já estão em cache) e liga o rastreamento
    try {
      await carregarLibs();
      await criarCena();
      const tela = cena.querySelector('#telaAR');
      tela.setAttribute('visible', false);
      tela.setAttribute('material', 'opacity', 0);
      alvoVisivel = false;
      sistemaAR().start();
    } catch (e) {
      console.error('Falha ao iniciar a câmera', e);
      abrirCinema({ motivo: 'erro' });
    }
  }

  function pararCamera() {
    try { if (arRodando) sistemaAR().stop(); } catch (e) {}
    arRodando = false;
    // o MindAR guarda a âncora como "visível" se parar com o quadro na tela;
    // forçamos "perdido" para o próximo start disparar targetFound de novo.
    try {
      const ancora = cena && cena.querySelector('#alvo').components['mindar-image-target'];
      if (ancora && ancora.el.object3D.visible) ancora.updateWorldMatrix(null);
    } catch (e) {}
    alvoVisivel = false;
    filmeAR.pause();
  }

  /* ---------- Eventos do rastreamento ---------- */
  function fade(para, ms) {
    const tela = cena.querySelector('#telaAR');
    tela.removeAttribute('animation__fade');
    tela.setAttribute('animation__fade', { property: 'material.opacity', to: para, dur: ms, easing: 'easeOutQuad' });
  }

  function aoEncontrar() {
    alvoVisivel = true;
    mira.classList.add('oculta');

    if (modo === 'tela') {
      // reconheceu o quadro → filme em tela cheia
      abrirCinema({ motivo: 'reconhecido' });
      return;
    }

    const tela = cena.querySelector('#telaAR');
    tela.setAttribute('visible', true);
    const mostrar = () => { if (alvoVisivel) fade(calib.opacidade, 250); };
    if (calib.congelar) {
      // calibração: vídeo parado no 1º frame (= arte impressa) para comparar os cantos
      filmeAR.pause(); filmeAR.currentTime = 0;
      if (filmeAR.readyState >= 2) mostrar(); else filmeAR.addEventListener('loadeddata', mostrar, { once: true });
      return;
    }
    filmeAR.dataset.tocar = '1';
    // só mostra o plano quando já existe um frame decodificado (evita "piscar" preto)
    if (filmeAR.readyState >= 2) mostrar();
    else filmeAR.addEventListener('loadeddata', mostrar, { once: true });
    filmeAR.play().catch(() => { filmeAR.muted = true; atualizarBotaoSom(); filmeAR.play().catch(() => {}); });

    controlesAR.classList.remove('escondido');
    progressoAR.classList.remove('escondido');
  }

  function aoPerder() {
    alvoVisivel = false;
    if (modo !== 'ar') return;
    fade(0, 200);
    delete filmeAR.dataset.tocar;
    filmeAR.pause();
    mira.classList.remove('oculta');
    miraTexto.textContent = 'Aponte de novo para o quadro';
  }

  filmeAR.addEventListener('timeupdate', () => {
    if (filmeAR.duration) progressoAR.firstElementChild.style.width = (filmeAR.currentTime / filmeAR.duration * 100) + '%';
  });

  /* ---------- Cinema (tela cheia) ---------- */
  function abrirCinema({ motivo, inicioEm = 0 } = {}) {
    pararCamera();
    prepararVideo(filmeHD, VIDEO_HD);
    camera.classList.add('escondido');
    inicio.classList.add('escondido');
    cinema.classList.remove('escondido');
    fim.classList.add('escondido');
    filmeHD.controls = true;
    filmeHD.dataset.tocar = '1';
    if (inicioEm) {
      const pular = () => { try { filmeHD.currentTime = inicioEm; } catch (e) {} };
      if (filmeHD.readyState >= 1) pular(); else filmeHD.addEventListener('loadedmetadata', pular, { once: true });
    }
    filmeHD.play().catch(() => {
      // sem permissão de som: toca mudo e o usuário liga o som nos controles
      filmeHD.muted = true;
      filmeHD.play().catch(() => {});
    });
    if (motivo === 'erro') console.warn('AR indisponível: abrindo o filme em tela cheia.');
  }

  function fecharCinema() {
    filmeHD.pause();
    delete filmeHD.dataset.tocar;
    cinema.classList.add('escondido');
    camera.classList.add('escondido');
    inicio.classList.remove('escondido');
  }

  filmeHD.addEventListener('ended', () => { fim.classList.remove('escondido'); });

  /* ---------- Botões ---------- */
  document.querySelectorAll('.escolha').forEach((b) => {
    b.addEventListener('click', () => {
      if (!temCamera) { abrirCinema({ motivo: 'sem-camera' }); return; }
      iniciarCamera(b.dataset.modo);
    });
  });
  $('btnSemCamera').addEventListener('click', () => abrirCinema({ motivo: 'escolha' }));
  $('btnVoltar').addEventListener('click', () => {
    pararCamera();
    camera.classList.add('escondido');
    inicio.classList.remove('escondido');
  });
  btnSom.addEventListener('click', () => {
    filmeAR.muted = !filmeAR.muted;
    if (!filmeAR.muted && alvoVisivel) filmeAR.play().catch(() => {});
    atualizarBotaoSom();
  });
  $('btnRecomecar').addEventListener('click', () => {
    filmeAR.currentTime = 0;
    progressoAR.firstElementChild.style.width = '0';
  });
  $('btnExpandir').addEventListener('click', () => {
    abrirCinema({ motivo: 'expandir', inicioEm: filmeAR.currentTime });
  });
  $('btnFecharCinema').addEventListener('click', fecharCinema);
  $('btnInicio').addEventListener('click', fecharCinema);
  $('btnRever').addEventListener('click', () => {
    fim.classList.add('escondido');
    filmeHD.currentTime = 0;
    filmeHD.play().catch(() => {});
  });

  /* ---------- Modo calibração (?calibrar=1) ----------
   * Para ajustar no quadro REAL: vídeo semitransparente parado no 1º frame,
   * controles de escala/deslocamento (ao vivo) e de FOV/filtro (reiniciam a câmera).
   * No fim, mostra os valores para fixar como padrão no app.js.
   */
  const calib = { opacidade: 1, congelar: false };
  if (CALIBRAR) {
    calib.opacidade = 0.5; calib.congelar = true;
    const painel = document.createElement('div');
    painel.className = 'calib';
    const campos = [
      ['opacidade', 'Transparência', 0.1, 1, 0.05, () => calib.opacidade],
      ['sx', 'Escala largura', 0.95, 1.05, 0.001, () => CONFIG.sx],
      ['sy', 'Escala altura', 0.95, 1.05, 0.001, () => CONFIG.sy],
      ['dx', 'Desloc. horiz.', -0.05, 0.05, 0.001, () => CONFIG.dx],
      ['dy', 'Desloc. vert.', -0.05, 0.05, 0.001, () => CONFIG.dy],
      ['fov', 'FOV câmera (°) *', 40, 85, 1, () => CONFIG.fov],
      ['minCF', 'Filtro parado *', 0.00001, 0.01, 0.00001, () => CONFIG.minCF],
      ['beta', 'Filtro movimento *', 0, 3000, 10, () => CONFIG.beta],
    ];
    painel.innerHTML = `
      <div class="calib-topo"><label><input type="checkbox" id="cCongelar" checked> Congelar no 1º frame</label>
        <button id="cRecolher" type="button">Recolher ▾</button></div>
      ${campos.map(([k, rot, mi, ma, st, v]) => `
        <label class="calib-linha"><span>${rot}</span>
          <input type="range" data-k="${k}" min="${mi}" max="${ma}" step="${st}" value="${v()}">
          <output id="o_${k}">${v()}</output></label>`).join('')}
      <div class="calib-botoes"><button id="cAplicar">Aplicar * (reinicia câmera)</button><button id="cCopiar">Copiar valores</button></div>
      <code id="cValores"></code>`;
    camera.appendChild(painel);

    const escrever = () => {
      const s = `fov=${CONFIG.fov}&minCF=${CONFIG.minCF}&beta=${CONFIG.beta}&sx=${CONFIG.sx}&sy=${CONFIG.sy}&dx=${CONFIG.dx}&dy=${CONFIG.dy}`;
      const v = palco.querySelector('video');
      $('cValores').textContent = s + (v ? `  · câmera ${v.videoWidth}x${v.videoHeight}` : '');
      return s;
    };
    const aplicarPlano = () => {
      const tela = cena && cena.querySelector('#telaAR');
      if (!tela) return;
      tela.setAttribute('width', PLANO_LARGURA * CONFIG.sx);
      tela.setAttribute('height', PLANO_ALTURA * CONFIG.sy);
      tela.setAttribute('position', `${CONFIG.dx} ${CONFIG.dy} 0.001`);
      if (alvoVisivel) tela.setAttribute('material', 'opacity', calib.opacidade);
    };
    painel.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (k) {
        const v = parseFloat(e.target.value);
        if (k === 'opacidade') calib.opacidade = v; else CONFIG[k] = v;
        $('o_' + k).textContent = v;
        aplicarPlano(); escrever();
      }
      if (e.target.id === 'cCongelar') {
        calib.congelar = e.target.checked;
        if (!calib.congelar && alvoVisivel) { filmeAR.dataset.tocar = '1'; filmeAR.play().catch(() => {}); }
        if (calib.congelar) { filmeAR.pause(); filmeAR.currentTime = 0; }
      }
    });
    $('cRecolher').addEventListener('click', () => {
      const r = painel.classList.toggle('recolhido');
      $('cRecolher').textContent = r ? 'Ajustes ▴' : 'Recolher ▾';
    });
    $('cAplicar').addEventListener('click', () => {
      pararCamera();
      window.MINDAR_FOVY = CONFIG.fov;
      const sis = sistemaAR();
      if (sis) { sis.filterMinCF = CONFIG.minCF; sis.filterBeta = CONFIG.beta; }
      iniciarCamera('ar');
    });
    $('cCopiar').addEventListener('click', () => {
      const s = escrever();
      (navigator.clipboard ? navigator.clipboard.writeText(s) : Promise.reject()).then(
        () => { $('cCopiar').textContent = 'Copiado!'; }, () => { $('cCopiar').textContent = 'Selecione o texto abaixo'; });
    });
    setInterval(escrever, 1000);
  }

  /* ---------- Bateria: pausa quando a aba sai de foco ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { filmeAR.pause(); filmeHD.pause(); }
    else if (modo === 'ar' && alvoVisivel && !camera.classList.contains('escondido')) filmeAR.play().catch(() => {});
  });
})();
