// Logger estruturado leve — sem dependencias externas.
// Grava logs em arquivo com rotacao automatica (max 5MB por arquivo, 3 arquivos).
// Em producao, logs vao para arquivo + console. Em dev, apenas console.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./app-config.js";

const LOG_DIR = path.join(DATA_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "ecoferro.log");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES = 3;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Garante que o diretorio de logs existe
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch {
  // Silencioso se nao conseguir criar
}

function rotateLogFile() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < MAX_LOG_SIZE) return;

    // Rotaciona: ecoferro.log.2 -> .3, .1 -> .2, .log -> .1
    for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? LOG_FILE : `${LOG_FILE}.${i}`;
      const to = `${LOG_FILE}.${i + 1}`;
      try {
        if (fs.existsSync(from)) {
          fs.renameSync(from, to);
        }
      } catch {
        // Ignora erros de rotacao individual
      }
    }

    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
  } catch {
    // Arquivo ainda nao existe ou erro de stat — ignora
  }
}

function writeToFile(line) {
  if (!IS_PRODUCTION) return;

  try {
    rotateLogFile();
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Silencioso — logging nao deve derrubar o app
  }
}

function formatLog(level, component, message, data = null) {
  const entry = {
    t: new Date().toISOString(),
    level,
    component,
    msg: message,
  };

  if (data !== null && data !== undefined) {
    if (data instanceof Error) {
      entry.error = {
        name: data.name,
        message: data.message,
        stack: IS_PRODUCTION ? undefined : data.stack,
      };
    } else {
      entry.data = data;
    }
  }

  return JSON.stringify(entry);
}

function createLogger(component) {
  return {
    info(message, data) {
      const line = formatLog("info", component, message, data);
      console.log(line);
      writeToFile(line);
    },
    warn(message, data) {
      const line = formatLog("warn", component, message, data);
      console.warn(line);
      writeToFile(line);
    },
    error(message, data) {
      const line = formatLog("error", component, message, data);
      console.error(line);
      writeToFile(line);
    },
    debug(message, data) {
      if (IS_PRODUCTION) return;
      const line = formatLog("debug", component, message, data);
      console.log(line);
    },
  };
}

export default createLogger;
export { createLogger, LOG_DIR, LOG_FILE };
