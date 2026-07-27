import { describe, expect, it } from 'vitest'
import { writeCommonLayer } from '../../manifest'
import { makeFixture } from '../../testFixtures'
import { moveServiceEntryToHostLayer } from './hostLayer'
import { buildServicesSyncGroup } from './syncItems'
import { SERVICES_LAYER } from './constants'
import type { ServiceUnitEntry } from './types'

// 신규 테스트 — F2(docs/refactor-spec-v0.2.md)의 services Candidates 그룹.

const UNIT: ServiceUnitEntry = {
  name: 'cliproxyapi.service',
  file: 'services/systemd-user/cliproxyapi.service',
  enabled: true
}

describe('buildServicesSyncGroup', () => {
  it('returns null when nothing is captured', () => {
    const fixture = makeFixture('reference')
    expect(buildServicesSyncGroup(fixture.ctx)).toBeNull()
    fixture.cleanup()
  })

  it('lists a captured unit as always managed and never ignored', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, { unit: [UNIT] })

    const group = buildServicesSyncGroup(fixture.ctx)
    expect(group).not.toBeNull()
    expect(group!.capability).toBe('services')
    expect(group!.items).toEqual([
      { key: UNIT.name, label: UNIT.name, managed: true, ignored: false, hostOnly: false }
    ])

    fixture.cleanup()
  })

  it('marks a host-layer unit as hostOnly', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, { unit: [UNIT] })
    moveServiceEntryToHostLayer(fixture.ctx, UNIT.name)

    const group = buildServicesSyncGroup(fixture.ctx)
    const item = group!.items.find((i) => i.key === UNIT.name)
    expect(item?.hostOnly).toBe(true)
    expect(item?.managed).toBe(true)

    fixture.cleanup()
  })
})
