FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci --ignore-scripts --no-audit --no-fund && mkdir /data && chown node:node /data
USER node
ENV BIND_HOST=0.0.0.0 PORT=8787 REMOTE_STATE_DIR=/data
EXPOSE 8787
CMD ["node", "--import", "tsx", "packages/relay/src/server.ts"]
