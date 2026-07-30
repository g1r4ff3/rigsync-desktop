import { diffSnapshotSlot, fetchDiffSnapshot } from './diffSnapshotStore'
import { fetchSyncItemsSnapshot, syncItemsSnapshotSlot } from './syncItemsSnapshotStore'
import type {
  DotfilesCaptureReport,
  EngineStatus,
  PackagesCaptureReport,
  ReposCaptureReportDto,
  ScheduledCaptureReportDto,
  ServicesCaptureReportDto,
  SettingsCaptureReportDto,
  ToolsCaptureReportDto
} from '../../shared/ipc'

/**
 * R6: capability 10종을 한 번에 캡처하는 공용 헬퍼(additive-only, 결정 ③) —
 * DiffView의 "capture-first" 흐름과 Candidates(SyncItemsView)의 "보류 중 변경
 * 반영" 배너 둘 다 정확히 같은 동작(전 capability capture)이 필요해서 한
 * 곳으로 뺐다.
 *
 * v0.1.20 실사고("Capture를 눌렀는데 반영된 건지 안 된 건지 알 수 없었다") 수리
 * — 이전엔 성공/실패만 반환하고 각 capture의 리포트(added/updated 수·notes)를
 * 통째로 버렸다. captureAppimage가 "update source 좌표를 찾지 못함 -- 건너뜀"
 * note를 남겨도 renderer가 그 리포트를 안 받으니 화면엔 아무 설명도 안 떴다.
 * 이제 `captureAll()`은 절대 throw하지 않고(개별 capability 실패도 삼켜 report에
 * 담는다 — Promise.all이었다면 하나만 reject해도 이미 성공한 나머지 9개의
 * added/updated/notes를 통째로 잃었다) capability별 결과를 구조화해 돌려준다.
 * 호출부(DiffView/SyncItemsView)는 이 리포트로 "반영 N건"/"반영 없음 — 사유"를
 * 그대로 보여준다(설명가능성 계약 — 스킵·실패를 숨기지 않는다).
 *
 * `commitCreated`류의 리터럴 git-commit 확인은 이 함수 경계에서 알 수 없다 —
 * manifest write(capture)는 동기지만 commit+push(`autoSyncAfterWrite`,
 * main/gitSync.ts)는 캡처 IPC 핸들러가 fire-and-forget으로 트리거해 응답을
 * 기다리지 않는다(의도된 설계 — git push를 매 Capture 클릭마다 기다리게 하지
 * 않는다). 그래서 `hasChanges`(added+updated>0)를 "곧 commit+push가 뒤따를
 * 것"의 대리 신호로 쓴다 — capture가 role='follower'에서는 항상 실패하므로
 * (안전 불변식 ⑦) hasChanges는 reference에서만 true일 수 있다.
 */

export interface CaptureCapabilitySummary {
  readonly capability: string
  /** 사람이 읽는 capability 이름 — captureCapabilityLabel(copy.ts)과 1:1. */
  readonly label: string
  readonly ok: boolean
  readonly added: number
  readonly updated: number
  /** ok=true일 때만 채워지는, 이 capability의 note 원문(항목 이름 접두어 없이). */
  readonly notes: readonly string[]
  /** ok=false일 때만 채워지는 사람이 읽는 에러 메시지. */
  readonly error?: string
}

export interface CaptureAllReport {
  readonly capabilities: readonly CaptureCapabilitySummary[]
  readonly totalAdded: number
  readonly totalUpdated: number
  /** capability 라벨을 접두어로 붙여 평탄화한 note 목록 — 화면이 그대로 나열한다. */
  readonly notes: readonly string[]
  /** totalAdded+totalUpdated > 0 — 위 파일 헤더 주석 "commitCreated" 절 참조. */
  readonly hasChanges: boolean
  readonly hasErrors: boolean
}

interface NormalizedCapture {
  readonly added: number
  readonly updated: number
  readonly notes: readonly string[]
}

function summarizeDotfiles(r: DotfilesCaptureReport): NormalizedCapture {
  const notes = [...r.notes]
  if (r.skippedSecretScan > 0) {
    notes.push(
      `비밀 스캔에 걸려 ${r.skippedSecretScan}개 항목을 건너뜀 (Doctor > Secret scan에서 확인)`
    )
  }
  return { added: r.seededNew, updated: r.copied, notes }
}

function summarizePackages(r: PackagesCaptureReport): NormalizedCapture {
  const added =
    r.apt.packagesAdded +
    r.apt.sourcesCaptured +
    r.apt.keyringsCaptured +
    r.snap.added +
    r.flatpak.addedRemotes +
    r.flatpak.addedApps
  const notes = [...r.apt.notes]
  if (r.apt.skipped) notes.push('apt 사용 불가 -- 건너뜀')
  if (r.snap.skipped) notes.push('snap 사용 불가 -- 건너뜀')
  if (r.flatpak.skipped) notes.push('flatpak 사용 불가 -- 건너뜀')
  return { added, updated: 0, notes }
}

/** appimage/fonts/binaries 셋 다 "capturedCount 총계 중 added가 신규"인 같은 shape. */
function summarizeCapturedCount(r: {
  readonly capturedCount: number
  readonly added: number
  readonly notes: readonly string[]
}): NormalizedCapture {
  return { added: r.added, updated: Math.max(0, r.capturedCount - r.added), notes: [...r.notes] }
}

function summarizeSettings(r: SettingsCaptureReportDto): NormalizedCapture {
  const notes = r.skippedEmpty.map((p) => `${p}: dump가 비어 있어 캡처하지 않음`)
  if (r.skipped) notes.push('dconf 사용 불가 -- 건너뜀')
  return { added: r.written, updated: 0, notes }
}

