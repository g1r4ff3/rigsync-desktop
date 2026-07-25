import { describe, expect, it } from 'vitest'
import { gearleverConfigHash, parseIni } from './ini'

// 픽스처는 이 세션에서 이 머신의 실제 gearlever.conf를 읽어 그대로 옮긴
// 것이다(§7 실측 — tev가 Gear Lever로 통합돼 있음, desktop_id "tev.desktop",
// GithubUpdater Tom94/tev). 코드 복사가 아니라 설정 파일 내용 자체를 픽스처로
// 쓴 것 — 파싱 대상 데이터.
const REAL_GEARLEVER_CONF = `[DEFAULT]
fetch-updates-in-background = no

[app.b796ed608df8a3736610d7d3c8aec1d8.update_manager]

[app.aae71db24081f179f284b8b98f395297]
default_exec_arguments = %F
name = tev
file_path = /home/cglab/AppImages/tev.appimage

[app.aae71db24081f179f284b8b98f395297.update_manager]
repo = Tom94/tev
repo_filename = tev.appimage
allow_prereleases = False
manager = GithubUpdater
`

describe('parseIni', () => {
  it('parses the real gearlever.conf fixture into sections/keys', () => {
    const doc = parseIni(REAL_GEARLEVER_CONF)
    expect(doc['DEFAULT']['fetch-updates-in-background']).toBe('no')
    expect(doc['app.aae71db24081f179f284b8b98f395297'].name).toBe('tev')
    expect(doc['app.aae71db24081f179f284b8b98f395297'].file_path).toBe(
      '/home/cglab/AppImages/tev.appimage'
    )
    const um = doc['app.aae71db24081f179f284b8b98f395297.update_manager']
    expect(um.repo).toBe('Tom94/tev')
    expect(um.repo_filename).toBe('tev.appimage')
    expect(um.manager).toBe('GithubUpdater')
    expect(um.allow_prereleases).toBe('False')
  })

  it('keeps an empty section present with no keys (real fixture has one)', () => {
    const doc = parseIni(REAL_GEARLEVER_CONF)
    expect(doc['app.b796ed608df8a3736610d7d3c8aec1d8.update_manager']).toEqual({})
  })
})

describe('gearleverConfigHash', () => {
  it('matches the real section hash for tev.appimage (md5 of the absolute path)', () => {
    // 이 머신에서 실제로 확인된 값 -- python3 -c "hashlib.md5(path.encode()).hexdigest()"
    expect(gearleverConfigHash('/home/cglab/AppImages/tev.appimage')).toBe(
      'aae71db24081f179f284b8b98f395297'
    )
  })
})
