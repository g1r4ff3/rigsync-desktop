/**
 * "항목 삭제(uninstall)" 엔진 공용 타입 — 안전 불변식 5(2026-07-26 개정)의
 * 실행 계층. capability별 `planXUninstall` 함수(각 capability 디렉터리의
 * `plan.ts`/`apt.ts`/`flatpak.ts`)가 이 타입으로 결과를 돌려주면,
 * `src/engine/uninstall/index.ts`의 `planUninstall`이 여러 capability에 걸친
 * 요청을 이 shape로 모아 UI(후속 작업)에 넘긴다.
 *
 * 기존 `plan/index.ts`의 `PlanAction`/`PlanExecutor`를 그대로 재사용한다 —
 * 삭제 액션도 설치 액션과 같은 실행기·이벤트 스트림·privileged 처리(불변식
 * ⑥ dry-run 노출 + P2b 권한 상승 통합)를 탄다. 이 모듈은 "무엇을 지울지
 * 계산"만 새로 더한다.
 */
import type { PlanAction } from '../plan'

/**
 * "동기화 항목" 화면(syncItems.ts)의 `SyncItemGroup['capability']` 값과
 * 대응한다(문자열로만 받는 이유: 미지원 capability·오타를 던지지 않고
 * `excluded`로 정직하게 보고하기 위해 — 타입을 좁게 잠그면 그 케이스가
 * 컴파일 에러가 아니라 방어적 분기로 처리돼야 하는데, 문자열이면 그
 * 분기가 자연스럽다).
 */
export interface UninstallItemRequest {
  readonly capability: string
  readonly key: string
}

/** 요청했지만 삭제 계획에 담기지 않은 항목 — "왜 빠졌는지"를 사용자에게 정직하게 보여주기 위함. */
export interface UninstallExclusion {
  readonly capability: string
  readonly key: string
  readonly reason: string
}

/** capability 하나의 uninstall plan 결과 — 각 `planXUninstall` 함수의 공통 반환 shape. */
export interface CapabilityUninstallResult {
  readonly actions: readonly PlanAction[]
  readonly excluded: readonly UninstallExclusion[]
}
