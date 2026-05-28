# syntax=docker/dockerfile:1

# Veyra — multi-stage image.
# Stage 1 builds the TypeScript CLI; stage 2 is a slim runtime that also
# bundles the read-only scanner binaries Veyra shells out to (gitleaks,
# osv-scanner, semgrep). The image runs as a non-root user and never needs
# write access to the host beyond the mounted project directory.

# ---- Stage 1: build ---------------------------------------------------------
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN corepack enable

WORKDIR /app

# Install dependencies first (layer-cached on lockfile changes only).
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Build the CLI to dist/.
COPY tsconfig.json ./
COPY src ./src
COPY rules ./rules
RUN pnpm build

# Prune to production dependencies for the runtime stage.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Pinned scanner versions (override at build time with --build-arg).
ARG GITLEAKS_VERSION=8.21.2
ARG OSV_SCANNER_VERSION=1.9.1
ARG SEMGREP_VERSION=1.95.0

# semgrep ships as a Python package; gitleaks + osv-scanner are Go binaries.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl python3 python3-pip git; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) gl_arch=x64; osv_arch=amd64 ;; \
      arm64) gl_arch=arm64; osv_arch=arm64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz" \
      | tar -xz -C /usr/local/bin gitleaks; \
    curl -fsSL -o /usr/local/bin/osv-scanner \
      "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${osv_arch}"; \
    chmod +x /usr/local/bin/osv-scanner; \
    pip3 install --no-cache-dir --break-system-packages "semgrep==${SEMGREP_VERSION}"; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    gitleaks version && osv-scanner --version && semgrep --version

ENV NODE_ENV=production
WORKDIR /app

# Built CLI + production dependencies + Semgrep rules.
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/rules ./rules

# Run as the unprivileged user that the node image ships with.
USER node

# The project to scan is mounted read-only at /scan; reports go to /out.
WORKDIR /scan
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["--help"]
