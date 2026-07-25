import { useEffect, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { HelpPopover } from '@/components/HelpPopover'
import { buttonCopy, emptyStateCopy, helpCopy } from '../copy'
import { StatusText } from '../status'
import { doctorResultKind } from '../statusKind'
import type { DoctorReportDto } from '../../../shared/ipc'

/**
 * doctor 탭(P2d 세 번째 새 탭) — 전 capability의 preflight/check를 한 화면에
 * 통합한다: 기본 진단(machine-id/role/manifest 존재) + T3 appimage preflight
 * (P2c `checkAppimagePreflight`) + NVIDIA 드라이버 불일치(P4) + 구 repo
 * checks(수동 체크리스트) 레이어(gui.py `doctor_visible`/`_build_doctor_page`
 * 행동 이식 — "더 이상 점검 안 함" 토글로 ignore.toml에 쌓인다).
 */
function DoctorView(): React.JSX.Element {
  const [report, setReport] = useState<DoctorReportDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState(false)

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      setReport(await window.api.engine.getDoctorReport())
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    window.api.engine
      .getDoctorReport()
      .then(setReport, (err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  async function ignoreCheck(name: string): Promise<void> {
    setPending((prev) => ({ ...prev, [name]: true }))
    try {
      const next = await window.api.engine.ignoreDoctorCheck({ name, ignored: true })
      setReport(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending((prev) => ({ ...prev, [name]: false }))
    }
  }

  if (!report) {
    return (
      <div>
        {error ? (
          <StatusText kind="error">{error}</StatusText>
        ) : (
          <p className="text-xs text-muted-foreground">{emptyStateCopy.loading}</p>
        )}
      </div>
    )
  }

  return (
    <div className="h-full space-y-5 overflow-y-auto pr-1">
      <div className="flex items-start justify-between gap-2">
        <HelpPopover text={helpCopy.doctor} />
        <ActionButton
          variant="secondary"
          label={buttonCopy.refresh.label}
          subtitle={buttonCopy.refresh.subtitle}
          disabled={refreshing}
          onClick={() => void refresh()}
        />
      </div>

      <section>
        <h2 className="text-sm font-medium text-foreground">Basic diagnostics</h2>
        <p className="mb-1.5 text-xs text-muted-foreground">
          machine-id·role·manifest 폴더 존재 여부
        </p>
        <ul className="space-y-1 text-xs">
          <li className="font-mono text-muted-foreground">machine-id: {report.basic.machineId}</li>
          <li className="font-mono text-muted-foreground">role: {report.basic.role}</li>
          <li>
            <StatusText kind={report.basic.configConfigured ? 'ok' : 'warn'}>
              config.toml: {report.basic.configConfigured ? '설정됨' : '미설정 (dev 기본값)'}
            </StatusText>
          </li>
          <li>
            <StatusText kind={report.basic.manifestDirExists ? 'ok' : 'warn'}>
              manifestDir: {report.basic.manifestDirExists ? '존재함' : '아직 없음'}
            </StatusText>
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-foreground">AppImage (Gear Lever) preflight</h2>
        <p className="mb-1.5 text-xs text-muted-foreground">
          T3 AppImage 자동 통합에 필요한 선행 조건
        </p>
        <ul className="space-y-1 text-xs">
          <li>
            <StatusText kind={report.appimage.gearLeverInstalled ? 'ok' : 'error'}>
              Gear Lever 설치됨: {String(report.appimage.gearLeverInstalled)}
            </StatusText>
          </li>
          <li>
            <StatusText kind={report.appimage.gearLeverVersionOk ? 'ok' : 'muted'}>
              버전 요건 충족:{' '}
              {report.appimage.gearLeverVersionOk === null
                ? '확인 불가'
                : String(report.appimage.gearLeverVersionOk)}
            </StatusText>
          </li>
          <li>
            <StatusText kind={report.appimage.libfuse2t64Installed ? 'ok' : 'warn'}>
              libfuse2t64: {String(report.appimage.libfuse2t64Installed)}
            </StatusText>
          </li>
          {report.appimage.appImageLauncherPresent && (
            <li>
              <StatusText kind="warn">AppImageLauncher 설치됨 (충돌 가능)</StatusText>
            </li>
          )}
        </ul>
        {report.appimage.warnings.length > 0 && (
          <ul className="mt-1 space-y-1">
            {report.appimage.warnings.map((w) => (
              <li key={w}>
                <StatusText kind="warn">{w}</StatusText>
              </li>
            ))}
          </ul>
        )}
      </section>

      {report.nvidia.applicable && (
        <section>
          <h2 className="text-sm font-medium text-foreground">NVIDIA driver</h2>
          <p className="mb-1.5 text-xs text-muted-foreground">
            커널 모듈(NVRM) vs 설치된 드라이버 패키지 버전 비교
          </p>
          <ul className="space-y-1 text-xs">
            <li>
              <StatusText kind={report.nvidia.matched ? 'ok' : 'warn'}>
                NVRM {report.nvidia.nvrmVersion ?? '?'} / 패키지{' '}
                {report.nvidia.userspaceVersion ?? '?'}
              </StatusText>
            </li>
          </ul>
          {report.nvidia.warning && (
            <p className="mt-1">
              <StatusText kind="warn">{report.nvidia.warning}</StatusText>
            </p>
          )}
        </section>
      )}

      {report.checksVisible && (
        <section>
          <h2 className="text-sm font-medium text-foreground">Checklist</h2>
          <p className="mb-1.5 text-xs text-muted-foreground">
            rigsync가 자동화하지 않는 수동 설치·설정 점검 목록
          </p>
          <ul className="space-y-2">
            {report.checks.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-2 rounded border border-border p-2 text-xs"
              >
                <div>
                  <StatusText kind={doctorResultKind(c.result)}>
                    {c.name} ({c.type})
                  </StatusText>
                  <div className="mt-0.5 font-mono text-muted-foreground">{c.detail}</div>
                  {c.hint && <div className="font-mono text-status-muted">hint: {c.hint}</div>}
                </div>
                <ActionButton
                  variant="secondary"
                  size="sm"
                  label={buttonCopy.ignoreCheck.label}
                  subtitle={buttonCopy.ignoreCheck.subtitle}
                  disabled={pending[c.name]}
                  onClick={() => void ignoreCheck(c.name)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!report.checksVisible && (
        <p className="text-xs text-muted-foreground">{emptyStateCopy.noChecks}</p>
      )}
    </div>
  )
}

export default DoctorView
