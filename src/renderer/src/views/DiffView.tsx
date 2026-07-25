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
  DotfilesDiffReport,
  EngineStatus,
  PackagesDiffReport,
  PlanActionResultDto,
  PlanEvent
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

function hasPackagesDrift(packages: PackagesDiffReport | null): boolean {
  if (!packages) return false
  return (
    packages.apt.toInstall.length > 0 ||
    packages.apt.sourcesMissing.length > 0 ||
    packages.apt.sourcesContentChanged.length > 0 ||
    packages.snap.toInstall.length > 0 ||
    packages.flatpak.toAddRemotes.length > 0 ||
    packages.flatpak.toInstall.length > 0
  )
}

interface DiffViewProps {
  readonly status: EngineStatus | null
}

function DiffView({ status }: DiffViewProps): React.JSX.Element {
  const [dotfilesDiff, setDotfilesDiff] = useState<DotfilesDiffReport | null>(null)
  const [packagesDiff, setPackagesDiff] = useState<PackagesDiffReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [preview, setPreview] = useState<ApplyResponse | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [live, setLive] = useState<Record<number, RowLiveState>>({})
  const [finalResults, setFinalResults] = useState<readonly PlanActionResultDto[] | null>(null)
  const [applying, setApplying] = useState(false)

  async function refreshDiff(): Promise<void> {
    const [dotfiles, packages] = await Promise.all([
      window.api.engine.diffDotfiles(),
      window.api.engine.diffPackages()
    ])
    setDotfilesDiff(dotfiles)
    setPackagesDiff(packages)
  }

  useEffect(() => {
    Promise.all([window.api.engine.diffDotfiles(), window.api.engine.diffPackages()]).then(
      ([dotfiles, packages]) => {
        setDotfilesDiff(dotfiles)
        setPackagesDiff(packages)
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err))
    )
  }, [])

  const hasDrift = useMemo(() => {
    const dotfilesDrift = dotfilesDiff
      ? dotfilesDiff.toLink.length > 0 ||
        dotfilesDiff.contentChanged.length > 0 ||
        dotfilesDiff.invalidStore.length > 0
      : false
    return dotfilesDrift || hasPackagesDrift(packagesDiff)
  }, [dotfilesDiff, packagesDiff])

  // capture-first: dotfiles + packages를 한 번에 캡처한다 (결정 ③ — additive-only).
  async function handleCapture(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await Promise.all([
        window.api.engine.captureDotfiles({ dryRun: false }),
        window.api.engine.capturePackages({ dryRun: false })
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
  // engine:planEvent 구독으로 행마다 실시간 진행을 표시한다.
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
            {packagesDiff.snap.toInstall.map((s) => (
              <li key={`snap-install-${s.name}`} className="text-amber-400">
                [snap to-install] {s.name}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply 계획 확인</DialogTitle>
            <DialogDescription>
              아래 각 항목이 확인을 누르면 그대로 실행할 내용입니다 (덮어쓰기 전 자동 백업됨).
              <code className="text-amber-500"> skipped</code>로 표시된 항목은 권한 상승(sudo)이
              필요해 아직 자동 실행되지 않습니다 — 표시된 명령을 직접 실행하세요.
            </DialogDescription>
          </DialogHeader>

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
