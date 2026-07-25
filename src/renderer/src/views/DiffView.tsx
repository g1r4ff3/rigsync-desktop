import { useEffect, useMemo, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { HelpPopover } from '@/components/HelpPopover'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { buttonCopy, emptyStateCopy, helpCopy, sectionCopy } from '../copy'
import { SCREENSHOT_GOTO_EVENT } from '../screenshotBus'
import { StatusIcon, StatusText } from '../status'
import { planActionStatusKind, type StatusKind } from '../statusKind'
import type {
  ApplyResponse,
  AppimageDiffReportDto,
  DotfilesDiffReport,
  DuplicateWarningDto,
  EngineStatus,
  PackagesDiffReport,
  PlanActionResultDto,
  PlanEvent,
  ReclassificationEventDto,
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
  children
}: {
  readonly title: string
  readonly description: string
  readonly loading: boolean
  readonly empty: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mt-5 first:mt-0">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mb-1.5 text-xs text-muted-foreground">{description}</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">{emptyStateCopy.loading}</p>
      ) : empty ? (
        <StatusText kind="ok">기준과 일치</StatusText>
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

interface DiffViewProps {
  readonly status: EngineStatus | null
}

function DiffView({ status }: DiffViewProps): React.JSX.Element {
  const [dotfilesDiff, setDotfilesDiff] = useState<DotfilesDiffReport | null>(null)
  const [packagesDiff, setPackagesDiff] = useState<PackagesDiffReport | null>(null)
  const [appimageDiff, setAppimageDiff] = useState<AppimageDiffReportDto | null>(null)
  const [settingsDiff, setSettingsDiff] = useState<SettingsDiffReportDto | null>(null)
  const [servicesDiff, setServicesDiff] = useState<ServicesDiffReportDto | null>(null)
  const [scheduledDiff, setScheduledDiff] = useState<ScheduledDiffReportDto | null>(null)
  const [toolsDiff, setToolsDiff] = useState<ToolsDiffReportDto | null>(null)
  const [reposDiff, setReposDiff] = useState<ReposDiffReportDto | null>(null)
  const [duplicates, setDuplicates] = useState<readonly DuplicateWarningDto[]>([])
  const [reclassifications, setReclassifications] = useState<readonly ReclassificationEventDto[]>(
    []
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [preview, setPreview] = useState<ApplyResponse | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [live, setLive] = useState<Record<number, RowLiveState>>({})
  const [finalResults, setFinalResults] = useState<readonly PlanActionResultDto[] | null>(null)
  const [applying, setApplying] = useState(false)

  async function refreshDiff(): Promise<void> {
    // P4: follower는 diff를 보기 전에 fetch+ff-pull을 먼저 시도한다(reference는
    // syncNow가 commit+push라 여기서 부르면 안 됨 -- role로 가른다). 실패해도
    // 로컬 기준으로 diff는 계속 보여준다(상태바가 오류를 표면화).
    if (status?.role === 'follower') {
      await window.api.engine.syncNow().catch(() => {})
    }
    const [
      dotfiles,
      packages,
      appimage,
      settings,
      services,
      scheduled,
      tools,
      repos,
      dupes,
      reclass
    ] = await Promise.all([
      window.api.engine.diffDotfiles(),
      window.api.engine.diffPackages(),
      window.api.engine.diffAppimage(),
      window.api.engine.diffSettings(),
      window.api.engine.diffServices(),
      window.api.engine.diffScheduled(),
      window.api.engine.diffTools(),
      window.api.engine.diffRepos(),
      window.api.engine.detectDuplicates(),
      window.api.engine.detectReclassifications()
    ])
    setDotfilesDiff(dotfiles)
    setPackagesDiff(packages)
    setAppimageDiff(appimage)
    setSettingsDiff(settings)
    setServicesDiff(services)
    setScheduledDiff(scheduled)
    setToolsDiff(tools)
    setReposDiff(repos)
    setDuplicates(dupes)
    setReclassifications(reclass)
  }

  useEffect(() => {
    // P4: follower는 초기 로드 때도 pull을 먼저 시도한다 (refreshDiff와 동일한
    // 판단 -- 인라인하는 이유는 기존 react-hooks/set-state-in-effect 회피 패턴 유지).
    const presync =
      status?.role === 'follower' ? window.api.engine.syncNow().catch(() => {}) : Promise.resolve()
    presync
      .then(() =>
        Promise.all([
          window.api.engine.diffDotfiles(),
          window.api.engine.diffPackages(),
          window.api.engine.diffAppimage(),
          window.api.engine.diffSettings(),
          window.api.engine.diffServices(),
          window.api.engine.diffScheduled(),
          window.api.engine.diffTools(),
          window.api.engine.diffRepos(),
          window.api.engine.detectDuplicates(),
          window.api.engine.detectReclassifications()
        ])
      )
      .then(
        ([
          dotfiles,
          packages,
          appimage,
          settings,
          services,
          scheduled,
          tools,
          repos,
          dupes,
          reclass
        ]) => {
          setDotfilesDiff(dotfiles)
          setPackagesDiff(packages)
          setAppimageDiff(appimage)
          setSettingsDiff(settings)
          setServicesDiff(services)
          setScheduledDiff(scheduled)
          setToolsDiff(tools)
          setReposDiff(repos)
          setDuplicates(dupes)
          setReclassifications(reclass)
        },
        (err: unknown) => setError(err instanceof Error ? err.message : String(err))
      )
    // status가 null -> 실제 EngineStatus로 바뀌는 순간 follower 여부를 다시
    // 반영해 한 번 더 부른다(마운트 시 status가 아직 로딩 중일 수 있어서) --
    // 약간의 중복 조회는 있지만 안전한 read-only 호출이라 감수한다.
  }, [status])

  const hasDrift = useMemo(() => {
    const dotfilesDrift = dotfilesDiff
      ? dotfilesDiff.toLink.length > 0 ||
        dotfilesDiff.contentChanged.length > 0 ||
        dotfilesDiff.invalidStore.length > 0
      : false
    return (
      dotfilesDrift ||
      hasPackagesDrift(packagesDiff) ||
      hasAppimageDrift(appimageDiff) ||
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

  // capture-first: 전 capability를 한 번에 캡처한다 (결정 ③ — additive-only).
  async function handleCapture(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await Promise.all([
        window.api.engine.captureDotfiles({ dryRun: false }),
        window.api.engine.capturePackages({ dryRun: false }),
        window.api.engine.captureAppimage({ dryRun: false }),
        window.api.engine.captureSettings({ dryRun: false }),
        window.api.engine.captureServices({ dryRun: false }),
        window.api.engine.captureScheduled({ dryRun: false }),
        window.api.engine.captureTools({ dryRun: false }),
        window.api.engine.captureRepos({ dryRun: false })
      ])
      await refreshDiff()
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

  return (
    <div className="h-full overflow-y-auto pr-1">
      {/* R1b 원칙①(시각적 위계): "이 머신이 기준과 다른가"가 화면에서 가장 크고
          먼저 읽혀야 한다 — capability별 세부 목록보다 앞, 가장 큰 글자로. */}
      <section className="mb-3 rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-1.5">
          <HelpPopover text={helpCopy.diff} />
          <h2 className="text-xs font-medium text-muted-foreground">이 머신이 기준과 다른 점</h2>
        </div>
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
                ? '기준과 일치'
                : '건 — Apply로 맞출 수 있습니다'}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {driftCounts.map((c) => (
            <span
              key={c.key}
              title={`${c.label}: ${c.count === null ? emptyStateCopy.loading : c.count === 0 ? '기준과 일치' : `${c.count}건 드리프트`}`}
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
      </section>

      {/* R1b 원칙②(액션 배치): 액션(Capture/Apply)은 요약 바로 아래, 좌측 정렬
          한 줄로 — 이전에는 justify-between으로 오른쪽 끝에 붙어 그 옆(왼쪽)에
          쓸모없는 빈 띠가 생겼다(사용자 지적 사례). */}
      <ViewToolbar>
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
        <StatusText kind="muted" className="mb-3">
          이 머신은 follower입니다 — capture는 reference 전용이라 비활성화되어 있습니다.
        </StatusText>
      )}

      {error && (
        <StatusText kind="error" className="mb-3">
          {error}
        </StatusText>
      )}

      <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        세부 항목
      </h3>

      <DriftSection
        title="Dotfiles"
        description={sectionCopy.dotfiles}
        loading={!dotfilesDiff}
        empty={
          !!dotfilesDiff &&
          dotfilesDiff.toLink.length === 0 &&
          dotfilesDiff.contentChanged.length === 0 &&
          dotfilesDiff.invalidStore.length === 0
        }
      >
        {dotfilesDiff?.toLink.map((home) => (
          <DriftRow key={`link-${home}`} kind="warn">
            [to-link] {home}
          </DriftRow>
        ))}
        {dotfilesDiff?.contentChanged.map((item) => (
          <DriftRow key={`changed-${item}`} kind="warn">
            [content-changed] {item}
          </DriftRow>
        ))}
        {dotfilesDiff?.invalidStore.map((home) => (
          <DriftRow key={`invalid-${home}`} kind="error">
            [invalid-store] {home}
          </DriftRow>
        ))}
      </DriftSection>

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
      {appimageDiff && appimageDiff.unsupportedSource.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">
          미지원 소스(자동 설치 안 됨): {appimageDiff.unsupportedSource.join(', ')}
        </p>
      )}

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

      {duplicates.length > 0 && (
        <DriftSection
          title="Duplicate installs (INV-1)"
          description={sectionCopy.duplicates}
          loading={false}
          empty={false}
        >
          {duplicates.map((d) => (
            <DriftRow key={d.name} kind={d.ignored ? 'muted' : 'error'}>
              {d.name}: {d.layers.map((l) => `${l.capability}(${l.label})`).join(' + ')}
              {d.ignored ? ' — 무시됨' : ''}
            </DriftRow>
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
            <DriftRow key={r.name} kind="warn">
              {r.name}: manifest={r.manifestedIn} → 실제={r.foundIn}
              {status?.role === 'follower'
                ? ' — reference에서 매니페스트를 갱신하세요'
                : ' — 매니페스트 갱신을 검토하세요 (자동 갱신 없음)'}
            </DriftRow>
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
            <div className="rounded border border-border bg-muted p-2">
              <p className="mb-1 text-xs text-status-warn">
                관리자 권한 스크립트 (polkit 1회 인증으로 실행)
              </p>
              <pre className="max-h-48 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                {preview.sudoScriptPreview}
              </pre>
            </div>
          )}

          <ul className="space-y-3">
            {preview?.results.map((action, index) => {
              const rowState = finalResults?.[index]
              const liveRow = live[index]
              const label = statusLabel(index, preview, finalResults, live)
              const kind = planActionStatusKind(label as Parameters<typeof planActionStatusKind>[0])
              return (
                <li key={`${action.summary}-${index}`} className="rounded border border-border p-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                    <span>{action.summary}</span>
                    <StatusText kind={kind}>{label}</StatusText>
                  </div>
                  {action.commands.map((cmd, cmdIndex) => (
                    <div
                      key={cmdIndex}
                      className="font-mono text-xs break-all text-muted-foreground"
                    >
                      $ {cmd}
                    </div>
                  ))}
                  {(rowState?.detail ?? liveRow?.error) && (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {rowState?.detail ?? liveRow?.error}
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
