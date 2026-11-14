# Site 100% estático servido por Nginx (suporta Range/206, necessário para vídeo no iOS)
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
EXPOSE 8080
