import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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

function statusColor(status: string): string {
  if (status === 'ok') return 'text-green-400'
  if (status === 'failed' || status === 'refused') return 'text-red-400'
  if (status === 'skipped') return 'text-amber-500'
  if (status === 'running') return 'text-amber-400'
  return 'text-neutral-500'
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
    <div>
      <div className="mb-4 flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy || status?.role === 'follower'}
          title={
            status?.role === 'follower'
              ? 'follower 머신은 capture가 차단됩니다 (reference/follower 단방향 배포, 불변식 ⑦)'
              : undefined
          }
          onClick={handleCapture}
        >
          Capture
        </Button>
        <Button disabled={busy || !hasDrift} onClick={openApplyPreview}>
          Apply
        </Button>
      </div>

      {status?.role === 'follower' && (
        <p className="mb-4 font-mono text-xs text-amber-400">
          이 머신은 follower입니다 — capture는 reference 전용이라 비활성화되어 있습니다.
        </p>
      )}

      {error && <p className="mb-4 font-mono text-xs text-red-400">error: {error}</p>}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">dotfiles</h2>
        {!dotfilesDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : dotfilesDiff.toLink.length === 0 &&
          dotfilesDiff.contentChanged.length === 0 &&
          dotfilesDiff.invalidStore.length === 0 ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {dotfilesDiff.toLink.map((home) => (
              <li key={`link-${home}`} className="text-amber-400">
                [to-link] {home}
              </li>
            ))}
            {dotfilesDiff.contentChanged.map((item) => (
              <li key={`changed-${item}`} className="text-amber-400">
                [content-changed] {item}
              </li>
            ))}
            {dotfilesDiff.invalidStore.map((home) => (
              <li key={`invalid-${home}`} className="text-red-400">
                [invalid-store] {home}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-300">packages</h2>
        {!packagesDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasPackagesDrift(packagesDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {packagesDiff.apt.toInstall.map((name) => (
              <li key={`apt-install-${name}`} className="text-amber-400">
                [apt to-install] {name}
              </li>
            ))}
            {packagesDiff.apt.sourcesMissing.map((name) => (
              <li key={`apt-src-missing-${name}`} className="text-red-400">
                [apt source missing] {name}
              </li>
            ))}
            {packagesDiff.apt.sourcesContentChanged.map((name) => (
              <li key={`apt-src-changed-${name}`} className="text-amber-400">
                [apt source changed] {name}
              </li>
            ))}
            {packagesDiff.flatpak.toAddRemotes.map((r) => (
              <li key={`flatpak-remote-${r.name}`} className="text-amber-400">
                [flatpak remote to-add] {r.name}
              </li>
            ))}
            {packagesDiff.flatpak.toInstall.map((a) => (
              <li key={`flatpak-install-${a.application}`} className="text-amber-400">
                [flatpak to-install] {a.application}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">appimage</h2>
        {!appimageDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasAppimageDrift(appimageDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {appimageDiff.toInstall.map((name) => (
              <li key={`appimage-install-${name}`} className="text-amber-400">
                [appimage to-install] {name}
              </li>
            ))}
            {appimageDiff.pinMismatch.map((m) => (
              <li key={`appimage-pin-${m.name}`} className="text-amber-400">
                [appimage pin mismatch] {m.name} (고정 {m.pinned} ≠ 설치됨 {m.installed})
              </li>
            ))}
          </ul>
        )}
        {appimageDiff && appimageDiff.unsupportedSource.length > 0 && (
          <p className="mt-1 font-mono text-xs text-neutral-500">
            미지원 소스(자동 설치 안 됨): {appimageDiff.unsupportedSource.join(', ')}
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">settings (dconf)</h2>
        {!settingsDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasSettingsDrift(settingsDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {settingsDiff.contentChanged.map((p) => (
              <li key={`settings-${p}`} className="text-amber-400">
                [content-changed] {p}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">services (systemd --user)</h2>
        {!servicesDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasServicesDrift(servicesDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {servicesDiff.missing.map((name) => (
              <li key={`svc-missing-${name}`} className="text-red-400">
                [missing] {name}
              </li>
            ))}
            {servicesDiff.contentChanged.map((name) => (
              <li key={`svc-changed-${name}`} className="text-amber-400">
                [content-changed] {name}
              </li>
            ))}
            {servicesDiff.enabledMismatch.map((name) => (
              <li key={`svc-enabled-${name}`} className="text-amber-400">
                [enabled mismatch] {name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">scheduled (cron)</h2>
        {!scheduledDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasScheduledDrift(scheduledDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {scheduledDiff.lineDiff.added.map((line) => (
              <li key={`cron-add-${line}`} className="text-amber-400">
                [+] {line}
              </li>
            ))}
            {scheduledDiff.lineDiff.removed.map((line) => (
              <li key={`cron-remove-${line}`} className="text-red-400">
                [-] {line}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">tools (nvm/node/npm)</h2>
        {!toolsDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasToolsDrift(toolsDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {toolsDiff.nodeToInstall && (
              <li className="text-amber-400">[node to-install] {toolsDiff.nodeToInstall}</li>
            )}
            {toolsDiff.toInstall.map((pkg) => (
              <li key={`tools-install-${pkg}`} className="text-amber-400">
                [npm -g to-install] {pkg}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-medium text-neutral-300">repos (git)</h2>
        {!reposDiff ? (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        ) : !hasReposDrift(reposDiff) ? (
          <p className="font-mono text-xs text-neutral-500">drift 없음 — manifest와 일치합니다.</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {reposDiff.toClone.map((r) => (
              <li key={`repos-clone-${r.path}`} className="text-amber-400">
                [to-clone] {r.path} ({r.url})
              </li>
            ))}
            {reposDiff.manualNoUrl.map((p) => (
              <li key={`repos-manual-${p}`} className="text-neutral-500">
                [manual, no url] {p}
              </li>
            ))}
          </ul>
        )}
      </section>

      {duplicates.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">중복 설치 경고 (INV-1)</h2>
          <ul className="space-y-1 font-mono text-xs">
            {duplicates.map((d) => (
              <li key={d.name} className={d.ignored ? 'text-neutral-600' : 'text-red-400'}>
                {d.name}: {d.layers.map((l) => `${l.capability}(${l.label})`).join(' + ')}
                {d.ignored ? ' — 무시됨' : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {reclassifications.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-neutral-300">계층 재분류 감지</h2>
          <ul className="space-y-1 font-mono text-xs text-amber-400">
            {reclassifications.map((r) => (
              <li key={r.name}>
                {r.name}: manifest={r.manifestedIn} → 실제={r.foundIn}
                {status?.role === 'follower'
                  ? ' — reference에서 매니페스트를 갱신하세요'
                  : ' — 매니페스트 갱신을 검토하세요 (자동 갱신 없음)'}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply 계획 확인</DialogTitle>
            <DialogDescription>
              일반 작업은 바로 실행되고, 관리자 권한이 필요한 작업은 아래 스크립트 하나로 묶여
              시스템 인증(polkit) 1회로 실행됩니다 (덮어쓰기 전 자동 백업됨).
              <code className="text-amber-500"> skipped</code>로 표시되면 pkexec가 없거나 인증이
              거부된 것 — 표시된 명령을 터미널에서 직접 실행하세요.
            </DialogDescription>
          </DialogHeader>

          {preview?.sudoScriptPreview && (
            <div className="rounded border border-amber-900 bg-neutral-950 p-2">
              <p className="mb-1 font-mono text-xs text-amber-500">
                관리자 권한 스크립트 (polkit 1회 인증으로 실행)
              </p>
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-neutral-300">
                {preview.sudoScriptPreview}
              </pre>
            </div>
          )}

          <ul className="space-y-3 font-mono text-xs">
            {preview?.results.map((action, index) => {
              const rowState = finalResults?.[index]
              const liveRow = live[index]
              const label = statusLabel(index, preview, finalResults, live)
              return (
                <li key={`${action.summary}-${index}`} className="rounded border border-border p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span>{action.summary}</span>
                    <span className={statusColor(label)}>{label}</span>
                  </div>
                  {action.commands.map((cmd, cmdIndex) => (
                    <div key={cmdIndex} className="text-neutral-400">
                      $ {cmd}
                    </div>
                  ))}
                  {(rowState?.detail ?? liveRow?.error) && (
                    <div className="mt-1 text-neutral-500">
                      {rowState?.detail ?? liveRow?.error}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          <DialogFooter>
            {applying && (
              <Button variant="secondary" onClick={cancelApply}>
                취소
              </Button>
            )}
            <Button variant="secondary" onClick={() => setDialogOpen(false)} disabled={applying}>
              닫기
            </Button>
            <Button onClick={confirmApply} disabled={applying || finalResults !== null}>
              {applying ? '실행 중…' : finalResults !== null ? '완료됨' : '확인 — 실행'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default DiffView
