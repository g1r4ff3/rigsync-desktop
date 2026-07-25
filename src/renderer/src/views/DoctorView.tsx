import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DoctorReportDto } from '../../../shared/ipc'

/**
 * doctor 탭(P2d 세 번째 새 탭) — 전 capability의 preflight/check를 한 화면에
 * 통합한다: 기본 진단(machine-id/role/manifest 존재) + T3 appimage preflight
 * (P2c `checkAppimagePreflight`) + 구 repo checks(수동 체크리스트) 레이어
 * (gui.py `doctor_visible`/`_build_doctor_page` 행동 이식 — "더 이상 점검 안
 * 함" 토글로 ignore.toml에 쌓인다).
 */
function DoctorView(): React.JSX.Element {
  const [report, setReport] = useState<DoctorReportDto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  async function refresh(): Promise<void> {
    setReport(await window.api.engine.getDoctorReport())
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
          <p className="font-mono text-xs text-red-400">error: {error}</p>
        ) : (
          <p className="font-mono text-xs text-neutral-500">로딩 중…</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button variant="secondary" onClick={() => void refresh()}>
          재점검
        </Button>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-300">기본 진단</h2>
        <ul className="space-y-1 font-mono text-xs">
          <li>machine-id: {report.basic.machineId}</li>
          <li>role: {report.basic.role}</li>
          <li className={report.basic.configConfigured ? 'text-green-400' : 'text-amber-400'}>
            config.toml: {report.basic.configConfigured ? '설정됨' : '미설정 (dev 기본값)'}
          </li>
          <li className={report.basic.manifestDirExists ? 'text-green-400' : 'text-amber-400'}>
            manifestDir: {report.basic.manifestDirExists ? '존재함' : '아직 없음'}
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-neutral-300">
          T3 appimage (Gear Lever) preflight
        </h2>
        <ul className="space-y-1 font-mono text-xs">
          <li className={report.appimage.gearLeverInstalled ? 'text-green-400' : 'text-red-400'}>
            Gear Lever 설치됨: {String(report.appimage.gearLeverInstalled)}
          </li>
          <li>
            버전 요건 충족:{' '}
            {report.appimage.gearLeverVersionOk === null
              ? '확인 불가'
              : String(report.appimage.gearLeverVersionOk)}
          </li>
          <li
            className={report.appimage.libfuse2t64Installed ? 'text-green-400' : 'text-amber-400'}
          >
            libfuse2t64: {String(report.appimage.libfuse2t64Installed)}
          </li>
          {report.appimage.appImageLauncherPresent && (
            <li className="text-amber-400">AppImageLauncher 설치됨 (충돌 가능)</li>
          )}
        </ul>
        {report.appimage.warnings.length > 0 && (
          <ul className="mt-1 space-y-1 font-mono text-xs text-amber-400">
            {report.appimage.warnings.map((w) => (
              <li key={w}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </section>

      {report.checksVisible && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-neutral-300">체크리스트</h2>
          <ul className="space-y-2 font-mono text-xs">
            {report.checks.map((c) => (
              <li
                key={c.name}
                className="flex items-center justify-between gap-2 rounded border border-border p-2"
              >
                <div>
                  <div className={c.result === 'pass' ? 'text-green-400' : 'text-red-400'}>
                    [{c.result}] {c.name} ({c.type})
                  </div>
                  <div className="text-neutral-500">{c.detail}</div>
                  {c.hint && <div className="text-neutral-600">hint: {c.hint}</div>}
                </div>
                <Button
                  variant="secondary"
                  disabled={pending[c.name]}
                  onClick={() => void ignoreCheck(c.name)}
                >
                  더 이상 점검 안 함
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

export default DoctorView
