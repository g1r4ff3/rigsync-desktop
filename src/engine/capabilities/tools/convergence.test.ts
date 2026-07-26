/**
 * apply → diff 수렴 e2e 테스트 — 실사용 버그(follower 머신에서 Apply가 전부
 * ok로 끝나도 diff가 같은 항목을 영원히 to-install로 보고하는 문제)의 재발
 * 방지. 근본 원인은 탐지(`nodeVersion`/`npmGlobals`/`npmNodeAvailable`)가
 * 설치와 다른 환경(NVM_SOURCE 미소싱)을 봐서였다 — 이 테스트는 그 환경 문제
 * 자체는 fake provider라 재현하지 않지만(실제 환경 재현은
 * `providers/linux/tools.test.ts`), "install들이 실제로 반영한 상태를 diff가
 * 다시 봤을 때 drift가 0이 되는가"라는 수렴 계약을 고정한다.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { diffTools } from './diff'
import { planTools } from './plan'
import { TOOLS_LAYER } from './constants'
import { makeFakeToolsProvider } from './testHelpers'

function writeToolsManifest(
  ctx: Parameters<typeof writeCommonLayer>[0],
  packages: readonly string[],
  nodeVersion = 'v25.8.1'
): void {
  writeCommonLayer(ctx, TOOLS_LAYER, {
    packages: [...packages].sort(),
    node: { version: nodeVersion, manager: 'nvm' }
  })
}

describe('tools apply -> diff convergence (실사용 버그 회귀)', () => {
  it('fresh machine: nvm+node+package apply 후 재-diff에서 drift 0', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx, ['pnpm'], 'v25.8.1')
    const provider = makeFakeToolsProvider({ available: false })

    const diff1 = await diffTools(fixture.ctx, provider)
    expect(diff1.toInstall).toEqual(['pnpm'])
    expect(diff1.nodeToInstall).toBe('v25.8.1')
    expect(diff1.nvmMissing).toBe(true)

    const plan1 = planTools(fixture.ctx, provider, diff1)
    expect(plan1).toHaveLength(3)
    for (const action of plan1) {
      const result = await action.run()
      expect(result.ok).toBe(true)
    }
    // 실제 nvm 설치 스크립트의 부수효과(~/.nvm 생성)를 흉내낸다 -- 이 디렉터리
    // 존재 여부는 provider가 아니라 diffTools가 직접 fs로 본다.
    fs.mkdirSync(path.join(fixture.ctx.homeDir, '.nvm'), { recursive: true })

    const diff2 = await diffTools(fixture.ctx, provider)
    expect(diff2.toInstall).toEqual([])
    expect(diff2.nodeToInstall).toBeNull()
    expect(diff2.nvmMissing).toBe(false)
    expect(planTools(fixture.ctx, provider, diff2)).toEqual([])

    fixture.cleanup()
  })

  it('nvm은 있지만 node 버전이 다른 머신: node install 후 재-diff에서 drift 0', async () => {
    const fixture = makeFixture('reference')
    writeToolsManifest(fixture.ctx, [], 'v25.8.1')
    fs.mkdirSync(path.join(fixture.ctx.homeDir, '.nvm'), { recursive: true })
    const provider = makeFakeToolsProvider({
      available: true,
      globals: {},
      nodeVersion: 'v24.0.0'
    })

    const diff1 = await diffTools(fixture.ctx, provider)
    expect(diff1.nodeToInstall).toBe('v25.8.1')

    const plan1 = planTools(fixture.ctx, provider, diff1)
    expect(plan1).toHaveLength(1)
    const result = await plan1[0].run()
    expect(result.ok).toBe(true)

    const diff2 = await diffTools(fixture.ctx, provider)
    expect(diff2.nodeToInstall).toBeNull()
    expect(planTools(fixture.ctx, provider, diff2)).toEqual([])

    fixture.cleanup()
  })
})
