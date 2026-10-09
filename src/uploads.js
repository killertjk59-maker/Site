"use strict";

/**
 * Боркунии расмҳо: санҷиши ҳаҷм ва формат бо сигнатураи файл (magic bytes).
 * Танҳо JPEG, PNG, WebP. Нав ва ниқобшуда (HTML/SVG/скрипт) рад мешаванд.
 * Файл то тасдиқ дар хотира мемонад — пеш аз санҷиш ба диск навишта намешавад.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { HttpError } = require("./security");

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Сигнатураҳои маъруфи файлҳои расм */
function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: "png", mime: "image/png" };
  }
  // WebP: "RIFF"...."WEBP"
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

function createUploadMiddleware() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, parts: 10 },
    fileFilter: (req, file, cb) => {
      // Ин танҳо пешфилтр аст; ҳақиқати охирин — сигнатураи файл аст
      if (file.mimetype && file.mimetype.startsWith("image/")) return cb(null, true);
      return cb(new HttpError(400, "Танҳо файли расм (JPG, PNG, WebP) иҷозат аст.", "UPLOAD_TYPE"));
    },
  }).single("photo");

  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();
      if (err instanceof HttpError) return next(err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(new HttpError(400, "Расм хеле калон аст (ҳадди аксар 5 MB).", "UPLOAD_TOO_LARGE"));
      }
      if (err.code === "LIMIT_UNEXPECTED_FILE") {
        return next(new HttpError(400, "Танҳо як файл бо майдони photo фиристед.", "UPLOAD_FIELD"));
      }
      return next(new HttpError(400, "Хатогии боркунии расм.", "UPLOAD_FAILED"));
    });
  };
}

/** Санҷиш ва навиштани атомии расм. Бозгашт: { url, filename, size, mime } */
function saveValidatedImage(buffer, uploadDir) {
  if (!buffer || !buffer.length) throw new HttpError(400, "Расм интихоб нашудааст.", "UPLOAD_EMPTY");
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(400, "Расм хеле калон аст (ҳадди аксар 5 MB).", "UPLOAD_TOO_LARGE");
  const type = detectImageType(buffer);
  if (!type) throw new HttpError(400, "Файл расми дуруст нест (танҳо JPEG, PNG ё WebP).", "UPLOAD_SIGNATURE");

  fs.mkdirSync(uploadDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${type.ext}`;
  const finalPath = path.join(uploadDir, filename);
  const tmp = `${finalPath}.${process.pid}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o644);
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, finalPath);
  } catch (err) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ҳеҷ */ }
    try { fs.unlinkSync(tmp); } catch { /* ҳеҷ */ }
    throw err;
  }
  return { url: `/uploads/${filename}`, filename, size: buffer.length, mime: type.mime };
}

function countUploads(uploadDir) {
  try {
    return fs.readdirSync(uploadDir).filter((f) => !f.startsWith(".") && !f.endsWith(".tmp")).length;
  } catch {
    return 0;
  }
}

module.exports = { MAX_IMAGE_BYTES, detectImageType, createUploadMiddleware, saveValidatedImage, countUploads };
