import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function ensureArtifactsDir(applicationId) {
  const dir = path.join(".artifacts", applicationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function applicationDir(applicationId) {
  const dir = path.join("applications", applicationId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
