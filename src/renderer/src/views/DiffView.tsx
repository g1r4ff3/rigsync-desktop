import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { ViewToolbar } from '@/components/ViewToolbar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  applyProgressCopy,
  buttonCopy,
  diffSummaryCopy,
  dotfilesStateCopy,
  dotfilesToLinkExplainCopy,
  emptyStateCopy,
  helpCopy,
  recaptureActionCopy,
  sectionCopy
} from '../copy'
import { captureAll, revalidateAfterCapture, type CaptureAllReport } from '../captureAll'
import { CaptureReportSummary } from '@/components/CaptureReportSummary'
import { diffSnapshotSlot, fetchDiffSnapshot, useDiffSnapshot } from '../diffSnapshotStore'
import { SCREENSHOT_GOTO_EVENT } from '../screenshotBus'
import { StatusIcon, StatusText } from '../status'
import { planActionStatusKind, type StatusKind } from '../statusKind'
import type {
  ApplyResponse,
  AppimageDiffReportDto,
  BinariesDiffReportDto,
  DotfilesDiffReport,
  EngineStatus,
  FontsDiffReportDto,
  PackagesDiffReport,
  PlanActionResultDto,
  PlanEvent,
  ReposDiffReportDto,
  ScheduledDiffReportDto,
  ServicesDiffReportDto,
  SettingsDiffReportDto,
  ToolsDiffReportDto
} from '../../../shared/ipc'

type RowLiveState = { running?: boolean; ok?: boolean; error?: string }

function statusLabel(
  index: number,
  preview: ApplyResponse | null,
  finalResults: readonly PlanActionResultDto[] | null,
  live: Record<number, RowLiveState>
): string {
  if (finalResults) return finalResults[index]?.status ?? '?'
  if (live[index]?.running) return 'running'
  return preview?.results[index]?.status ?? '?'
}

function hasDotfilesDrift(dotfiles: DotfilesDiffReport | null): boolean {
  if (!dotfiles) return false
  // R5: missingHome이 빠져 있으면 홈에서 파일이 통째로 사라진 경우가 "기준과
  // 일치"로 잘못 보고된다 — 나머지 세 상태와 동급으로 합산한다(renderer 전용
  // 수정, engine의 DiffReport 필드는 그대로).
  return (
    dotfiles.toLink.length > 0 ||
    dotfiles.contentChanged.length > 0 ||
    dotfiles.missingHome.length > 0 ||
    dotfiles.invalidStore.length > 0
  )
}

// snap은 P2c에서 동기화 plan/apply 대상에서 빠졌다(정책 §7 비목표) — diff는
// 여전히 계산되지만(중복 검출용) 이 액션 지향 화면에는 안 보여준다. snap
// 상태는 "항목" 화면에 detectionOnly로 나온다.
function hasPackagesDrift(packages: PackagesDiffReport | null): boolean {
  if (!packages) return false
  return (
    packages.apt.toInstall.length > 0 ||
    packages.apt.sourcesMissing.length > 0 ||
    packages.apt.sourcesContentChanged.length > 0 ||
    packages.flatpak.toAddRemotes.length > 0 ||
    packages.flatpak.toInstall.length > 0
  )
}

function hasAppimageDrift(appimage: AppimageDiffReportDto | null): boolean {
  if (!appimage) return false
  return appimage.toInstall.length > 0 || appimage.pinMismatch.length > 0
}

function hasFontsDrift(fonts: FontsDiffReportDto | null): boolean {
  if (!fonts) return false
  return fonts.toInstall.length > 0 || fonts.pinMismatch.length > 0
}

function hasBinariesDrift(binaries: BinariesDiffReportDto | null): boolean {
  if (!binaries) return false
  return binaries.toInstall.length > 0 || binaries.pinMismatch.length > 0
}

function hasSettingsDrift(settings: SettingsDiffReportDto | null): boolean {
  return !!settings && settings.contentChanged.length > 0
}

function hasServicesDrift(services: ServicesDiffReportDto | null): boolean {
  if (!services) return false
  return (
    services.missing.length > 0 ||
    services.contentChanged.length > 0 ||
    services.enabledMismatch.length > 0
  )
}

function hasScheduledDrift(scheduled: ScheduledDiffReportDto | null): boolean {
  return !!scheduled && scheduled.contentChanged
}

function hasToolsDrift(tools: ToolsDiffReportDto | null): boolean {
  if (!tools) return false
  return tools.toInstall.length > 0 || tools.nodeToInstall !== null
}

function hasReposDrift(repos: ReposDiffReportDto | null): boolean {
  if (!repos) return false
  return repos.toClone.length > 0 || repos.manualNoUrl.length > 0
}

