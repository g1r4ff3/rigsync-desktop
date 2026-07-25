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
