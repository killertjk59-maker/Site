"use strict";

/**
 * OSHONA — нуқтаи вуруди сервер.
 * Танзимот аз муҳит (.env дар рушд; Railway Variables дар production).
 * Санҷиши production: JWT_SECRET ва ADMIN_PASSWORD-и заиф → сервер оғоз намешавад.
 */
require("dotenv").config();

const { loadConfig, ConfigError } = require("./src/config");
const { createApp } = require("./src/app");
const { StorageError } = require("./src/storage");

function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error("❌ Сервер оғоз намешавад.\n" + err.message);
      process.exit(1);
    }
    throw err;
  }

  let built;
  try {
    built = createApp(config, { logger: console });
  } catch (err) {
    if (err instanceof StorageError) {
      console.error("❌ " + err.message);
      process.exit(1);
    }
    throw err;
  }

  for (const w of config.warnings) console.warn("⚠️  " + w);
  if (config.production) console.log("🔒 Режими production фаъол аст.");

  const server = built.app.listen(config.port, "0.0.0.0", () => {
    console.log(`🍽️  OSHONA backend кор мекунад: http://0.0.0.0:${config.port}`);
    console.log(`   AI: ${built.aiClient.enabled ? "фаъол (" + built.aiClient.models[0] + ")" : "хомӯш (OPENROUTER_API_KEY танзим нашудааст)"}`);
    console.log(`   Telegram: ${config.telegram.enabled ? "фаъол" : "хомӯш"}`);
    console.log(`   Маълумот: ${config.dataDir}`);
  });
  server.on("error", (err) => {
    console.error("❌ Хатогии сервер:", err.code || err.message);
    process.exit(1);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main();
}

module.exports = { main };
