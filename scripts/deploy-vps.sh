#!/usr/bin/env bash
# Deploy automatizado pro VPS — build local, copia dist+api+server, restart.
#
# Uso:
#   ./scripts/deploy-vps.sh              # deploy completo
#   ./scripts/deploy-vps.sh --skip-build # usa dist já buildado (rapido)
#   ./scripts/deploy-vps.sh --api-only   # só api/ + server/ (sem rebuild)
#
# Requer:
#   - git push já feito (o VPS faz git pull)
#   - ssh configurado pra root@77.37.69.102

set -euo pipefail

VPS_HOST="root@77.37.69.102"
VPS_SOURCE="/data/coolify/applications/m1b5cfm30arif8y7bia20bwo/source"
SKIP_BUILD=0
API_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --api-only)   API_ONLY=1; SKIP_BUILD=1 ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //'
      exit 0
      ;;
  esac
done

cd "$(dirname "$0")/.."

log() { echo -e "\033[1;34m[deploy]\033[0m $*"; }
err() { echo -e "\033[1;31m[deploy]\033[0m $*" >&2; }

# 1. Verifica git limpo (evita deploy com mudanças não commitadas)
if [[ -n "$(git status --porcelain 2>/dev/null | grep -v '^?? ' || true)" ]]; then
  err "Tem mudanças não commitadas. Commit antes de deployar."
  git status --short
  exit 1
fi

# 2. Confirma último commit foi pushed
LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main 2>/dev/null || echo "unknown")
if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  err "Commit local ($LOCAL_SHA) != remoto ($REMOTE_SHA). Faça git push primeiro."
  exit 1
fi

# 3. Build (se necessário)
if [[ $SKIP_BUILD -eq 0 ]]; then
  log "Build frontend…"
  npm run build
fi

# 4. Git pull no VPS
log "Git pull no VPS…"
ssh "$VPS_HOST" "cd $VPS_SOURCE && git pull" | tail -2

# 5. Detecta container
CONTAINER=$(ssh "$VPS_HOST" "docker ps --format '{{.Names}}' | grep m1b5 | head -1")
if [[ -z "$CONTAINER" ]]; then
  err "Container não encontrado no VPS"
  exit 1
fi
log "Container: $CONTAINER"

# 6. Copia dist (se buildado)
if [[ $API_ONLY -eq 0 ]]; then
  log "Copiando dist/…"
  scp -q -r dist "$VPS_HOST":/tmp/
  ssh "$VPS_HOST" "docker cp /tmp/dist/. $CONTAINER:/app/dist/"
fi

# 7. Copia api/ e server/ (código backend)
log "Copiando api/ + server/…"
ssh "$VPS_HOST" "cd $VPS_SOURCE && docker cp api/. $CONTAINER:/app/api/ && docker cp server/. $CONTAINER:/app/server/"

# 8. Restart
log "Restart container…"
ssh "$VPS_HOST" "docker restart $CONTAINER" > /dev/null

# 9. Aguarda saúde
log "Aguardando healthcheck…"
sleep 10
STATUS=$(ssh "$VPS_HOST" "docker ps --format '{{.Status}}' --filter 'name=$CONTAINER'")
echo "  $STATUS"

if [[ "$STATUS" == *"healthy"* ]]; then
  log "✓ Deploy OK."
else
  err "Container não saudável. Logs:"
  ssh "$VPS_HOST" "docker logs $CONTAINER --tail 20" || true
  exit 1
fi
