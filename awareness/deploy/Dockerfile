# syntax=docker/dockerfile:1
# Awareness Newsletter — production container.
# Multi-stage: stage 1 packages dist/ with the build script;
# stage 2 ships dist/ behind nginx-alpine with the config baked in.

# ──────────────────────────────────────────────────────────────────────────
# Stage 1 — build
# ──────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /src

COPY package.json package-lock.json* ./
RUN npm ci --omit=optional --no-audit --no-fund || true

COPY . .

RUN node scripts/build-dist.mjs --force

# ──────────────────────────────────────────────────────────────────────────
# Stage 2 — runtime
# ──────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

RUN rm /etc/nginx/conf.d/default.conf

# Write nginx config inline — no external file dependency.
RUN cat <<'NGINXEOF' > /etc/nginx/conf.d/default.conf
server {
    listen 80 default_server;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;
    server_tokens off;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=(), payment=(), usb=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.anthropic.com https://api.openai.com https://api.allorigins.win https://corsproxy.io https://api.codetabs.com https://api.rss2json.com https:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;

    client_max_body_size 1m;

    location = /builder.html { return 301 /index.html#section-home; }

    location = /health.html {
        access_log off;
        add_header Cache-Control "no-store" always;
    }

    location ~ /\.                       { deny all; }
    location ~* ^/(tests|scripts|docs|node_modules|ensemble-logs|playwright-report|test-results|deploy)/ { deny all; }
    location = /package.json             { deny all; }
    location = /package-lock.json        { deny all; }

    location ~* \.html?$ {
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-Frame-Options "DENY" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://api.anthropic.com https://api.openai.com https://api.allorigins.win https://corsproxy.io https://api.codetabs.com https://api.rss2json.com https:; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" always;
        try_files $uri /index.html;
    }

    location ~* \.(js|css)$ {
        add_header Cache-Control "public, max-age=86400, must-revalidate" always;
    }

    location ~* \.(jpg|jpeg|png|gif|webp|ico|svg|woff|woff2|ttf|eot)$ {
        add_header Cache-Control "public, max-age=604800" always;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINXEOF

COPY --from=build /src/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1/health.html || exit 1

CMD ["nginx", "-g", "daemon off;"]
