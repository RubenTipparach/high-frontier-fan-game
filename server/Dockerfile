FROM node:20-slim

WORKDIR /app

# better-sqlite3 has prebuilt binaries for node 20 on linux-x64, but
# python and build-essential are kept around as a fallback in case the
# prebuild is unavailable.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
