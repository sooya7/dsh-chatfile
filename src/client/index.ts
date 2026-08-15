/**
 * dsh-chatfile client plugin: the browser half of the chat file upload.
 *
 * - Drop catcher on `conversation.input.overlay`: capture-phase document
 *   listeners take over NON-image file drags (the shipped image drop flow
 *   listens on the bubble phase and keeps handling pure-image drags).
 * - Attach button on `conversation.input.left`: a 📎 file picker.
 * - Status chips on `conversation.input.dock`: per-file upload state,
 *   download link and remove action; the uploaded-file path reference is
 *   written into the composer draft through `inputActions.setDraft`.
 *
 * Files are POSTed as base64 JSON to the host route `/chatfile/upload` and
 * land in `<session workspace>/uploads/`, so the agent can read them with
 * its normal file tools.
 */

import React from 'react'

/** Stable `<style>` element id (idempotent injection). */
export const STYLE_ID = 'dsh-chatfile-style'

/** The plugin's injected stylesheet text (theme tokens only, no literal colors). */
export const cssText = `
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
`

/** Inject the stylesheet once (stable id; HMR-safe). */
export function adoptStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
}

// ---- local, self-contained type declarations for the slot surface ----
// (the DSH client packages ship their own types; these minimal shapes cover
// exactly the fields this plugin reads from the slot props.)

interface InputState {
  readonly draft: string
}

interface InputActions {
  setDraft(text: string): void
}

interface SlotProps {
  sessionId?: string
  inputActions?: InputActions
  input?: InputState
  [key: string]: unknown
}

interface SlotsService {
  inject(key: string, callback: () => unknown): unknown
  register(entry: { name: string; id: string }, component: (props: SlotProps) => unknown): unknown
}

interface ClientCtx {
  get(name: string): unknown
  slots?: SlotsService
  effect(callback: () => unknown, label?: string): unknown
}

// ---- per-session upload state ----

interface UploadEntry {
  id: string
  name: string
  size: number
  mime: string
  status: 'uploading' | 'ready' | 'error'
  placeholder: string
  refText: string
  relPath: string
  downloadUrl: string
  error: string
}

interface SessionState {
  entries: UploadEntry[]
  draft: string
}

/** Single-file upload cap: 50 MiB (mirrors the host cap). */
const MAX_BYTES = 50 * 1024 * 1024

const stateBySession = new Map<string, SessionState>()
const actionsBySession = new Map<string, InputActions>()
const listeners = new Set<() => void>()
let idSeq = 1

function ensureState(sessionId: string): SessionState {
  let state = stateBySession.get(sessionId)
  if (state === undefined) {
    state = { entries: [], draft: '' }
    stateBySession.set(sessionId, state)
  }
  return state
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function notify(): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn()
    } catch {
      // a listener must never break the others
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const result = String(reader.result ?? '')
        const idx = result.indexOf(',')
        resolve(idx >= 0 ? result.slice(idx + 1) : result)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function setDraftFor(sessionId: string, draft: string): void {
  const state = ensureState(sessionId)
  state.draft = draft
  const actions = actionsBySession.get(sessionId)
  if (actions !== undefined) actions.setDraft(draft)
  notify()
}

function appendToDraft(sessionId: string, text: string): void {
  const state = ensureState(sessionId)
  const draft = state.draft ?? ''
  setDraftFor(sessionId, draft + (draft !== '' ? '\n' : '') + text)
}

function replaceInDraft(sessionId: string, from: string, to: string): void {
  const state = ensureState(sessionId)
  let draft = state.draft ?? ''
  if (from !== '' && draft.includes(from)) draft = draft.replace(from, to)
  else if (to !== '') draft = draft + (draft !== '' ? '\n' : '') + to
  setDraftFor(sessionId, draft)
}

function removeEntry(sessionId: string, id: string): void {
  const state = ensureState(sessionId)
  const entry = state.entries.find((candidate) => candidate.id === id)
  if (entry === undefined) return
  state.entries = state.entries.filter((candidate) => candidate.id !== id)
  const from = entry.refText !== '' ? entry.refText : entry.placeholder
  if (from !== '') replaceInDraft(sessionId, from, '')
  notify()
}

async function uploadFile(sessionId: string, id: string, file: File): Promise<void> {
  try {
    if (file.size > MAX_BYTES) throw new Error('文件超过 50MB 上限')
    const base64 = await fileToBase64(file)
    const response = await fetch('/chatfile/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        name: file.name,
        size: file.size,
        mime: file.type ?? '',
        base64,
      }),
    })
    let result: { ok: boolean; error?: string; relPath?: string; downloadUrl?: string } | null = null
    try {
      result = (await response.json()) as typeof result
    } catch {
      result = null
    }
    const state = stateBySession.get(sessionId)
    if (state === undefined) return
    const entry = state.entries.find((candidate) => candidate.id === id)
    if (entry === undefined) return
    if (response.ok && result !== null && result.ok) {
      entry.status = 'ready'
      entry.refText = `[上传文件] ${result.relPath}（${file.name}，${formatSize(file.size)}）`
      entry.relPath = result.relPath ?? ''
      entry.downloadUrl = result.downloadUrl ?? ''
      replaceInDraft(sessionId, entry.placeholder, entry.refText)
    } else {
      entry.status = 'error'
      entry.error = result?.error ?? (response.ok ? '上传失败' : `HTTP ${response.status}`)
      replaceInDraft(sessionId, entry.placeholder, '')
    }
  } catch (err) {
    const state = stateBySession.get(sessionId)
    if (state === undefined) return
    const entry = state.entries.find((candidate) => candidate.id === id)
    if (entry === undefined) return
    entry.status = 'error'
    entry.error = err instanceof Error ? err.message : String(err)
    replaceInDraft(sessionId, entry.placeholder, '')
  }
  notify()
}

