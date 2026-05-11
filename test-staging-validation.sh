#!/bin/bash
# Staging Validation Script - implantacao-saas-ml-v1
# Tests: login, IDOR, multi-tenant isolation, CSRF protection

STAGING_URL="http://kndwf1040xxel8jw3v2e1lnl.77.37.69.102.sslip.io"
ORIGIN="http://kndwf1040xxel8jw3v2e1lnl.77.37.69.102.sslip.io"
ADMIN_USER="admin.ecoferro"
ADMIN_PASS="Eco@ferro2026"
OP_USER="vendas.ecoferro"
OP_PASS="ecoferro@2026#"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0

check() {
  local name="$1"
  local result="$2"
  local expected="$3"
  
  if echo "$result" | grep -q "$expected"; then
    echo -e "${GREEN}[PASS]${NC} $name"
    PASS=$((PASS+1))
  else
    echo -e "${RED}[FAIL]${NC} $name"
    echo "  Expected: $expected"
    echo "  Got: ${result:0:200}"
    FAIL=$((FAIL+1))
  fi
}

echo "=== STAGING VALIDATION: $STAGING_URL ==="
echo ""

# Get container IP for direct access
CONTAINER_IP=$(docker inspect kndwf1040xxel8jw3v2e1lnl-143433150245 --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" 2>/dev/null || echo "")
if [ -z "$CONTAINER_IP" ]; then
  CONTAINER=$(docker ps --filter 'name=kndwf1040xxel8jw3v2e1lnl' --format '{{.Names}}' | head -1)
  CONTAINER_IP=$(docker inspect $CONTAINER --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" 2>/dev/null)
fi
echo "Container IP: $CONTAINER_IP"
BASE="http://$CONTAINER_IP:3000"

echo ""
echo "--- TEST 1: Health Check ---"
RESULT=$(curl -s "$BASE/api/health" --max-time 5)
check "Health check returns ok" "$RESULT" '"ok":true'

echo ""
echo "--- TEST 2: Admin Login ---"
ADMIN_RESP=$(curl -s -X POST "$BASE/api/app-auth" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"action\":\"login\",\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  --max-time 10)
check "Admin login succeeds" "$ADMIN_RESP" '"role":"admin"'

ADMIN_TOKEN=$(echo "$ADMIN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
echo "  Admin token: ${ADMIN_TOKEN:0:20}..."

echo ""
echo "--- TEST 3: Operator Login ---"
OP_RESP=$(curl -s -X POST "$BASE/api/app-auth" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d "{\"action\":\"login\",\"username\":\"$OP_USER\",\"password\":\"$OP_PASS\"}" \
  --max-time 10)
check "Operator login succeeds" "$OP_RESP" '"role":"operator"'

OP_TOKEN=$(echo "$OP_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)
echo "  Operator token: ${OP_TOKEN:0:20}..."

echo ""
echo "--- TEST 4: CSRF Protection (no Origin) ---"
CSRF_RESP=$(curl -s -X POST "$BASE/api/app-auth" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"login\",\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
  --max-time 5)
check "CSRF blocked without Origin" "$CSRF_RESP" '"error":"origin_not_allowed"'

echo ""
echo "--- TEST 5: ML Connections List (Admin) ---"
if [ -n "$ADMIN_TOKEN" ]; then
  CONN_RESP=$(curl -s "$BASE/api/ml/auth" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Origin: $ORIGIN" \
    --max-time 10)
  check "Admin can list ML connections" "$CONN_RESP" '"connections"'
else
  echo -e "${YELLOW}[SKIP]${NC} Admin token not available"
fi

echo ""
echo "--- TEST 6: Dashboard without connection (should handle gracefully) ---"
if [ -n "$ADMIN_TOKEN" ]; then
  DASH_RESP=$(curl -s "$BASE/api/ml/dashboard" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Origin: $ORIGIN" \
    --max-time 10)
  # Should return either data or a proper error (not 500)
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ml/dashboard" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Origin: $ORIGIN" \
    --max-time 10)
  check "Dashboard returns non-500 status" "$HTTP_CODE" "^[^5]"
  echo "  Dashboard HTTP status: $HTTP_CODE"
  echo "  Dashboard response: ${DASH_RESP:0:200}"
fi

echo ""
echo "--- TEST 7: IDOR - Operator cannot access admin connections ---"
if [ -n "$OP_TOKEN" ]; then
  # Get admin's connections first
  ADMIN_CONNS=$(curl -s "$BASE/api/ml/auth" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Origin: $ORIGIN" \
    --max-time 10)
  
  ADMIN_CONN_ID=$(echo "$ADMIN_CONNS" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    conns = d.get('connections', [])
    if conns:
        print(conns[0].get('id', ''))
except:
    pass
" 2>/dev/null)
  
  if [ -n "$ADMIN_CONN_ID" ]; then
    echo "  Admin connection ID: $ADMIN_CONN_ID"
    # Try to access admin's connection as operator
    IDOR_RESP=$(curl -s "$BASE/api/ml/dashboard?connectionId=$ADMIN_CONN_ID" \
      -H "Authorization: Bearer $OP_TOKEN" \
      -H "Origin: $ORIGIN" \
      --max-time 10)
    IDOR_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ml/dashboard?connectionId=$ADMIN_CONN_ID" \
      -H "Authorization: Bearer $OP_TOKEN" \
      -H "Origin: $ORIGIN" \
      --max-time 10)
    echo "  IDOR attempt HTTP status: $IDOR_CODE"
    check "IDOR blocked (403 or no data)" "$IDOR_CODE" "^(403|404|401)"
  else
    echo -e "${YELLOW}[SKIP]${NC} No admin connections found"
  fi
fi

echo ""
echo "--- TEST 8: Live-snapshot endpoint returns 410 Gone ---"
SNAP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ml/live-snapshot" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Origin: $ORIGIN" \
  --max-time 5)
check "live-snapshot returns 410 Gone" "$SNAP_CODE" "410"

echo ""
echo "--- TEST 9: Unauthenticated access blocked ---"
UNAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/ml/dashboard" \
  -H "Origin: $ORIGIN" \
  --max-time 5)
check "Unauthenticated dashboard blocked (401)" "$UNAUTH_CODE" "401"

echo ""
echo "==================================="
echo "RESULTS: $PASS passed, $FAIL failed"
echo "==================================="
