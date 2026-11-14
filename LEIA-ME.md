# Fio a Fio · WebAR

## Estrutura
- `site/` — o site estático (vai inteiro para a hospedagem)
  - `index.html`, `estilo.css`, `app.js` — landing + câmera + AR + tela cheia
  - `assets/fio_a_fio_ar.mp4` — 720x1280, ~2,8 Mbps (textura do AR, ~55 MB)
  - `assets/fio_a_fio_hd.mp4` — 1080x1920, ~4,5 Mbps (modo tela cheia, ~88 MB)
  - `assets/alvo_quadro.png` — arte impressa exata (941x1680)
  - `targets/quadro.mind` — alvo compilado do MindAR
  - `vendor/` — A-Frame 1.5.0 e MindAR 1.2.5 hospedados localmente (sem depender de CDN)
- `tools/serve.mjs` — servidor local de teste (`node tools/serve.mjs 8080`)
- `tools/compilar_alvo.html` — recompila o `quadro.mind` (abrir em http://localhost:8080/__tools/compilar_alvo.html)
- `Dockerfile`, `nginx.conf`, `fly.toml` — deploy no fly.io

## Modos
1. **O quadro ganha vida** (AR): reconhece o quadro e toca o filme ancorado sobre ele. Pausa ao perder o quadro e retoma ao reencontrar.
2. **Filme em tela cheia**: reconhece o quadro e abre o filme em tela cheia (HD), desligando a câmera.
3. **Assistir sem câmera** / erro de câmera: filme em tela cheia direto.

## Encaixe
A arte impressa (941x1680) é o frame inteiro do vídeo (1080x1920) levemente comprimido na vertical
(verificado por comparação de imagem). Por isso o plano do vídeo usa a proporção do alvo,
1 x 1,78533, centrado — cada ponto do vídeo cai sobre o mesmo ponto do quadro.

## Trocar o vídeo
Reencode o master novo para os dois arquivos (mesmos nomes) e suba o `?v=` em `app.js`:
```bash
ffmpeg -i MASTER.mp4 -vf scale=720:1280:flags=lanczos -c:v libx264 -profile:v main -level 4.0 -preset slow -b:v 2800k -maxrate 3500k -bufsize 6000k -pix_fmt yuv420p -r 24 -g 48 -c:a aac -b:a 128k -ac 2 -movflags +faststart site/assets/fio_a_fio_ar.mp4
ffmpeg -i MASTER.mp4 -c:v libx264 -profile:v high -level 4.1 -preset slow -b:v 4500k -maxrate 6000k -bufsize 9000k -pix_fmt yuv420p -r 24 -g 48 -c:a aac -b:a 160k -ac 2 -movflags +faststart site/assets/fio_a_fio_hd.mp4
```
Se a arte impressa mudar, troque `site/assets/alvo_quadro.png` e recompile o `quadro.mind`.

## Publicação (GitHub Pages — gratuito)
Site: https://bioextratus35.github.io/ · Repositório: https://github.com/bioextratus35/bioextratus35.github.io
(organização gratuita `bioextratus35`; o nome do repositório `bioextratus35.github.io` é o que faz o site ficar na raiz do endereço — não renomeie, senão o endereço do QR quebra)

Para atualizar, basta commitar e enviar; o GitHub Actions publica a pasta `site/` sozinho:
```bash
git add -A
git commit -m "Atualiza site"
git push
```
Limites: arquivos até 100 MB, cerca de 100 GB de banda por mês (≈ 1.500 visualizações completas).
Domínio próprio: Settings → Pages → Custom domain, e aponte o DNS. Gere o QR **com a URL final**.

(Os arquivos `Dockerfile`, `nginx.conf` e `fly.toml` continuam aqui caso um dia queira voltar ao fly.io, que exige cartão.)
