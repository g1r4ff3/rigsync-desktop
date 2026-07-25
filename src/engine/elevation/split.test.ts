import { describe, expect, it } from 'vitest'
import type { PlanAction } from '../plan'
import { flattenPrivilegedCommands, splitPlanByPrivilege } from './split'

// 케이스 출처: 구 repo gui.py TestSplitPlanByPrivilege/TestFlattenSudoCommands
// (행동만 옮김 — 코드 복사 아님). 구 repo는 commands 문자열이 "sudo"로
// 시작하는지로 분류했지만, 이 엔진은 PlanAction.privileged 구조적 필드를
// 이미 갖고 있어 그걸 쓴다(플랜/index.ts 주석 참조 — 의도적 차이).

const noop = async (): Promise<{ ok: boolean; detail: string }> => ({ ok: true, detail: '' })

function action(
  capability: string,
  summary: string,
  commands: string[],
  privileged: boolean
): PlanAction {
  return { capability, summary, commands, privileged, run: noop }
}

describe('splitPlanByPrivilege', () => {
  it('buckets sudo (privileged) actions separately (test_sudo_commands_bucketed_separately)', () => {
    const plan: PlanAction[] = [
      action('apt', 'install foo', ['sudo apt-get install -y foo'], true),
      action('dotfiles', 'link ~/.zshrc', ['<symlink+backup>'], false),
      action('snap', 'snap install bar', ['sudo snap install bar'], true),
      action('repos', 'clone x', ['git clone url path'], false)
    ]
    const [executable, privileged] = splitPlanByPrivilege(plan)
    expect(executable.map((a) => a.capability)).toEqual(['dotfiles', 'repos'])
    expect(privileged.map((a) => a.capability)).toEqual(['apt', 'snap'])
  })

  it('empty plan (test_empty_plan)', () => {
    expect(splitPlanByPrivilege([])).toEqual([[], []])
  })
})

describe('flattenPrivilegedCommands', () => {
  it('flattens and tracks owner (test_flattens_and_tracks_owner)', () => {
    const plan: PlanAction[] = [
      action('apt', 'install a', ['sudo apt-get install -y a'], true),
      action('apt', 'install b+c', ['sudo apt-get install -y b', 'sudo apt-get install -y c'], true)
    ]
    const { commands, owner } = flattenPrivilegedCommands(plan)
    expect(commands).toHaveLength(3)
    expect(owner).toEqual([0, 1, 1])
  })

  it('empty (test_empty)', () => {
    expect(flattenPrivilegedCommands([])).toEqual({ commands: [], owner: [] })
  })
})
