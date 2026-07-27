import { describe, expect, it } from 'vitest'
import { makeFixture } from '../testFixtures'
import { evaluateCheck } from './evaluate'
import { makeFakeDoctorSystemProvider } from './testHelpers'

// role 타입 케이스 출처: 구 repo tests/test_role.py TestMachineRoleDoctorCheck
// (4케이스 중 3케이스 적응 이식 -- "content와 무관하게 pass"는 이 repo의 role이
// 항상 유효한 'reference'|'follower' 유니온이라 재현 불가능한 케이스라 제외,
// 대신 "config.toml 존재 여부"로 판정 기준을 옮겼다 -- evaluate.ts 주석 참조).

describe('evaluateCheck', () => {
  it('file: passes when a match exists', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDoctorSystemProvider({
      fileMatches: { '/opt/resolve': ['/opt/resolve'] }
    })
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'davinci-resolve', type: 'file', target: '/opt/resolve' },
      provider,
      { configConfigured: true }
    )
    expect(result.result).toBe('pass')
    expect(result.detail).toBe('/opt/resolve')
    fixture.cleanup()
  })

  it('file: fails when there is no match', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDoctorSystemProvider({})
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'zoom', type: 'file', target: '/opt/zoom' },
      provider,
      { configConfigured: true }
    )
    expect(result.result).toBe('fail')
    expect(result.detail).toBe('no match: /opt/zoom')
    fixture.cleanup()
  })

  it('apt: passes when dpkg reports the package installed', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDoctorSystemProvider({ aptInstalled: { tailscale: true } })
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'tailscale-pkg', type: 'apt', target: 'tailscale' },
      provider,
      { configConfigured: true }
    )
    expect(result.result).toBe('pass')
    fixture.cleanup()
  })

  it('cmd: passes on exit 0 with expected output substring', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDoctorSystemProvider({
      shellResults: { 'tailscale status': { code: 0, combinedOutput: '100.x.x.x  logged in\n' } }
    })
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'tailscale', type: 'cmd', target: 'tailscale status', expect: 'logged in' },
      provider,
      { configConfigured: true }
    )
    expect(result.result).toBe('pass')
    fixture.cleanup()
  })

  it('cmd: fails when the expected substring is missing', async () => {
    const fixture = makeFixture('reference')
    const provider = makeFakeDoctorSystemProvider({
      shellResults: { 'tailscale status': { code: 0, combinedOutput: 'Stopped\n' } }
    })
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'tailscale', type: 'cmd', target: 'tailscale status', expect: 'logged in' },
      provider,
      { configConfigured: true }
    )
    expect(result.result).toBe('fail')
    fixture.cleanup()
  })

  it('test_fails_when_role_file_missing (adapted: fails when config.toml is not yet configured)', async () => {
    const fixture = makeFixture('reference')
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'machine-role', type: 'role', target: '~/.config/rigsync/role' },
      makeFakeDoctorSystemProvider(),
      { configConfigured: false }
    )
    expect(result.result).toBe('fail')
    fixture.cleanup()
  })

  it('test_passes_when_role_reference (adapted: passes once config.toml exists)', async () => {
    const fixture = makeFixture('reference')
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'machine-role', type: 'role', target: '~/.config/rigsync/role' },
      makeFakeDoctorSystemProvider(),
      { configConfigured: true }
    )
    expect(result.result).toBe('pass')
    expect(result.detail).toBe('role=reference')
    fixture.cleanup()
  })

  it('test_passes_when_role_follower (adapted: passes once config.toml exists)', async () => {
    const fixture = makeFixture('follower')
    const result = await evaluateCheck(
      fixture.ctx,
      { name: 'machine-role', type: 'role', target: '~/.config/rigsync/role' },
      makeFakeDoctorSystemProvider(),
      { configConfigured: true }
    )
    expect(result.result).toBe('pass')
    expect(result.detail).toBe('role=follower')
    fixture.cleanup()
  })
})
