/**
 * selection 메커니즘 (머신별 구독) — "창고 모델 1차"(cheerful-growing-fairy
 * 계획) WS1. ignore.toml(`ignore.ts`)이 **함대 전역** "카탈로그 제외"라면,
 * selection.toml은 **머신별** "카탈로그 중 무엇을 구독할지"다. 병합
 * 파이프라인(`manifest/index.ts` mergeLayer)은 override+append만 가능해
 * "빼기"를 표현할 수 없으므로, 구독은 애초에 병합 대상이 아닌 **host 전용
 * 파일**로 둔다 — `hosts/<machineId>/selection.toml` 하나만 있고 common
 * 오버레이가 없다(다른 레이어와 달리 `effectiveLayer`를 쓰지 않는다).
 *
 * 레이아웃:
 * ```toml
 * mode = "select"          # "all" | "select" — 파일·키 부재 = "all"(무마이그레이션)
 * [dotfiles]
 * include = ["~/.zshrc"]   # mode="select"에서 사용
 * [apt]
 * exclude = ["v4l-utils"]  # mode="all"에서 사용
 * ```
 *
 * `mode`는 파일 전체에 하나뿐인 전역값이다(capability별이 아니다) — 이
 * 머신이 "전체 구독"이냐 "선택 구독"이냐를 통째로 가른다. `all` 모드에서는
 * capability별 `exclude` 목록만 의미가 있고(구독=exclude에 없음), `select`
 * 모드에서는 `include` 목록만 의미가 있다(구독=include에 있음) — 두 목록이
 * 동시에 있어도 현재 모드가 아닌 쪽은 죽은 데이터로 남는다(모드 전환 시
 * 되살아날 수 있어 `setSelectionMode`가 목록을 지우지 않는다, 아래 참조).
 *
 * ignore와 달리 **kind 계층이 없다** — capability당 목록 하나로 충분하다
 * (예: apt는 패키지명 단일 목록. ignore.ts의 `kind` 축은 apt의
 * packages/sources처럼 한 capability 안에 여러 다른 종류의 키가 섞이는
 * 경우를 위한 것인데, 구독은 SyncItem 카탈로그 키만 대상으로 하므로 그
 * 구분이 필요 없다).
 *
 * 지원 범위: snap은 detection-only라 구독 개념이 없다(항상 전체 표시).
 * settings/scheduled는애초에 SyncItem으로 항목화되지 않는 capability라
 * 이 모듈의 대상이 아니다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from './context'
import {
  hostLayerPath,
  readManifestFile,
  writeManifestFile,
  type ManifestDocument
} from './manifest'

export const SELECTION_LAYER = 'selection'

export type SelectionMode = 'all' | 'select'

export interface SelectionFilter {
  readonly mode: SelectionMode
  /** mode="select"에서만 쓰인다 — 이 목록에 있으면 구독. */
  readonly include: ReadonlySet<string>
  /** mode="all"에서만 쓰인다 — 이 목록에 있으면 구독 아님. */
  readonly exclude: ReadonlySet<string>
}

function selectionDocPath(ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>): string {
  return hostLayerPath(ctx, SELECTION_LAYER)
}

function readSelectionDoc(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>
): ManifestDocument {
  return readManifestFile(selectionDocPath(ctx))
}

function writeSelectionDoc(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  doc: ManifestDocument
): void {
  writeManifestFile(selectionDocPath(ctx), doc)
}

function modeOf(doc: ManifestDocument): SelectionMode {
  return doc.mode === 'select' ? 'select' : 'all'
}

function toStringSet(v: unknown): Set<string> {
  return new Set(Array.isArray(v) ? (v as string[]) : [])
}

/** 이 머신의 selection.toml `mode` 필드 — 파일·키 부재는 "all"(하위 호환). */
export function readSelectionMode(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>
): SelectionMode {
  return modeOf(readSelectionDoc(ctx))
}

/** `[<capability>] include/exclude`를 이 머신의 mode와 함께 읽는다. */
export function readSelectionFilter(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  capability: string
): SelectionFilter {
  const doc = readSelectionDoc(ctx)
  const section = doc[capability] as ManifestDocument | undefined
  return {
    mode: modeOf(doc),
    include: toStringSet(section?.include),
    exclude: toStringSet(section?.exclude)
  }
}

