/**
 * repos plan — 구 repo `plan_repos`(rigsync.py:1741) 행동 이식. `git clone`은
 * sudo가 필요 없다 — `privileged: false`, 테스트에서도 `run()`이 실제 호출되므로
 * clone 실행은 `GitProvider` 뒤로 격리한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import type { PlanAction } from '../../plan'
import { expandHome } from '../../paths'
import type { GitProvider } from './providerTypes'
import type { ReposDiffReport } from './types'

export function planRepos(
  ctx: RigsyncContext,
  provider: GitProvider,
  diff: ReposDiffReport
): PlanAction[] {
  return diff.toClone.map((r) => {
    const dest = expandHome(ctx, r.path)
    return {
      capability: 'repos',
      summary: `clone ${r.path}`,
      commands: [`git clone ${r.url} ${dest}`],
      privileged: false,
      run: async () => {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        const result = await provider.clone(r.url, dest)
        return { ok: result.ok, detail: result.output || (result.ok ? 'cloned' : 'clone 실패') }
      }
    }
  })
}
