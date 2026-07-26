/**
 * dotfiles capture: 홈의 현재 파일을 스토어로 복사 + manifest에 additive-only로
 * 기록한다. 구 repo `capture_dotfiles` 행동을 옮긴 것(코드 복사 아님).
 *
 * 안전선(P1 확정 결정 ④ + P2a 결정 ④ ignore):
 * - role='follower'면 즉시 거부 (불변식 ⑦) — `FollowerCaptureBlockedError`.
 * - denylist 매치는 어떤 경로로도 담기지 않는다 (불변식 ③) — 스토어에 복사도,
 *   manifest 기록도 안 한다.
 * - 내용 수준 비밀 스캔(denylist는 파일 **이름**만 보므로, 이름이 평범한
 *   파일 안의 비밀은 이름 기반 denylist를 통과한다 — 실제 사고 직전 사례:
 *   `~/.zshrc` 안의 GitHub PAT)도 같은 원칙으로 막는다. entry가 파일이든
 *   디렉터리 트리든 `scanTreeForSecrets`로 전체를 스캔해 allowlist에 없는
 *   고신뢰/중간신뢰 매치가 하나라도 있으면 그 entry 전체를 스토어에 담지
 *   않는다(denylist와 동일한 entry 단위 granularity — 디렉터리 내 개별
 *   파일만 선별 차단하지는 않는다, 아래 `captureDotfiles` 주석의 한계 참고).
 * - additive-only (불변식 ④) — 기존 manifest 항목 제거는 안 하고(denylist·ignore
 *   매치 제외), 새 항목 추가만 한다. ignore는 additive-only의 유일한 예외
 *   (이미 manifest에 있던 항목도 ignore되면 제거된다 — `tests/test_ignore.py`
 *   `TestIgnoreDotfiles` 행동 이식).
 * - `options.dryRun`이면 스토어 파일 쓰기·manifest 쓰기 둘 다 건너뛴다(카운트는
 *   "이렇게 됐을 것"을 그대로 계산해 리포트한다 — 구 repo의 `cfg.dry_run` 동작).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink, safeRealpath } from '../../fsUtil'
import { readIgnoreSet } from '../../ignore'
import {
  effectiveLayer,
  readCommonLayer,
  writeCommonLayer,
  type ManifestDocument
} from '../../manifest'
import { expandHome } from '../../paths'
import { matchesDenylist } from '../../safety/denylist'
import { filterAllowlistedFindings, readSecretAllowlist } from '../../safety/secretAllowlist'
import { scanTreeForSecrets } from '../../safety/secretScan'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { copyTreeMirror, resolveDotfileStorePath } from './fsTree'
import { SEED_DOTFILES } from './seed'
import type { CaptureReport, DotfileEntry, SecretScanBlockedEntry } from './types'

export class FollowerCaptureBlockedError extends Error {
  constructor() {
    super(
      'capture는 reference 머신 전용입니다 -- 이 머신은 follower로 설정되어 있어 ' +
        'capture를 거부합니다 (follower는 diff+apply만 수행하는 것이 정상입니다).'
    )
    this.name = 'FollowerCaptureBlockedError'
  }
}

export interface CaptureOptions {
  /** true면 스토어·manifest 쓰기를 건너뛴다 (불변식 ①의 capture 쪽 적용). */
  readonly dryRun: boolean
}

function entriesOf(doc: ManifestDocument): DotfileEntry[] {
  return (doc.entry as DotfileEntry[] | undefined) ?? []
}

function seedRelPath(home: string): string {
  return home.startsWith('~/') ? home.slice(2) : home.replace(/^~/, '')
}

