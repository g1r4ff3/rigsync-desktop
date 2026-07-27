import { describe, expect, it } from 'vitest'
import { effectiveLayer, readCommonLayer, readHostLayer, writeCommonLayer } from '../../manifest'
import { makeFixture, type TestFixture } from '../../testFixtures'
import { FollowerHostLayerMoveBlockedError, HostLayerEntryNotFoundError } from '../hostLayerErrors'
import { SERVICES_KEY_FIELDS, SERVICES_LAYER } from './constants'
import { moveServiceEntryToCommonLayer, moveServiceEntryToHostLayer } from './hostLayer'
import type { ServicesManifest, ServiceUnitEntry } from './types'

// F1 실증 사례 이름 그대로 픽스처에 씀 — capture.ts host dedup 주석이 참조하는
// 실제 케이스(cliproxyapi.service를 host 계층으로 옮긴 수동 조치)와 일치시킨다.
const UNIT: ServiceUnitEntry = {
  name: 'cliproxyapi.service',
  file: 'services/systemd-user/cliproxyapi.service',
  enabled: true
}

function commonUnitsOf(fixture: TestFixture): readonly ServiceUnitEntry[] {
  return ((readCommonLayer(fixture.ctx, SERVICES_LAYER) as ServicesManifest).unit ??
    []) as ServiceUnitEntry[]
}

function hostUnitsOf(fixture: TestFixture): readonly ServiceUnitEntry[] {
  return ((readHostLayer(fixture.ctx, SERVICES_LAYER) as ServicesManifest).unit ??
    []) as ServiceUnitEntry[]
}

describe('moveServiceEntryToHostLayer / moveServiceEntryToCommonLayer', () => {
  it('rejects on a follower machine', () => {
    const fixture = makeFixture('follower')
    expect(() => moveServiceEntryToHostLayer(fixture.ctx, UNIT.name)).toThrow(
      FollowerHostLayerMoveBlockedError
    )
    expect(() => moveServiceEntryToCommonLayer(fixture.ctx, UNIT.name)).toThrow(
      FollowerHostLayerMoveBlockedError
    )
    fixture.cleanup()
  })

  it('throws when the unit does not exist in the source layer', () => {
    const fixture = makeFixture('reference')
    expect(() => moveServiceEntryToHostLayer(fixture.ctx, 'nope.service')).toThrow(
      HostLayerEntryNotFoundError
    )
    expect(() => moveServiceEntryToCommonLayer(fixture.ctx, 'nope.service')).toThrow(
      HostLayerEntryNotFoundError
    )
    fixture.cleanup()
  })

  it('moves the unit entry (not the unit file) common -> host -> common (round trip)', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, { unit: [UNIT] })

    moveServiceEntryToHostLayer(fixture.ctx, UNIT.name)

    expect(commonUnitsOf(fixture)).toHaveLength(0)
    const hostUnits = hostUnitsOf(fixture)
    expect(hostUnits).toEqual([UNIT])
    // unit 파일 경로는 옮기지 않는다 -- 공통 services/systemd-user/ 위치 그대로.
    expect(hostUnits[0].file).toBe('services/systemd-user/cliproxyapi.service')

    moveServiceEntryToCommonLayer(fixture.ctx, UNIT.name)

    expect(hostUnitsOf(fixture)).toHaveLength(0)
    expect(commonUnitsOf(fixture)).toEqual([UNIT])

    fixture.cleanup()
  })

  it('effectiveLayer merges the host-only unit for this machine but not for a different machine', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, { unit: [UNIT] })

    moveServiceEntryToHostLayer(fixture.ctx, UNIT.name)

    const merged = effectiveLayer(
      fixture.ctx,
      SERVICES_LAYER,
      SERVICES_KEY_FIELDS
    ) as ServicesManifest
    expect((merged.unit ?? []).map((u) => u.name)).toContain(UNIT.name)

    const otherHostCtx = { ...fixture.ctx, machineId: 'other-host' }
    const mergedOther = effectiveLayer(
      otherHostCtx,
      SERVICES_LAYER,
      SERVICES_KEY_FIELDS
    ) as ServicesManifest
    expect((mergedOther.unit ?? []).map((u) => u.name)).not.toContain(UNIT.name)

    fixture.cleanup()
  })

  it('never leaves the unit present in both common and host at once', () => {
    const fixture = makeFixture('reference')
    writeCommonLayer(fixture.ctx, SERVICES_LAYER, { unit: [UNIT] })

    moveServiceEntryToHostLayer(fixture.ctx, UNIT.name)

    expect(commonUnitsOf(fixture).some((u) => u.name === UNIT.name)).toBe(false)
    expect(hostUnitsOf(fixture).some((u) => u.name === UNIT.name)).toBe(true)

    moveServiceEntryToCommonLayer(fixture.ctx, UNIT.name)

    expect(commonUnitsOf(fixture).some((u) => u.name === UNIT.name)).toBe(true)
    expect(hostUnitsOf(fixture).some((u) => u.name === UNIT.name)).toBe(false)

    fixture.cleanup()
  })
})