/** 화면 전체가 이 하나의 섹션 틀을 공유한다 — 제목·한 줄 설명·로딩/빈/목록 3단 상태. */
function DriftSection({
  title,
  description,
  loading,
  empty,
  matchedLabel = '기준과 일치',
  children
}: {
  readonly title: string
  readonly description: string
  readonly loading: boolean
  readonly empty: boolean
  /** R5: reference 화면에서는 "기준과 일치"가 자기지시적이라 어색해 role별로 바꿔 넣는다. */
  readonly matchedLabel?: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-5 first:mt-0">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mb-1.5 text-xs text-muted-foreground">{description}</p>
      {loading ? (
        // UI 정돈(v0.1.16): "불러오는 중…" 텍스트 한 줄 대신 곧 나타날 행
        // 모양을 암시하는 스켈레톤 두 줄 — v0.1.15 워커 분리 후 큐잉으로 이
        // 상태가 눈에 띄게 길어질 수 있어(실측: 이 화면 8개 capability 각각이
        // 수 초씩) 빈 텍스트보다 레이아웃 예고가 체감 대기를 줄인다.
        <div className="space-y-1.5 py-0.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      ) : empty ? (
        <StatusText kind="ok">{matchedLabel}</StatusText>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </section>
  )
}

function DriftRow({
  kind,
  children
}: {
  readonly kind: StatusKind
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex items-center gap-1.5 font-mono text-xs">
      <StatusIcon kind={kind} />
      <span
        className={
          kind === 'error'
            ? 'text-status-error'
            : kind === 'warn'
              ? 'text-status-warn'
              : 'text-muted-foreground'
        }
      >
        {children}
      </span>
    </li>
  )
}

/**
 * R5: 문장에 가까운 긴 행 전용(dotfiles + UI 정돈에서 합류한 Duplicates·
 * Reclassifications) — DriftRow와 달리 전체를 monospace로 묶지 않는다
 * ("경로·명령 자체는 monospace 원문 유지"라는 계약에 맞춰, 사람이 읽는 설명은
 * 보통 글꼴로, 식별자만 별도 <span className="font-mono">로 감싼다 — 호출부
 * 책임). 짧은 태그류(`[apt to-install]` 등)는 여전히 DriftRow를 쓴다 — 이름과
 * 달리 이제 dotfiles 전용은 아니다.
 */
function DotfilesDriftRow({
  kind,
  action,
  children
}: {
  readonly kind: StatusKind
  /** WS3("창고 모델" 등록): 행 끝에 붙는 단건 액션(예: "다시 캡처") — 없으면 기존과 동일. */
  readonly action?: React.ReactNode
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <StatusIcon kind={kind} className="mt-0.5" />
      <span
        className={
          kind === 'error'
            ? 'text-status-error flex-1'
            : kind === 'warn'
              ? 'text-status-warn flex-1'
              : 'text-muted-foreground flex-1'
        }
      >
        {children}
      </span>
      {action}
    </li>
  )
}

interface DiffViewProps {
  readonly status: EngineStatus | null
}

function DiffView({ status }: DiffViewProps): React.JSX.Element {
  // 4단계(스냅샷 스토어): 탭 전환 체감 0ms — 앱 수준 스토어(diffSnapshotStore.ts)
  // 구독으로 바꿨다. 이전 데이터가 있으면 재마운트(=탭 재방문) 즉시 그대로
  // 렌더되고, 백그라운드에서 조용히 재검증된다(stale-while-revalidate).
  // 아래 12개 상수는 옛 개별 useState와 같은 이름 그대로 유지해 이후 렌더
  // 로직(hasXDrift 등)을 건드리지 않는다.
  const diffSnapshot = useDiffSnapshot()
  const snapshotData = diffSnapshot.data
  const dotfilesDiff = snapshotData?.dotfiles ?? null
  const packagesDiff = snapshotData?.packages ?? null
  const appimageDiff = snapshotData?.appimage ?? null
  const fontsDiff = snapshotData?.fonts ?? null
  const binariesDiff = snapshotData?.binaries ?? null
  const settingsDiff = snapshotData?.settings ?? null
  const servicesDiff = snapshotData?.services ?? null
  const scheduledDiff = snapshotData?.scheduled ?? null
  const toolsDiff = snapshotData?.tools ?? null
  const reposDiff = snapshotData?.repos ?? null
  const duplicates = snapshotData?.duplicates ?? []
  const reclassifications = snapshotData?.reclassifications ?? []
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // v0.1.20 1번: 마지막 Capture 결과 — 다음 Capture 시작 시 비운다(핸들러의
  // setCaptureReport(null)).
  const [captureReport, setCaptureReport] = useState<CaptureAllReport | null>(null)
  // WS3("창고 모델" 등록): dotfiles 드리프트 행의 "다시 캡처"(재등록, upsert)
  // 전용 busy 상태 — Apply·Capture 버튼과 독립된 컨트롤이라 별도로 둔다.
  const [pendingRecaptureKeys, setPendingRecaptureKeys] = useState<Record<string, boolean>>({})

  const [preview, setPreview] = useState<ApplyResponse | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [live, setLive] = useState<Record<number, RowLiveState>>({})
  const [finalResults, setFinalResults] = useState<readonly PlanActionResultDto[] | null>(null)
  const [applying, setApplying] = useState(false)
  // R1: 항목별 로그 펼침 상태 — 사용자가 명시적으로 토글한 것만 여기 기록하고,
  // 나머지는 렌더 시점의 상태(실패면 기본 펼침)를 그대로 따른다(아래
  // rowExpanded). openApplyPreview에서 다이얼로그를 새로 열 때 리셋한다.
  const [expandedOverride, setExpandedOverride] = useState<Record<number, boolean>>({})

  // R5: reference는 그 자체가 기준이라 "기준과 다른 점" 프레이밍이 성립하지
  // 않는다 — role에 따라 요약 문구 전체를 갈아 끼운다(copy.ts diffSummaryCopy).
  const isReference = status?.role === 'reference'
  const summary = isReference ? diffSummaryCopy.reference : diffSummaryCopy.follower

  // 4단계: 스토어의 revalidate 하나로 "마운트 시 최신화"와 "수동/변조 후
  // 재조회"를 통일했다(옛 코드는 이 둘이 각각 별도 Promise.all 블록이었다).
  // Slot이 이미 in-flight를 병합하므로 중복 호출은 안전하다.
  async function refreshDiff(): Promise<void> {
    await diffSnapshotSlot.revalidate(() => fetchDiffSnapshot(status))
  }

  // WS3("창고 모델" 등록): 드리프트 행의 "다시 캡처" — 홈의 현재 내용을
  // 스토어로 다시 복사한다(registry.ts `registerDotfileEntry`, upsert). 어느
  // 머신에서든 실행 가능하다(배치 A로 follower도 git 저작 경로를 갖췄다 —
  // role 가드 없음). `contentChanged` 문자열은 권한만 다르면
  // "<home> (mode a != b)" 형태라(engine diff.ts) 접미사를 떼고 home만 쓴다.
  async function recaptureDotfile(driftEntry: string): Promise<void> {
    const home = driftEntry.split(' (mode ')[0]
    setPendingRecaptureKeys((prev) => ({ ...prev, [home]: true }))
    setError(null)
    try {
      const response = await window.api.engine.registerEntry({ capability: 'dotfiles', key: home })
      if (response.sync.kind === 'error') {
        setError(`${recaptureActionCopy.pushFailedPrefix}${response.sync.message}`)
      }
      await refreshDiff()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingRecaptureKeys((prev) => ({ ...prev, [home]: false }))
    }
  }

  useEffect(() => {
    // P4: follower는 diff 전에 fetch+ff-pull을 먼저 시도한다(fetchDiffSnapshot
    // 내부 -- role로 가른다). status가 null -> 실제 EngineStatus로 바뀌는 순간
    // follower 여부를 다시 반영해 한 번 더 부른다(마운트 시 status가 아직
    // 로딩 중일 수 있어서) -- 스토어가 in-flight를 병합하므로 안전하다.
    diffSnapshotSlot
      .revalidate(() => fetchDiffSnapshot(status))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [status])

  const hasDrift = useMemo(() => {
    return (
      hasDotfilesDrift(dotfilesDiff) ||
      hasPackagesDrift(packagesDiff) ||
      hasAppimageDrift(appimageDiff) ||
      hasFontsDrift(fontsDiff) ||
      hasBinariesDrift(binariesDiff) ||
      hasSettingsDrift(settingsDiff) ||
      hasServicesDrift(servicesDiff) ||
      hasScheduledDrift(scheduledDiff) ||
      hasToolsDrift(toolsDiff) ||
      hasReposDrift(reposDiff)
    )
  }, [
    dotfilesDiff,
    packagesDiff,
    appimageDiff,
    fontsDiff,
    binariesDiff,
    settingsDiff,
    servicesDiff,
    scheduledDiff,
    toolsDiff,
    reposDiff
  ])

  // R1b: "3초 안에 이 머신이 기준과 다른가"를 화면 맨 위 요약으로 보여주기
  // 위한 capability별 건수. hasXDrift(boolean)와 같은 필드를 세되, 로딩 중엔
  // null로 구분해 요약 카드가 "불러오는 중"과 "0건(일치)"을 갈라 보여준다.
  const driftCounts = useMemo(
    () =>
      [
        {
          key: 'dotfiles',
          label: 'Dotfiles',
          count: dotfilesDiff
            ? dotfilesDiff.toLink.length +
              dotfilesDiff.contentChanged.length +
              dotfilesDiff.missingHome.length +
              dotfilesDiff.invalidStore.length
            : null
        },
        {
          key: 'packages',
          label: 'Packages',
          count: packagesDiff
            ? packagesDiff.apt.toInstall.length +
              packagesDiff.apt.sourcesMissing.length +
              packagesDiff.apt.sourcesContentChanged.length +
              packagesDiff.flatpak.toAddRemotes.length +
              packagesDiff.flatpak.toInstall.length
            : null
        },
        {
          key: 'appimage',
          label: 'AppImage',
          count: appimageDiff
            ? appimageDiff.toInstall.length + appimageDiff.pinMismatch.length
            : null
        },
        {
          key: 'fonts',
          label: 'Fonts',
          count: fontsDiff ? fontsDiff.toInstall.length + fontsDiff.pinMismatch.length : null
        },
        {
          key: 'binaries',
          label: 'Binaries',
          count: binariesDiff
            ? binariesDiff.toInstall.length + binariesDiff.pinMismatch.length
            : null
        },
        {
          key: 'settings',
          label: 'Settings',
          count: settingsDiff ? settingsDiff.contentChanged.length : null
        },
        {
          key: 'services',
          label: 'Services',
          count: servicesDiff
            ? servicesDiff.missing.length +
              servicesDiff.contentChanged.length +
              servicesDiff.enabledMismatch.length
            : null
        },
        {
          key: 'scheduled',
          label: 'Scheduled',
          count: scheduledDiff
            ? scheduledDiff.lineDiff.added.length + scheduledDiff.lineDiff.removed.length
            : null
        },
        {
          key: 'tools',
          label: 'Tools',
          count: toolsDiff ? toolsDiff.toInstall.length + (toolsDiff.nodeToInstall ? 1 : 0) : null
        },
        {
          key: 'repos',
          label: 'Repos',
          count: reposDiff ? reposDiff.toClone.length + reposDiff.manualNoUrl.length : null
        }
      ] as const,
    [
      dotfilesDiff,
      packagesDiff,
      appimageDiff,
      fontsDiff,
      binariesDiff,
      settingsDiff,
      servicesDiff,
      scheduledDiff,
      toolsDiff,
      reposDiff
    ]
  )
  const totalDrift = driftCounts.every((c) => c.count !== null)
    ? driftCounts.reduce((sum, c) => sum + (c.count ?? 0), 0)
    : null
  const activeDuplicateCount = duplicates.filter((d) => !d.ignored).length
  // 확인 결과: totalDrift는 driftCounts(8개 capability)만 합산하고 Duplicates·
  // Reclassifications는 애초에 이 배열에 없어 수치에는 안 섞인다. 다만 요약
  // 카드 안에서 나란히 보이면 "N건에 Duplicates도 포함"으로 오독할 수 있어
  // (안전 불변식 ⑤: 중복은 보고만, Apply로 안 고쳐진다) 아래 캡션으로 명시한다.
  const hasReportOnlyWarnings = activeDuplicateCount > 0 || reclassifications.length > 0

  // R4-2 #5: capability 8개를 전부 펼치면(각 ~145px) 전부 "일치"인 화면도
  // 스크롤이 생겨 계약("머신 상태가 스크롤 없이 한 화면에")을 못 지킨다.
  // drift 있는 것만 아래에서 DriftSection으로 펼치고, 일치하는 것들은 여기
  // 한 데 모아 컴팩트 그리드 한 줄씩으로 접는다. 위 요약 카드의 칩(아이콘+
  // 라벨만)과 정보가 겹치지 않도록 여기는 각 capability의 설명(sectionCopy)을
  // 덧붙여 "무엇을 추적하는지"까지 보여준다 — 로딩 중(diff===null)인 항목은
  // 아직 판정이 안 났으므로 포함하지 않는다(로딩 상태는 아래 DriftSection이
  // 계속 담당).
  const matchedCapabilities = useMemo(() => {
    const list: { key: string; title: string; description: string }[] = []
    if (dotfilesDiff && !hasDotfilesDrift(dotfilesDiff)) {
      list.push({ key: 'dotfiles', title: 'Dotfiles', description: sectionCopy.dotfiles })
    }
    if (packagesDiff && !hasPackagesDrift(packagesDiff)) {
      list.push({ key: 'packages', title: 'Packages', description: sectionCopy.packages })
    }
    if (appimageDiff && !hasAppimageDrift(appimageDiff)) {
      list.push({ key: 'appimage', title: 'AppImage', description: sectionCopy.appimage })
    }
    if (fontsDiff && !hasFontsDrift(fontsDiff)) {
      list.push({ key: 'fonts', title: 'Fonts', description: sectionCopy.fonts })
    }
    if (binariesDiff && !hasBinariesDrift(binariesDiff)) {
      list.push({ key: 'binaries', title: 'Binaries', description: sectionCopy.binaries })
    }
    if (settingsDiff && !hasSettingsDrift(settingsDiff)) {
      list.push({ key: 'settings', title: 'Settings (dconf)', description: sectionCopy.settings })
    }
    if (servicesDiff && !hasServicesDrift(servicesDiff)) {
      list.push({
        key: 'services',
        title: 'Services (systemd --user)',
        description: sectionCopy.services
      })
    }
    if (scheduledDiff && !hasScheduledDrift(scheduledDiff)) {
      list.push({ key: 'scheduled', title: 'Scheduled (cron)', description: sectionCopy.scheduled })
    }
    if (toolsDiff && !hasToolsDrift(toolsDiff)) {
      list.push({ key: 'tools', title: 'Tools (nvm/node/npm)', description: sectionCopy.tools })
    }
    if (reposDiff && !hasReposDrift(reposDiff)) {
      list.push({ key: 'repos', title: 'Repos (git)', description: sectionCopy.repos })
    }
    return list
  }, [
    dotfilesDiff,
    packagesDiff,
    appimageDiff,
    fontsDiff,
    binariesDiff,
    settingsDiff,
    servicesDiff,
    scheduledDiff,
    toolsDiff,
    reposDiff
  ])

  // capture-first: 전 capability를 한 번에 캡처한다 (결정 ③ — additive-only).
  // R6: 실제 IPC 호출 목록은 captureAll()(renderer 공용 헬퍼)로 뺐다 —
  // Candidates 화면의 "보류 중 변경 반영" 배너도 정확히 같은 동작이 필요하다.
  // v0.1.20 1번: captureAll()이 이제 구조화된 리포트를 돌려준다(더 이상
  // throw하지 않는다) — 화면 아래 CaptureReportSummary로 그대로 보여준다.
  // v0.1.20 3번: 이 화면 자신의 refreshDiff()에 더해 Candidates 스토어도
  // 강제 재검증한다(revalidateAfterCapture) — 이 Capture로 그쪽의 보류 배너·
  // 집계도 바뀔 수 있는데 그 탭이 지금 마운트돼 있지 않을 수 있다.
  async function handleCapture(): Promise<void> {
    setBusy(true)
    setError(null)
    setCaptureReport(null)
    try {
      const report = await captureAll()
      setCaptureReport(report)
      await refreshDiff()
      await revalidateAfterCapture(status)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Apply 흐름 1단계: dry-run으로 계획을 먼저 받아 확인 다이얼로그에 액션
  // 전문을 그대로 노출한다 (불변식 ⑥ — UI가 실행 전 스크립트를 보여준다).
  // privileged(apt/snap) 액션도 여기 포함되어 그대로 보이되, 실행하면
  // "skipped"로 표시된다(P2a 결정 ② — 권한 상승 통합 전까지 보류).
  async function openApplyPreview(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const dryRunPreview = await window.api.engine.apply({ confirm: false })
      setPreview(dryRunPreview)
      setFinalResults(null)
      setLive({})
      setExpandedOverride({})
      setDialogOpen(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // R4: 스크린샷 하네스가 Apply 다이얼로그를 열어야 할 때(App.tsx가 window
  // CustomEvent로 다시 뿌린다 -- 자세한 이유는 App.tsx 주석).
  useEffect(() => {
    const listener = (): void => {
      void openApplyPreview()
    }
    window.addEventListener(SCREENSHOT_GOTO_EVENT, listener)
    return () => window.removeEventListener(SCREENSHOT_GOTO_EVENT, listener)
  }, [])

  // Apply 흐름 2단계: 사용자가 다이얼로그에서 확인을 누르면 실제로 실행하고,
  // engine:planEvent 구독으로 행마다 실시간 진행을 표시한다. privileged
  // 액션은 pkexec 1회 인증으로 스크립트 하나가 실행되고(P2b), 그 진행도 같은
  // 이벤트 스트림에 합류한다 — UI는 privileged/unprivileged를 구분하지 않고
  // 행 상태로만 본다.
  async function confirmApply(): Promise<void> {
    setApplying(true)
    setLive({})
    const unsubscribe = window.api.engine.onPlanEvent((event: PlanEvent) => {
      if (event.type === 'action_start') {
        setLive((prev) => ({ ...prev, [event.index]: { running: true } }))
      } else if (event.type === 'action_done') {
        setLive((prev) => ({ ...prev, [event.index]: { ok: event.ok, error: event.error } }))
      }
    })
    try {
      const executed = await window.api.engine.apply({ confirm: true })
      setFinalResults(executed.results)
      await refreshDiff()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      unsubscribe()
      setApplying(false)
    }
  }

  // 실행 중 취소 (P2b 결정 ③) — 명령 사이에서 협조적으로 멈춘다: 이미 실행
  // 중인 명령/액션은 끝까지 마치고, 그 뒤로는 not-run으로 보고된다.
  async function cancelApply(): Promise<void> {
    try {
      await window.api.engine.cancelApply()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // R1: 진행률은 apt 패키지 등 명령 내부 단위가 아니라 액션(preview.results의
  // 각 행) 단위다 — 세부 퍼센트를 낼 소스가 없어 액션 단위가 스펙 그대로다.
  // 이벤트 스트림은 이미 있어(action_start/action_done) 새 IPC 없이 live에서
  // 그대로 파생한다.
  const totalActions = preview?.results.length ?? 0
  const completedActions = Object.values(live).filter((row) => row.ok !== undefined).length
  const progressPercent = totalActions > 0 ? Math.round((completedActions / totalActions) * 100) : 0
  const runningIndex = Object.keys(live)
    .map(Number)
    .find((index) => live[index]?.running)
  const runningSummary =
    runningIndex !== undefined ? (preview?.results[runningIndex]?.summary ?? null) : null
  const finalTally = finalResults
    ? finalResults.reduce(
        (acc, r) => {
          if (r.status === 'ok') acc.ok += 1
          else if (r.status === 'failed' || r.status === 'refused') acc.failed += 1
          return acc
        },
        { ok: 0, failed: 0 }
      )
    : null

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* R1b 원칙①(시각적 위계): "이 머신이 기준과 다른가"가 화면에서 가장 크고
          먼저 읽혀야 한다 — capability별 세부 목록보다 앞, 가장 큰 글자로. */}
      <section className="mb-3 rounded-lg border border-border bg-card p-4">
        {/* R4-2 #2: 화면별 "?" 헬프는 App.tsx 탭 바 우측 끝 하나로 통일했다 —
            여기 있던 인스턴스는 그 통일 위치와 중복이라 제거. */}
        <h2 className="text-xs font-medium text-muted-foreground">{summary.heading}</h2>
        <div className="mt-1.5 flex items-center gap-2">
          <StatusIcon
            kind={totalDrift === null ? 'muted' : totalDrift === 0 ? 'ok' : 'warn'}
            className="size-6"
          />
          <span className="text-3xl leading-none font-semibold tabular-nums text-foreground">
            {totalDrift ?? '…'}
          </span>
          <span className="text-sm text-muted-foreground">
            {totalDrift === null
              ? emptyStateCopy.loading
              : totalDrift === 0
                ? summary.matched
                : summary.drift}
          </span>
          {/* 4단계 SWR: 이전 데이터를 보여주는 동안 조용히 재검증 중임을 미세
              표시 — 스토어가 스켈레톤 대신 이전 값을 그대로 렌더하므로, 지금
              보는 값이 갱신 중일 수 있다는 신호가 없으면 오해할 수 있다. */}
          {totalDrift !== null && diffSnapshot.revalidating && (
            <span className="text-[11px] text-muted-foreground">갱신 중…</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {driftCounts.map((c) => (
            <span
              key={c.key}
              title={`${c.label}: ${c.count === null ? emptyStateCopy.loading : c.count === 0 ? summary.matched : `${c.count}${summary.chipUnit}`}`}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            >
              <StatusIcon
                kind={c.count === null ? 'muted' : c.count > 0 ? 'warn' : 'ok'}
                className="size-3"
              />
              {c.label}
              {/* 0은 "정보 없음"이 아니라 "일치"라 체크 아이콘이 이미 말해준다 —
                  숫자 0을 덧붙이면 시각적 잡음만 늘어난다(round 1 스크린샷에서 발견). */}
              {c.count ? ` ${c.count}` : c.count === null ? ' …' : ''}
            </span>
          ))}
          {activeDuplicateCount > 0 && (
            <span
              title="INV-1 중복 설치 경고"
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-status-error"
            >
              <StatusIcon kind="error" className="size-3" />
              Duplicates {activeDuplicateCount}
            </span>
          )}
          {reclassifications.length > 0 && (
            <span
              title="계층 재분류 감지"
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[11px] text-status-warn"
            >
              <StatusIcon kind="warn" className="size-3" />
              Reclassified {reclassifications.length}
            </span>
          )}
        </div>
        {/* 확인 결과: 위 "N건" 수치(totalDrift)는 driftCounts 8개 capability만
            합산하고 Duplicates·Reclassified는 원래부터 안 섞인다(engine의 안전
            불변식 ⑤ — 중복은 Apply로 해결 안 되고 보고만). 다만 칩이 같은 카드
            안에 나란히 있으면 오독 소지가 있어 명시적으로 분리해 알려준다. */}
        {hasReportOnlyWarnings && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Duplicates·Reclassified는 위 건수에 포함되지 않습니다 — Apply로 해결되지 않고 보고만
            합니다.
          </p>
        )}
      </section>

      {/* R1b 원칙②(액션 배치): 액션(Capture/Apply)은 요약 바로 아래, 좌측 정렬
          한 줄로 — 이전에는 justify-between으로 오른쪽 끝에 붙어 그 옆(왼쪽)에
          쓸모없는 빈 띠가 생겼다(사용자 지적 사례). R4-2 #5: 버튼 행과 "세부
          항목" 라벨 사이 여백도 mb-2로 조여 빈 공간을 줄인다. */}
      <ViewToolbar className="mb-2">
        <ActionButton
          variant="secondary"
          label={buttonCopy.capture.label}
          subtitle={buttonCopy.capture.subtitle}
          disabledReason={buttonCopy.captureDisabledFollower}
          busy={busy}
          disabled={busy || status?.role === 'follower'}
          onClick={handleCapture}
        />
        <ActionButton
          label={buttonCopy.apply.label}
          subtitle={buttonCopy.apply.subtitle}
          disabledReason={buttonCopy.applyDisabledNoDrift}
          busy={busy}
          disabled={busy || !hasDrift}
          onClick={openApplyPreview}
        />
      </ViewToolbar>

      {status?.role === 'follower' && (
        <StatusText kind="muted" className="mb-2">
          이 머신은 follower입니다 — capture는 reference 전용이라 비활성화되어 있습니다.
        </StatusText>
      )}

      {(error ?? diffSnapshot.error) && (
        <StatusText kind="error" className="mb-2">
          {error ?? diffSnapshot.error}
        </StatusText>
      )}

      {/* v0.1.20 1번: Capture 결과 — 다음 Capture 시작 시 비워지고, 사용자가
          닫기를 눌러도 비워진다(둘 다 setCaptureReport(null)). */}
      {captureReport && (
        <div className="mb-2">
          <CaptureReportSummary report={captureReport} onDismiss={() => setCaptureReport(null)} />
        </div>
      )}

      <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        세부 항목
      </h3>

      {/* R4-2 #5: 기준과 일치하는 capability는 각자 섹션(제목+설명+"기준과
          일치")을 펼치지 않고 여기 한 데 모아 한 줄씩 컴팩트하게 접는다 —
          drift가 있는 것만 아래에서 온전히 펼쳐진다. */}
      {/* UI 정돈(v0.1.16): 보더 카드 대신 아주 옅은 배경 틴트만 남긴다 —
          촘촘한 이름 그리드가 세부 항목(아래 DriftSection들, 보더 없음)과는
          결이 다른 "묶음"이라는 것만 암시하면 충분하고, 진한 회색 보더 상자를
          또 하나 만들 필요는 없다(이 화면의 유일한 실질 보더 카드는 위 요약
          히어로 카드 하나로 충분). */}
      {matchedCapabilities.length > 0 && (
        <section className="mb-4 rounded-md bg-muted/40 p-2.5">
          <p className="mb-1.5 text-xs text-muted-foreground">
            {summary.matched} ({matchedCapabilities.length})
          </p>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {matchedCapabilities.map((c) => (
              <div key={c.key} className="flex min-w-0 items-center gap-1.5 text-xs">
                <StatusIcon kind="ok" className="size-3 shrink-0" />
                <span className="shrink-0 font-medium text-foreground">{c.title}</span>
                <span className="truncate text-muted-foreground" title={c.description}>
                  — {c.description}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(!dotfilesDiff || hasDotfilesDrift(dotfilesDiff)) && (
        <DriftSection
          title="Dotfiles"
          description={sectionCopy.dotfiles}
          loading={!dotfilesDiff}
          matchedLabel={summary.matched}
          empty={
            !!dotfilesDiff &&
            dotfilesDiff.toLink.length === 0 &&
            dotfilesDiff.contentChanged.length === 0 &&
            dotfilesDiff.missingHome.length === 0 &&
            dotfilesDiff.invalidStore.length === 0
          }
        >
          {/* R5: [to-link]는 raw 상태 태그라 reference에서 Capture 직후에도
              "벌써 어긋났다"로 오독됐다 — 사람이 읽는 문장 + 그 아래 한 줄
              설명으로 바꾼다(경로만 monospace로 남긴다). */}
          {dotfilesDiff && dotfilesDiff.toLink.length > 0 && (
            <li className="mb-1 text-[11px] text-muted-foreground">{dotfilesToLinkExplainCopy}</li>
          )}
          {dotfilesDiff?.toLink.map((home) => (
            <DotfilesDriftRow key={`link-${home}`} kind="warn">
              {dotfilesStateCopy.toLink} — <span className="font-mono">{home}</span>
            </DotfilesDriftRow>
          ))}
          {dotfilesDiff?.contentChanged.map((item) => {
            const home = item.split(' (mode ')[0]
            return (
              <DotfilesDriftRow
                key={`changed-${item}`}
                kind="warn"
                action={
                  <ActionButton
                    variant="secondary"
                    size="xs"
                    label={recaptureActionCopy.label}
                    subtitle={recaptureActionCopy.subtitle}
                    busy={pendingRecaptureKeys[home]}
                    disabled={pendingRecaptureKeys[home]}
                    onClick={() => recaptureDotfile(item)}
                  />
                }
              >
                {dotfilesStateCopy.contentChanged} — <span className="font-mono">{item}</span>
              </DotfilesDriftRow>
            )
          })}
          {dotfilesDiff?.missingHome.map((home) => (
            <DotfilesDriftRow key={`missing-${home}`} kind="error">
              {dotfilesStateCopy.missingHome} — <span className="font-mono">{home}</span>
            </DotfilesDriftRow>
          ))}
          {dotfilesDiff?.invalidStore.map((home) => (
            <DotfilesDriftRow key={`invalid-${home}`} kind="error">
              {dotfilesStateCopy.invalidStore} — <span className="font-mono">{home}</span>
            </DotfilesDriftRow>
          ))}
        </DriftSection>
      )}

      {(!packagesDiff || hasPackagesDrift(packagesDiff)) && (
        <DriftSection
          title="Packages"
          description={sectionCopy.packages}
          loading={!packagesDiff}
          empty={!!packagesDiff && !hasPackagesDrift(packagesDiff)}
        >
          {packagesDiff?.apt.toInstall.map((name) => (
            <DriftRow key={`apt-install-${name}`} kind="warn">
              [apt to-install] {name}
            </DriftRow>
          ))}
          {packagesDiff?.apt.sourcesMissing.map((name) => (
            <DriftRow key={`apt-src-missing-${name}`} kind="error">
              [apt source missing] {name}
            </DriftRow>
          ))}
          {packagesDiff?.apt.sourcesContentChanged.map((name) => (
            <DriftRow key={`apt-src-changed-${name}`} kind="warn">
              [apt source changed] {name}
            </DriftRow>
          ))}
          {packagesDiff?.flatpak.toAddRemotes.map((r) => (
            <DriftRow key={`flatpak-remote-${r.name}`} kind="warn">
              [flatpak remote to-add] {r.name}
            </DriftRow>
          ))}
          {packagesDiff?.flatpak.toInstall.map((a) => (
            <DriftRow key={`flatpak-install-${a.application}`} kind="warn">
              [flatpak to-install] {a.application}
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!appimageDiff || hasAppimageDrift(appimageDiff)) && (
        <DriftSection
          title="AppImage"
          description={sectionCopy.appimage}
          loading={!appimageDiff}
          empty={!!appimageDiff && !hasAppimageDrift(appimageDiff)}
        >
          {appimageDiff?.toInstall.map((name) => (
            <DriftRow key={`appimage-install-${name}`} kind="warn">
              [appimage to-install] {name}
            </DriftRow>
          ))}
          {appimageDiff?.pinMismatch.map((m) => (
            <DriftRow key={`appimage-pin-${m.name}`} kind="warn">
              [appimage pin mismatch] {m.name} (고정 {m.pinned} ≠ 설치됨 {m.installed})
            </DriftRow>
          ))}
        </DriftSection>
      )}
      {appimageDiff && appimageDiff.unsupportedSource.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">
          미지원 소스(자동 설치 안 됨): {appimageDiff.unsupportedSource.join(', ')}
        </p>
      )}

      {(!fontsDiff || hasFontsDrift(fontsDiff)) && (
        <DriftSection
          title="Fonts"
          description={sectionCopy.fonts}
          loading={!fontsDiff}
          empty={!!fontsDiff && !hasFontsDrift(fontsDiff)}
        >
          {fontsDiff?.toInstall.map((name) => (
            <DriftRow key={`fonts-install-${name}`} kind="warn">
              [fonts to-install] {name}
            </DriftRow>
          ))}
          {fontsDiff?.pinMismatch.map((m) => (
            <DriftRow key={`fonts-pin-${m.name}`} kind="warn">
              [fonts pin mismatch] {m.name} (고정 {m.pinned} ≠ 설치됨 {m.installedVersion})
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!binariesDiff || hasBinariesDrift(binariesDiff)) && (
        <DriftSection
          title="Binaries"
          description={sectionCopy.binaries}
          loading={!binariesDiff}
          empty={!!binariesDiff && !hasBinariesDrift(binariesDiff)}
        >
          {binariesDiff?.toInstall.map((name) => (
            <DriftRow key={`binaries-install-${name}`} kind="warn">
              [binaries to-install] {name}
            </DriftRow>
          ))}
          {binariesDiff?.pinMismatch.map((m) => (
            <DriftRow key={`binaries-pin-${m.name}`} kind="warn">
              [binaries pin mismatch] {m.name} (고정 {m.pinned} ≠ 설치됨 {m.installedVersion})
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!settingsDiff || hasSettingsDrift(settingsDiff)) && (
        <DriftSection
          title="Settings (dconf)"
          description={sectionCopy.settings}
          loading={!settingsDiff}
          empty={!!settingsDiff && !hasSettingsDrift(settingsDiff)}
        >
          {settingsDiff?.contentChanged.map((p) => (
            <DriftRow key={`settings-${p}`} kind="warn">
              [content-changed] {p}
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!servicesDiff || hasServicesDrift(servicesDiff)) && (
        <DriftSection
          title="Services (systemd --user)"
          description={sectionCopy.services}
          loading={!servicesDiff}
          empty={!!servicesDiff && !hasServicesDrift(servicesDiff)}
        >
          {servicesDiff?.missing.map((name) => (
            <DriftRow key={`svc-missing-${name}`} kind="error">
              [missing] {name}
            </DriftRow>
          ))}
          {servicesDiff?.contentChanged.map((name) => (
            <DriftRow key={`svc-changed-${name}`} kind="warn">
              [content-changed] {name}
            </DriftRow>
          ))}
          {servicesDiff?.enabledMismatch.map((name) => (
            <DriftRow key={`svc-enabled-${name}`} kind="warn">
              [enabled mismatch] {name}
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!scheduledDiff || hasScheduledDrift(scheduledDiff)) && (
        <DriftSection
          title="Scheduled (cron)"
          description={sectionCopy.scheduled}
          loading={!scheduledDiff}
          empty={!!scheduledDiff && !hasScheduledDrift(scheduledDiff)}
        >
          {scheduledDiff?.lineDiff.added.map((line) => (
            <DriftRow key={`cron-add-${line}`} kind="warn">
              [+] {line}
            </DriftRow>
          ))}
          {scheduledDiff?.lineDiff.removed.map((line) => (
            <DriftRow key={`cron-remove-${line}`} kind="error">
              [-] {line}
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!toolsDiff || hasToolsDrift(toolsDiff)) && (
        <DriftSection
          title="Tools (nvm/node/npm)"
          description={sectionCopy.tools}
          loading={!toolsDiff}
          empty={!!toolsDiff && !hasToolsDrift(toolsDiff)}
        >
          {toolsDiff?.nodeToInstall && (
            <DriftRow kind="warn">[node to-install] {toolsDiff.nodeToInstall}</DriftRow>
          )}
          {toolsDiff?.toInstall.map((pkg) => (
            <DriftRow key={`tools-install-${pkg}`} kind="warn">
              [npm -g to-install] {pkg}
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {(!reposDiff || hasReposDrift(reposDiff)) && (
        <DriftSection
          title="Repos (git)"
          description={sectionCopy.repos}
          loading={!reposDiff}
          empty={!!reposDiff && !hasReposDrift(reposDiff)}
        >
          {reposDiff?.toClone.map((r) => (
            <DriftRow key={`repos-clone-${r.path}`} kind="warn">
              [to-clone] {r.path} ({r.url})
            </DriftRow>
          ))}
          {reposDiff?.manualNoUrl.map((p) => (
            <DriftRow key={`repos-manual-${p}`} kind="muted">
              [manual, no url] {p}
            </DriftRow>
          ))}
        </DriftSection>
      )}

      {/* UI 정돈(v0.1.16): Duplicates·Reclassifications는 짧은 태그가 아니라
          문장에 가까운 긴 내용이라 DriftRow의 통짜 모노스페이스 대신
          DotfilesDriftRow(아이콘 + 보통 글꼴 산문, 이름만 monospace)를 쓴다 —
          "빨간 모노스페이스 장문"을 아이콘+차분한 톤으로 바꾸라는 지시가
          정확히 겨냥한 줄들이다. */}
      {duplicates.length > 0 && (
        <DriftSection
          title="Duplicate installs (INV-1)"
          description={sectionCopy.duplicates}
          loading={false}
          empty={false}
        >
          {duplicates.map((d) => (
            <DotfilesDriftRow key={d.name} kind={d.ignored ? 'muted' : 'error'}>
              <span className="font-mono">{d.name}</span>:{' '}
              {d.layers.map((l) => `${l.capability}(${l.label})`).join(' + ')}
              {d.ignored ? ' — 무시됨' : ''}
            </DotfilesDriftRow>
          ))}
        </DriftSection>
      )}

      {reclassifications.length > 0 && (
        <DriftSection
          title="Reclassifications"
          description={sectionCopy.reclassifications}
          loading={false}
          empty={false}
        >
          {reclassifications.map((r) => (
            <DotfilesDriftRow key={r.name} kind="warn">
              <span className="font-mono">{r.name}</span>: manifest={r.manifestedIn} → 실제=
              {r.foundIn}
              {status?.role === 'follower'
                ? ' — reference에서 매니페스트를 갱신하세요'
                : ' — 매니페스트 갱신을 검토하세요 (자동 갱신 없음)'}
            </DotfilesDriftRow>
          ))}
        </DriftSection>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply plan</DialogTitle>
            <DialogDescription>{helpCopy.applyDialog}</DialogDescription>
          </DialogHeader>

          {preview?.sudoScriptPreview && (
            <div className="min-w-0 rounded border border-border bg-muted p-2">
              <p className="mb-1 text-xs text-status-warn">
                관리자 권한 스크립트 (polkit 1회 인증으로 실행)
              </p>
              <pre className="max-h-48 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                {preview.sudoScriptPreview}
              </pre>
            </div>
          )}

          {/* R1: 실행 중엔 액션 단위 진행률(완료 수/전체 수) — apt 패키지 등
              명령 내부 단위 퍼센트는 소스가 없어 스펙 밖. 이미 있는
              action_start/action_done 이벤트 스트림(live)에서 파생하므로 새
              IPC 계약이 필요 없다. */}
          {applying && finalResults === null && (
            <div className="min-w-0 rounded border border-border bg-muted p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">
                  {runningSummary ?? applyProgressCopy.preparing}
                </span>
                <span className="shrink-0 font-mono tabular-nums">
                  {applyProgressCopy.countLabel(completedActions, totalActions)} ({progressPercent}
                  %)
                </span>
              </div>
              <Progress value={progressPercent} />
            </div>
          )}
          {/* 완료 후: 진행률 바를 그대로 두는 대신 요약 헤더로 대체한다 —
              바는 "진행 중"이라는 의미가 강해 끝난 뒤에도 남아 있으면
              어중간하다(기존 상태 텍스트 디자인 언어로 대체). */}
          {finalTally && (
            <StatusText kind={finalTally.failed > 0 ? 'error' : 'ok'} className="min-w-0">
              {applyProgressCopy.doneSummary(finalTally.ok, finalTally.failed)}
            </StatusText>
          )}

          <ul className="min-w-0 space-y-2">
            {preview?.results.map((action, index) => {
              const rowState = finalResults?.[index]
              const liveRow = live[index]
              const label = statusLabel(index, preview, finalResults, live)
              const kind = planActionStatusKind(label as Parameters<typeof planActionStatusKind>[0])
              // R1: failed(및 refused — 둘 다 'error' kind)는 설명가능성 계약상
              // 문제를 숨기지 않도록 기본 펼침. 나머지는 기본 접힘. 사용자가
              // 명시적으로 토글하면(expandedOverride) 그 값이 항상 우선한다.
              const defaultExpanded = kind === 'error'
              const expanded = expandedOverride[index] ?? defaultExpanded
              const detailText = rowState?.detail ?? liveRow?.error
              return (
                <li
                  key={`${action.summary}-${index}`}
                  className="min-w-0 rounded border border-border p-2"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedOverride((prev) => ({ ...prev, [index]: !expanded }))}
                    className="flex w-full min-w-0 items-center gap-1.5 text-left text-xs hover:text-foreground"
                    title={expanded ? applyProgressCopy.collapseRow : applyProgressCopy.expandRow}
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 truncate" title={action.summary}>
                      {action.summary}
                    </span>
                    <StatusText kind={kind} className="shrink-0">
                      {label}
                    </StatusText>
                  </button>
                  {expanded && (
                    <div className="mt-1 min-w-0 space-y-1 pl-5">
                      {action.commands.map((cmd, cmdIndex) => (
                        <div
                          key={cmdIndex}
                          className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground"
                        >
                          $ {cmd}
                        </div>
                      ))}
                      {detailText && (
                        <div className="font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                          {detailText}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <DialogFooter>
            {applying && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" onClick={cancelApply}>
                    {buttonCopy.applyCancel.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{buttonCopy.applyCancel.subtitle}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="secondary"
                  onClick={() => setDialogOpen(false)}
                  disabled={applying}
                >
                  {buttonCopy.applyClose.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{buttonCopy.applyClose.subtitle}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button onClick={confirmApply} disabled={applying || finalResults !== null}>
                  {applying
                    ? '실행 중…'
                    : finalResults !== null
                      ? '완료됨'
                      : buttonCopy.applyConfirm.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{buttonCopy.applyConfirm.subtitle}</TooltipContent>
            </Tooltip>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default DiffView
