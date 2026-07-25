import { describe, expect, it } from 'vitest'
import {
  makeFakeAptProvider,
  makeFakeFlatpakProvider,
  makeFakeSnapProvider
} from './capabilities/packages/testHelpers'
import { makeFakeGearLeverProvider } from './capabilities/appimage/testHelpers'
import { detectReclassifications } from './reclassification'

// 신규 테스트 — 정책 §5 발산 정책의 "계층 재분류" 경로(구 repo엔 계층 개념
// 자체가 없어 대응 테스트가 없다).

describe('detectReclassifications', () => {
  it('flags an app manifested in apt but actually found live in flatpak (T2 promotion)', async () => {
    const providers = {
      apt: makeFakeAptProvider({ manual: [] }), // gimp가 apt엔 더 이상 없음
      snap: makeFakeSnapProvider([]),
      flatpak: makeFakeFlatpakProvider({
        apps: [{ application: 'org.gimp.GIMP', origin: 'flathub', installation: 'system' }]
      })
    }
    const gearLever = makeFakeGearLeverProvider({ installed: [] })

    const events = await detectReclassifications(providers, gearLever, { apt: ['gimp'] })
    expect(events).toEqual([{ name: 'gimp', manifestedIn: 'apt', foundIn: 'flatpak' }])
  })

  it('does not flag anything when the missing app is nowhere else either (real drift, not a reclassification)', async () => {
    const providers = {
      apt: makeFakeAptProvider({ manual: [] }),
      snap: makeFakeSnapProvider([]),
      flatpak: makeFakeFlatpakProvider({ apps: [] })
    }
    const gearLever = makeFakeGearLeverProvider({ installed: [] })

    const events = await detectReclassifications(providers, gearLever, { apt: ['ripgrep'] })
    expect(events).toEqual([])
  })

  it('flags a demotion from flatpak to appimage', async () => {
    const providers = {
      apt: makeFakeAptProvider({ manual: [] }),
      snap: makeFakeSnapProvider([]),
      flatpak: makeFakeFlatpakProvider({ apps: [] })
    }
    const gearLever = makeFakeGearLeverProvider({
      installed: [
        {
          name: 'tev (2.13.1)',
          path: '/home/x/tev.appimage',
          desktopId: 'tev.desktop',
          currentVersion: '2.13.1',
          availableVersion: null,
          downloadSize: null,
          manager: 'GithubUpdater',
          embeddedSource: false,
          running: false
        }
      ]
    })

    const events = await detectReclassifications(providers, gearLever, { flatpak: ['tev'] })
    expect(events).toEqual([{ name: 'tev', manifestedIn: 'flatpak', foundIn: 'appimage' }])
  })
})
