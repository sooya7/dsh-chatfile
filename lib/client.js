window.__ModuleLoader__.load({ id: 'dsh-chatfile', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  STYLE_ID: () => STYLE_ID,
  adoptStyles: () => adoptStyles,
  apply: () => apply,
  cssText: () => cssText,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"), 1);
var STYLE_ID = "dsh-chatfile-style";
var cssText = `
.dsh_chatfile_mask{position:fixed;inset:0;z-index:99999;pointer-events:none;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.dsh_chatfile_card{background:var(--dsw-alias-bg-base);border:1.5px dashed var(--dsw-alias-state-business-primary);border-radius:16px;padding:28px 44px;display:flex;flex-direction:column;align-items:center;gap:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);max-width:80vw}
.dsh_chatfile_ico{font-size:34px;line-height:1}
.dsh_chatfile_title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);text-align:center}
.dsh_chatfile_sub{font-size:12px;color:var(--dsw-alias-label-secondary);text-align:center}
.dsh_chatfile_chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 2px;max-width:var(--dsh-composer-card-max-width,780px);margin:0 auto;width:100%;box-sizing:border-box}
.dsh_chatfile_chip{display:inline-flex;align-items:center;gap:6px;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);max-width:340px}
.dsh_chatfile_chipName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.dsh_chatfile_chipMeta{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dsh_chatfile_chipErr{color:var(--dsw-alias-state-error-primary)}
.dsh_chatfile_chipBtn{background:none;border:none;cursor:pointer;color:inherit;padding:0 2px;font-size:12px;line-height:1;opacity:.75;text-decoration:none}
.dsh_chatfile_chipBtn:hover{opacity:1}
.dsh_chatfile_attach{display:grid}
.dsh_chatfile_attachBtn{display:grid;place-items:center;width:28px;height:28px;border:none;border-radius:999px;background:transparent;cursor:pointer;font-size:15px;padding:0;color:var(--dsw-alias-label-secondary)}
.dsh_chatfile_attachBtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
`;
function adoptStyles() {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = cssText;
  document.head.appendChild(style);
}
var MAX_BYTES = 50 * 1024 * 1024;
var stateBySession = /* @__PURE__ */ new Map();
var actionsBySession = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
var idSeq = 1;
function ensureState(sessionId) {
  let state = stateBySession.get(sessionId);
  if (state === void 0) {
    state = { entries: [], draft: "" };
    stateBySession.set(sessionId, state);
  }
  return state;
}
function subscribe(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function notify() {
  for (const fn of Array.from(listeners)) {
    try {
      fn();
    } catch {
    }
  }
}
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = String(reader.result ?? "");
        const idx = result.indexOf(",");
        resolve(idx >= 0 ? result.slice(idx + 1) : result);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("\u8BFB\u53D6\u6587\u4EF6\u5931\u8D25"));
    reader.readAsDataURL(file);
  });
}
function setDraftFor(sessionId, draft) {
  const state = ensureState(sessionId);
  state.draft = draft;
  const actions = actionsBySession.get(sessionId);
  if (actions !== void 0) actions.setDraft(draft);
  notify();
}
function appendToDraft(sessionId, text) {
  const state = ensureState(sessionId);
  const draft = state.draft ?? "";
  setDraftFor(sessionId, draft + (draft !== "" ? "\n" : "") + text);
}
function replaceInDraft(sessionId, from, to) {
  const state = ensureState(sessionId);
  let draft = state.draft ?? "";
  if (from !== "" && draft.includes(from)) draft = draft.replace(from, to);
  else if (to !== "") draft = draft + (draft !== "" ? "\n" : "") + to;
  setDraftFor(sessionId, draft);
}
function removeEntry(sessionId, id) {
  const state = ensureState(sessionId);
  const entry = state.entries.find((candidate) => candidate.id === id);
  if (entry === void 0) return;
  state.entries = state.entries.filter((candidate) => candidate.id !== id);
  const from = entry.refText !== "" ? entry.refText : entry.placeholder;
  if (from !== "") replaceInDraft(sessionId, from, "");
  notify();
}
async function uploadFile(sessionId, id, file) {
  try {
    if (file.size > MAX_BYTES) throw new Error("\u6587\u4EF6\u8D85\u8FC7 50MB \u4E0A\u9650");
    const base64 = await fileToBase64(file);
    const response = await fetch("/chatfile/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        name: file.name,
        size: file.size,
        mime: file.type ?? "",
        base64
      })
    });
    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    const state = stateBySession.get(sessionId);
    if (state === void 0) return;
    const entry = state.entries.find((candidate) => candidate.id === id);
    if (entry === void 0) return;
    if (response.ok && result !== null && result.ok) {
      entry.status = "ready";
      entry.refText = `[\u4E0A\u4F20\u6587\u4EF6] ${result.relPath}\uFF08${file.name}\uFF0C${formatSize(file.size)}\uFF09`;
      entry.relPath = result.relPath ?? "";
      entry.downloadUrl = result.downloadUrl ?? "";
      replaceInDraft(sessionId, entry.placeholder, entry.refText);
    } else {
      entry.status = "error";
      entry.error = result?.error ?? (response.ok ? "\u4E0A\u4F20\u5931\u8D25" : `HTTP ${response.status}`);
      replaceInDraft(sessionId, entry.placeholder, "");
    }
  } catch (err) {
    const state = stateBySession.get(sessionId);
    if (state === void 0) return;
    const entry = state.entries.find((candidate) => candidate.id === id);
    if (entry === void 0) return;
    entry.status = "error";
    entry.error = err instanceof Error ? err.message : String(err);
    replaceInDraft(sessionId, entry.placeholder, "");
  }
  notify();
}
function uploadFiles(sessionId, fileList) {
  if (sessionId === void 0 || sessionId === "") return;
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return;
  for (const file of files) {
    const state = ensureState(sessionId);
    const id = `f${idSeq++}`;
    const placeholder = `[\u9644\u4EF6\u4E0A\u4F20\u4E2D\uFF1A${file.name}]`;
    state.entries.push({
      id,
      name: file.name,
      size: file.size,
      mime: file.type ?? "",
      status: "uploading",
      placeholder,
      refText: "",
      relPath: "",
      downloadUrl: "",
      error: ""
    });
    appendToDraft(sessionId, placeholder);
    void uploadFile(sessionId, id, file);
  }
}
function DropCatcher(props) {
  const sessionId = props.sessionId;
  const [active, setActive] = import_react.default.useState(false);
  const depthRef = import_react.default.useRef(0);
  import_react.default.useEffect(() => {
    const hasFiles = (event) => {
      const dt = event.dataTransfer;
      return dt !== null && Array.from(dt.types ?? []).indexOf("Files") >= 0;
    };
    const allImages = (event) => {
      const dt = event.dataTransfer;
      if (dt === null) return true;
      const items = dt.items;
      let sawFile = false;
      if (items !== null && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item === null || item.kind !== "file") continue;
          sawFile = true;
          if (item.type === "" || item.type.indexOf("image/") !== 0) return false;
        }
        return sawFile;
      }
      const files = dt.files;
      if (files !== null && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          sawFile = true;
          if (files[i].type.indexOf("image/") !== 0) return false;
        }
        return sawFile;
      }
      return false;
    };
    const takeOver = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const reset = () => {
      depthRef.current = 0;
      setActive(false);
    };
    const onDragEnter = (event) => {
      if (!hasFiles(event)) return;
      if (allImages(event)) return;
      takeOver(event);
      depthRef.current += 1;
      setActive(true);
    };
    const onDragOver = (event) => {
      if (!hasFiles(event)) return;
      if (allImages(event)) return;
      takeOver(event);
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event) => {
      if (!hasFiles(event)) return;
      if (allImages(event)) return;
      takeOver(event);
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) setActive(false);
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      if (allImages(event)) return;
      takeOver(event);
      reset();
      const dt = event.dataTransfer;
      if (dt !== null && dt.files !== null && dt.files.length > 0) {
        uploadFiles(sessionId, Array.from(dt.files));
      }
    };
    const onDragEnd = () => {
      reset();
    };
    document.addEventListener("dragenter", onDragEnter, true);
    document.addEventListener("dragover", onDragOver, true);
    document.addEventListener("dragleave", onDragLeave, true);
    document.addEventListener("drop", onDrop, true);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      document.removeEventListener("dragenter", onDragEnter, true);
      document.removeEventListener("dragover", onDragOver, true);
      document.removeEventListener("dragleave", onDragLeave, true);
      document.removeEventListener("drop", onDrop, true);
      window.removeEventListener("dragend", onDragEnd);
    };
  }, [sessionId]);
  import_react.default.useEffect(() => {
    if (!active) return;
    const mask = document.createElement("div");
    mask.className = "dsh_chatfile_mask";
    const card = document.createElement("div");
    card.className = "dsh_chatfile_card";
    const ico = document.createElement("div");
    ico.className = "dsh_chatfile_ico";
    ico.textContent = "\u{1F4C4}";
    const title = document.createElement("div");
    title.className = "dsh_chatfile_title";
    title.textContent = "\u677E\u5F00\u4EE5\u4E0A\u4F20\u6587\u4EF6";
    const sub = document.createElement("div");
    sub.className = "dsh_chatfile_sub";
    sub.textContent = "\u6587\u4EF6\u5C06\u4FDD\u5B58\u5230\u5F53\u524D\u4F1A\u8BDD\u5DE5\u4F5C\u533A\u7684 uploads/ \u76EE\u5F55";
    card.appendChild(ico);
    card.appendChild(title);
    card.appendChild(sub);
    mask.appendChild(card);
    document.body.appendChild(mask);
    return () => {
      if (mask.parentNode !== null) mask.parentNode.removeChild(mask);
    };
  }, [active]);
  return null;
}
function AttachButton(props) {
  const sessionId = props.sessionId;
  const actions = props.inputActions;
  const input = props.input;
  const fileRef = import_react.default.useRef(null);
  import_react.default.useEffect(() => {
    if (sessionId === void 0 || sessionId === "") return;
    if (actions !== void 0) actionsBySession.set(sessionId, actions);
    const state = ensureState(sessionId);
    if (input !== void 0 && typeof input.draft === "string") state.draft = input.draft;
  });
  const onPick = (event) => {
    const el = event.target;
    const files = el.files;
    if (files !== null && files.length > 0) uploadFiles(sessionId, Array.from(files));
    el.value = "";
  };
  return import_react.default.createElement(
    "div",
    { className: "dsh_chatfile_attach", title: "\u4E0A\u4F20\u6587\u4EF6\uFF08\u6216\u5C06\u6587\u4EF6\u76F4\u63A5\u62D6\u5165\u804A\u5929\u6846\uFF09" },
    import_react.default.createElement(
      "button",
      {
        type: "button",
        className: "dsh_chatfile_attachBtn",
        "aria-label": "\u4E0A\u4F20\u6587\u4EF6",
        onClick: () => {
          if (fileRef.current !== null) fileRef.current.click();
        }
      },
      "\u{1F4CE}"
    ),
    import_react.default.createElement("input", {
      ref: fileRef,
      type: "file",
      multiple: true,
      style: { display: "none" },
      onChange: onPick
    })
  );
}
function Chips(props) {
  const sessionId = props.sessionId;
  const actions = props.inputActions;
  const input = props.input;
  const [, setTick] = import_react.default.useState(0);
  import_react.default.useEffect(() => {
    if (sessionId === void 0 || sessionId === "") return;
    if (actions !== void 0) actionsBySession.set(sessionId, actions);
    const state2 = ensureState(sessionId);
    if (input !== void 0 && typeof input.draft === "string") state2.draft = input.draft;
  });
  import_react.default.useEffect(() => subscribe(() => setTick((tick) => tick + 1)), []);
  const state = sessionId !== void 0 ? stateBySession.get(sessionId) : void 0;
  const entries = state !== void 0 ? state.entries : [];
  if (entries.length === 0) return null;
  return import_react.default.createElement(
    "div",
    { className: "dsh_chatfile_chips" },
    entries.map((entry) => {
      const status = entry.status === "uploading" ? import_react.default.createElement("span", { className: "dsh_chatfile_chipMeta" }, "\u23F3 \u4E0A\u4F20\u4E2D\u2026") : entry.status === "error" ? import_react.default.createElement(
        "span",
        { className: "dsh_chatfile_chipMeta dsh_chatfile_chipErr", title: entry.error },
        `\u2717 ${entry.error}`
      ) : import_react.default.createElement("span", { className: "dsh_chatfile_chipMeta" }, "\u2713");
      return import_react.default.createElement(
        "span",
        { key: entry.id, className: "dsh_chatfile_chip", title: entry.relPath !== "" ? entry.relPath : entry.name },
        import_react.default.createElement("span", { className: "dsh_chatfile_chipName" }, `\u{1F4C4} ${entry.name}`),
        import_react.default.createElement("span", { className: "dsh_chatfile_chipMeta" }, formatSize(entry.size)),
        status,
        entry.downloadUrl !== "" ? import_react.default.createElement(
          "a",
          { className: "dsh_chatfile_chipBtn", href: entry.downloadUrl, download: entry.name, title: "\u4E0B\u8F7D" },
          "\u2B07"
        ) : null,
        import_react.default.createElement(
          "button",
          {
            type: "button",
            className: "dsh_chatfile_chipBtn",
            title: "\u79FB\u9664",
            onClick: () => {
              removeEntry(sessionId, entry.id);
            }
          },
          "\u2715"
        )
      );
    })
  );
}
var inject = ["slots"];
function apply(ctx) {
  adoptStyles();
  const slots = ctx.slots ?? ctx.get("slots");
  if (slots === void 0) return;
  slots.inject(
    "conversation.input.overlay",
    () => slots.register(
      { name: "conversation.input.overlay", id: "chatfile-drop" },
      (props) => import_react.default.createElement(DropCatcher, props)
    )
  );
  slots.inject(
    "conversation.input.left",
    () => slots.register(
      { name: "conversation.input.left", id: "chatfile-attach" },
      (props) => import_react.default.createElement(AttachButton, props)
    )
  );
  slots.inject(
    "conversation.input.dock",
    () => slots.register(
      { name: "conversation.input.dock", id: "chatfile-chips" },
      (props) => import_react.default.createElement(Chips, props)
    )
  );
}
return module.exports; } });
//# sourceMappingURL=client.js.map
