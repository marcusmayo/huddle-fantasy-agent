FROM node:24-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .
RUN bash scripts/verify-core.sh scripts \
    && mkdir -p data state \
    && chown -R node:node /app/data /app/state

USER node
ENV NODE_ENV=production \
    HUDDLE_HOST=0.0.0.0 \
    HUDDLE_PORT=8787 \
    HUDDLE_STATE_FILE=/app/data/huddle-state.json
EXPOSE 8787
CMD ["node", "src/server.js"]
