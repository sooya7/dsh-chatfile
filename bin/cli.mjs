#!/usr/bin/env node
/**
 * dsh-chatfile CLI: 插件生命周期管理（构建 / 安装 / 状态 / 重启 / 文件管理）。
 * 零依赖，Node >= 18。
 *
 * 用法:
 *   dsh-chatfile <command> [args]
 *
 * Commands:
 *   build       构建插件（host + client bundles，产物进 lib/）
 *   install     安装/更新到 web profile（dsh plugin add，之后需重启）
 *   status      检查服务与插件状态（路由 / client bundle 探测）
 *   restart     重启 dsh web 服务（优先 systemctl，失败则 SIGTERM + systemd 自动拉起）
 *   ls          列出 uploads/ 下的文件（默认当前目录的 uploads/，可用 --dir 指定）
 *   upload      把本地文件放进 uploads/（重名自动 -1 后缀；默认目标 <cwd>/uploads/）
 *   help        帮助
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import os from 'node:os'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DSH_HOME = process.env.DSH_HOME || join(os.homedir(), '.dsh')
const PROFILE = join(DSH_HOME, 'profiles', 'web')
const HOME = os.homedir()

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

function out(text = '') { console.log(text) }
function ok(text) { out(`${GREEN}✓${RESET} ${text}`) }
function warn(text) { out(`${YELLOW}⚠${RESET} ${text}`) }
function fail(text) { out(`${RED}✗${RESET} ${text}`) }
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (result.error !== undefined) {
    fail(`${cmd} 启动失败: ${result.error.message}`)
    process.exit(1)
  }
  return result.status ?? 1
}
function capture(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' })
  return result.error === undefined ? String(result.stdout ?? '').trim() : ''
}

/** 找出 dsh web 服务进程信息。 */
function findWebProcess() {
  const lines = capture('pgrep', ['-af', 'dsh web --port']).split('\n')
  for (const line of lines) {
    const match = /^(\d+)\s+.*dsh web --port (\d+)/.exec(line)
    if (match !== null) return { pid: Number(match[1]), port: Number(match[2]) }
  }
  return undefined
}

function uploadsDir(flagDir) {
  return flagDir !== undefined ? resolve(flagDir, 'uploads') : resolve(process.cwd(), 'uploads')
}

