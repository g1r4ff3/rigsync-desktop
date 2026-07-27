import { Copy, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { truncatePathStart } from '@/lib/utils'
import { StatusText } from '../status'
import type { StatusKind } from '../statusKind'
import type { EngineStatus, SyncStatusDto } from '../../../shared/ipc'

/**
 * UI 정돈(v0.1.16) — GTK 기본 타이틀바를 제거(main/index.ts `frame: false`)
 * 하고 이 컴포넌트가 그 자리를 대신한다. 기존 App.tsx 상단 헤더 줄(machineId·
 * role·sync 상태·manifestDir)을 여기로 통합했다 — 헤더가 따로 있으면 타이틀바
 * 아래 중복된 얇은 띠가 하나 더 생겨 수직 공간을 낭비하고(Claude Desktop
 * 레퍼런스의 "최소한의 크롬" 원칙 위반), 원래도 창 맨 위 한 줄이었던 정보라
 * 자연스럽게 합쳐진다.
 *
 * 드래그: 바 전체가 `-webkit-app-region: drag`이고, 클릭 가능한 요소(경로
 * 툴팁 트리거·창 제어 버튼)만 `no-drag`로 뚫는다. 더블클릭으로 최대화/복원
 * 토글 — no-drag 구간에서는 버블링을 막아 의도치 않은 토글을 방지한다.
 */

const MANIFEST_DIR_MAX_CHARS = 34
const NO_DRAG: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as React.CSSProperties
const DRAG: React.CSSProperties = { WebkitAppRegion: 'drag' } as React.CSSProperties

function syncStatusLabel(status: SyncStatusDto | null): string {
  if (!status) return ''
  if (status.kind === 'local-only') return '로컬 전용'
  if (status.kind === 'synced') return '동기화됨'
  if (status.kind === 'behind') return `뒤처짐 (${status.behindBy})`
  return `오류: ${status.message}`
}

function WindowButton({
  onClick,
  label,
  danger,
  children
}: {
  readonly onClick: () => void
  readonly label: string
  readonly danger?: boolean
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      style={NO_DRAG}
      className={
        'flex h-9 w-11 items-center justify-center text-muted-foreground transition-colors duration-150 ' +
        (danger ? 'hover:bg-destructive hover:text-white' : 'hover:bg-accent hover:text-foreground')
      }
    >
      {children}
    </button>
  )
}

export interface TitleBarProps {
  readonly status: EngineStatus | null
  readonly statusError: string | null
  readonly syncStatus: SyncStatusDto | null
  readonly syncKind: StatusKind | null
}

export function TitleBar({
  status,
  statusError,
  syncStatus,
  syncKind
}: TitleBarProps): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.windowControls.isMaximized().then(setMaximized, () => {})
    return window.api.windowControls.onMaximizeChanged(setMaximized)
  }, [])

  return (
    <div
      className="flex h-9 shrink-0 items-center border-b border-border bg-card text-xs select-none"
      style={DRAG}
      onDoubleClick={() => void window.api.windowControls.toggleMaximize()}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden pl-3">
        <span className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
          rigsync
        </span>
        {status ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground">
            <span className="shrink-0">·</span>
            <span className="shrink-0">
              {status.machineId} · {status.role}
            </span>
            {syncKind && (
              <>
                <span className="shrink-0">·</span>
                <StatusText kind={syncKind} className="inline-flex shrink-0">
                  {syncStatusLabel(syncStatus)}
                </StatusText>
              </>
            )}
            <span className="shrink-0">·</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="max-w-[34ch] shrink-0 overflow-hidden font-mono text-[11px]"
                  style={NO_DRAG}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {truncatePathStart(status.manifestDir, MANIFEST_DIR_MAX_CHARS)}
                </span>
              </TooltipTrigger>
              {/* 실측 버그 수정(v0.1.16): 이전엔 max-w-none이라 긴 경로가 트리거를
                  중심으로 양옆으로 한없이 펼쳐져 같은 줄의 "동기화됨" 텍스트와
                  겹쳐 렌더됐다 — 창 아래(side="bottom")로 내리고 폭을 제한해
                  줄바꿈시키면 같은 줄과 겹칠 여지가 구조적으로 없어진다. */}
              <TooltipContent side="bottom" align="end" className="max-w-md break-all">
                {status.manifestDir}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : statusError ? (
          <StatusText kind="error" className="truncate">
            {statusError}
          </StatusText>
        ) : (
          <span className="text-muted-foreground">로딩 중…</span>
        )}
      </div>
      <div className="flex h-full shrink-0 items-stretch">
        <WindowButton label="Minimize" onClick={() => void window.api.windowControls.minimize()}>
          <Minus className="size-3.5" aria-hidden="true" />
        </WindowButton>
        <WindowButton
          label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => void window.api.windowControls.toggleMaximize()}
        >
          {maximized ? (
            <Copy className="size-3.5" aria-hidden="true" />
          ) : (
            <Square className="size-3" aria-hidden="true" />
          )}
        </WindowButton>
        <WindowButton label="Close" danger onClick={() => void window.api.windowControls.close()}>
          <X className="size-4" aria-hidden="true" />
        </WindowButton>
      </div>
    </div>
  )
}
