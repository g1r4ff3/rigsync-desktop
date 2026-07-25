/**
 * plan을 실행 가능(executable)/관리자 권한 필요(privileged)로 나누고, 후자를
 * 하나의 명령 목록으로 펼친다 — 구 repo `gui.py`의 `split_plan_by_privilege`/
 * `flatten_sudo_commands` 행동을 옮긴 것(코드 복사 아님).
 *
 * **의도적 차이**: 구 repo는 `action.commands`의 각 문자열이 `sudo`로
 * 시작하는지 문자열로 스니핑해서 판단했다(당시엔 그게 유일한 신호였다). 이
 * repo는 P2a에서 이미 `PlanAction.privileged: boolean`을 구조적으로 달아뒀으니
 * (apt/snap install·source 복원 = true, dotfiles·flatpak = false) 그 필드를
 * 그대로 쓴다 — 문자열 휴리스틱보다 엄격하고, "명령 텍스트에 우연히 sudo가
 * 들어간 비특권 액션"을 오분류할 여지가 없다.
 */
import type { PlanAction } from '../plan'

export function splitPlanByPrivilege(
  plan: readonly PlanAction[]
): [executable: PlanAction[], privileged: PlanAction[]] {
  const executable: PlanAction[] = []
  const privileged: PlanAction[] = []
  for (const action of plan) {
    ;(action.privileged ? privileged : executable).push(action)
  }
  return [executable, privileged]
}

export interface FlattenedSudoCommands {
  readonly commands: readonly string[]
  /** owner[i] = commands[i]가 속한 privileged 배열의 인덱스. */
  readonly owner: readonly number[]
}

/**
 * privileged 액션들의 `commands`를 하나의 평평한 목록으로 편다. 액션 하나가
 * 명령을 여러 개 가지면(예: apt source 복원 + keyring 복원 + apt-get update)
 * 연속된 여러 항목이 전부 같은 owner를 갖는다 — `runSudoScript`가 아는 건
 * "합쳐진 명령 인덱스"뿐이라, 실시간 이벤트를 올바른 Apply 행(row)에
 * 되돌리려면 이 매핑이 필요하다.
 */
export function flattenPrivilegedCommands(
  privileged: readonly PlanAction[]
): FlattenedSudoCommands {
  const commands: string[] = []
  const owner: number[] = []
  privileged.forEach((action, actionIndex) => {
    for (const cmd of action.commands) {
      commands.push(cmd)
      owner.push(actionIndex)
    }
  })
  return { commands, owner }
}
