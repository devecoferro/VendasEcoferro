import net from "node:net";

const HEALTHCHECK_HOST = String(process.env.HEALTHCHECK_HOST || "127.0.0.1").trim();
const HEALTHCHECK_PORT = Number(process.env.PORT || "3000");
const HEALTHCHECK_PING_URL = String(process.env.HEALTHCHECK_PING_URL || "").trim();

async function waitForPort(host, port, timeoutMs = 3000) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const onError = (error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      socket.end();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timeout ao conectar em ${host}:${port}.`));
    });
    socket.once("error", onError);
  });
}

async function main() {
  await waitForPort(HEALTHCHECK_HOST, HEALTHCHECK_PORT);

  if (HEALTHCHECK_PING_URL) {
    await fetch(HEALTHCHECK_PING_URL, { method: "GET" });
    console.log(
      `Healthcheck local por porta OK (${HEALTHCHECK_HOST}:${HEALTHCHECK_PORT}) e sinalizacao externa concluida.`
    );
    return;
  }

  console.log(
    `Healthcheck local por porta OK (${HEALTHCHECK_HOST}:${HEALTHCHECK_PORT}). Nenhuma URL externa configurada.`
  );
}

await main();
