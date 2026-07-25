import { describe, expect, it } from 'vitest'
import { checkNvidiaDriverMismatch, type NvidiaCheckProvider } from './nvidia'

function fakeProvider(
  nvrm: string | null,
  packages: Array<{ name: string; version: string }>
): NvidiaCheckProvider {
  return {
    readNvrmVersion: () => nvrm,
    listInstalledDriverPackages: () => packages
  }
}

describe('checkNvidiaDriverMismatch', () => {
  it('is not applicable (skip) on a machine with no NVIDIA GPU at all', () => {
    const result = checkNvidiaDriverMismatch(fakeProvider(null, []))
    expect(result.applicable).toBe(false)
  })

  it('matches when NVRM and the userspace package version are identical', () => {
    const result = checkNvidiaDriverMismatch(
      fakeProvider('580.173.02', [{ name: 'nvidia-driver-580', version: '580.173.02' }])
    )
    expect(result.applicable).toBe(true)
    expect(result.matched).toBe(true)
    expect(result.warning).toBeUndefined()
  })

  it('matches even when dpkg reports a Debian revision suffix (real dpkg -l format)', () => {
    // 실측: `dpkg -l`은 "580.173.02-0ubuntu0.24.04.1"처럼 데비안 리비전을
    // 붙인다 -- NVRM은 순수 업스트림 버전만("580.173.02") 보고하므로 그대로
    // 비교하면 항상 불일치로 오판한다.
    const result = checkNvidiaDriverMismatch(
      fakeProvider('580.173.02', [
        { name: 'nvidia-driver-580', version: '580.173.02-0ubuntu0.24.04.1' }
      ])
    )
    expect(result.matched).toBe(true)
    expect(result.warning).toBeUndefined()
  })

  it("flags a mismatch and warns when versions differ (this machine's real state)", () => {
    // 실측: NVRM 580.159.03 vs dpkg nvidia-driver-580 580.173.02.
    const result = checkNvidiaDriverMismatch(
      fakeProvider('580.159.03', [
        { name: 'nvidia-driver-550', version: '550.163.01-0ubuntu0.24.04.2' },
        { name: 'nvidia-driver-580', version: '580.173.02-0ubuntu0.24.04.1' }
      ])
    )
    expect(result.applicable).toBe(true)
    expect(result.matched).toBe(false)
    expect(result.nvrmVersion).toBe('580.159.03')
    expect(result.userspaceVersion).toBe('580.173.02-0ubuntu0.24.04.1')
    expect(result.warning).toContain('580.159.03')
    expect(result.warning).toContain('580.173.02')
    expect(result.warning).toContain('재부팅')
  })

  it('picks the userspace package whose major version matches NVRM, not just the first one', () => {
    const result = checkNvidiaDriverMismatch(
      fakeProvider('550.163.01', [
        { name: 'nvidia-driver-580', version: '580.173.02' },
        { name: 'nvidia-driver-550', version: '550.163.01' }
      ])
    )
    expect(result.matched).toBe(true)
  })

  it('warns when the kernel module is loaded but no matching dpkg package is found', () => {
    const result = checkNvidiaDriverMismatch(fakeProvider('580.159.03', []))
    expect(result.applicable).toBe(true)
    expect(result.matched).toBe(false)
    expect(result.warning).toContain('찾을 수 없습니다')
  })

  it('warns when a driver package is installed but the kernel module is not loaded', () => {
    const result = checkNvidiaDriverMismatch(
      fakeProvider(null, [{ name: 'nvidia-driver-580', version: '580.173.02' }])
    )
    expect(result.applicable).toBe(true)
    expect(result.matched).toBe(false)
    expect(result.warning).toContain('재부팅')
  })
})
