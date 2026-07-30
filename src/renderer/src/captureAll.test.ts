import { describe, expect, it } from 'vitest'
import { __testing } from './captureAll'
import type {
  DotfilesCaptureReport,
  PackagesCaptureReport,
  ReposCaptureReportDto,
  ScheduledCaptureReportDto,
  SecretFindingDto,
  ServicesCaptureReportDto,
  SettingsCaptureReportDto,
  ToolsCaptureReportDto
} from '../../shared/ipc'

const fakeFinding: SecretFindingDto = {
  path: '~/.config/foo',
  line: 1,
  kind: 'aws-access-key',
  confidence: 'high',
  label: 'AWS access key',
  maskedExcerpt: 'AKIA****'
}

/**
 * v0.1.20 1번 — captureAll()의 정규화·집계 로직(순수 함수) 단위 테스트.
 * window.api가 없는 node 환경에서 __testing export만 검증한다(captureAll.ts
 * 파일 헤더 주석이 이 테스트 파일을 이미 전제하고 있었다).
 */

const {
  summarizeDotfiles,
  summarizePackages,
  summarizeCapturedCount,
  summarizeSettings,
  summarizeServices,
  summarizeScheduled,
  summarizeTools,
  summarizeRepos,
  buildReport
} = __testing

describe('summarizeDotfiles', () => {
  it('seededNew를 added, copied를 updated로 매핑한다', () => {
    const report: DotfilesCaptureReport = {
      capability: 'dotfiles',
      seededNew: 2,
      copied: 5,
      alreadyLinked: 0,
      skippedDenylist: 0,
      missingHome: 0,
      skippedBrokenSymlink: 0,
      skippedInvalidStore: 0,
      ignored: 0,
      skippedSecretScan: 0,
      secretScanBlocked: [],
      notes: ['기존 note']
    }
    expect(summarizeDotfiles(report)).toEqual({ added: 2, updated: 5, notes: ['기존 note'] })
  })

  it('skippedSecretScan > 0이면 note를 덧붙인다 — 비밀 스캔 스킵을 숨기지 않는다', () => {
    const report: DotfilesCaptureReport = {
      capability: 'dotfiles',
      seededNew: 0,
      copied: 0,
      alreadyLinked: 0,
      skippedDenylist: 0,
      missingHome: 0,
      skippedBrokenSymlink: 0,
      skippedInvalidStore: 0,
      ignored: 0,
      skippedSecretScan: 3,
      secretScanBlocked: [],
      notes: []
    }
    const result = summarizeDotfiles(report)
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]).toContain('3개')
  })
})

describe('summarizePackages', () => {
  it('apt/snap/flatpak added를 전부 합산하고 updated는 0(제자리 갱신 개념이 없다)', () => {
    const report: PackagesCaptureReport = {
      capability: 'packages',
      apt: {
        skipped: false,
        manualInstalled: 0,
        packagesInManifest: 0,
        packagesAdded: 1,
        sourcesCaptured: 2,
        keyringsCaptured: 1,
        notes: []
      },
      snap: { skipped: false, captured: 0, added: 3 },
      flatpak: { skipped: false, remotes: 0, apps: 0, addedRemotes: 1, addedApps: 2 }
    }
    expect(summarizePackages(report)).toEqual({
      added: 1 + 2 + 1 + 3 + 1 + 2,
      updated: 0,
      notes: []
    })
  })

  it('skipped된 하위 provider마다 note를 남긴다 — 조용히 넘어가지 않는다', () => {
    const report: PackagesCaptureReport = {
      capability: 'packages',
      apt: {
        skipped: true,
        manualInstalled: 0,
        packagesInManifest: 0,
        packagesAdded: 0,
        sourcesCaptured: 0,
        keyringsCaptured: 0,
        notes: []
      },
      snap: { skipped: true, captured: 0, added: 0 },
      flatpak: { skipped: true, remotes: 0, apps: 0, addedRemotes: 0, addedApps: 0 }
    }
    const { notes } = summarizePackages(report)
    expect(notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('apt'),
        expect.stringContaining('snap'),
        expect.stringContaining('flatpak')
      ])
    )
  })
})

describe('summarizeCapturedCount', () => {
  it('appimage/fonts/binaries 공용 shape: updated = capturedCount - added (음수 방지)', () => {
    expect(summarizeCapturedCount({ capturedCount: 10, added: 3, notes: [] })).toEqual({
      added: 3,
      updated: 7,
      notes: []
    })
  })

  it('capturedCount < added인 방어적 입력에도 updated는 0 밑으로 내려가지 않는다', () => {
    expect(summarizeCapturedCount({ capturedCount: 1, added: 5, notes: [] })).toEqual({
      added: 5,
      updated: 0,
      notes: []
    })
  })

  it('note를 그대로 보존한다 — captureAppimage의 "-- 건너뜀" note가 여기로 흘러온다', () => {
    const notes = ['orphan.desktop: gearlever.conf에서 update source 좌표를 찾지 못함 -- 건너뜀']
    expect(summarizeCapturedCount({ capturedCount: 0, added: 0, notes }).notes).toEqual(notes)
  })
})

