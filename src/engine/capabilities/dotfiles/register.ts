/**
 * dotfiles 단건 등록/삭제 리졸버 — WS4("창고 모델 1차") `registry.ts`가
 * 호출한다. 이번 배치는 **기존 엔트리의 재캡처(upsert)만** 지원한다(신규
 * 임의 경로 등록 다이얼로그는 WS6) — manifest에 없는 home으로 호출되면
 * 무시하지 않고 명시 에러를 던진다(스펙 지시).
 *
 * unregister는 hostLayerMove.ts의 원자성 원칙(대상 먼저, 원본 나중)과 같은
 * 정신으로 "엔트리 먼저(manifest에서 제거) → payload 나중(store 사본 삭제)"
 * 순서를 지킨다. **홈의 실제 파일은 절대 건드리지 않는다** — 카탈로그
 * 제외는 로컬 삭제가 아니다(CLAUDE.md 안전 불변식 4·5와 별개로, 이 함수
 * 자체가 store(우리 소유 사본)만 다룬다).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { isSymlink, safeRealpath } from '../../fsUtil'
import {
  hostLayerPath,
  readCommonLayer,
  readHostLayer,
  writeCommonLayer,
  writeManifestFile,
  type ManifestDocument
} from '../../manifest'
import { expandHome } from '../../paths'
import { matchesDenylist } from '../../safety/denylist'
import { filterAllowlistedFindings, readSecretAllowlist } from '../../safety/secretAllowlist'
import { scanTreeForSecrets } from '../../safety/secretScan'
import { DOTFILES_LAYER } from './constants'
import { copyTreeMirror, resolveDotfileStorePath } from './fsTree'
import type { DotfileEntry } from './types'

export class DotfileEntryNotRegisteredError extends Error {
  constructor(readonly home: string) {
    super(
      `${home}: manifest에 없는 dotfiles 경로입니다 — 이 배치는 재캡처(upsert)만 지원합니다 ` +
        '(임의 경로 신규 등록은 다음 배치)'
    )
    this.name = 'DotfileEntryNotRegisteredError'
  }
}

export class DotfileSecretScanBlockedError extends Error {
  constructor(
    readonly home: string,
    readonly findingCount: number
  ) {
    super(`${home}: 내용에 비밀로 의심되는 값이 있어 재캡처를 거부함 (${findingCount}건)`)
    this.name = 'DotfileSecretScanBlockedError'
  }
}

function entriesOf(doc: ManifestDocument): DotfileEntry[] {
  return (doc.entry as DotfileEntry[] | undefined) ?? []
}

/**
 * 기존 dotfiles entry의 payload만 재캡처한다(upsert) — manifest 구조(store
 * 경로·type·link)는 그대로 두고 홈 → 스토어 내용만 다시 복사한다. 안전선은
 * capture.ts의 단건분과 동일: denylist(이름 기반) + 내용 수준 비밀 스캔.
 */
export function registerDotfileEntry(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'homeDir'>,
  home: string
): void {
  const commonEntries = entriesOf(readCommonLayer(ctx, DOTFILES_LAYER))
  const hostEntries = entriesOf(readHostLayer(ctx, DOTFILES_LAYER))
  const entry =
    commonEntries.find((e) => e.home === home) ?? hostEntries.find((e) => e.home === home)
  if (!entry) throw new DotfileEntryNotRegisteredError(home)

  const homePath = expandHome(ctx, home)
  const basename = path.basename(homePath)
  if (matchesDenylist(basename)) {
    throw new Error(`${home}: 이름이 denylist에 걸려 재캡처를 거부함 (${basename})`)
  }

  const storePath = resolveDotfileStorePath(ctx, entry.store)
  if (storePath === null) {
    throw new Error(`${home}: store 경로가 잘못됐습니다 (manifestDir 밖 참조): ${entry.store}`)
  }

  if (!fs.existsSync(homePath) && !isSymlink(homePath)) {
    throw new Error(`${home}: 홈에 파일/디렉터리가 없어 재캡처할 수 없음`)
  }

  // 이미 store를 가리키는 심링크면 재캡처할 내용이 없다(capture.ts와 동일 판정).
  if (isSymlink(homePath) && safeRealpath(homePath) === path.resolve(storePath)) {
    return
  }

  const secretAllowlist = readSecretAllowlist(ctx)
  const scanResult = scanTreeForSecrets(homePath, home)
  const blockedFindings = filterAllowlistedFindings(secretAllowlist, scanResult.findings)
  if (blockedFindings.length > 0) {
    throw new DotfileSecretScanBlockedError(home, blockedFindings.length)
  }

  copyTreeMirror(homePath, storePath)
}

/**
 * manifest에서 entry를 지운다(common+host 양쪽 검사) → 그 다음 store
 * payload를 지운다("엔트리 먼저, payload 나중" — hostLayerMove.ts 원자성
 * 주석과 같은 원칙: 중간에 죽어도 "엔트리는 없는데 payload가 남는" 쪽이
 * "엔트리는 있는데 payload가 사라진" 쪽보다 안전하다, 후자는 다음 apply가
 * 빈 스토어를 배포할 수 있다). 홈의 실제 파일은 건드리지 않는다.
 */
export function unregisterDotfileEntry(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  home: string
): void {
  const commonDoc = readCommonLayer(ctx, DOTFILES_LAYER)
  const commonEntries = entriesOf(commonDoc)
  const commonEntry = commonEntries.find((e) => e.home === home)

  const hostDoc = readHostLayer(ctx, DOTFILES_LAYER)
  const hostEntries = entriesOf(hostDoc)
  const hostEntry = hostEntries.find((e) => e.home === home)

  if (!commonEntry && !hostEntry) return // 이미 없음 -- 멱등.

  if (commonEntry) {
    const nextCommonEntries = commonEntries.filter((e) => e.home !== home)
    writeCommonLayer(
      ctx,
      DOTFILES_LAYER,
      nextCommonEntries.length > 0 ? { entry: nextCommonEntries } : {}
    )
  }
  if (hostEntry) {
    const nextHostEntries = hostEntries.filter((e) => e.home !== home)
    const nextHostDoc: ManifestDocument = { ...hostDoc }
    if (nextHostEntries.length > 0) nextHostDoc.entry = nextHostEntries
    else delete nextHostDoc.entry
    writeManifestFile(hostLayerPath(ctx, DOTFILES_LAYER), nextHostDoc)
  }

  for (const entry of [commonEntry, hostEntry]) {
    if (!entry) continue
    const storePath = resolveDotfileStorePath(ctx, entry.store)
    if (storePath && fs.existsSync(storePath)) {
      fs.rmSync(storePath, { recursive: true, force: true })
    }
  }
}
