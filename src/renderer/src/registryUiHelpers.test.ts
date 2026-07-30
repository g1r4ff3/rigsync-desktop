import { describe, expect, it } from 'vitest'
import {
  computeSubscribeGroupState,
  isSubscribeEligible,
  isSubscribedOn,
  nextBulkSubscribedValue,
  showsRegisterButton,
  showsUnregisterButton,
  subscribeEligibleKeys
} from './registryUiHelpers'

describe('isSubscribeEligible / isSubscribedOn', () => {
  it('managed && !ignored만 구독 대상이다', () => {
    expect(isSubscribeEligible({ managed: true, ignored: false })).toBe(true)
    expect(isSubscribeEligible({ managed: false, ignored: false })).toBe(false)
    expect(isSubscribeEligible({ managed: true, ignored: true })).toBe(false)
  })

  it("state==='not-subscribed'가 아니면 구독 중이다", () => {
    expect(isSubscribedOn({ state: 'synced' })).toBe(true)
    expect(isSubscribedOn({ state: 'not-subscribed' })).toBe(false)
  })
})

describe('computeSubscribeGroupState', () => {
  it('구독 대상 항목이 없으면 null(버튼 숨김)', () => {
    expect(
      computeSubscribeGroupState([{ managed: false, ignored: false, state: 'pending-add' }])
    ).toBe(null)
  })

  it('전부 구독 중이면 all-on', () => {
    expect(
      computeSubscribeGroupState([
        { managed: true, ignored: false, state: 'synced' },
        { managed: true, ignored: false, state: 'synced' }
      ])
    ).toBe('all-on')
  })

  it('전부 미구독이면 all-off', () => {
    expect(
      computeSubscribeGroupState([
        { managed: true, ignored: false, state: 'not-subscribed' },
        { managed: true, ignored: false, state: 'not-subscribed' }
      ])
    ).toBe('all-off')
  })

  it('섞여 있으면 mixed', () => {
    expect(
      computeSubscribeGroupState([
        { managed: true, ignored: false, state: 'synced' },
        { managed: true, ignored: false, state: 'not-subscribed' }
      ])
    ).toBe('mixed')
  })

  it('구독 대상 아닌 항목(미관리·ignore됨)은 집계에서 제외한다', () => {
    expect(
      computeSubscribeGroupState([
        { managed: true, ignored: false, state: 'synced' },
        { managed: false, ignored: false, state: 'pending-add' },
        { managed: true, ignored: true, state: 'pending-remove' }
      ])
    ).toBe('all-on')
  })
})

describe('subscribeEligibleKeys', () => {
  it('구독 대상 항목의 key만 뽑는다', () => {
    expect(
      subscribeEligibleKeys([
        { key: 'a', managed: true, ignored: false },
        { key: 'b', managed: false, ignored: false },
        { key: 'c', managed: true, ignored: true }
      ])
    ).toEqual(['a'])
  })
})

describe('nextBulkSubscribedValue', () => {
  it('all-on이면 다음은 false(전부 해제)', () => {
    expect(nextBulkSubscribedValue('all-on')).toBe(false)
  })
  it('all-off/mixed면 다음은 true(전부 구독)', () => {
    expect(nextBulkSubscribedValue('all-off')).toBe(true)
    expect(nextBulkSubscribedValue('mixed')).toBe(true)
  })
})

describe('showsRegisterButton', () => {
  it('발견형 capability의 pending-add/unresolvable에서만 true', () => {
    expect(showsRegisterButton('apt', 'pending-add')).toBe(true)
    expect(showsRegisterButton('appimage', 'unresolvable')).toBe(true)
  })

  it('dotfiles pending-add는 false(재캡처만 지원, 이번 배치는 신규 등록 없음)', () => {
    expect(showsRegisterButton('dotfiles', 'pending-add')).toBe(false)
  })

  it('managed 상태(synced 등)는 false', () => {
    expect(showsRegisterButton('apt', 'synced')).toBe(false)
    expect(showsRegisterButton('apt', 'not-subscribed')).toBe(false)
  })

  it('registry.ts가 지원하지 않는 capability(binaries 등)는 false', () => {
    expect(showsRegisterButton('binaries', 'pending-add')).toBe(false)
  })
})

describe('showsUnregisterButton', () => {
  it('managed capability(registerable)만 true', () => {
    expect(showsUnregisterButton('apt', true)).toBe(true)
    expect(showsUnregisterButton('dotfiles', true)).toBe(true)
  })

  it('미관리 항목은 false', () => {
    expect(showsUnregisterButton('apt', false)).toBe(false)
  })

  it('registry.ts가 지원하지 않는 capability는 managed여도 false', () => {
    expect(showsUnregisterButton('services', true)).toBe(false)
    expect(showsUnregisterButton('binaries', true)).toBe(false)
    expect(showsUnregisterButton('snap', true)).toBe(false)
  })
})