/** all→exclude에 없으면 true / select→include에 있으면 true. */
export function isSubscribed(
  filter: Pick<SelectionFilter, 'mode' | 'include' | 'exclude'>,
  key: string
): boolean {
  return filter.mode === 'select' ? filter.include.has(key) : !filter.exclude.has(key)
}

/**
 * 구독 상태를 1건 갱신한다 — 현재 mode에 따라 include/exclude 한쪽만
 * 건드린다(반대쪽 목록은 죽은 데이터로 그대로 둔다, 파일 헤더 설명 참조).
 */
export function setSubscribed(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  capability: string,
  key: string,
  subscribed: boolean
): void {
  setSubscribedBulk(ctx, capability, [key], subscribed)
}

/**
 * R5(ignore.ts `setIgnoredBulk`)와 동일한 이유로 벌크 경로를 따로 둔다 — 여러
 * 키를 한 번의 읽기-수정-쓰기로 처리해 diff가 1커밋 분량이 되게 한다.
 */
export function setSubscribedBulk(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  capability: string,
  keys: readonly string[],
  subscribed: boolean
): void {
  if (keys.length === 0) return
  const doc = readSelectionDoc(ctx)
  const mode = modeOf(doc)
  const section = (doc[capability] as ManifestDocument | undefined) ?? {}
  const include = toStringSet(section.include)
  const exclude = toStringSet(section.exclude)

  if (mode === 'select') {
    for (const key of keys) {
      if (subscribed) include.add(key)
      else include.delete(key)
    }
  } else {
    for (const key of keys) {
      if (subscribed) exclude.delete(key)
      else exclude.add(key)
    }
  }

  const nextSection: ManifestDocument = {}
  if (include.size > 0) nextSection.include = [...include].sort()
  if (exclude.size > 0) nextSection.exclude = [...exclude].sort()

  const nextDoc: ManifestDocument = { ...doc }
  if (Object.keys(nextSection).length > 0) nextDoc[capability] = nextSection
  else delete nextDoc[capability]

  writeSelectionDoc(ctx, nextDoc)
}

/** 전역 mode를 전환한다 — 기존 include/exclude 목록은 그대로 보존한다(모드를 되돌리면 되살아남). */
export function setSelectionMode(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  mode: SelectionMode
): void {
  const doc = readSelectionDoc(ctx)
  writeSelectionDoc(ctx, { ...doc, mode })
}

/**
 * `hosts/*\/selection.toml`을 전수 스캔해 이 capability의 이 key를 구독하는
 * 머신 id 목록을 돌려준다(삭제 경고 UI 등 추후 배치가 소비할 조회).
 *
 * **정직한 한계**: selection.toml이 아예 없는 머신(구버전 앱이 아직 이
 * 기능을 모르거나, 이 기능을 도입한 뒤로도 한 번도 selection을 안 건드린
 * 전체 구독 머신)은 이 함수가 열거할 수 없다 — `hosts/<id>/` 디렉터리
 * 자체가 다른 레이어(ignore·dotfiles 등) 쓰기로만 생겨도 selection.toml은
 * 없을 수 있고, 파일이 없다는 사실만으로는 "이 머신이 존재하며 전체
 * 구독"인지 "이 머신이 애초에 이 capability를 전혀 안 씀"인지 구분할 수
 * 없기 때문이다. 호출부(추후 배치의 삭제 경고 UI)는 이 목록을 "selection을
 * 명시한 머신 중 구독자"로만 쓰고, 별도로 "selection.toml이 없는 머신은
 * 전체 구독으로 간주해 모두 받습니다"를 안내해야 한다.
 */
export function listEntrySubscribers(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  capability: string,
  key: string
): string[] {
  const hostsDir = path.join(ctx.manifestDir, 'hosts')
  if (!fs.existsSync(hostsDir)) return []

  const hostIds = fs
    .readdirSync(hostsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const subscribers: string[] = []
  for (const hostId of hostIds) {
    const selectionPath = path.join(hostsDir, hostId, `${SELECTION_LAYER}.toml`)
    if (!fs.existsSync(selectionPath)) continue // 열거 불가 한계 — 위 jsdoc 참조.
    const filter = readSelectionFilter(
      { manifestDir: ctx.manifestDir, machineId: hostId },
      capability
    )
    if (isSubscribed(filter, key)) subscribers.push(hostId)
  }
  return subscribers.sort()
}
