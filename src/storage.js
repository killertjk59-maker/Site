"use strict";

/**
 * Нигоҳдории JSON бо муҳофизат аз вайроншавӣ:
 *  - навиштан атомӣ аст: ба файли муваққатӣ менависад → fsync → rename;
 *    агар қатъ шавад, файли аслӣ ҳамчунон солим мемонад;
 *  - нусхаи охирини солим (.bak) нигоҳ дошта мешавад;
 *  - агар файл вайрон бошад, сервер оғоз намешавад (то маълумот беэътибор
 *    бо холӣ rewrite нашавад);
 *  - сервер ягона нусха (single writer) фарз мекунад: ҳамаи навиштанҳо синхронӣ
 *    ва тартибан иҷро мешаванд.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

class StorageError extends Error {
  constructor(message, file) {
    super(message);
    this.name = "StorageError";
    this.file = file;
  }
}

class JsonStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  filePath(name) {
    return path.join(this.dir, name);
  }

  /** Хониш; агар файл нест — fallback (бе навиштан). Файли вайроншуда → StorageError. */
  read(name, fallback) {
    const p = this.filePath(name);
    if (!fs.existsSync(p)) return structuredClone(fallback);
    const raw = fs.readFileSync(p, "utf8");
    if (!raw.trim()) return structuredClone(fallback);
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new StorageError(
        `Файли ${name} вайрон шудааст (JSON нодуруст: ${err.message}). ` +
          `Сервер барои муҳофизати маълумот оғоз намешавад. Файлро аз ${name}.bak бозгардонед ё санҷед.`,
        p
      );
    }
  }

  /** Навиштани атомӣ. Дар хатогӣ истисно мепартояд (файли аслӣ тағйир намеёбад). */
  write(name, data) {
    const p = this.filePath(name);
    const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    const body = JSON.stringify(data, null, 2);
    let fd;
    try {
      fd = fs.openSync(tmp, "wx", 0o600);
      fs.writeFileSync(fd, body, "utf8");
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    try {
      if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`);
      fs.renameSync(tmp, p);
    } catch (err) {
      try { fs.unlinkSync(tmp); } catch { /* тоза кардан */ }
      throw err;
    }
    this.fsyncDir();
  }

  fsyncDir() {
    try {
      const dfd = fs.openSync(this.dir, "r");
      try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch { /* баъзе платформаҳо дастгирӣ намекунанд */ }
  }

  /** Файлҳои ҳамсоя: ҳама .tmp-ҳои боқимонда (пас аз қатъи бе эълон) тоза мешаванд. */
  cleanupTempFiles() {
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith(".tmp")) {
        try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* ҳеҷ */ }
      }
    }
  }
}

module.exports = { JsonStore, StorageError };
