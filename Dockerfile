# Image for the Welo Sick Leave Intelligence dashboard (Next.js).
#
# Deployed the same way as the absenteeism inference service: a container on
# Cloud Run, with the Anthropic API key injected from Secret Manager at runtime
# (never baked into the image). Uses Next.js standalone output so the runtime
# layer carries only what the server needs. Listens on $PORT (Cloud Run injects
# it; defaults to 8080 locally).

FROM node:26-slim AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package.json package-lock.json ./
RUN npm ci

FROM node:26-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone server + static assets.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080

# As with the inference image: Cloud Run uses the probes configured in
# infra/terraform, and this covers every other way the image gets run. Node is
# already here, so nothing is added to the image to support it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/'},r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "server.js"]
