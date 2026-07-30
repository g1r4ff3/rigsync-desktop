import { captureReportCopy } from '../copy'
import { StatusText } from '../status'
import type { CaptureAllReport } from '../captureAll'

/**
 * v0.1.20 1번: Capture 완료 피드백 — DiffView·SyncItemsView 둘 다 Capture
 * 버튼을 갖고 있어(둘 다 captureAll()을 부른다) 리포트 렌더링을 여기 하나로
 * 모았다(중복 방지). 새 대형 UI가 아니라 기존 "결과 목록" 디자인 언어
 * (DiffView Apply 다이얼로그의 `rounded border border-border bg-muted p-2` +
 * StatusText)를 그대로 재사용한다.
 *
 * 셋 중 하나만 보인다: 실패가 하나라도 있으면 error, 없고 변경이 있으면 ok,
 * 변경도 실패도 없으면 muted("반영된 변경 없음"). notes(스킵 사유·에러
 * 메시지, capability 라벨 접두어 포함)는 있으면 항상 그대로 나열한다 —
 * 성공/실패와 무관하게 숨기지 않는다.
 */
export function CaptureReportSummary({
  report,
  onDismiss
}: {
  readonly report: CaptureAllReport
  readonly onDismiss: () => void
}): React.JSX.Element {
  const kind = report.hasErrors ? 'error' : report.hasChanges ? 'ok' : 'muted'
  const failedCount = report.capabilities.filter((c) => !c.ok).length
  const heading = report.hasErrors
    ? captureReportCopy.errorsHeading(failedCount)
    : report.hasChanges
      ? captureReportCopy.changesHeading(report.totalAdded, report.totalUpdated)
      : captureReportCopy.noChangesHeading

  return (
    <div className="min-w-0 rounded border border-border bg-muted p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <StatusText kind={kind} className="min-w-0">
          {heading}
        </StatusText>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {captureReportCopy.dismiss}
        </button>
      </div>
      {report.notes.length > 0 && (
        <div className="mt-1.5">
          <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {captureReportCopy.notesLabel}
          </p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {report.notes.map((note, index) => (
              <li key={index} className="break-words">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
