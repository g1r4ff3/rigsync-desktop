import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { registerDotfileDialogCopy } from '../copy'
import { StatusText } from '../status'
import type {
  DotfileRegistrationCheckDto,
  RegisterDotfileResponse,
  SecretFindingDto,
  SyncItemGroupDto
} from '../../../shared/ipc'

/**
 * WS6("창고 모델 1차" — cheerful-growing-fairy 계획): dotfiles 그룹 헤더의
 * "Add file/folder" 버튼이 여는 다이얼로그 — SEED_DOTFILES 후보뿐 아니라
 * 카탈로그에 아직 없는 **임의** 경로를 새로 등록한다(기존 registerEntry는
 * 이미 manifest에 있는 dotfiles entry의 재캡처만 지원 — registryUiHelpers
 * `showsRegisterButton` 주석 참조, 이 다이얼로그가 그 빈 자리를 채운다).
 *
 * 흐름: 경로 입력(타이핑 또는 Browse 피커) → blur/변경마다
 * `engine:validateDotfilePath`로 검증(존재·homeDir 내부·이미 managed 아님
 * 등, `DotfileRegistrationCheck` 그대로) → 통과하면 link/host 토글과 함께
 * `engine:registerDotfile` 제출. secret 사전 검사에 걸리면 **차단**하고
 * 소견 목록을 그대로 보여준다(계획서 확정 결정 — 경고-통과 아님).
 */
export interface RegisterDotfileDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  /** 등록이 실제로 완료됐을 때(성공) 부모가 목록 스냅샷을 갱신하도록. */
  readonly onRegistered: (groups: readonly SyncItemGroupDto[]) => void
}

function findingsList(findings: readonly SecretFindingDto[]): React.JSX.Element {
  return (
    <ul className="space-y-0.5 rounded border border-status-warn/40 bg-status-warn/10 p-2 font-mono text-[11px]">
      {findings.map((f, i) => (
        <li key={i} className="text-foreground">
          {f.path}:{f.line} — {f.label} ({f.maskedExcerpt})
        </li>
      ))}
    </ul>
  )
}

export function RegisterDotfileDialog({
  open,
  onOpenChange,
  onRegistered
}: RegisterDotfileDialogProps): React.JSX.Element {
  const [homePath, setHomePath] = useState('')
  const [link, setLink] = useState(true)
  const [host, setHost] = useState(false)

  const [check, setCheck] = useState<DotfileRegistrationCheckDto | null>(null)
  const [checking, setChecking] = useState(false)
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secretFindings, setSecretFindings] = useState<readonly SecretFindingDto[] | null>(null)
  const [response, setResponse] = useState<RegisterDotfileResponse | null>(null)

  function runCheck(path: string): void {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    if (path.trim().length === 0) {
      setCheck(null)
      setChecking(false)
      return
    }
    setChecking(true)
    checkTimerRef.current = setTimeout(() => {
      window.api.engine
        .validateDotfilePath({ homePath: path.trim() })
        .then(setCheck, (err: unknown) =>
          setError(err instanceof Error ? err.message : String(err))
        )
        .finally(() => setChecking(false))
    }, 300)
  }

  function handlePathChange(next: string): void {
    setHomePath(next)
    setResponse(null)
    setSecretFindings(null)
    setError(null)
    runCheck(next)
  }

  async function handleBrowse(): Promise<void> {
    const result = await window.api.dotfiles.pickPath()
    if (result.canceled || !result.path) return
    setHomePath(result.path)
    setResponse(null)
    setSecretFindings(null)
    setError(null)
    runCheck(result.path)
  }

  async function handleSubmit(): Promise<void> {
    if (!check?.ok) return
    setSubmitting(true)
    setError(null)
    setSecretFindings(null)
    try {
      const res = await window.api.engine.registerDotfile({
        homePath: homePath.trim(),
        link,
        host
      })
      setResponse(res)
      if (res.ok) {
        onRegistered(res.groups)
      } else if (res.reason === 'secret-scan-blocked') {
        setSecretFindings(res.findings)
      } else {
        setError(res.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  function reset(): void {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current)
    setHomePath('')
    setLink(true)
    setHost(false)
    setCheck(null)
    setChecking(false)
    setSubmitting(false)
    setError(null)
    setSecretFindings(null)
    setResponse(null)
  }

  const done = response?.ok === true
  const donePushFailed = done && response.sync.kind === 'error'

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{registerDotfileDialogCopy.title}</DialogTitle>
          <DialogDescription>{registerDotfileDialogCopy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-foreground">
              {registerDotfileDialogCopy.pathLabel}
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border border-border bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none"
                value={homePath}
                onChange={(e) => handlePathChange(e.target.value)}
                placeholder={registerDotfileDialogCopy.pathPlaceholder}
                disabled={done}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={done}
                    onClick={() => void handleBrowse()}
                  >
                    {registerDotfileDialogCopy.browseButton.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{registerDotfileDialogCopy.browseButton.subtitle}</TooltipContent>
              </Tooltip>
            </div>
            {checking && (
              <p className="text-xs text-muted-foreground">{registerDotfileDialogCopy.checking}</p>
            )}
            {!checking && check && !check.ok && (
              <StatusText kind="error">{check.message}</StatusText>
            )}
            {!checking && check?.ok && (
              <StatusText kind="ok">
                {check.homeKey} ({check.type === 'dir' ? '폴더' : '파일'})
              </StatusText>
            )}
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 text-xs">
                <Switch size="sm" checked={link} onCheckedChange={setLink} disabled={done} />
                <span className="text-foreground">
                  {registerDotfileDialogCopy.linkToggle.label}
                </span>
              </label>
            </TooltipTrigger>
            <TooltipContent>{registerDotfileDialogCopy.linkToggle.subtitle}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <label className="flex items-center gap-2 text-xs">
                <Switch size="sm" checked={host} onCheckedChange={setHost} disabled={done} />
                <span className="text-foreground">
                  {registerDotfileDialogCopy.hostToggle.label}
                </span>
              </label>
            </TooltipTrigger>
            <TooltipContent>{registerDotfileDialogCopy.hostToggle.subtitle}</TooltipContent>
          </Tooltip>

          {secretFindings && secretFindings.length > 0 && (
            <div className="space-y-1">
              <StatusText kind="error">{registerDotfileDialogCopy.secretBlockedTitle}</StatusText>
              <p className="text-[11px] text-muted-foreground">
                {registerDotfileDialogCopy.secretBlockedHint}
              </p>
              {findingsList(secretFindings)}
            </div>
          )}

          {error && <StatusText kind="error">{error}</StatusText>}
          {done && !donePushFailed && (
            <StatusText kind="ok">{registerDotfileDialogCopy.doneMessage}</StatusText>
          )}
          {donePushFailed && response.ok && (
            <StatusText kind="error">
              {`${registerDotfileDialogCopy.pushFailedPrefix}${response.sync.kind === 'error' ? response.sync.message : ''}`}
            </StatusText>
          )}
        </div>

        <DialogFooter>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
                {done
                  ? registerDotfileDialogCopy.closeButton.label
                  : registerDotfileDialogCopy.cancelButton.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {done
                ? registerDotfileDialogCopy.closeButton.subtitle
                : registerDotfileDialogCopy.cancelButton.subtitle}
            </TooltipContent>
          </Tooltip>
          {!done && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!check?.ok || submitting || checking}
                >
                  {submitting
                    ? registerDotfileDialogCopy.runningLabel
                    : registerDotfileDialogCopy.submitButton.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{registerDotfileDialogCopy.submitButton.subtitle}</TooltipContent>
            </Tooltip>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
