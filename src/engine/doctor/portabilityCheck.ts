/**
 * 이식성(portability) 검사 — refactor-spec-v0.2 P2, F1 재발 방지의 본체.
 *
 * F1 사고: `/home/cglab` 절대경로가 박힌 crontab 라인·systemd 유닛이 manifest
 * 공통 계층으로 들어가 follower(사용자명이 다른 집 머신)에 배포됐고, 15분마다
 * 실패하는 cron과 시작 못 하는 서비스가 돌았다. 이 검사는 **이 머신에 적용되는
 * manifest 스토어 콘텐츠**에서 다른 사용자의 `/home/<이름>` 참조를 찾아
 * Doctor에 경고로 표출한다 — `.zshrc` 사고 때 제안되고 미구현으로 남았던
 * "Doctor 이식성 경고"의 구현.
 *
 * 스캔 대상 = 이 머신에 실제로 적용되는 것만:
 * - dotfiles: effective(공통+이 호스트 오버레이) entry들의 스토어 파일/트리
 * - scheduled: crontab 스토어 (host 스토어가 있으면 그것, 없으면 common —
 *   `scheduledStorePath` 해석과 동일)
 * - services: effective entry들이 참조하는 유닛 파일
 * 다른 호스트의 오버레이(hosts/<다른 머신>/**)는 이 머신에 적용되지 않으므로
 * 보지 않는다. "다른 사용자" 판정 기준은 ctx.homeDir의 basename — 이 머신의
 * 홈 사용자와 다른 이름의 `/home/<이름>`만 문제다(자기 자신은 정상).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../context'
import { effectiveLayer } from '../manifest'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from '../capabilities/dotfiles/constants'
import { resolveDotfileStorePath } from '../capabilities/dotfiles/fsTree'
import type { DotfileEntry } from '../capabilities/dotfiles/types'
import { scheduledStorePath } from '../capabilities/scheduled/store'
import { SERVICES_KEY_FIELDS, SERVICES_LAYER } from '../capabilities/services/constants'
import type { ServicesManifest } from '../capabilities/services/types'

export interface PortabilityFinding {
  /** manifestDir 기준 상대 경로. */
  readonly path: string
  readonly line: number
  /** 발견된 다른 사용자 이름 (예: "cglab"). */
  readonly foreignUser: string
  /** 해당 줄 원문(공백 정리, 200자 컷) — 비밀이 아니라 경로 참조라 그대로 보여준다. */
  readonly excerpt: string
}

export interface PortabilityCheckResult {
  readonly findings: readonly PortabilityFinding[]
  /** 파일 단위로 압축한 사람이 읽는 경고 문장. */
  readonly warnings: readonly string[]
}

const HOME_REF_RE = /\/home\/([A-Za-z0-9._-]+)/g
/**
 * 문서 placeholder 억제 — 실측 오탐(p10k.zsh 주석의 "/home/username/file",
 * "/home/directory/…" 같은 설명 예시)이 첫 실행부터 경고를 오염시키면
 * 사용자가 이 검사 자체를 무시하게 된다. 실제 사용자명이 이 단어들일 가능성은
 * 무시할 수준이고, 진짜 문제(다른 머신의 실사용자명)는 그대로 잡힌다.
 */
const DOC_PLACEHOLDER_USERS: ReadonlySet<string> = new Set([
  'user',
  'username',
  'yourname',
  'yourusername',
  'example',
  'directory'
])
/** 텍스트 판정: NUL이 들어 있으면 바이너리로 보고 건너뛴다. */
const MAX_SCAN_BYTES = 1024 * 1024

function scanFile(
  absPath: string,
  relPath: string,
  ownUser: string,
  findings: PortabilityFinding[]
): void {
  let stat: fs.Stats
  try {
    stat = fs.statSync(absPath)
  } catch {
    return
  }
  if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return
  const buf = fs.readFileSync(absPath)
  if (buf.includes(0)) return // binary
  const lines = buf.toString('utf-8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(HOME_REF_RE)) {
      if (m[1] === ownUser || DOC_PLACEHOLDER_USERS.has(m[1])) continue
      findings.push({
        path: relPath,
        line: i + 1,
        foreignUser: m[1],
        excerpt: lines[i].trim().slice(0, 200)
      })
    }
  }
}

function scanTree(
  absPath: string,
  relPath: string,
  ownUser: string,
  findings: PortabilityFinding[]
): void {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(absPath)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(absPath).sort()) {
      scanTree(path.join(absPath, name), `${relPath}/${name}`, ownUser, findings)
    }
    return
  }
  scanFile(absPath, relPath, ownUser, findings)
}

export function checkManifestPortability(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'homeDir' | 'profile'>
): PortabilityCheckResult {
  const ownUser = path.basename(ctx.homeDir)
  const findings: PortabilityFinding[] = []

  // dotfiles — effective entry들의 스토어만 (다른 호스트 오버레이 스토어 제외).
  const dotfiles = effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS)
  for (const entry of (dotfiles.entry as DotfileEntry[] | undefined) ?? []) {
    const storePath = resolveDotfileStorePath(ctx, entry.store)
    if (storePath === null) continue
    scanTree(storePath, entry.store, ownUser, findings)
  }

  // scheduled — 이 머신에 적용될 crontab 스토어 (host 우선 해석과 동일).
  const cronPath = scheduledStorePath(ctx)
  scanFile(cronPath, path.relative(ctx.manifestDir, cronPath), ownUser, findings)

  // services — effective 유닛 entry가 참조하는 스토어 파일.
  const services = effectiveLayer(ctx, SERVICES_LAYER, SERVICES_KEY_FIELDS) as ServicesManifest
  for (const unit of services.unit ?? []) {
    scanFile(path.join(ctx.manifestDir, unit.file), unit.file, ownUser, findings)
  }

  // 파일 단위 압축 경고 — 한 dotfile 트리에서 수십 건이 나올 수 있어(F1의
  // .zshrc처럼) 첫 위치+건수로 줄인다. 상세는 findings에 전부 남는다.
  const byFile = new Map<string, PortabilityFinding[]>()
  for (const f of findings) {
    const list = byFile.get(f.path) ?? []
    list.push(f)
    byFile.set(f.path, list)
  }
  const warnings = [...byFile.entries()].map(([file, list]) => {
    const users = [...new Set(list.map((f) => f.foreignUser))].sort().join(', ')
    return (
      `${file}:${list[0].line} — 다른 사용자 홈 경로 /home/{${users}} 참조 ${list.length}곳. ` +
      '이 머신에 적용되면 깨진 경로가 됩니다 — 머신 고유 항목이면 host 계층으로 옮기고, ' +
      '공유 항목이면 $HOME/~ 기반으로 고친 뒤 다시 Capture하세요.'
    )
  })

  return { findings, warnings }
}
