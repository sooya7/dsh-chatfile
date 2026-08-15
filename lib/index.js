// src/index.ts
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
var name = "dsh-chatfile";
var inject = ["sessions", "sandboxPolicy", "webServer"];
var MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
var MAX_BODY_BYTES = 70 * 1024 * 1024;
function errorMessage(err) {
  return err instanceof Error ? err.message : String(err);
}
function sanitizeName(raw) {
  if (typeof raw !== "string") return "";
  let name2 = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  name2 = name2.replace(/[\u0000-\u001f\u007f]/g, "");
  name2 = name2.replace(/^\.+/, "");
  name2 = name2.trim().slice(0, 150);
  if (name2 === "" || name2 === "." || name2 === "..") return "";
  return name2;
}
function safeMime(raw) {
  if (typeof raw !== "string") return "application/octet-stream";
  const mime = raw.replace(/[\u0000-\u001f\u007f\r\n]/g, "").trim().slice(0, 120);
  return mime === "" ? "application/octet-stream" : mime;
}
function randomToken() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const arr = new Uint8Array(16);
      crypto.getRandomValues(arr);
      let hex2 = "";
      for (let i = 0; i < arr.length; i++) hex2 += arr[i].toString(16).padStart(2, "0");
      return hex2;
    }
  } catch {
  }
  let hex = "";
  for (let i = 0; i < 24; i++) hex += Math.floor(Math.random() * 16).toString(16);
  return hex;
}
async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) throw new Error("\u8BF7\u6C42\u4F53\u8D85\u8FC7\u5927\u5C0F\u4E0A\u9650");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
function sendJson(res, status, body) {
  const response = res;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload)),
    "Cache-Control": "no-store"
  });
  response.end(payload);
}
async function pickFreeName(dir, base) {
  const dot = base.lastIndexOf(".");
  let candidate = base;
  for (let i = 1; i < 2e3; i++) {
    try {
      await stat(`${dir}/${candidate}`);
    } catch {
      return candidate;
    }
    candidate = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}
function apply(ctx) {
  const downloads = /* @__PURE__ */ new Map();
  const webServer = ctx.webServer;
  const sessions = ctx.sessions;
  const sandboxPolicy = ctx.sandboxPolicy;
  webServer.register({
    kind: "exact",
    path: "/chatfile/upload",
    handler: async (req, res) => {
      try {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("method not allowed");
          return;
        }
        const body = await readBody(req, MAX_BODY_BYTES);
        const input = JSON.parse(body.toString("utf8") || "{}");
        const base64 = input.base64;
        const size = input.size;
        if (typeof base64 !== "string" || base64.length === 0) {
          sendJson(res, 400, { ok: false, error: "\u6587\u4EF6\u6570\u636E\u4E3A\u7A7A" });
          return;
        }
        if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
          sendJson(res, 400, { ok: false, error: "\u6587\u4EF6\u5927\u5C0F\u65E0\u6548" });
          return;
        }
        if (size > MAX_UPLOAD_BYTES) {
          sendJson(res, 400, { ok: false, error: "\u6587\u4EF6\u8D85\u8FC7 50MB \u4E0A\u9650" });
          return;
        }
        const safeName = sanitizeName(input.name);
        if (safeName === "") {
          sendJson(res, 400, { ok: false, error: "\u6587\u4EF6\u540D\u65E0\u6548" });
          return;
        }
        const expected = Math.ceil(size / 3) * 4;
        if (base64.length < expected - 8 || base64.length > expected + 16) {
          sendJson(res, 400, { ok: false, error: "\u6587\u4EF6\u6570\u636E\u4E0D\u5B8C\u6574" });
          return;
        }
        const session = typeof input.sessionId === "string" ? sessions.get(input.sessionId) : void 0;
        const policy = sandboxPolicy.resolve(session !== void 0 ? { session } : {});
        const uploadsDir = `${policy.workspaceRoot}/uploads`;
        await mkdir(uploadsDir, { recursive: true });
        const fileName = await pickFreeName(uploadsDir, safeName);
        const absPath = `${uploadsDir}/${fileName}`;
        await writeFile(absPath, Buffer.from(base64, "base64"));
        const written = await stat(absPath);
        if (written.size !== size) {
          await rm(absPath, { force: true });
          sendJson(res, 400, { ok: false, error: "\u6587\u4EF6\u5199\u5165\u6821\u9A8C\u5931\u8D25" });
          return;
        }
        const mime = safeMime(input.mime);
        const token = randomToken();
        downloads.set(token, { absPath, name: safeName, mime });
        sendJson(res, 200, {
          ok: true,
          absPath,
          relPath: `uploads/${fileName}`,
          name: safeName,
          size,
          mime,
          downloadUrl: `/chatfile/download/${token}`
        });
      } catch (err) {
        sendJson(res, 400, { ok: false, error: errorMessage(err) });
      }
    }
  });
  webServer.register({
    kind: "prefix",
    path: "/chatfile/download",
    handler: async (req, res) => {
      try {
        const raw = (req.url ?? "").split("?")[0];
        const parts = raw.split("/").filter((part) => part.length > 0);
        const token = parts[parts.length - 1] ?? "";
        const record = downloads.get(token);
        if (record === void 0) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("not found");
          return;
        }
        const bytes = await readFile(record.absPath);
        const inline = /^image\//.test(record.mime) || record.mime === "application/pdf";
        res.writeHead(200, {
          "Content-Type": record.mime,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.name)}`,
          "Cache-Control": "no-store"
        });
        res.end(bytes);
      } catch {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("internal error");
      }
    }
  });
}
export {
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map