function pickFreeName(dir, base) {
  const dot = base.lastIndexOf('.')
  let candidate = base
  for (let i = 1; i < 2000; i++) {
    if (!existsSync(join(dir, candidate))) return candidate
    candidate = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

function cmdBuild() {
  out(`${BOLD}构建 dsh-chatfile${RESET}`)
  if (!existsSync(join(ROOT, 'node_modules', 'esbuild'))) {
    warn('未安装依赖，先执行 pnpm install')
    run('pnpm', ['install'], { cwd: ROOT })
  }
  run('node', ['build.mjs'], { cwd: ROOT })
  ok('构建完成: lib/index.js + lib/client.js')
}

function cmdInstall() {
  out(`${BOLD}安装 dsh-chatfile 到 web profile${RESET}`)
  if (!existsSync(join(PROFILE, 'package.json'))) {
    fail(`未找到 web profile: ${PROFILE}`)
    process.exit(1)
  }
  run('dsh', ['plugin', '--profile', 'web', 'add', `file:${ROOT}`], { cwd: HOME })
  ok('已加入 profile 依赖与 bundles 列表')
  warn('需要重启 dsh web 服务生效: dsh-chatfile restart')
}

function cmdStatus() {
  out(`${BOLD}dsh-chatfile 状态${RESET}`)
  const service = capture('systemctl', ['is-active', 'dsh-web.service'])
  if (service === 'active') ok('dsh-web.service: active')
  else warn(`dsh-web.service: ${service || '未检测到（非 systemd 环境？）'}`)

  const proc = findWebProcess()
  if (proc === undefined) {
    fail('未找到运行中的 dsh web 进程')
    process.exit(1)
  }
  ok(`进程 PID ${proc.pid}，端口 ${proc.port}`)

  const base = `http://127.0.0.1:${proc.port}`
  const uploadStatus = capture('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/chatfile/upload`])
  const bundleStatus = capture('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/plugins/dsh-chatfile/client.js`])
  const downloadStatus = capture('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `${base}/chatfile/download/nonexistent`])
  out()
  if (uploadStatus === '405') ok(`POST /chatfile/upload 已注册（探测 405）`)
  else fail(`POST /chatfile/upload 未注册（探测 ${uploadStatus || '失败'}）`)
  if (bundleStatus === '200') ok(`/plugins/dsh-chatfile/client.js 正常（200）`)
  else fail(`client bundle 异常（${bundleStatus || '失败'}）`)
  if (downloadStatus === '404') ok(`GET /chatfile/download 已注册（探测 404）`)
  else warn(`download 路由异常（${downloadStatus || '失败'}）`)
}

function cmdRestart() {
  out(`${BOLD}重启 dsh web 服务${RESET}`)
  const service = capture('systemctl', ['is-active', 'dsh-web.service'])
  if (service === 'active') {
    const result = spawnSync('systemctl', ['restart', 'dsh-web.service'], { stdio: 'inherit' })
    if (result.error === undefined && result.status === 0) {
      ok('systemctl 重启完成')
      return
    }
    warn('systemctl 无权限（需要 root），改用 SIGTERM + systemd 自动拉起')
  } else {
    warn(`dsh-web.service 状态: ${service || '未知'}，尝试直接重启进程`)
  }
  const proc = findWebProcess()
  if (proc === undefined) {
    fail('未找到 dsh web 进程')
    process.exit(1)
  }
  spawnSync('kill', ['-TERM', String(proc.pid)])
  out(`已向 PID ${proc.pid} 发送 SIGTERM，等待 systemd 自动拉起…`)
  let waited = 0
  for (; waited < 30; waited++) {
    spawnSync('sleep', ['1'])
    const again = findWebProcess()
    if (again !== undefined && again.pid !== proc.pid) {
      ok(`服务已重启，新 PID ${again.pid}，端口 ${again.port}`)
      return
    }
  }
  fail('等待超时，请手动检查: systemctl status dsh-web.service')
  process.exit(1)
}

function cmdLs(flagDir) {
  const dir = uploadsDir(flagDir)
  if (!existsSync(dir)) {
    out(`${DIM}${dir} 不存在（还没有上传过文件）${RESET}`)
    return
  }
  const files = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile())
  if (files.length === 0) {
    out(`${DIM}${dir} 为空${RESET}`)
    return
  }
  out(`${BOLD}${dir}${RESET}`)
  for (const name of files.sort()) {
    const bytes = statSync(join(dir, name)).size
    out(`  ${name}  ${DIM}${formatSize(bytes)}${RESET}`)
  }
}

function cmdUpload(flagDir, files) {
  if (files.length === 0) {
    fail('用法: dsh-chatfile upload <文件...> [--dir <目标工作区>]')
    process.exit(1)
  }
  const dir = uploadsDir(flagDir)
  mkdirSync(dir, { recursive: true })
  for (const file of files) {
    if (!existsSync(file)) {
      fail(`文件不存在: ${file}`)
      continue
    }
    const base = file.split(/[\\/]/).pop()
    const name = pickFreeName(dir, base)
    copyFileSync(file, join(dir, name))
    ok(`已上传 ${name} → ${dir}（${formatSize(statSync(join(dir, name)).size)}）`)
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function cmdHelp() {
  out(`${BOLD}dsh-chatfile — 聊天文件上传插件 CLI${RESET}`)
  out()
  out(`${BOLD}用法:${RESET} dsh-chatfile <command> [args]`)
  out()
  out(`${BOLD}命令:${RESET}`)
  out(`  build      构建插件（host + client bundles 到 lib/）`)
  out(`  install    安装/更新到 web profile（之后需 restart 生效）`)
  out(`  status     检查服务与插件状态（进程 / 路由 / bundle 探测）`)
  out(`  restart    重启 dsh web 服务（systemctl，失败则 SIGTERM 自动拉起）`)
  out(`  ls         列出 uploads/ 文件（默认 <cwd>/uploads/）`)
  out(`  upload     复制本地文件到 uploads/（重名自动 -1；默认 <cwd>/uploads/）`)
  out(`  help       显示本帮助`)
  out()
  out(`${BOLD}选项:${RESET}`)
  out(`  --dir <path>   ls / upload 的目标工作区（默认当前目录）`)
  out()
  out(`${BOLD}示例:${RESET}`)
  out(`  dsh-chatfile build`)
  out(`  dsh-chatfile install && dsh-chatfile restart`)
  out(`  dsh-chatfile status`)
  out(`  dsh-chatfile upload report.pdf 数据.xlsx`)
  out(`  dsh-chatfile ls --dir /home/developer/dsh`)
}

const args = process.argv.slice(2)
const flagDir = (() => {
  const idx = args.indexOf('--dir')
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined
})()

const command = args[0] ?? 'help'
switch (command) {
  case 'build': cmdBuild(); break
  case 'install': cmdInstall(); break
  case 'status': cmdStatus(); break
  case 'restart': cmdRestart(); break
  case 'ls': cmdLs(flagDir); break
  case 'upload': cmdUpload(flagDir, args.slice(1).filter((a) => a !== '--dir' && a !== flagDir)); break
  case 'help':
  case '-h':
  case '--help':
  case undefined: cmdHelp(); break
  default:
    fail(`未知命令: ${command}`)
    cmdHelp()
    process.exit(1)
}
