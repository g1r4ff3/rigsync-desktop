import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeFixture, writeSelection } from '../../testFixtures'
import { writeCommonLayer } from '../../manifest'
import { diffServices } from './diff'
import { SERVICES_LAYER } from './constants'
import { makeFakeSystemdUserProvider } from './testHelpers'

describe('diffServices', () => {
  it('reports missing when the manifested unit file is gone from the live unit dir', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, {
      unit: [{ name: 'foo.service', file: 'services/systemd-user/foo.service', enabled: false }]
    })
    const d = await diffServices(fixture.ctx, makeFakeSystemdUserProvider())
    expect(d.missing).toEqual(['foo.service'])
    fixture.cleanup()
  })

  it('reports an enabled mismatch without content_changed encoding', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, {
      unit: [{ name: 'foo.service', file: 'services/systemd-user/foo.service', enabled: true }]
    })
    const storedAbs = path.join(fixture.ctx.manifestDir, 'services/systemd-user/foo.service')
    fs.mkdirSync(path.dirname(storedAbs), { recursive: true })
    fs.writeFileSync(storedAbs, '[Service]\n')

    const provider = makeFakeSystemdUserProvider({
      units: [{ name: 'foo.service', content: '[Service]\n' }],
      enabled: { 'foo.service': false }
    })
    const d = await diffServices(fixture.ctx, provider)
    expect(d.missing).toEqual([])
    expect(d.contentChanged).toEqual([])
    expect(d.enabledMismatch).toEqual(['foo.service'])
    fixture.cleanup()
  })

  it('is fully in sync when content and enabled state match', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, {
      unit: [{ name: 'foo.service', file: 'services/systemd-user/foo.service', enabled: true }]
    })
    const storedAbs = path.join(fixture.ctx.manifestDir, 'services/systemd-user/foo.service')
    fs.mkdirSync(path.dirname(storedAbs), { recursive: true })
    fs.writeFileSync(storedAbs, '[Service]\n')

    const provider = makeFakeSystemdUserProvider({
      units: [{ name: 'foo.service', content: '[Service]\n' }],
      enabled: { 'foo.service': true }
    })
    const d = await diffServices(fixture.ctx, provider)
    expect(d.missing).toEqual([])
    expect(d.contentChanged).toEqual([])
    expect(d.enabledMismatch).toEqual([])
    fixture.cleanup()
  })

  // WS2("창고 모델" 구독 강제): services는 ignore를 지원하지 않아 selection이
  // 이 capability 최초의 선별 기제다 — 안전 규칙 1은 동일(미구독 유닛은
  // 판정만 skip, 제거 plan 없음).
  it('does not report missing/drift for an unsubscribed unit (WS2)', async () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, {
      unit: [{ name: 'foo.service', file: 'services/systemd-user/foo.service', enabled: false }]
    })
    writeSelection(fixture, { mode: 'all', services: { exclude: ['foo.service'] } })

    const d = await diffServices(fixture.ctx, makeFakeSystemdUserProvider())
    expect(d.missing).toEqual([])
    expect(d.contentChanged).toEqual([])
    expect(d.enabledMismatch).toEqual([])
    fixture.cleanup()
  })
})
