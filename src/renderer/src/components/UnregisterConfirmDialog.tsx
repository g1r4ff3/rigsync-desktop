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
import { unregisterActionCopy } from '../copy'
import { StatusText } from '../status'
import type { RegisterCapability, SyncStatusDto } from '../../../shared/ipc'

/**
 * WS4("창고 모델 1차") "Remove from catalog" 확인 다이얼로그 — DeleteConfirmDialog
 * (로컬 시스템 삭제, 안전 불변식 5)와 혼동되지 않도록 완전히 별도 컴포넌트로
 * 둔다: 이건 manifest 등재만 지우고 로컬 파일·설치는 절대 건드리지 않는다.
 *
 * 열릴 때 `listEntrySubscribers`로 이 항목을 구독 중인 머신을 조회해 보여준다
 * — selection.ts의 정직한 한계(전체 구독 머신은 selection.toml이 없어 열거
 * 불가)를 그대로 안내한다(unregisterActionCopy.unlistableSubscribersNotice).
 *
 * `item`은 부모가 다이얼로그를 열 때만 새로 만든다 — SyncItemsView가 열 때마다
 * `key`를 바꿔 이 컴포넌트를 리마운트하므로(DeleteConfirmDialog와 같은 패턴)
 * "열릴 때 이전 상태 리셋" 로직이 따로 필요 없다.
 */
export interface UnregisterConfirmDialogProps {
  readonly item: {
    readonly capability: RegisterCapability
    readonly key: string
    readonly label: string
  } | null
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** 삭제가 실제로 완료됐을 때(성공) 부모가 목록을 새로고침하도록. */
  readonly onCompleted: () => void
}

export function UnregisterConfirmDialog({
  item,
  open,
  onOpenChange,
  onCompleted
}: UnregisterConfirmDialogProps): React.JSX.Element {
  const [subscribers, setSubscribers] = useState<readonly string[] | null>(null)
  const [subscribersError, setSubscribersError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [sync, setSync] = useState<SyncStatusDto | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !item) return
    window.api.engine
      .listEntrySubscribers({ capability: item.capability, key: item.key })
      .then(setSubscribers, (err: unknown) =>
        setSubscribersError(err instanceof Error ? err.message : String(err))
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open 전환 시에만(부모가 key로 리마운트)
  }, [open])

  async function confirmUnregister(): Promise<void> {
    if (!item) return
    setRunning(true)
    setError(null)
    try {
      const response = await window.api.engine.unregisterEntry({
        capability: item.capability,
        key: item.key
      })
      setSync(response.sync)
      onCompleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  const done = sync !== null
  const loadingSubscribers = open && subscribers === null && subscribersError === null

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{unregisterActionCopy.dialogTitle(item?.label ?? '')}</DialogTitle>
          <DialogDescription>{unregisterActionCopy.localFilesNotice}</DialogDescription>
        </DialogHeader>

        {loadingSubscribers && (
          <p className="text-xs text-muted-foreground">{unregisterActionCopy.loadingSubscribers}</p>
        )}
        {subscribersError && <StatusText kind="error">{subscribersError}</StatusText>}
        {subscribers && (
          <p className="text-xs text-muted-foreground">
            {subscribers.length > 0
              ? unregisterActionCopy.subscribersFound(subscribers)
              : unregisterActionCopy.noSubscribersFound}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {unregisterActionCopy.unlistableSubscribersNotice}
        </p>

        {error && <StatusText kind="error">{error}</StatusText>}
        {sync?.kind === 'error' && (
          <StatusText kind="error">{`${unregisterActionCopy.label} 완료 — 단 동기화 실패: ${sync.message}`}</StatusText>
        )}
        {done && sync?.kind !== 'error' && <StatusText kind="ok">삭제 완료</StatusText>}

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={running}>
                {done
                  ? unregisterActionCopy.closeButton.label
                  : unregisterActionCopy.cancelButton.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {done
                ? unregisterActionCopy.closeButton.subtitle
                : unregisterActionCopy.cancelButton.subtitle}
            </TooltipContent>
          </Tooltip>
          {!done && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="destructive" onClick={confirmUnregister} disabled={running}>
                  {running
                    ? unregisterActionCopy.runningLabel
                    : unregisterActionCopy.confirmButton.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{unregisterActionCopy.confirmButton.subtitle}</TooltipContent>
            </Tooltip>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
