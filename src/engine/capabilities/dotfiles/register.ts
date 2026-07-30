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
  effectiveLayer,
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
import { scanTreeForSecrets, type SecretFinding } from '../../safety/secretScan'
import { DOTFILES_KEY_FIELDS, DOTFILES_LAYER } from './constants'
import { copyTreeMirror, resolveDotfileStorePath } from './fsTree'
import { commonDotfileStoreRelPath, hostDotfileStoreRelPath } from './hostLayer'
import { setSubscribed } from '../../selection'
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

// ---------------------------------------------------------------------------
// WS6("창고 모델 1차"): dotfiles 임의 경로 등록 — 위의 registerDotfileEntry는
// **기존** manifest entry의 재캡처(upsert)만 지원한다. 여기부터는 manifest에
// 아직 없는 새 홈 경로를 등록하는 별도 경로다(register.ts 파일 헤더 주석
// 참조 — registerEntry/registry.ts는 이 함수를 부르지 않는다, IPC는
// `engine:registerDotfile` 전용 핸들러가 직접 호출한다).
// ---------------------------------------------------------------------------

export type DotfileRegistrationRejectReason =
  | 'not-found'
  | 'outside-home'
  | 'already-managed'
  | 'inside-managed-entry'
  | 'manifest-internal'
  | 'denylist'

export interface DotfileRegistrationCheck {
  readonly ok: boolean
  readonly reason?: DotfileRegistrationRejectReason
  /** 사람이 읽는 거부 사유 — ok=true면 없음. */
  readonly message?: string
  /**
   * `~/상대경로` 정규화 키 — homeDir 내부로 풀린 경로에서만 채워진다
   * (outside-home이면 애초에 `~` 표기가 성립하지 않으므로 undefined).
   */
  readonly homeKey?: string
  /** 존재 확인된 경로에서만 채워진다(존재하지 않으면 file/dir을 판별할 수 없다). */
  readonly type?: DotfileEntry['type']
}

/**
 * homePath(절대경로 또는 `~/...` 축약형)를 ctx.homeDir 기준 절대경로로 편다
 * — expandHome은 `~` 축약형만 알고 이미 절대경로인 입력은 그대로 돌려준다
 * (파일 피커가 절대경로를 주는 경로와 사용자가 `~/...`를 타이핑하는 경로
 * 둘 다 지원).
 */
function resolveCandidateAbsPath(ctx: Pick<RigsyncContext, 'homeDir'>, homePath: string): string {
  return expandHome(ctx, homePath)
}

/**
 * WS6 — 신규 dotfiles 경로 등록 사전 검증(순수 읽기 전용). `engine:validateDotfilePath`
 * IPC와 `registerNewDotfile`(아래, 경쟁 조건 방어를 위한 재검증) 둘 다 이
 * 함수 하나를 쓴다. 검사 순서(먼저 걸리는 사유가 이긴다):
 * 1. homeDir 내부인가(밖이면 `~` 정규화 자체가 성립하지 않는다)
 * 2. manifestDir·backupRoot 자신/내부인가(자기 자신을 창고에 등록하는 순환 방지)
 * 3. 이름이 secret denylist에 걸리는가(capture.ts와 동일한 이름 기반 1차 방어 —
 *    내용 기반 스캔은 이 함수가 아니라 registerNewDotfile 호출 전 별도 단계다)
 * 4. 실제로 존재하는가
 * 5. 이미 managed인가 — effective dotfiles entry와 정확히 같거나(already-managed),
 *    기존 managed 디렉터리 엔트리 내부에 있거나 반대로 기존 엔트리를 품는
 *    디렉터리를 등록하려는 경우(inside-managed-entry, 양방향 포함 관계)
 */
export function validateDotfileRegistration(
  ctx: Pick<RigsyncContext, 'homeDir' | 'manifestDir' | 'backupRoot' | 'machineId' | 'profile'>,
  homePath: string
): DotfileRegistrationCheck {
  const absPath = resolveCandidateAbsPath(ctx, homePath)
  const homeRoot = path.resolve(ctx.homeDir)
  const resolvedAbs = path.resolve(absPath)
  const relFromHome = path.relative(homeRoot, resolvedAbs)
  const insideHome =
    resolvedAbs === homeRoot || (!relFromHome.startsWith('..') && !path.isAbsolute(relFromHome))
  if (!insideHome) {
    return {
      ok: false,
      reason: 'outside-home',
      message: `${homePath}: 홈 디렉터리(${ctx.homeDir}) 밖의 경로는 등록할 수 없습니다`
    }
  }
  const homeKey = resolvedAbs === homeRoot ? '~' : `~/${relFromHome.split(path.sep).join('/')}`

  const manifestRoot = path.resolve(ctx.manifestDir)
  const backupRoot = path.resolve(ctx.backupRoot)
  const isSelfOrInside = (root: string): boolean =>
    resolvedAbs === root || !path.relative(root, resolvedAbs).startsWith('..')
  if (isSelfOrInside(manifestRoot) || isSelfOrInside(backupRoot)) {
    return {
      ok: false,
      reason: 'manifest-internal',
      message: `${homeKey}: rigsync 자신의 manifest/백업 디렉터리는 등록할 수 없습니다`,
      homeKey
    }
  }

  const basename = path.basename(resolvedAbs)
  if (matchesDenylist(basename)) {
    return {
      ok: false,
      reason: 'denylist',
      message: `${homeKey}: 이름이 secret denylist에 걸려 등록을 거부함 (${basename})`,
      homeKey
    }
  }

  if (!fs.existsSync(resolvedAbs)) {
    return {
      ok: false,
      reason: 'not-found',
      message: `${homeKey}: 홈에 파일/디렉터리가 없어 등록할 수 없습니다`,
      homeKey
    }
  }
  const type: DotfileEntry['type'] = fs.statSync(resolvedAbs).isDirectory() ? 'dir' : 'file'

  const managedEntries =
    (effectiveLayer(ctx, DOTFILES_LAYER, DOTFILES_KEY_FIELDS).entry as
      DotfileEntry[] | undefined) ?? []
  for (const entry of managedEntries) {
    if (entry.home === homeKey) {
      return {
        ok: false,
        reason: 'already-managed',
        message: `${homeKey}: 이미 창고에 등록돼 있습니다`,
        homeKey,
        type
      }
    }
    const entryIsAncestor = homeKey.startsWith(`${entry.home}/`)
    const candidateIsAncestor = entry.home.startsWith(`${homeKey}/`)
    if (entryIsAncestor || candidateIsAncestor) {
      return {
        ok: false,
        reason: 'inside-managed-entry',
        message: entryIsAncestor
          ? `${homeKey}: 이미 등록된 디렉터리(${entry.home}) 내부입니다 — 그 엔트리가 이 경로를 포함합니다`
          : `${homeKey}: 이미 등록된 항목(${entry.home})을 포함하는 디렉터리입니다 — 겹치는 등록은 허용하지 않습니다`,
        homeKey,
        type
      }
    }
  }

  return { ok: true, homeKey, type }
}

