import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostLayerPath, readManifestFile, writeManifestFile } from './manifest'
import {
  isSubscribed,
  listEntrySubscribers,
  readSelectionFilter,
  readSelectionMode,
  setSelectionMode,
  setSubscribed,
  setSubscribedBulk
} from './selection'
import { makeFixture, writeSelection } from './testFixtures'

// 테스트 전용 헬퍼 -- 임의 machineId의 selection.toml 경로를 만든다
// (listEntrySubscribers는 fixture.ctx.machineId가 아닌 다른 머신들을 스캔하는
// 함수라 hostLayerPath(fixture.ctx, ...)로는 못 만든다).
function hostLayerPathFor(manifestDir: string, machineId: string, layer: string): string {
  return path.join(manifestDir, 'hosts', machineId, `${layer}.toml`)
}

describe('selection (WS1 — 머신별 구독)', () => {
  it('파일이 없으면 mode="all"이고 모든 키가 구독 상태다', () => {
    const fixture = makeFixture()
    expect(readSelectionMode(fixture.ctx)).toBe('all')
    const filter = readSelectionFilter(fixture.ctx, 'dotfiles')
    expect(filter.mode).toBe('all')
    expect(isSubscribed(filter, '~/.zshrc')).toBe(true)
    expect(isSubscribed(filter, 'anything')).toBe(true)
    fixture.cleanup()
  })

  it('mode="all"에서는 exclude에 있는 키만 미구독이다', () => {
    const fixture = makeFixture()
    writeSelection(fixture, { mode: 'all', apt: { exclude: ['v4l-utils'] } })
    const filter = readSelectionFilter(fixture.ctx, 'apt')
    expect(filter.mode).toBe('all')
    expect(isSubscribed(filter, 'v4l-utils')).toBe(false)
    expect(isSubscribed(filter, 'git')).toBe(true)
    fixture.cleanup()
  })

  it('mode="select"에서는 include에 있는 키만 구독이다', () => {
    const fixture = makeFixture()
    writeSelection(fixture, { mode: 'select', dotfiles: { include: ['~/.zshrc'] } })
    const filter = readSelectionFilter(fixture.ctx, 'dotfiles')
    expect(filter.mode).toBe('select')
    expect(isSubscribed(filter, '~/.zshrc')).toBe(true)
    expect(isSubscribed(filter, '~/.bashrc')).toBe(false)
    fixture.cleanup()
  })

  it('select 모드에서 capability에 섹션 자체가 없으면 아무 것도 구독하지 않는다', () => {
    const fixture = makeFixture()
    writeSelection(fixture, { mode: 'select' })
    const filter = readSelectionFilter(fixture.ctx, 'apt')
    expect(isSubscribed(filter, 'git')).toBe(false)
    fixture.cleanup()
  })

  it('setSubscribed: all 모드에서 구독 해제 -> exclude에 추가, 재구독 -> exclude에서 제거', () => {
    const fixture = makeFixture()
    setSubscribed(fixture.ctx, 'apt', 'v4l-utils', false)
    expect(isSubscribed(readSelectionFilter(fixture.ctx, 'apt'), 'v4l-utils')).toBe(false)

    setSubscribed(fixture.ctx, 'apt', 'v4l-utils', true)
    expect(isSubscribed(readSelectionFilter(fixture.ctx, 'apt'), 'v4l-utils')).toBe(true)
    // 안정 상태로 돌아오면 exclude 목록 자체가 비어 섹션이 사라진다.
    const doc = readManifestFile(hostLayerPath(fixture.ctx, 'selection'))
    expect(doc.apt).toBeUndefined()
    fixture.cleanup()
  })

  it('setSubscribed: select 모드에서 구독 -> include에 추가, 해제 -> include에서 제거', () => {
    const fixture = makeFixture()
    writeSelection(fixture, { mode: 'select' })

    setSubscribed(fixture.ctx, 'dotfiles', '~/.zshrc', true)
    expect(isSubscribed(readSelectionFilter(fixture.ctx, 'dotfiles'), '~/.zshrc')).toBe(true)

    setSubscribed(fixture.ctx, 'dotfiles', '~/.zshrc', false)
    expect(isSubscribed(readSelectionFilter(fixture.ctx, 'dotfiles'), '~/.zshrc')).toBe(false)
    fixture.cleanup()
  })

  it('setSubscribedBulk: 여러 키를 1회 읽기-수정-쓰기로 처리하고 정렬해 저장한다', () => {
    const fixture = makeFixture()
    setSubscribedBulk(fixture.ctx, 'apt', ['zoom', 'curl', 'ark'], false)
    const doc = readManifestFile(hostLayerPath(fixture.ctx, 'selection'))
    const apt = doc.apt as { exclude?: string[] }
    expect(apt.exclude).toEqual(['ark', 'curl', 'zoom'])
    fixture.cleanup()
  })

  it('setSubscribedBulk: 빈 배열은 아무 것도 쓰지 않는다', () => {
    const fixture = makeFixture()
    setSubscribedBulk(fixture.ctx, 'apt', [], false)
    expect(readManifestFile(hostLayerPath(fixture.ctx, 'selection'))).toEqual({})
    fixture.cleanup()
  })

  it('setSelectionMode: 모드를 바꿔도 기존 include/exclude 목록은 보존한다', () => {
    const fixture = makeFixture()
    writeSelection(fixture, { mode: 'all', apt: { exclude: ['v4l-utils'] } })

    setSelectionMode(fixture.ctx, 'select')

    const doc = readManifestFile(hostLayerPath(fixture.ctx, 'selection'))
    expect(doc.mode).toBe('select')
    expect((doc.apt as { exclude?: string[] }).exclude).toEqual(['v4l-utils'])
    // select 모드에서는 exclude가 죽은 데이터라 이 capability는 구독이 안 된다.
    expect(isSubscribed(readSelectionFilter(fixture.ctx, 'apt'), 'v4l-utils')).toBe(false)
    expect(isSubscribed(readSelectionFilter(fixture.ctx, 'apt'), 'git')).toBe(false)
    fixture.cleanup()
  })

  it('listEntrySubscribers: hosts/*/selection.toml을 스캔해 구독 중인 머신만 나열한다', () => {
    const fixture = makeFixture()
    // host A: all 모드, git 미구독(exclude).
    writeManifestFile(hostLayerPathFor(fixture.manifestDir, 'host-a', 'selection'), {
      mode: 'all',
      apt: { exclude: ['git'] }
    })
    // host B: select 모드, git 구독(include).
    writeManifestFile(hostLayerPathFor(fixture.manifestDir, 'host-b', 'selection'), {
      mode: 'select',
      apt: { include: ['git'] }
    })
    // host C: selection.toml 자체가 없음 -- 열거 불가(한계), 목록에 안 나옴.
    fs.mkdirSync(
      hostLayerPathFor(fixture.manifestDir, 'host-c', 'selection').replace('/selection.toml', ''),
      {
        recursive: true
      }
    )

    const subscribers = listEntrySubscribers(fixture.ctx, 'apt', 'git')
    expect(subscribers).toEqual(['host-b'])
    fixture.cleanup()
  })

  it('listEntrySubscribers: hosts 디렉터리가 아예 없으면 빈 배열', () => {
    const fixture = makeFixture()
    expect(listEntrySubscribers(fixture.ctx, 'apt', 'git')).toEqual([])
    fixture.cleanup()
  })
})