function uploadFiles(sessionId: string | undefined, fileList: Iterable<File>): void {
  if (sessionId === undefined || sessionId === '') return
  const files = Array.from(fileList ?? [])
  if (files.length === 0) return
  for (const file of files) {
    const state = ensureState(sessionId)
    const id = `f${idSeq++}`
    const placeholder = `[附件上传中：${file.name}]`
    state.entries.push({
      id,
      name: file.name,
      size: file.size,
      mime: file.type ?? '',
      status: 'uploading',
      placeholder,
      refText: '',
      relPath: '',
      downloadUrl: '',
      error: '',
    })
    appendToDraft(sessionId, placeholder)
    void uploadFile(sessionId, id, file)
  }
}

// ---- slot components ----

function DropCatcher(props: SlotProps): React.ReactElement | null {
  const sessionId = props.sessionId
  const [active, setActive] = React.useState(false)
  const depthRef = React.useRef(0)

  React.useEffect(() => {
    const hasFiles = (event: DragEvent): boolean => {
      const dt = event.dataTransfer
      return dt !== null && Array.from(dt.types ?? []).indexOf('Files') >= 0
    }
    const allImages = (event: DragEvent): boolean => {
      const dt = event.dataTransfer
      if (dt === null) return true
      const items = dt.items
      let sawFile = false
      if (items !== null && items.length > 0) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item === null || item.kind !== 'file') continue
          sawFile = true
          if (item.type === '' || item.type.indexOf('image/') !== 0) return false
        }
        return sawFile
      }
      const files = dt.files
      if (files !== null && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          sawFile = true
          if (files[i].type.indexOf('image/') !== 0) return false
        }
        return sawFile
      }
      return false
    }
    const takeOver = (event: DragEvent): void => {
      event.preventDefault()
      event.stopPropagation()
    }
    const reset = (): void => {
      depthRef.current = 0
      setActive(false)
    }
    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      if (allImages(event)) return
      takeOver(event)
      depthRef.current += 1
      setActive(true)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      if (allImages(event)) return
      takeOver(event)
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      if (allImages(event)) return
      takeOver(event)
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setActive(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      if (allImages(event)) return
      takeOver(event)
      reset()
      const dt = event.dataTransfer
      if (dt !== null && dt.files !== null && dt.files.length > 0) {
        uploadFiles(sessionId, Array.from(dt.files))
      }
    }
    const onDragEnd = (): void => {
      reset()
    }

    document.addEventListener('dragenter', onDragEnter, true)
    document.addEventListener('dragover', onDragOver, true)
    document.addEventListener('dragleave', onDragLeave, true)
    document.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      document.removeEventListener('dragenter', onDragEnter, true)
      document.removeEventListener('dragover', onDragOver, true)
      document.removeEventListener('dragleave', onDragLeave, true)
      document.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (!active) return
    const mask = document.createElement('div')
    mask.className = 'dsh_chatfile_mask'
    const card = document.createElement('div')
    card.className = 'dsh_chatfile_card'
    const ico = document.createElement('div')
    ico.className = 'dsh_chatfile_ico'
    ico.textContent = '📄'
    const title = document.createElement('div')
    title.className = 'dsh_chatfile_title'
    title.textContent = '松开以上传文件'
    const sub = document.createElement('div')
    sub.className = 'dsh_chatfile_sub'
    sub.textContent = '文件将保存到当前会话工作区的 uploads/ 目录'
    card.appendChild(ico)
    card.appendChild(title)
    card.appendChild(sub)
    mask.appendChild(card)
    document.body.appendChild(mask)
    return () => {
      if (mask.parentNode !== null) mask.parentNode.removeChild(mask)
    }
  }, [active])

  return null
}

