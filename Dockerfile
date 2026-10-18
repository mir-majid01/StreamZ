FROM node:22.13.1-bookworm-slim AS build

WORKDIR /app

# Install the two locked dependency trees before copying source so Docker can
# reuse the expensive install layers when application code changes.
COPY party-server/package.json party-server/package-lock.json ./party-server/
COPY party-server/web/package.json party-server/web/package-lock.json ./party-server/web/
RUN npm ci --prefix party-server --ignore-scripts \
  && npm ci --prefix party-server/web --ignore-scripts

COPY party-server ./party-server
RUN npm run build --prefix party-server/web

FROM node:22.13.1-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build /app/party-server/package.json /app/party-server/package-lock.json ./party-server/
COPY --from=build /app/party-server/node_modules ./party-server/node_modules
COPY --from=build /app/party-server/server.mjs ./party-server/server.mjs
COPY --from=build /app/party-server/public ./party-server/public

EXPOSE 8787
CMD ["node", "party-server/server.mjs"]
