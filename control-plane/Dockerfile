# code-crafter control plane (long-lived). Runs as root because it drives Docker through the mounted socket
# (root-equivalent on the host — acceptable on a single-user laptop, see docs/12-security.md).
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
EXPOSE 3000
CMD ["node", "src/main.ts"]
