/**
 * Apply 확인 다이얼로그에 노출할 sudo 스크립트 전문(P2b 확정 결정 ⑤ —
 * 불변식 ⑥의 핵심). 순수 함수 — 부작용 없이 plan만 보고 문자열을 만든다.
 *
 * 이 미리보기 스크립트에는 취소파일 체크가 **없다** — 그 경로는 실제 실행
 * 시점(`ApplyRunner.runPrivileged`)에야 정해지므로, 사용자가 확인 다이얼로그에서
 * 본 것과 실행되는 스크립트는 취소 체크 유무만 다르고 명령·순서·마커는
 * 완전히 동일하다(구 repo `_run_apply_worker`의 "같은 script_text 객체가
 * 아니라 다시 빌드하지만, 사용자가 검토한 것과 달라지지 않는다" 원칙 이식).
 */
import { buildSudoScript } from './script'
import { flattenPrivilegedCommands, splitPlanByPrivilege } from './split'
import type { PlanAction } from '../plan'

/** plan에 privileged 액션이 있으면 스크립트 전문을, 없으면 null을 반환한다. */
export function buildSudoScriptPreview(plan: readonly PlanAction[]): string | null {
  const [, privileged] = splitPlanByPrivilege(plan)
  if (privileged.length === 0) return null
  const { commands } = flattenPrivilegedCommands(privileged)
  return buildSudoScript(commands)
}
