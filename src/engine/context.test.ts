import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse as parseToml } from 'smol-toml'
import {
  defaultConfigPath,
  DEFAULT_DRIFT_CHECK_INTERVAL_HOURS,
  resolveContext,
  writeConfigFile
} from './context'

// R1: Settings 화면의 "저장 -> 재해석" 왕복을 엔진 레벨에서 검증한다(main의
// refreshEngineContext()/스케줄러 재생성은 main 레이어라 여기선 다루지 않음
// — 최종 보고에 그 경로를 별도로 설명).

describe('writeConfigFile / resolveContext round-trip', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-context-test-'))
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('resolveContext reports firstRun=true and a dev default before any config.toml exists', () => {
    const { ctx, firstRun } = resolveContext(homeDir)
    expect(firstRun).toBe(true)
    expect(ctx.role).toBe('reference')
    expect(ctx.autostartEnabled).toBe(false)
  })

  it('a freshly written config.toml round-trips through resolveContext', () => {
    writeConfigFile(homeDir, {
      machineId: 'my-desktop',
      role: 'follower',
      manifestDir: '/tmp/some-manifest',
      profile: 'gaming-rig',
      autostartEnabled: true,
      driftCheckIntervalHours: 12
    })

    const { ctx, firstRun } = resolveContext(homeDir)
    expect(firstRun).toBe(false)
    expect(ctx.machineId).toBe('my-desktop')
    expect(ctx.role).toBe('follower')
    expect(ctx.manifestDir).toBe('/tmp/some-manifest')
    expect(ctx.profile).toBe('gaming-rig')
    expect(ctx.autostartEnabled).toBe(true)
    expect(ctx.settings.driftCheckIntervalHours).toBe(12)
  })

  it('omitting driftCheckIntervalHours falls back to the documented default on read', () => {
    writeConfigFile(homeDir, {
      machineId: 'my-desktop',
      role: 'reference',
      manifestDir: '/tmp/some-manifest',
      autostartEnabled: false
    })
    const { ctx } = resolveContext(homeDir)
    expect(ctx.settings.driftCheckIntervalHours).toBeUndefined()
    expect(ctx.settings.driftCheckIntervalHours ?? DEFAULT_DRIFT_CHECK_INTERVAL_HOURS).toBe(
      DEFAULT_DRIFT_CHECK_INTERVAL_HOURS
    )
  })

  it('re-saving via the Settings screen (role/profile change) does not wipe hand-edited [settings] keys', () => {
    // 사용자가 config.toml을 직접 편집해 dconfPaths를 넣어둔 상태를 흉내낸다.
    const configPath = defaultConfigPath(homeDir)
    fs.mkdirSync(path.dirname(configPath), { recursive: true })
    fs.writeFileSync(
      configPath,
      'machineId = "my-desktop"\nrole = "reference"\nmanifestDir = "/tmp/m"\nautostartEnabled = false\n\n[settings]\ndconfPaths = ["/org/gnome/desktop/wm/keybindings/"]\n'
    )

    // Settings 화면에서 role만 바꿔 저장.
    writeConfigFile(homeDir, {
      machineId: 'my-desktop',
      role: 'follower',
      manifestDir: '/tmp/m',
      autostartEnabled: false,
      driftCheckIntervalHours: 3
    })

    const { ctx } = resolveContext(homeDir)
    expect(ctx.role).toBe('follower')
    expect(ctx.settings.driftCheckIntervalHours).toBe(3)
    // 손으로 넣어둔 dconfPaths가 여전히 남아있어야 한다.
    expect(ctx.settings.dconfPaths).toEqual(['/org/gnome/desktop/wm/keybindings/'])
  })

  it('writes a profile-less config without an empty profile key (TOML has no null)', () => {
    writeConfigFile(homeDir, {
      machineId: 'my-desktop',
      role: 'reference',
      manifestDir: '/tmp/m',
      autostartEnabled: false
    })
    const raw = parseToml(fs.readFileSync(defaultConfigPath(homeDir), 'utf-8')) as Record<
      string,
      unknown
    >
    expect('profile' in raw).toBe(false)
  })
})
