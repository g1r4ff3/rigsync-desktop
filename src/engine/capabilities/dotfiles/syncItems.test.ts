import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeHomeFile, writeIgnore, type TestFixture } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import type { SyncItem, SyncItemGroup } from '../../syncItems'
import { captureDotfiles } from './capture'
import { DOTFILES_LAYER } from './constants'
import { moveDotfileEntryToHostLayer } from './hostLayer'
import { buildDotfilesSyncGroup } from './syncItems'

// 신규 테스트 (구 repo엔 이 화면이 없었음) — P2a 결정 ⑤ "동기화 항목" 화면의
// dotfiles 그룹.
//
// WS6("창고 모델 1차") "SEED 강등": SEED_DOTFILES 유래 미관리 후보는 더는 본체
// 그룹에 섞이지 않고 별도 `dotfiles-suggested` 서브그룹으로 나온다 — 아래
// 테스트가 그 분리를 검증한다(allItems 헬퍼는 반환된 그룹 배열 전체에서 찾는다).

function allItems(groups: readonly SyncItemGroup[]): Map<string, SyncItem> {
  return new Map(groups.flatMap((g) => g.items).map((i) => [i.key, i]))
}

describe('buildDotfilesSyncGroup', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('returns no groups when there is nothing managed or candidate', () => {
    expect(buildDotfilesSyncGroup(fixture.ctx)).toEqual([])
  })

  it('lists a managed entry in the main group and an unmanaged seed candidate in the suggested group, marking ignored ones', async () => {
    writeHomeFile(fixture, '.zshrc', 'seed content\n')
    await captureDotfiles(fixture.ctx, { dryRun: false }) // "~/.zshrc" becomes managed

    writeHomeFile(fixture, '.gitconfig', '[user]\n') // seed candidate, not yet captured
    writeIgnore(fixture, { dotfiles: { homes: ['~/.gitconfig'] } })

    const groups = buildDotfilesSyncGroup(fixture.ctx)
    expect(groups).toHaveLength(2)

    const mainGroup = groups.find((g) => g.subgroup === undefined)
    const suggestedGroup = groups.find((g) => g.subgroup === 'dotfiles-suggested')
    expect(mainGroup).toBeDefined()
    expect(suggestedGroup).toBeDefined()
    expect(suggestedGroup?.collapsedByDefault).toBe(true)

    expect(mainGroup!.items.map((i) => i.key)).toEqual(['~/.zshrc'])
    expect(mainGroup!.items[0]).toEqual({
      key: '~/.zshrc',
      label: '~/.zshrc',
      managed: true,
      ignored: false,
      // R6 R2: 잘 알려진 dotfile 사전에서 온 한 줄 설명.
      description: 'zsh 셸 설정',
      // F2: host 계층으로 옮긴 적 없으니 false.
      hostOnly: false
    })
    // 후보(candidate)면서 ignore도 된 항목 -- 화면엔 여전히 나타나야 한다(추천 그룹에).
    expect(suggestedGroup!.items.map((i) => i.key)).toEqual(['~/.gitconfig'])
    expect(suggestedGroup!.items[0]).toEqual({
      key: '~/.gitconfig',
      label: '~/.gitconfig',
      managed: false,
      ignored: true,
      description: 'git 전역 설정',
      hostOnly: false
    })
  })

  // F2 (docs/refactor-spec-v0.2.md) — "이 머신 전용" 배지의 데이터 소스.
  it('marks a host-layer entry as hostOnly', () => {
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    moveDotfileEntryToHostLayer(fixture.ctx, '~/.zshrc')

    const item = allItems(buildDotfilesSyncGroup(fixture.ctx)).get('~/.zshrc')
    expect(item?.hostOnly).toBe(true)
    expect(item?.managed).toBe(true)
  })
})
