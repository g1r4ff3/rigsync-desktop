import { useEffect, useState } from 'react'
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
import { deleteConfirmCopy } from '../copy'
import type { DeletableItem } from '../deleteEligibility'
import { StatusText } from '../status'
import { planActionStatusKind } from '../statusKind'
import type { PlanActionResultDto, PlanEvent, PlanUninstallResponse } from '../../../shared/ipc'

/**
 * 삭제 확인 다이얼로그(단건·일괄 공용) — 안전 불변식 5 + 불변식 ⑥의 UI 구현.
 * DiffView의 Apply 확인 다이얼로그와 같은 2단계 패턴(dry-run 미리보기 →
 * 확인 → 실행 + 실시간 진행)을 그대로 따른다. 다른 점은 실행 채널이
 * `engine:planUninstall`/`engine:runUninstall`이라는 것뿐 — 이벤트 스트림
 * (`engine:planEvent`)은 apply와 같은 채널을 공유한다(엔진 실행기 하나).
 *
 * `items`는 부모(SyncItemsView)가 다이얼로그를 열 때만 새로 만든다(매 렌더
 * 새 배열을 만들면 안 됨) — 아래 effect가 `open` 전환 시에만 미리보기를
 * 새로 계산한다.
 */
export interface DeleteConfirmDialogProps {
  readonly items: readonly DeletableItem[]
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** 삭제가 실제로 실행되어 완료됐을 때(성공/실패 무관) 부모가 목록을 새로고침하도록. */
  readonly onCompleted: () => void
}

type RowLiveState = { running?: boolean; ok?: boolean; error?: string }

function statusLabel(
  index: number,
  preview: PlanUninstallResponse | null,
  finalResults: readonly PlanActionResultDto[] | null,
  live: Record<number, RowLiveState>
): string {
  if (finalResults) return finalResults[index]?.status ?? '?'
  if (live[index]?.running) return 'running'
  return preview?.actions[index]?.status ?? '?'
}

export function DeleteConfirmDialog({
  items,
  open,
  onOpenChange,
  onCompleted
}: DeleteConfirmDialogProps): React.JSX.Element {
  // R4 패턴과 다른 점: 이 다이얼로그는 단건(행)·일괄(체크리스트) 두 곳에서
  // 열리므로 부모(SyncItemsView)가 "새 삭제 요청"마다 `key`를 바꿔 이 컴포넌트
  // 전체를 리마운트한다 — 그래서 여기서는 "열릴 때 이전 상태를 리셋"하는
  // 효과가 필요 없다(리마운트 자체가 리셋). 이 effect는 순수 초기 조회라
  // useEffect 안에서 setState를 직접 부르지 않고(react-hooks/set-state-in-effect
  // 위반 회피) `.then()` 콜백 안에서만 부른다 — `loadingPreview`도 별도 state
  // 대신 preview/previewError가 둘 다 비어있는 파생값으로 표현한다.
  const [preview, setPreview] = useState<PlanUninstallResponse | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const loadingPreview = open && preview === null && previewError === null
  const [live, setLive] = useState<Record<number, RowLiveState>>({})
  const [finalResults, setFinalResults] = useState<readonly PlanActionResultDto[] | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open) return
    const request = { items: items.map((i) => ({ capability: i.capability, key: i.key })) }
    window.api.engine
      .planUninstall(request)
      .then(setPreview, (err: unknown) =>
        setPreviewError(err instanceof Error ? err.message : String(err))
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 전환 시에만(부모가 key로 리마운트하므로 items는 마운트 동안 고정)
  }, [open])

  async function confirmDelete(): Promise<void> {
    setApplying(true)
    setLive({})
    const request = { items: items.map((i) => ({ capability: i.capability, key: i.key })) }
    const unsubscribe = window.api.engine.onPlanEvent((event: PlanEvent) => {
      if (event.type === 'action_start') {
        setLive((prev) => ({ ...prev, [event.index]: { running: true } }))
      } else if (event.type === 'action_done') {
        setLive((prev) => ({ ...prev, [event.index]: { ok: event.ok, error: event.error } }))
      }
    })
    try {
      const executed = await window.api.engine.runUninstall(request)
      setFinalResults(executed.results)
      onCompleted()
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      unsubscribe()
      setApplying(false)
    }
  }

  const doneSummary = finalResults
    ? deleteConfirmCopy.doneSummary(
        finalResults.filter((r) => r.status === 'ok').length,
        finalResults.filter((r) => r.status === 'failed' || r.status === 'refused').length
      )
    : null

  return (
    <Dialog open={open} onOpenChange={(next) => !applying && onOpenChange(next)}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{deleteConfirmCopy.title(items.length)}</DialogTitle>
          <DialogDescription>{deleteConfirmCopy.description}</DialogDescription>
        </DialogHeader>

        {loadingPreview && (
          <p className="text-xs text-muted-foreground">{deleteConfirmCopy.loadingPreview}</p>
        )}
        {previewError && <StatusText kind="error">{previewError}</StatusText>}

        {preview && preview.aptDependencies && preview.aptDependencies.extra.length > 0 && (
          <div className="rounded border border-status-warn/40 bg-status-warn/10 p-2">
            <p className="mb-1 text-xs font-medium text-status-warn">
              {deleteConfirmCopy.dependencyWarningTitle}
            </p>
            <p className="font-mono text-xs break-all text-muted-foreground">
              {preview.aptDependencies.extra.join(', ')}
            </p>
          </div>
        )}

        {preview && preview.sudoScriptPreview && (
          <div className="rounded border border-border bg-muted p-2">
            <p className="mb-1 text-xs text-status-warn">
              관리자 권한 스크립트 (polkit 1회 인증으로 실행)
            </p>
            <pre className="max-h-48 overflow-y-auto font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
              {preview.sudoScriptPreview}
            </pre>
          </div>
        )}

        {preview && preview.actions.length === 0 && preview.excluded.length > 0 && (
          <StatusText kind="warn">{deleteConfirmCopy.noValidTargets}</StatusText>
        )}

        {preview && preview.actions.length > 0 && (
          <ul className="space-y-3">
            {preview.actions.map((action, index) => {
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
                  {(finalResults?.[index]?.detail ?? liveRow?.error) && (
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      {finalResults?.[index]?.detail ?? liveRow?.error}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {preview && preview.excluded.length > 0 && (
          <div className="rounded border border-border p-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {deleteConfirmCopy.excludedTitle}
            </p>
            <ul className="space-y-0.5">
              {preview.excluded.map((e) => (
                <li key={`${e.capability}:${e.key}`} className="text-xs text-muted-foreground">
                  <span className="font-mono">
                    [{e.capability}] {e.key}
                  </span>{' '}
                  — {e.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {doneSummary && <StatusText kind="ok">{doneSummary}</StatusText>}

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={applying}>
                {finalResults !== null
                  ? deleteConfirmCopy.closeButton.label
                  : deleteConfirmCopy.cancelButton.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {finalResults !== null
                ? deleteConfirmCopy.closeButton.subtitle
                : deleteConfirmCopy.cancelButton.subtitle}
            </TooltipContent>
          </Tooltip>
          {finalResults === null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={applying || !preview || preview.actions.length === 0}
                >
                  {applying
                    ? deleteConfirmCopy.runningLabel
                    : deleteConfirmCopy.confirmButton.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{deleteConfirmCopy.confirmButton.subtitle}</TooltipContent>
            </Tooltip>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