describe('summarizeSettings', () => {
  it('written을 added로 매핑하고 skippedEmpty 각각을 note로 편다', () => {
    const report: SettingsCaptureReportDto = {
      skipped: false,
      written: 2,
      skippedEmpty: ['/org/gnome/foo']
    }
    const result = summarizeSettings(report)
    expect(result).toMatchObject({ added: 2, updated: 0 })
    expect(result.notes[0]).toContain('/org/gnome/foo')
  })

  it('skipped=true면 note를 덧붙인다', () => {
    const report: SettingsCaptureReportDto = { skipped: true, written: 0, skippedEmpty: [] }
    expect(summarizeSettings(report).notes).toEqual(['dconf 사용 불가 -- 건너뜀'])
  })
})

describe('summarizeServices', () => {
  it('captured를 added로, secretScanBlocked 각 항목을 findings 건수와 함께 note로 편다', () => {
    const report: ServicesCaptureReportDto = {
      captured: 4,
      skippedSecretScan: 1,
      secretScanBlocked: [{ name: 'my.service', findings: [fakeFinding] }]
    }
    const result = summarizeServices(report)
    expect(result.added).toBe(4)
    expect(result.notes[0]).toContain('my.service')
    expect(result.notes[0]).toContain('1건')
  })
})

describe('summarizeScheduled', () => {
  it('captured=true면 added=1, note가 있으면 그대로 편다', () => {
    const report: ScheduledCaptureReportDto = {
      skipped: false,
      captured: true,
      lines: 5,
      note: '기존 crontab 없음',
      secretScanBlocked: []
    }
    const result = summarizeScheduled(report)
    expect(result.added).toBe(1)
    expect(result.notes).toEqual(['기존 crontab 없음'])
  })

  it('secretScanBlocked가 있으면 전체 스킵 note를 덧붙인다', () => {
    const report: ScheduledCaptureReportDto = {
      skipped: false,
      captured: false,
      lines: 0,
      secretScanBlocked: [fakeFinding]
    }
    const result = summarizeScheduled(report)
    expect(result.added).toBe(0)
    expect(result.notes[0]).toContain('crontab 전체를 건너뜀')
  })
})

describe('summarizeTools', () => {
  it('added와 note(있으면)를 그대로 옮긴다', () => {
    const report: ToolsCaptureReportDto = {
      skipped: false,
      packagesInManifest: 0,
      added: 1,
      nodeVersion: '20.0.0',
      note: 'nvm 없음'
    }
    expect(summarizeTools(report)).toEqual({ added: 1, updated: 0, notes: ['nvm 없음'] })
  })
})

describe('summarizeRepos', () => {
  it('added는 그대로, updated = captured - added, warnings+notes를 합쳐 편다', () => {
    const report: ReposCaptureReportDto = {
      found: 5,
      captured: 5,
      added: 2,
      warnings: ['경고1'],
      notes: ['노트1']
    }
    expect(summarizeRepos(report)).toEqual({
      added: 2,
      updated: 3,
      notes: ['경고1', '노트1']
    })
  })
})

describe('buildReport', () => {
  it('전부 성공·변경 있음 -> hasChanges=true, hasErrors=false, notes에 라벨 접두어가 붙는다', () => {
    const report = buildReport([
      { capability: 'dotfiles', label: 'dotfiles', ok: true, added: 2, updated: 1, notes: ['ok'] }
    ])
    expect(report.totalAdded).toBe(2)
    expect(report.totalUpdated).toBe(1)
    expect(report.hasChanges).toBe(true)
    expect(report.hasErrors).toBe(false)
    expect(report.notes).toEqual(['dotfiles: ok'])
  })

  it('변경도 실패도 없으면 hasChanges=false — "반영된 변경 없음" 분기의 근거', () => {
    const report = buildReport([
      { capability: 'appimage', label: 'appimage', ok: true, added: 0, updated: 0, notes: [] }
    ])
    expect(report.hasChanges).toBe(false)
    expect(report.hasErrors).toBe(false)
    expect(report.notes).toEqual([])
  })

  it('하나라도 실패하면 hasErrors=true고, 실패 note가 라벨과 함께 나온다 — 실패를 숨기지 않는다', () => {
    const report = buildReport([
      { capability: 'dotfiles', label: 'dotfiles', ok: true, added: 1, updated: 0, notes: [] },
      {
        capability: 'packages',
        label: 'packages (apt/snap/flatpak)',
        ok: false,
        added: 0,
        updated: 0,
        notes: [],
        error: 'ECONNREFUSED'
      }
    ])
    expect(report.hasErrors).toBe(true)
    // 성공한 capability의 added는 실패와 무관하게 그대로 집계된다(Promise.all이
    // 아니라 개별 runCapture라 하나의 실패가 나머지 성공분을 지우지 않는다).
    expect(report.totalAdded).toBe(1)
    expect(report.notes).toEqual(['packages (apt/snap/flatpak): 캡처 실패 -- ECONNREFUSED'])
  })
})
