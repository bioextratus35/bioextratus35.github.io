// Teste de precisão do encaixe (rodar no navegador, na página do site, via <script src="/__tools/teste_precisao.js">)
// Cria uma "câmera falsa" que renderiza o quadro em 3D com perspectiva real (FOV conhecido)
// e mede, em pixels de tela, o erro de cada canto do plano do vídeo em relação ao quadro.
window.testePrecisao = async function ({ fovReal = 66, rotY = 35, rotX = 10, dist = 2.4, esperaMs = 7000, modo = 'ar' } = {}) {
  const W = 720, H = 1280, AW = 1, AH = 1680 / 941;
  const img = new Image(); img.src = 'assets/alvo_quadro.png'; await img.decode();
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const gl = cv.getContext('webgl', { preserveDrawingBuffer: true });

  // matrizes (column-major)
  const rad = (d) => d * Math.PI / 180;
  const f = 1 / Math.tan(rad(fovReal) / 2), asp = W / H, n = 0.01, fa = 100;
  const P = [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (fa + n) / (n - fa), -1, 0, 0, 2 * fa * n / (n - fa), 0];
  const cy = Math.cos(rad(rotY)), sy = Math.sin(rad(rotY)), cx = Math.cos(rad(rotX)), sx = Math.sin(rad(rotX));
  // M = T(0,0,-dist) * Rx * Ry
  const R = [cy, sx * sy, -cx * sy, 0, 0, cx, sx, 0, sy, -sx * cy, cx * cy, 0, 0, 0, -dist, 1];
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const MVP = mul(P, R);
  const proj = (x, y) => { const v = [0, 0, 0, 0]; for (let r = 0; r < 4; r++) v[r] = MVP[r] * x + MVP[4 + r] * y + MVP[12 + r]; return [(v[0] / v[3] + 1) / 2 * W, (1 - v[1] / v[3]) / 2 * H]; };
  const cantosVerdadeiros = [[-AW / 2, AH / 2], [AW / 2, AH / 2], [AW / 2, -AH / 2], [-AW / 2, -AH / 2]].map(([x, y]) => proj(x, y));

  const vs = `attribute vec2 p; attribute vec2 t; uniform mat4 m; varying vec2 vt; void main(){ vt=t; gl_Position=m*vec4(p,0.,1.); }`;
  const fs = `precision mediump float; varying vec2 vt; uniform sampler2D s; void main(){ gl_FragColor=texture2D(s,vt); }`;
  const sh = (tp, src) => { const s = gl.createShader(tp); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-AW/2,-AH/2,0,1, AW/2,-AH/2,1,1, -AW/2,AH/2,0,0, AW/2,AH/2,1,0]), gl.STATIC_DRAW);
  const lp = gl.getAttribLocation(pr, 'p'), lt = gl.getAttribLocation(pr, 't');
  gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(lt); gl.vertexAttribPointer(lt, 2, gl.FLOAT, false, 16, 8);
  gl.uniformMatrix4fv(gl.getUniformLocation(pr, 'm'), false, new Float32Array(MVP));
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  (function desenha() { gl.viewport(0, 0, W, H); gl.clearColor(.29, .25, .22, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); requestAnimationFrame(desenha); })();
  navigator.mediaDevices.getUserMedia = async () => cv.captureStream(30);

  document.querySelector(`[data-modo="${modo}"]`).click();
  await new Promise((r) => setTimeout(r, esperaMs));

  const cena = document.querySelector('a-scene'), plano = document.querySelector('#telaAR');
  const palco = document.getElementById('palco'), video = palco.querySelector('video');
  if (!plano.object3D.parent.visible) return { erro: 'quadro não reconhecido' };
  const THREE = AFRAME.THREE, cam = cena.camera, cw = palco.clientWidth, ch = palco.clientHeight;
  const g = plano.getAttribute('geometry');
  plano.object3D.updateMatrixWorld(true);
  const cantosPlano = [[-g.width / 2, g.height / 2], [g.width / 2, g.height / 2], [g.width / 2, -g.height / 2], [-g.width / 2, -g.height / 2]].map(([x, y]) => {
    const v = new THREE.Vector3(x, y, 0).applyMatrix4(plano.object3D.matrixWorld).project(cam);
    return [(v.x + 1) / 2 * cw, (1 - v.y) / 2 * ch];
  });
  const vl = parseFloat(video.style.left), vt = parseFloat(video.style.top), vw = parseFloat(video.style.width), vh = parseFloat(video.style.height);
  const cantosTela = cantosVerdadeiros.map(([u, v]) => [vl + u * vw / W, vt + v * vh / H]);
  const erros = cantosTela.map((c, i) => Math.hypot(c[0] - cantosPlano[i][0], c[1] - cantosPlano[i][1]));
  const larguraTela = Math.hypot(cantosTela[1][0] - cantosTela[0][0], cantosTela[1][1] - cantosTela[0][1]);
  return {
    fovAssumido: window.MINDAR_FOVY, fovReal, rotY, rotX,
    erroCantosPx: erros.map((e) => +e.toFixed(1)),
    erroMedioPx: +(erros.reduce((a, b) => a + b) / 4).toFixed(1),
    erroMedioMm: +((erros.reduce((a, b) => a + b) / 4) / larguraTela * 420).toFixed(1), // quadro de 42 cm
  };
};