/**
 * 등록 후보(파일이면 그 파일, 디렉터리면 트리 전체)를 **쓰기 전** 내용 수준
 * 비밀 스캔한다 — capture.ts `scanTreeForSecrets` 호출과 같은 원칙이지만,
 * 이건 아직 manifest에 없는 새 경로라 allowlist 매치 여부만 판정하고 findings를
 * 그대로 돌려준다(호출부인 `engine:registerDotfile` IPC 핸들러가 findings가
 * 있으면 **기본 차단**하고 UI에 그대로 노출한다 — 경고-통과가 아니라 차단이
 * 옳다는 게 계획서의 확정 결정: push 게이트에서 어차피 좌초되므로).
 */
export function scanDotfileCandidateForSecrets(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'homeDir'>,
  homeKey: string
): readonly SecretFinding[] {
  const absPath = expandHome(ctx, homeKey)
  const allowlist = readSecretAllowlist(ctx)
  const scanResult = scanTreeForSecrets(absPath, homeKey)
  return filterAllowlistedFindings(allowlist, scanResult.findings)
}

export interface RegisterNewDotfileOptions {
  readonly homePath: string
  /** true(기본 의미상 권장)=reference에서 symlink apply, false=copy+chmod apply. */
  readonly link: boolean
  /** true면 hosts/<machineId>/dotfiles/<rel>에 담아 이 머신 host 계층에만 등록. */
  readonly host: boolean
}

/**
 * WS6 — 신규 dotfiles 경로 등록 실행. **payload 먼저, 엔트리 나중, 자동
 * 구독 마지막** 순서를 지킨다(hostLayer.ts 파일 헤더의 원자성 원칙과 같은
 * 정신 — 중간에 죽어도 "store엔 있는데 manifest는 모르는" 쪽이 "manifest는
 * 아는데 store가 없는" 쪽보다 안전하다, 후자는 다음 Apply가 빈 스토어를
 * 배포한다). secret 스캔은 이 함수가 하지 않는다 — 호출부(IPC 핸들러)가
 * `scanDotfileCandidateForSecrets`로 미리 걸러 findings가 없을 때만 이 함수를
 * 부른다는 계약이다. `validateDotfileRegistration`을 여기서도 다시 돌려
 * IPC 검증 호출과의 경쟁 조건(그 사이 다른 머신이 같은 경로를 먼저 등록)을
 * 방어한다.
 */
export function registerNewDotfile(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId' | 'homeDir' | 'backupRoot' | 'profile'>,
  options: RegisterNewDotfileOptions
): void {
  const check = validateDotfileRegistration(ctx, options.homePath)
  if (!check.ok || !check.homeKey || !check.type) {
    throw new Error(check.message ?? `${options.homePath}: 등록할 수 없는 경로입니다`)
  }
  const homeKey = check.homeKey
  const absPath = expandHome(ctx, homeKey)

  const storeRel = options.host
    ? hostDotfileStoreRelPath(ctx, homeKey)
    : commonDotfileStoreRelPath(homeKey)
  const storePath = resolveDotfileStorePath(ctx, storeRel)
  if (storePath === null) {
    throw new Error(`${homeKey}: store 경로 계산에 실패했습니다 (manifestDir 밖 참조): ${storeRel}`)
  }

  // payload 먼저.
  copyTreeMirror(absPath, storePath)

  // 엔트리 나중 — common 또는 host 계층 dotfiles.toml에 upsert.
  const entry: DotfileEntry = {
    home: homeKey,
    store: storeRel,
    type: check.type,
    link: options.link
  }
  if (options.host) {
    const hostEntries = (
      (readHostLayer(ctx, DOTFILES_LAYER).entry as DotfileEntry[] | undefined) ?? []
    ).filter((e) => e.home !== homeKey)
    writeManifestFile(hostLayerPath(ctx, DOTFILES_LAYER), { entry: [...hostEntries, entry] })
  } else {
    const commonEntries = (
      (readCommonLayer(ctx, DOTFILES_LAYER).entry as DotfileEntry[] | undefined) ?? []
    ).filter((e) => e.home !== homeKey)
    writeCommonLayer(ctx, DOTFILES_LAYER, { entry: [...commonEntries, entry] })
  }

  // 자동 구독 — registry.ts `registerEntry`와 동일한 마무리(selection.ts
  // `setSubscribed`가 mode='select'/'all' 두 갈래를 이미 알고 있다).
  setSubscribed(ctx, 'dotfiles', homeKey, true)
}
