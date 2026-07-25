/**
 * dotfiles capture: 홈의 현재 파일을 스토어로 복사 + manifest에 additive-only로
 * 기록한다. 구 repo `capture_dotfiles` 행동을 옮긴 것(코드 복사 아님) — `ignore`
 * 메커니즘은 P1 범위 밖이라 이식하지 않았다(요구 행동 명세에 없음).
 *
 * 안전선(P1 확정 결정 ④):
 * - role='follower'면 즉시 거부 (불변식 ⑦) — `FollowerCaptureBlockedError`.
 * - denylist 매치는 어떤 경로로도 담기지 않는다 (불변식 ③) — 스토어에 복사도,
 *   manifest 기록도 안 한다.
 * - additive-only (불변식 ④) — 기존 manifest 항목 제거는 안 하고(denylist 매치
 *   제외), 새 항목 추가만 한다.
 * - `options.dryRun`이면 스토어 파일 쓰기·manifest 쓰기 둘 다 건너뛴다(카운트는
 *   "이렇게 됐을 것"을 그대로 계산해 리포트한다 — 구 repo의 `cfg.dry_run` 동작).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink, safeRealpath } from '../../fsUtil'
import {
  effectiveLayer,
  readCommonLayer,
  writeCommonLayer,
  type ManifestDocument
} from '../../manifest'
import { expandHome } from '../../paths'
import { matchesDenylist } from '../../safety/denylist'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { copyTreeMirror, resolveDotfileStorePath } from './fsTree'
import { SEED_DOTFILES } from './seed'
import type { CaptureReport, DotfileEntry } from './types'

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

  let copied = 0
  let alreadyLinked = 0
  let skippedDenylist = 0
  let missingHome = 0
  let skippedBrokenSymlink = 0
  let skippedInvalidStore = 0
  const notes: string[] = []
  const denylistedHomes = new Set<string>()

  for (const [home, entry] of entries) {
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

    if (!options.dryRun) {
      const treeSkipped = copyTreeMirror(homePath, storePath)
      if (treeSkipped.length > 0) {
        skippedBrokenSymlink += treeSkipped.length
        for (const s of treeSkipped) notes.push(`${home}: dangling symlink ${s}, skipped`)
      }
    }
    copied += 1
  }

  // denylist 매치는 이전부터 manifest에 있었더라도 절대 남지 않는다.
  for (const home of denylistedHomes) commonEntries.delete(home)

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
    notes
  }
}
