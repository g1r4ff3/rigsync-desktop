import { describe, expect, it } from 'vitest'
import {
  collectDeletableItems,
  computeDeleteEligibility,
  controlValueForItem,
  isDeletableState,
  isUninstallSupportedCapability
} from './deleteEligibility'
import type { SyncItemGroupDto } from '../../shared/ipc'

describe('isUninstallSupportedCapability', () => {
  it('engine의 planUninstall switch 케이스와 같은 5종만 지원한다', () => {
    expect(isUninstallSupportedCapability('dotfiles')).toBe(true)
    expect(isUninstallSupportedCapability('apt')).toBe(true)
    expect(isUninstallSupportedCapability('flatpak')).toBe(true)
    expect(isUninstallSupportedCapability('binaries')).toBe(true)
    expect(isUninstallSupportedCapability('fonts')).toBe(true)
  })

  it('나머지(snap/appimage/tools/repos)는 미지원이다', () => {
    expect(isUninstallSupportedCapability('snap')).toBe(false)
    expect(isUninstallSupportedCapability('appimage')).toBe(false)
    expect(isUninstallSupportedCapability('tools')).toBe(false)
    expect(isUninstallSupportedCapability('repos')).toBe(false)
  })
})

describe('computeDeleteEligibility', () => {
  it('detectionOnly 그룹(snap)은 capability와 무관하게 항상 비활성이다', () => {
    const result = computeDeleteEligibility({
      capability: 'snap',
      managed: false,
      ignored: true,
      detectionOnly: true
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/snap/)
  })

  it('미지원 capability는 managed×ignored와 무관하게 비활성이다', () => {
    const result = computeDeleteEligibility({
      capability: 'tools',
      managed: false,
      ignored: true,
      detectionOnly: false
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toContain('tools')
  })

  it('managed 항목(아직 manifest에 있음)은 ignore 여부와 무관하게 비활성이다', () => {
    const result = computeDeleteEligibility({
      capability: 'apt',
      managed: true,
      ignored: true,
      detectionOnly: false
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/managed|manifest/i)
  })

  it('managed=false지만 아직 ignore 안 된 항목(pending-add)은 비활성이다', () => {
    const result = computeDeleteEligibility({
      capability: 'apt',
      managed: false,
      ignored: false,
      detectionOnly: false
    })
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/일시중지|Pause/)
  })

  it('managed=false && ignored=true && 지원 capability면 삭제 가능하다', () => {
    const result = computeDeleteEligibility({
      capability: 'apt',
      managed: false,
      ignored: true,
      detectionOnly: false
    })
    expect(result.eligible).toBe(true)
    expect(result.reason).toBeUndefined()
  })
})

describe('isDeletableState', () => {
  it("state==='excluded'일 때만 true", () => {
    expect(isDeletableState('excluded')).toBe(true)
    expect(isDeletableState('synced')).toBe(false)
    expect(isDeletableState('pending-add')).toBe(false)
    expect(isDeletableState('pending-remove')).toBe(false)
    expect(isDeletableState('detected')).toBe(false)
  })
})

describe('controlValueForItem', () => {
  it('ignored=false -> sync, ignored=true -> pause', () => {
    expect(controlValueForItem(false)).toBe('sync')
    expect(controlValueForItem(true)).toBe('pause')
  })
})

describe('collectDeletableItems', () => {
  const groups: readonly SyncItemGroupDto[] = [
    {
      capability: 'apt',
      title: 'apt',
      items: [
        { key: 'curl', label: 'curl', managed: false, ignored: true, state: 'excluded' },
        { key: 'zsync', label: 'zsync', managed: true, ignored: true, state: 'pending-remove' },
        { key: 'htop', label: 'htop', managed: false, ignored: false, state: 'pending-add' },
        { key: 'vim', label: 'vim', managed: true, ignored: false, state: 'synced' }
      ]
    },
    {
      capability: 'snap',
      title: 'snap (검출 전용)',
      detectionOnly: true,
      items: [{ key: 'foo', label: 'foo', managed: false, ignored: true, state: 'detected' }]
    },
    {
      capability: 'fonts',
      title: 'fonts',
      items: [
        {
          key: 'D2Coding',
          label: 'D2Coding',
          managed: false,
          ignored: true,
          state: 'excluded',
          description: '설치된 파일 3개'
        }
      ]
    }
  ]

  it('managed=false && ignored=true && 지원 capability인 항목만 모은다', () => {
    const result = collectDeletableItems(groups)
    expect(result.map((r) => `${r.capability}:${r.key}`)).toEqual(['apt:curl', 'fonts:D2Coding'])
  })

  it('description이 있으면 그대로 옮긴다', () => {
    const result = collectDeletableItems(groups)
    const fonts = result.find((r) => r.key === 'D2Coding')
    expect(fonts?.description).toBe('설치된 파일 3개')
  })

  it('검색 필터와 무관하게 항상 전체 groups를 대상으로 한다(호출부가 필터링하지 않고 넘긴 그대로)', () => {
    const result = collectDeletableItems(groups)
    expect(result).toHaveLength(2)
  })
})