function summarizeServices(r: ServicesCaptureReportDto): NormalizedCapture {
  const notes = r.secretScanBlocked.map(
    (e) => `${e.name}: 비밀 스캔에 걸려 건너뜀 (${e.findings.length}건)`
  )
  return { added: r.captured, updated: 0, notes }
}

function summarizeScheduled(r: ScheduledCaptureReportDto): NormalizedCapture {
  const notes: string[] = []
  if (r.note) notes.push(r.note)
  if (r.secretScanBlocked.length > 0) {
    notes.push(
      `비밀 스캔에 걸려 crontab 전체를 건너뜀 (${r.secretScanBlocked.length}건, Doctor > Secret scan에서 확인)`
    )
  }
  return { added: r.captured ? 1 : 0, updated: 0, notes }
}

function summarizeTools(r: ToolsCaptureReportDto): NormalizedCapture {
  return { added: r.added, updated: 0, notes: r.note ? [r.note] : [] }
}

function summarizeRepos(r: ReposCaptureReportDto): NormalizedCapture {
  return {
    added: r.added,
    updated: Math.max(0, r.captured - r.added),
    notes: [...r.warnings, ...r.notes]
  }
}

/** capability 하나를 캡처하고, 성공/실패 무관하게 항상 요약을 반환한다(절대 throw하지 않는다). */
async function runCapture<T>(
  capability: string,
  label: string,
  call: () => Promise<T>,
  normalize: (report: T) => NormalizedCapture
): Promise<CaptureCapabilitySummary> {
  try {
    const report = await call()
    const { added, updated, notes } = normalize(report)
    return { capability, label, ok: true, added, updated, notes }
  } catch (err) {
    return {
      capability,
      label,
      ok: false,
      added: 0,
      updated: 0,
      notes: [],
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function buildReport(capabilities: readonly CaptureCapabilitySummary[]): CaptureAllReport {
  const totalAdded = capabilities.reduce((sum, c) => sum + c.added, 0)
  const totalUpdated = capabilities.reduce((sum, c) => sum + c.updated, 0)
  const notes = capabilities.flatMap((c) =>
    c.ok ? c.notes.map((n) => `${c.label}: ${n}`) : [`${c.label}: 캡처 실패 -- ${c.error}`]
  )
  return {
    capabilities,
    totalAdded,
    totalUpdated,
    notes,
    hasChanges: totalAdded + totalUpdated > 0,
    hasErrors: capabilities.some((c) => !c.ok)
  }
}

export async function captureAll(): Promise<CaptureAllReport> {
  const capabilities = await Promise.all([
    runCapture(
      'dotfiles',
      'dotfiles',
      () => window.api.engine.captureDotfiles({ dryRun: false }),
      summarizeDotfiles
    ),
    runCapture(
      'packages',
      'packages (apt/snap/flatpak)',
      () => window.api.engine.capturePackages({ dryRun: false }),
      summarizePackages
    ),
    runCapture(
      'appimage',
      'appimage',
      () => window.api.engine.captureAppimage({ dryRun: false }),
      summarizeCapturedCount
    ),
    runCapture(
      'fonts',
      'fonts',
      () => window.api.engine.captureFonts({ dryRun: false }),
      summarizeCapturedCount
    ),
    runCapture(
      'binaries',
      'binaries',
      () => window.api.engine.captureBinaries({ dryRun: false }),
      summarizeCapturedCount
    ),
    runCapture(
      'settings',
      'settings (dconf)',
      () => window.api.engine.captureSettings({ dryRun: false }),
      summarizeSettings
    ),
    runCapture(
      'services',
      'services (systemd --user)',
      () => window.api.engine.captureServices({ dryRun: false }),
      summarizeServices
    ),
    runCapture(
      'scheduled',
      'scheduled (cron)',
      () => window.api.engine.captureScheduled({ dryRun: false }),
      summarizeScheduled
    ),
    runCapture(
      'tools',
      'tools (nvm)',
      () => window.api.engine.captureTools({ dryRun: false }),
      summarizeTools
    ),
    runCapture(
      'repos',
      'repos (git)',
      () => window.api.engine.captureRepos({ dryRun: false }),
      summarizeRepos
    )
  ])
  return buildReport(capabilities)
}

/**
 * v0.1.20 3번: Capture 완료 시 v0.1.17 스냅샷 스토어(diff·syncItems) 둘 다
 * 강제 재검증한다 — Candidates의 "보류 중 변경" 배너·집계, Differences의
 * drift 요약이 둘 다 이 capture 한 번으로 바뀔 수 있는데, 각 스토어는 자기
 * 탭이 다시 마운트될 때만 저절로 재검증된다(snapshotSlot.ts stale-while-
 * revalidate — 탭을 벗어나 있으면 그 갱신이 다음 방문까지 미뤄진다). 호출부
 * (DiffView·SyncItemsView 둘 다)는 이미 자기 쪽 스토어를 revalidate하고 있어
 * 여기서 한 번 더 불러도 Slot이 in-flight를 병합해 안전하다 — 이 함수는
 * "capture를 시작한 화면이 아닌 쪽"의 갱신을 담당한다.
 */
export async function revalidateAfterCapture(status: EngineStatus | null): Promise<void> {
  await Promise.all([
    diffSnapshotSlot.revalidate(() => fetchDiffSnapshot(status)),
    syncItemsSnapshotSlot.revalidate(fetchSyncItemsSnapshot)
  ])
}

// 테스트 전용 export — window.api 없이 정규화·집계 로직만 단위 테스트한다
// (captureAll.test.ts).
export const __testing = {
  summarizeDotfiles,
  summarizePackages,
  summarizeCapturedCount,
  summarizeSettings,
  summarizeServices,
  summarizeScheduled,
  summarizeTools,
  summarizeRepos,
  buildReport
}
