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
      libs = carregarScript('vendor/aframe.min.js')
        .then(() => carregarScript('vendor/mindar-image-aframe.prod.js'));
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
                      filterMinCF: 0.0001; filterBeta: 0.001; missTolerance: 10; warmupTolerance: 3"
        color-space="sRGB"
        renderer="colorManagement: true; antialias: true; precision: medium; alpha: true"
        vr-mode-ui="enabled: false"
        device-orientation-permission-ui="enabled: false"
        loading-screen="enabled: false"
        embedded>
        <a-camera position="0 0 0" look-controls="enabled: false" wasd-controls="enabled: false"></a-camera>
        <a-entity id="alvo" mindar-image-target="targetIndex: 0">
          <a-plane id="telaAR" width="${PLANO_LARGURA}" height="${PLANO_ALTURA}" position="0 0 0.001"
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
    filmeAR.dataset.tocar = '1';
    const mostrar = () => { if (alvoVisivel) fade(1, 250); };
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

  /* ---------- Bateria: pausa quando a aba sai de foco ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { filmeAR.pause(); filmeHD.pause(); }
    else if (modo === 'ar' && alvoVisivel && !camera.classList.contains('escondido')) filmeAR.play().catch(() => {});
  });
})();
