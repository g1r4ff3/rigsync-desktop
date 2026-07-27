/**
 * Diff 탭의 스냅샷 스토어 배선 — snapshotSlot.ts 참조(4단계 전체 배경).
 * 옛 DiffView는 마운트 useEffect와 `refreshDiff()`가 정확히 같은
 * `Promise.all([diff열개…])` 블록을 두 벌 들고 있었다(코드 중복이자,
 * 탭을 벗어났다 돌아올 때마다 그 열두 개 IPC를 처음부터 다시 기다리는
 * 원인) — 이 모듈로 하나만 남긴다.
 */
import type {
  AppimageDiffReportDto,
  BinariesDiffReportDto,
  DotfilesDiffReport,
  DuplicateWarningDto,
  EngineStatus,
  FontsDiffReportDto,
  PackagesDiffReport,
  ReclassificationEventDto,
  ReposDiffReportDto,
  ScheduledDiffReportDto,
  ServicesDiffReportDto,
  SettingsDiffReportDto,
  ToolsDiffReportDto
} from '../../shared/ipc'
import { Slot, useSlot, type SlotSnapshot } from './snapshotSlot'

export interface DiffSnapshot {
  readonly dotfiles: DotfilesDiffReport
  readonly packages: PackagesDiffReport
  readonly appimage: AppimageDiffReportDto
  readonly fonts: FontsDiffReportDto
  readonly binaries: BinariesDiffReportDto
  readonly settings: SettingsDiffReportDto
  readonly services: ServicesDiffReportDto
  readonly scheduled: ScheduledDiffReportDto
  readonly tools: ToolsDiffReportDto
  readonly repos: ReposDiffReportDto
  readonly duplicates: readonly DuplicateWarningDto[]
  readonly reclassifications: readonly ReclassificationEventDto[]
}

export const diffSnapshotSlot = new Slot<DiffSnapshot>()

/**
 * 실제 조회 — DiffView 마운트·수동 새로고침·capture/apply 후 재조회가 전부
 * 이 함수 하나로 모인다. follower presync(role이면 diff 전에 syncNow로
 * fetch+ff-pull 시도, 실패해도 로컬 기준으로 계속 진행)도 여기 포함 —
 * 기존 DiffView 동작 그대로 옮겼다.
 */
export async function fetchDiffSnapshot(status: EngineStatus | null): Promise<DiffSnapshot> {
  if (status?.role === 'follower') {
    await window.api.engine.syncNow().catch(() => {})
  }
  const [
    dotfiles,
    packages,
    appimage,
    fonts,
    binaries,
    settings,
    services,
    scheduled,
    tools,
    repos,
    duplicates,
    reclassifications
  ] = await Promise.all([
    window.api.engine.diffDotfiles(),
    window.api.engine.diffPackages(),
    window.api.engine.diffAppimage(),
    window.api.engine.diffFonts(),
    window.api.engine.diffBinaries(),
    window.api.engine.diffSettings(),
    window.api.engine.diffServices(),
    window.api.engine.diffScheduled(),
    window.api.engine.diffTools(),
    window.api.engine.diffRepos(),
    window.api.engine.detectDuplicates(),
    window.api.engine.detectReclassifications()
  ])
  return {
    dotfiles,
    packages,
    appimage,
    fonts,
    binaries,
    settings,
    services,
    scheduled,
    tools,
    repos,
    duplicates,
    reclassifications
  }
}

export function useDiffSnapshot(): SlotSnapshot<DiffSnapshot> {
  return useSlot(diffSnapshotSlot)
}
