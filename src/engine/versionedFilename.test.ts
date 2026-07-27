import { describe, expect, it } from 'vitest'
import { isVersionedFilename } from './versionedFilename'

describe('isVersionedFilename', () => {
  it('matches filenames with a hyphen followed by a dotted version number', () => {
    expect(isVersionedFilename('JetBrainsMono-2.304.ttf')).toBe(true)
    expect(isVersionedFilename('uv-0.5.1-x86_64.tar.gz')).toBe(true)
    expect(isVersionedFilename('some-tool-1.2.3')).toBe(true)
  })

  it('requires a digit immediately after the hyphen -- a "Ver" prefix does not count', () => {
    // 스펙 명시 패턴(`-\d+\.\d+`) 그대로: 하이픈 바로 뒤에 숫자가 와야 한다.
    // "-Ver1.3.2"는 하이픈 다음이 문자라 매칭되지 않는다(보수적 범위 유지).
    expect(isVersionedFilename('D2Coding-Ver1.3.2-20180524.ttf')).toBe(false)
  })

  it('does not match plain filenames without a versioned suffix', () => {
    expect(isVersionedFilename('SomeRandomFont.ttf')).toBe(false)
    expect(isVersionedFilename('uv')).toBe(false)
    expect(isVersionedFilename('micromamba')).toBe(false)
    expect(isVersionedFilename('sync-claude-to-opencode.sh')).toBe(false)
  })

  it('does not match a hyphenated integer without a decimal point (boundary)', () => {
    expect(isVersionedFilename('tool-2')).toBe(false)
    expect(isVersionedFilename('MesloLGS NF Regular.ttf')).toBe(false)
  })
})
