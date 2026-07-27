/**
 * ignore 메커니즘 (선택적 동기화 제외) — 구 repo `_ignore_set`/`ignore.toml`
 * 행동을 옮긴 것(코드 복사 아님). `tests/test_ignore.py`가 증명하는 핵심 계약:
 *
 * - capture: ignore된 항목은 절대 (재)추가하지 않고, 이미 manifest에 있었다면
 *   제거한다 (additive-only의 유일한 예외).
 * - diff: ignore된 항목은 어떤 섹션에도 나타나지 않는다(drift도 candidate도 아님).
 * - apply: diff 위에서 plan을 세우므로 diff에서 걸러지면 자동으로 plan에서도 빠진다.
 *
 * 레이아웃 — `<manifestDir>/common/ignore.toml` + `<manifestDir>/hosts/<id>/ignore.toml`
 * 오버레이. 코디네이터 확정 결정은 파일을 "`<manifestDir>/ignore.toml`"로만
 * 짧게 지칭했지만, 구 repo의 host-overlay 합집합 동작(`tests/test_ignore.py`
 * `TestIgnoreHostOverlayUnion` 2케이스 — host가 common을 대체하지 않고
 * 더한다)을 그대로 옮기려면 다른 모든 레이어와 동일하게 common+host 오버레이가
 * 필요하다. 이미 있는 `manifest/index.ts`의 effectiveLayer 제네릭 병합(문자열
 * 배열 = 합집합)을 그대로 재사용한다 — 새 코드 없이 "layer 이름만 ignore로"
 * 얻어지는 동작이라 이 해석이 가장 안전하다.
 */
import type { RigsyncContext } from './context'
import {
  effectiveLayer,
  readCommonLayer,
  writeCommonLayer,
  type ManifestDocument
} from './manifest'

export const IGNORE_LAYER = 'ignore'

/** ignore.toml의 `[<capability>] <kind> = [...]` 하나를 Set으로 읽는다. */
export function readIgnoreSet(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>,
  capability: string,
  kind: string
): Set<string> {
  const doc = effectiveLayer(ctx, IGNORE_LAYER)
  const section = doc[capability] as ManifestDocument | undefined
  const values = section?.[kind]
  return new Set(Array.isArray(values) ? (values as string[]) : [])
}

/**
 * "동기화 항목" 화면의 스위치가 호출하는 쓰기 경로 — **common** ignore.toml만
 * 갱신한다(호스트별 ignore는 이 화면의 범위 밖 — 필요해지면 host 선택 UI와
 * 함께 나중에). manifest에서의 실제 제거는 여기서 즉시 하지 않고 다음 capture
 * 때 일어난다(구 repo의 ignore 계약과 동일 — "capture removes it").
 */
export function setIgnored(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  capability: string,
  kind: string,
  key: string,
  ignored: boolean
): void {
  setIgnoredBulk(ctx, capability, kind, [key], ignored)
}

/**
 * R5: Candidates 그룹 전체 토글 — `setIgnored`를 항목 수만큼 반복 호출하면
 * ignore.toml을 그만큼 여러 번 읽고 쓰게 된다(그리고 호출부가 매번 자동
 * commit+push까지 붙이면 커밋이 폭탄처럼 쌓인다). 여러 키를 **한 번의
 * 읽기-수정-쓰기**로 처리해 diff가 항상 1커밋 분량이 되게 한다.
 */
export function setIgnoredBulk(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  capability: string,
  kind: string,
  keys: readonly string[],
  ignored: boolean
): void {
  if (keys.length === 0) return
  const doc = readCommonLayer(ctx, IGNORE_LAYER)
  const section = (doc[capability] as ManifestDocument | undefined) ?? {}
  const current = new Set(Array.isArray(section[kind]) ? (section[kind] as string[]) : [])
  for (const key of keys) {
    if (ignored) current.add(key)
    else current.delete(key)
  }
  writeCommonLayer(ctx, IGNORE_LAYER, {
    ...doc,
    [capability]: { ...section, [kind]: [...current].sort() }
  })
}

// ---------------------------------------------------------------------------
// apt include 예외 — refactor-spec-v0.2 §1 "예외만 기록"의 나머지 반쪽.
// ignore("사용자 판정인데 안 보냄")의 대칭으로, include는 "배포판 판정인데
// 보냄"이다. 저장 위치는 같은 ignore.toml의 `[apt] include = [...]` — 별도
// 파일 대신 기존 레이어 병합·bulk 쓰기 기계를 그대로 재사용한다(값 아닌
// 패키지명만 기록 — 스펙 요구).
// ---------------------------------------------------------------------------

export const APT_INCLUDE_KIND = 'include'

/** 배포판 판정인데 동기화에 포함(include)하기로 한 apt 패키지명 집합. */
export function readAptIncludeSet(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>
): Set<string> {
  return readIgnoreSet(ctx, 'apt', APT_INCLUDE_KIND)
}

export interface AptDistroToggleItem {
  readonly key: string
  /** manifest(effective)에 이미 있는 항목인지 — 켬/끔이 건드릴 예외 종류가 갈린다. */
  readonly managed: boolean
}

/**
 * "배포판 기본" 그룹의 동기화 스위치 의미론 — 항목의 managed 여부에 따라
 * 건드릴 예외 리스트가 다르다 (한 번의 읽기-수정-쓰기로 두 kind를 함께 갱신):
 *
 * - 켬(synced=true): managed면 ignore 해제(다음 Capture가 제거하지 않게),
 *   미관리면 include 추가(다음 Capture가 담게). 어느 쪽이든 ignore는 지운다.
 * - 끔(synced=false): managed면 ignore 추가(다음 Capture가 제거) **그리고
 *   include도 제거** — 제거된 뒤 include가 남아 있으면 그다음 Capture가 도로
 *   담는 진동이 생긴다. 미관리면 include만 제거(안정 상태로 복귀).
 */
export function applyAptDistroToggle(
  ctx: Pick<RigsyncContext, 'manifestDir'>,
  items: readonly AptDistroToggleItem[],
  synced: boolean
): void {
  if (items.length === 0) return
  const doc = readCommonLayer(ctx, IGNORE_LAYER)
  const section = (doc.apt as ManifestDocument | undefined) ?? {}
  const readKind = (kind: string): Set<string> =>
    new Set(Array.isArray(section[kind]) ? (section[kind] as string[]) : [])
  const ignore = readKind('packages')
  const include = readKind(APT_INCLUDE_KIND)

  for (const item of items) {
    if (synced) {
      ignore.delete(item.key)
      if (!item.managed) include.add(item.key)
    } else {
      include.delete(item.key)
      if (item.managed) ignore.add(item.key)
    }
  }

  writeCommonLayer(ctx, IGNORE_LAYER, {
    ...doc,
    apt: {
      ...section,
      packages: [...ignore].sort(),
      [APT_INCLUDE_KIND]: [...include].sort()
    }
  })
}
