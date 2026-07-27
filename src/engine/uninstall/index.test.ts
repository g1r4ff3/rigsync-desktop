/**
 * planUninstall 오케스트레이터 — capability별 라우팅 + 일괄(batch) 묶음 +
 * 미지원 capability의 정직한 제외 사유를 검증한다. capability별 세부 로직
 * (managed 거부, 백업 경로, apt 의존성 파싱 등)은 각 capability 자체 테스트
 * (`dotfiles/plan.test.ts`, `binaries/plan.test.ts`, `fonts/plan.test.ts`,
 * `packages/apt.test.ts`, `packages/flatpak.test.ts`)가 이미 담당하므로, 여기는
 * "여러 capability를 한 요청 배열로 섞어도 각자 옳게 라우팅되는지"에 집중한다.
 */
import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../manifest'
import { makeFixture, writeHomeFile, writeIgnore, type TestFixture } from '../testFixtures'
import { makeFakeAptProvider, makeFakeFlatpakProvider } from '../capabilities/packages/testHelpers'
import { makeFakeFontsSystemProvider } from '../capabilities/fonts/testHelpers'
import { DOTFILES_LAYER } from '../capabilities/dotfiles/constants'
import { planUninstall, type UninstallProviders } from './index'

describe('planUninstall', () => {
  let fixture: TestFixture
  let providers: UninstallProviders

  beforeEach(() => {
    fixture = makeFixture('reference')
    providers = {
      apt: makeFakeAptProvider(),
      flatpak: makeFakeFlatpakProvider(),
      fontsSystem: makeFakeFontsSystemProvider()
    }
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('routes a single dotfiles request to planDotfilesUninstall', async () => {
    const homeFile = writeHomeFile(fixture, '.oldtoolrc', 'leftover\n')
    writeIgnore(fixture, { dotfiles: { homes: ['~/.oldtoolrc'] } })

    const result = await planUninstall(
      fixture.ctx,
      providers,
      [{ capability: 'dotfiles', key: '~/.oldtoolrc' }],
      'run-single'
    )

    expect(result.actions).toHaveLength(1)
    expect(result.excluded).toEqual([])
    const runResult = await result.actions[0].run()
    expect(runResult.ok).toBe(true)
    expect(fs.existsSync(homeFile)).toBe(false)
  })

  it('excludes every unsupported capability with a human-readable reason (snap/appimage/settings/services/scheduled/tools/repos)', async () => {
    const unsupported = [
      'snap',
      'appimage',
      'settings',
      'services',
      'scheduled',
      'tools',
      'repos',
      'something-unknown'
    ]
    const items = unsupported.map((capability) => ({ capability, key: 'x' }))

    const result = await planUninstall(fixture.ctx, providers, items, 'run-unsupported')

    expect(result.actions).toEqual([])
    expect(result.excluded).toHaveLength(unsupported.length)
    for (const capability of unsupported) {
      const exclusion = result.excluded.find((e) => e.capability === capability)
      expect(exclusion).toBeDefined()
      expect(exclusion?.reason.length).toBeGreaterThan(0)
    }
    // 각 사유가 서로 달라야 한다(뭉뚱그린 "미지원" 한 마디로 퉁치지 않는다) —
    // 알 수 없는 capability만 공통 폴백 문구를 쓴다.
    const reasons = new Set(result.excluded.map((e) => e.reason))
    expect(reasons.size).toBe(unsupported.length)
  })

  it('bundles a batch request spanning multiple capabilities: apt merges into one command, others stay per-item, and a managed item elsewhere in the batch is still rejected', async () => {
    // apt: 두 패키지 모두 유효 -- 한 명령으로 묶여야 한다.
    providers = {
      ...providers,
      apt: makeFakeAptProvider({
        manual: ['ripgrep', 'fd-find'],
        removeDryRunOutput: [
          'The following packages will be REMOVED:',
          '  ripgrep fd-find',
          '0 upgraded'
        ].join('\n')
      })
    }
    writeIgnore(fixture, {
      apt: { packages: ['ripgrep', 'fd-find'] },
      dotfiles: { homes: ['~/.oldtoolrc'] }
    })

    // dotfiles: 하나는 유효(ignored+installed), 다른 하나는 managed라 거부.
    writeHomeFile(fixture, '.oldtoolrc', 'leftover\n')
    writeHomeFile(fixture, '.zshrc', 'seed\n')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })

    const result = await planUninstall(
      fixture.ctx,
      providers,
      [
        { capability: 'apt', key: 'ripgrep' },
        { capability: 'apt', key: 'fd-find' },
        { capability: 'dotfiles', key: '~/.oldtoolrc' },
        { capability: 'dotfiles', key: '~/.zshrc' } // managed -- 거부돼야 함
      ],
      'run-batch'
    )

    const aptActions = result.actions.filter((a) => a.commands.some((c) => c.includes('apt-get')))
    expect(aptActions).toHaveLength(1)
    expect(aptActions[0].commands[0]).toBe('sudo apt-get remove -y fd-find ripgrep')

    const dotfilesActions = result.actions.filter((a) => a.capability === 'dotfiles')
    expect(dotfilesActions).toHaveLength(1)

    expect(result.excluded).toEqual([
      { capability: 'dotfiles', key: '~/.zshrc', reason: expect.stringContaining('managed') }
    ])
    expect(result.aptDependencies?.willRemove).toEqual(['fd-find', 'ripgrep'])
    expect(result.aptDependencies?.extra).toEqual([])
  })

  it('omits aptDependencies entirely when no apt items are requested', async () => {
    writeHomeFile(fixture, '.oldtoolrc', 'leftover\n')
    writeIgnore(fixture, { dotfiles: { homes: ['~/.oldtoolrc'] } })

    const result = await planUninstall(
      fixture.ctx,
      providers,
      [{ capability: 'dotfiles', key: '~/.oldtoolrc' }],
      'run-no-apt'
    )

    expect(result.aptDependencies).toBeUndefined()
  })

  it('is a no-op-safe call with an empty item list', async () => {
    const result = await planUninstall(fixture.ctx, providers, [], 'run-empty')
    expect(result.actions).toEqual([])
    expect(result.excluded).toEqual([])
    expect(result.aptDependencies).toBeUndefined()
  })
})
