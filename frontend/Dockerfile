# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_OPENIMPORT_API_BASE_URL=/api/v1
ARG VITE_OPENIMPORT_PARENT_ORIGINS
ENV VITE_OPENIMPORT_API_BASE_URL=${VITE_OPENIMPORT_API_BASE_URL}
ENV VITE_OPENIMPORT_PARENT_ORIGINS=${VITE_OPENIMPORT_PARENT_ORIGINS}
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache gettext wget \
  && rm -rf /usr/share/nginx/html/* \
  && mkdir -p /tmp \
  && chown -R nginx:nginx /tmp /var/cache/nginx /var/run
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r$//' /docker-entrypoint.sh \
  && chmod +x /docker-entrypoint.sh \
  && chown -R nginx:nginx /usr/share/nginx/html /etc/nginx/nginx.conf.template
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]
