/**
 * `embed-appimage-update-info.mjs` 유닛 테스트 — 실제 AppImage나 `readelf`
 * 바이너리 없이 순수 파싱 로직만 검증한다(P4 자동 업데이트 소스 자동화).
 * 실제 빌드 산출물에 대한 `.upd_info` 문자열 검증은 `npm run build:linux` 후
 * 수동 `readelf --string-dump=.upd_info` 확인으로 한다(이 스크립트 파일 헤더
 * 주석 참조) — `findUpdInfoSection`/`embedUpdateInfo`는 실제 ELF 섹션
 * 오프셋에 의존해 진짜 AppImage 없이는 의미 있게 테스트할 수 없으므로,
 * 여기서는 exec 호출과 분리된 순수 파서(`parseUpdInfoSection`)만 커버한다.
 */
import { describe, expect, it } from 'vitest'
import { parseUpdInfoSection } from './embed-appimage-update-info.mjs'

// `readelf --sections -W` 실측 한 줄 형식 그대로 (컬럼: [Nr] Name Type Address
// Off Size ES Flg Lk Inf Al). .upd_info는 오프셋 0x3e8(1000), 크기 0x400(1024).
const FAKE_READELF_SECTIONS_OUTPUT = `There are 30 section headers, starting at offset 0x1234:

Section Headers:
  [Nr] Name              Type            Address          Off    Size   ES Flg Lk Inf Al
  [ 0]                   NULL            0000000000000000 000000 000000 00      0   0  0
  [ 1] .note.ABI-tag     NOTE            0000000000000318 000318 000020 00   A  0   0  4
  [ 2] .upd_info         NOTE            00000000000003e8 0003e8 000400 00   A  0   0  1
  [ 3] .text             PROGBITS        0000000000001000 001000 000100 00  AX  0   0 16
`

describe('parseUpdInfoSection', () => {
  it('parses the offset and size (hex) of the .upd_info section from readelf output', () => {
    const section = parseUpdInfoSection(FAKE_READELF_SECTIONS_OUTPUT)
    expect(section).toEqual({ offset: 0x3e8, size: 0x400 })
  })

  it('returns null when the readelf output has no .upd_info section', () => {
    const section = parseUpdInfoSection('Section Headers:\n  [ 0]  NULL  0 000000 000000 00\n')
    expect(section).toBeNull()
  })

  it('returns null on a malformed/truncated section line', () => {
    const section = parseUpdInfoSection('  [ 2] .upd_info         NOTE\n')
    expect(section).toBeNull()
  })

  it('is robust to the -W (wide) column layout regardless of surrounding whitespace', () => {
    const line =
      '  [ 5] .upd_info        NOTE             0000000000010000 010000 000400 00   A  0   0  1\n'
    const section = parseUpdInfoSection(`Section Headers:\n${line}`)
    expect(section).toEqual({ offset: 0x10000, size: 0x400 })
  })
})
