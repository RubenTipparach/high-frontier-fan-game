# Built from the REPOSITORY ROOT as the Docker context (not server/),
# because the API imports the shared, browser/server-common data
# modules under data/ (the canonical card + site tables that drive the
# engine). The deploy workflow runs
#   flyctl deploy --config server/fly.toml --dockerfile server/Dockerfile .
# from the repo root so this image can COPY both trees. Local dev is
# unaffected: `node server/index.js` resolves ../data the same way the
# image's /app/server -> /app/data sibling layout does.
FROM node:20-slim

WORKDIR /app/server

# better-sqlite3 has prebuilt binaries for node 20 on linux-x64, but
# python and build-essential are kept around as a fallback in case the
# prebuild is unavailable.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# App code lands in /app/server; the shared data tables in /app/data;
# the planner-map JSON in /app/vendor. planner-graph.js reads
# vendor/hf-mission-planner/assets/data-hf4.json at boot for the full
# ~1500-node movement graph (lagrange / burn / hohmann waypoints), so
# the directory must be present in the image.
COPY server/ ./
COPY data/ /app/data/
COPY vendor/ /app/vendor/
# Client source + assets so the /admin "Manage state" map can mount the SAME
# solar-map renderer the player sandbox uses (served statically by index.js).
COPY js/ /app/js/
COPY assets/ /app/assets/
COPY css/ /app/css/

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]
