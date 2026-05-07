import { getConnectionById } from '/app/api/ml/_lib/storage.js';
import { ensureValidAccessToken } from '/app/api/ml/_lib/mercado-livre.js';

async function validateToken(connectionId, expectedSellerId) {
  try {
    const conn = getConnectionById(connectionId);
    if (!conn) {
      console.log(connectionId + ': CONNECTION NOT FOUND');
      return;
    }

    const validConn = await ensureValidAccessToken(conn);
    const resp = await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: 'Bearer ' + validConn.access_token }
    });

    if (!resp.ok) {
      console.log(connectionId + ': /users/me FAILED status=' + resp.status);
      return;
    }

    const data = await resp.json();
    const match = String(data.id) === String(expectedSellerId);
    console.log(JSON.stringify({
      connectionId,
      expected_seller_id: expectedSellerId,
      users_me_id: data.id,
      users_me_nickname: data.nickname,
      MATCH: match
    }));
  } catch(e) {
    console.log(connectionId + ': ERROR ' + e.message);
  }
}

await validateToken('d6e57eb7-217f-441d-a688-a54149fe65b3', '75043688');
await validateToken('3c75e4e0-6e3a-4e36-8810-3b1395f72b04', '83594950');