export async function captureDotfiles(
  ctx: RigsyncContext,
  options: CaptureOptions
): Promise<CaptureReport> {
  if (ctx.role === 'follower') {
    throw new FollowerCaptureBlockedError()
  }

  const commonEntries = new Map<string, DotfileEntry>(
    entriesOf(readCommonLayer(ctx, DOTFILES_LAYER)).map((e) => [e.home, e])
  )

  // host-only 오버레이 엔트리: 페이로드는 캡처하되 common.toml에는 안 쓴다
  // (안 그러면 이 host 전용 항목이 다른 모든 host의 effective manifest로 샌다).
  const hostOnlyEntries = new Map<string, DotfileEntry>()
  for (const e of entriesOf(effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS))) {
    if (!commonEntries.has(e.home)) hostOnlyEntries.set(e.home, e)
  }

  let seededNew = 0
  for (const seed of SEED_DOTFILES) {
    if (commonEntries.has(seed.home) || hostOnlyEntries.has(seed.home)) continue
    if (!fs.existsSync(expandHome(ctx, seed.home))) continue
    const entry: DotfileEntry = {
      home: seed.home,
      store: `dotfiles/${seedRelPath(seed.home)}`,
      type: seed.type,
      link: seed.link,
      ...(seed.mode ? { mode: seed.mode } : {})
    }
    commonEntries.set(seed.home, entry)
    seededNew += 1
  }

  const entries = new Map<string, DotfileEntry>([...commonEntries, ...hostOnlyEntries])
  const ignoreHomes = readIgnoreSet(ctx, 'dotfiles', 'homes')
  const secretAllowlist = readSecretAllowlist(ctx)

  let copied = 0
  let alreadyLinked = 0
  let skippedDenylist = 0
  let missingHome = 0
  let skippedBrokenSymlink = 0
  let skippedInvalidStore = 0
  let ignored = 0
  let skippedSecretScan = 0
  const notes: string[] = []
  const denylistedHomes = new Set<string>()
  const secretScanBlocked: SecretScanBlockedEntry[] = []

  for (const [home, entry] of entries) {
    if (ignoreHomes.has(home)) {
      ignored += 1
      notes.push(`ignored: ${home}`)
      continue
    }

    const homePath = expandHome(ctx, home)
    const basename = path.basename(homePath)
    if (matchesDenylist(basename)) {
      skippedDenylist += 1
      denylistedHomes.add(home)
      notes.push(`refused (denylist): ${home}`)
      continue
    }

    const homeExists = fs.existsSync(homePath)
    const homeIsSymlink = isSymlink(homePath)
    if (!homeExists && !homeIsSymlink) {
      missingHome += 1
      continue
    }
    if (homeIsSymlink && !homeExists) {
      skippedBrokenSymlink += 1
      notes.push(`${home}: dangling symlink, skipped`)
      continue
    }

    const storePath = resolveDotfileStorePath(ctx, entry.store)
    if (storePath === null) {
      skippedInvalidStore += 1
      notes.push(`${home}: refused -- store ${JSON.stringify(entry.store)} escapes repo root`)
      continue
    }

    if (homeIsSymlink) {
      const target = safeRealpath(homePath)
      if (fs.existsSync(storePath) && target === path.resolve(storePath)) {
        alreadyLinked += 1
        continue
      }
    }

    // capture 직전 차단(핵심 관문) — denylist(이름 기반)를 통과했더라도 내용
    // 자체에 고신뢰/중간신뢰 비밀 패턴이 있으면 이 entry는 스토어에 들어가지
    // 않는다. entry가 디렉터리면 트리 전체를 스캔한다(파일 하나만 보지 않음).
    const scanResult = scanTreeForSecrets(homePath, home)
    const blockedFindings = filterAllowlistedFindings(secretAllowlist, scanResult.findings)
    if (blockedFindings.length > 0) {
      skippedSecretScan += 1
      secretScanBlocked.push({ home, findings: blockedFindings })
      notes.push(`refused (secret scan): ${home} -- ${blockedFindings.length}건 감지`)
      denylistedHomes.add(home) // manifest additive-only의 유일한 예외 경로를 재사용 -- 이전부터 있었어도 제거한다.
      continue
    }

    if (!options.dryRun) {
      const treeSkipped = copyTreeMirror(homePath, storePath)
      if (treeSkipped.length > 0) {
        skippedBrokenSymlink += treeSkipped.length
        for (const s of treeSkipped) notes.push(`${home}: dangling symlink ${s}, skipped`)
      }
    }
    copied += 1
  }

  // denylist·secret scan·ignore 매치는 이전부터 manifest에 있었더라도 절대 남지 않는다.
  for (const home of denylistedHomes) commonEntries.delete(home)
  for (const home of ignoreHomes) commonEntries.delete(home)

  if (!options.dryRun) {
    const data: ManifestDocument =
      commonEntries.size > 0 ? { entry: [...commonEntries.values()] } : {}
    writeCommonLayer(ctx, DOTFILES_LAYER, data)
  }

  return {
    capability: 'dotfiles',
    seededNew,
    copied,
    alreadyLinked,
    skippedDenylist,
    missingHome,
    skippedBrokenSymlink,
    skippedInvalidStore,
    ignored,
    skippedSecretScan,
    secretScanBlocked,
    notes
  }
}