function AttachButton(props: SlotProps): React.ReactElement {
  const sessionId = props.sessionId
  const actions = props.inputActions
  const input = props.input
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    if (actions !== undefined) actionsBySession.set(sessionId, actions)
    const state = ensureState(sessionId)
    if (input !== undefined && typeof input.draft === 'string') state.draft = input.draft
  })

  const onPick = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const el = event.target
    const files = el.files
    if (files !== null && files.length > 0) uploadFiles(sessionId, Array.from(files))
    el.value = ''
  }

  return React.createElement(
    'div',
    { className: 'dsh_chatfile_attach', title: '上传文件（或将文件直接拖入聊天框）' },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dsh_chatfile_attachBtn',
        'aria-label': '上传文件',
        onClick: () => {
          if (fileRef.current !== null) fileRef.current.click()
        },
      },
      '📎',
    ),
    React.createElement('input', {
      ref: fileRef,
      type: 'file',
      multiple: true,
      style: { display: 'none' },
      onChange: onPick,
    }),
  )
}

function Chips(props: SlotProps): React.ReactElement | null {
  const sessionId = props.sessionId
  const actions = props.inputActions
  const input = props.input
  const [, setTick] = React.useState(0)

  React.useEffect(() => {
    if (sessionId === undefined || sessionId === '') return
    if (actions !== undefined) actionsBySession.set(sessionId, actions)
    const state = ensureState(sessionId)
    if (input !== undefined && typeof input.draft === 'string') state.draft = input.draft
  })
  React.useEffect(() => subscribe(() => setTick((tick) => tick + 1)), [])

  const state = sessionId !== undefined ? stateBySession.get(sessionId) : undefined
  const entries = state !== undefined ? state.entries : []
  if (entries.length === 0) return null

  return React.createElement(
    'div',
    { className: 'dsh_chatfile_chips' },
    entries.map((entry) => {
      const status =
        entry.status === 'uploading'
          ? React.createElement('span', { className: 'dsh_chatfile_chipMeta' }, '⏳ 上传中…')
          : entry.status === 'error'
            ? React.createElement(
                'span',
                { className: 'dsh_chatfile_chipMeta dsh_chatfile_chipErr', title: entry.error },
                `✗ ${entry.error}`,
              )
            : React.createElement('span', { className: 'dsh_chatfile_chipMeta' }, '✓')
      return React.createElement(
        'span',
        { key: entry.id, className: 'dsh_chatfile_chip', title: entry.relPath !== '' ? entry.relPath : entry.name },
        React.createElement('span', { className: 'dsh_chatfile_chipName' }, `📄 ${entry.name}`),
        React.createElement('span', { className: 'dsh_chatfile_chipMeta' }, formatSize(entry.size)),
        status,
        entry.downloadUrl !== ''
          ? React.createElement(
              'a',
              { className: 'dsh_chatfile_chipBtn', href: entry.downloadUrl, download: entry.name, title: '下载' },
              '⬇',
            )
          : null,
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh_chatfile_chipBtn',
            title: '移除',
            onClick: () => {
              removeEntry(sessionId as string, entry.id)
            },
          },
          '✕',
        ),
      )
    }),
  )
}

/** Required services: the slot system. */
export const inject = ['slots']

/**
 * Compose the chat-file surface.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientCtx): void {
  adoptStyles()

  const slots = (ctx.slots ?? ctx.get('slots')) as SlotsService | undefined
  if (slots === undefined) return

  slots.inject('conversation.input.overlay', () =>
    slots.register({ name: 'conversation.input.overlay', id: 'chatfile-drop' }, (props) =>
      React.createElement(DropCatcher, props),
    ),
  )
  slots.inject('conversation.input.left', () =>
    slots.register({ name: 'conversation.input.left', id: 'chatfile-attach' }, (props) =>
      React.createElement(AttachButton, props),
    ),
  )
  slots.inject('conversation.input.dock', () =>
    slots.register({ name: 'conversation.input.dock', id: 'chatfile-chips' }, (props) =>
      React.createElement(Chips, props),
    ),
  )
}
