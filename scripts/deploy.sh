#!/usr/bin/env bash
# Deploy via image transfer — substitui o build no proprio VPS.
#
# Why: build no VPS (docker build .) usava 100% CPU/RAM, derrubava SSH
# e o site (incidente 2026-04-27). vite/esbuild paralelizam em todos os
# cores e Playwright/Chromium pesa ~150MB de download.
#
# Fluxo novo:
#   1. Build da imagem LOCAL (PC do desenvolvedor)
#   2. docker save → tarball comprimido
#   3. scp pro VPS
#   4. ssh docker load — VPS so descomprime, sem compilar
#   5. Atualiza docker-compose.yaml com nova tag
#   6. docker compose up -d (recriar container com nova imagem)
#
# VPS so consome ~5% CPU durante load + ~10s de downtime no compose up.
#
# Uso:
#   bash scripts/deploy.sh                    # deploy do HEAD atual
#   bash scripts/deploy.sh --skip-build       # reusar imagem ja buildada
#   bash scripts/deploy.sh --dry-run          # mostra o que faria

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────
VPS_HOST="${VPS_HOST:-root@77.37.69.102}"
COMPOSE_DIR="/data/coolify/applications/m1b5cfm30arif8y7bia20bwo"
IMAGE_REPO="m1b5cfm30arif8y7bia20bwo"

# ─── Argumentos ──────────────────────────────────────────────────────────
SKIP_BUILD=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# ─── Pre-checks ──────────────────────────────────────────────────────────
SHA="$(git rev-parse HEAD)"
SHORT_SHA="${SHA:0:7}"
TAG="${IMAGE_REPO}:${SHA}"
TARBALL="/tmp/${IMAGE_REPO}-${SHORT_SHA}.tar"
TARBALL_GZ="${TARBALL}.gz"

echo "== Deploy ${SHORT_SHA} =="
echo "  Image: ${TAG}"
echo "  Tarball: ${TARBALL_GZ}"
echo "  VPS: ${VPS_HOST}"
echo

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] sem efeitos."
  exit 0
fi

# Confirma branch atual
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  echo "AVISO: nao esta em main (atual: $BRANCH)"
  read -r -p "Continuar mesmo assim? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

# ─── 1. Build local ──────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == "0" ]]; then
  echo "[1/5] Build local da imagem..."
  docker build -t "$TAG" .
else
  echo "[1/5] Skip build (flag --skip-build)"
  if ! docker image inspect "$TAG" >/dev/null 2>&1; then
    echo "ERRO: imagem $TAG nao existe localmente. Rode sem --skip-build."
    exit 1
  fi
fi

# ─── 2. docker save ──────────────────────────────────────────────────────
echo "[2/5] Salvando imagem em tarball..."
rm -f "$TARBALL" "$TARBALL_GZ"
docker save "$TAG" -o "$TARBALL"
gzip "$TARBALL"
SIZE=$(du -h "$TARBALL_GZ" | cut -f1)
echo "  Tamanho: $SIZE"

# ─── 3. scp upload ───────────────────────────────────────────────────────
echo "[3/5] Upload pro VPS..."
scp -C "$TARBALL_GZ" "${VPS_HOST}:/tmp/"

# ─── 4. docker load no VPS ───────────────────────────────────────────────
echo "[4/5] Load da imagem no VPS..."
TARBALL_NAME="$(basename "$TARBALL_GZ")"
ssh "$VPS_HOST" "set -e; gunzip -c /tmp/${TARBALL_NAME} | docker load; rm -f /tmp/${TARBALL_NAME}"

# ─── 5. Atualiza compose e restart ───────────────────────────────────────
echo "[5/5] Atualizando docker-compose.yaml e reiniciando..."
ssh "$VPS_HOST" "
  set -e
  cd ${COMPOSE_DIR}
  cp docker-compose.yaml docker-compose.yaml.bak.\$(date +%Y%m%d-%H%M%S)
  sed -i \"s|image: '${IMAGE_REPO}:[a-f0-9]\\+'|image: '${TAG}'|\" docker-compose.yaml
  grep -E 'image:' docker-compose.yaml | head -3
  docker compose up -d
  docker compose ps
"

# ─── Cleanup local ───────────────────────────────────────────────────────
rm -f "$TARBALL_GZ"

echo
echo "✓ Deploy ${SHORT_SHA} concluido."
echo "  Verifique: https://vendas.ecoferro.com.br/"
