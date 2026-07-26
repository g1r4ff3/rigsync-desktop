import { useEffect, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { buttonCopy, doctorCopy, emptyStateCopy } from '../copy'
import { StatusIcon, StatusText } from '../status'
import { doctorResultKind, type StatusKind } from '../statusKind'
import type { DoctorReportDto } from '../../../shared/ipc'

/**
 * P4 자기 업데이트 체크 — `src/engine/doctor/selfUpdateCheck.ts`가 만드는 필드를
 * `DoctorReport`엔 얹었지만, `shared/ipc.ts`의 `DoctorReportDto`는 다른
 * 에이전트(binaries capability) 소유라 이 작업에서 손댈 수 없다(작업 스펙의
 * 파일 소유권 분리). `buildDoctorReport`가 반환하는 실제 런타임 객체엔
 * `selfUpdate` 필드가 이미 실려 오므로(구조적으로 잘려나가지 않는다 — IPC는
 * 실제 객체를 그대로 전달하고 TS 타입은 컴파일타임 라벨일 뿐), 여기서만
 * 로컬로 타입을 넓혀 소비한다. DTO 본체를 고치는 정공법이 아니라 이 파일
 * 안에서만 쓰는 임시 우회임을 남겨둔다.
 */
type SelfUpdateStatusCode =
  'not-appimage' | 'gearlever-missing' | 'not-integrated' | 'source-missing' | 'configured'

interface SelfUpdateCheckDto {
  readonly applicable: boolean
  readonly status: SelfUpdateStatusCode
  readonly warning?: string
  readonly manualCommand?: string
}

type DoctorReportWithSelfUpdate = DoctorReportDto & { readonly selfUpdate: SelfUpdateCheckDto }

/**
 * doctor 탭(P2d 세 번째 새 탭) — 전 capability의 preflight/check를 한 화면에
 * 통합한다: 기본 진단(machine-id/role/manifest 존재) + T3 appimage preflight
 * (P2c `checkAppimagePreflight`) + NVIDIA 드라이버 불일치(P4) + 구 repo
 * checks(수동 체크리스트) 레이어(gui.py `doctor_visible`/`_build_doctor_page`
 * 행동 이식 — "더 이상 점검 안 함" 토글로 ignore.toml에 쌓인다).
 *
 * R5 라운드5 재설계 — 실기 지적: "Recheck 버튼이 왜 여기 있나, 열자마자
 * recheck? 뭘 말하는지 모르겠다." 원인은 두 가지였다: ① 통과/경고/실패
 * 요약이 없어 3초 안에 읽을 게 없었고, ② "마지막 점검 시각"이 없어
 * Recheck이 "무엇을 다시" 하는지 알 근거가 없었다. 요약 카드(통과/경고/실패
 * 건수 + 마지막 점검 시각 + 그 옆의 Recheck)를 상단에 고정하고, 그 아래
 * 상세 섹션은 전부 통과인 그룹만 `<details>`로 접어 밀도를 낮춘다(Differences
 * 탭의 matchedCapabilities 컴팩트 패턴과 동일 원칙).
 */

type KindCounts = { readonly ok: number; readonly warn: number; readonly error: number }

function countKinds(kinds: readonly StatusKind[]): KindCounts {
  return {
    ok: kinds.filter((k) => k === 'ok').length,
    warn: kinds.filter((k) => k === 'warn').length,
    error: kinds.filter((k) => k === 'error').length
  }
}

function addCounts(a: KindCounts, b: KindCounts): KindCounts {
  return { ok: a.ok + b.ok, warn: a.warn + b.warn, error: a.error + b.error }
}

function basicKinds(
  basic: DoctorReportDto['basic'],
  emptyFollower: DoctorReportDto['emptyFollower']
): StatusKind[] {
  const kinds: StatusKind[] = [
    basic.configConfigured ? 'ok' : 'warn',
    basic.manifestDirExists ? 'ok' : 'warn'
  ]
  if (emptyFollower.warning) kinds.push('warn')
  return kinds
}

function appimageKinds(appimage: DoctorReportDto['appimage']): StatusKind[] {
  const kinds: StatusKind[] = [
    appimage.gearLeverInstalled ? 'ok' : 'error',
    appimage.libfuse2t64Installed ? 'ok' : 'warn'
  ]
  // R5: 이전엔 gearLeverVersionOk===false도 null(확인 불가)과 똑같이 'muted'로
  // 뭉뚱그려져 있었다(순수 렌더 로직 버그 — engine 값 자체는 안 바뀜) — 실제
  // "버전 요건 미충족"은 경고로 세야 요약 건수가 정확해진다.
  if (appimage.gearLeverVersionOk !== null) {
    kinds.push(appimage.gearLeverVersionOk ? 'ok' : 'warn')
  }
  if (appimage.appImageLauncherPresent) kinds.push('warn')
  kinds.push(...appimage.warnings.map((): StatusKind => 'warn'))
  return kinds
}

function fontsKinds(fonts: DoctorReportDto['fonts']): StatusKind[] {
  const kinds: StatusKind[] = [
    fonts.fcCacheAvailable ? 'ok' : 'warn',
    fonts.fcListAvailable ? 'ok' : 'warn'
  ]
  kinds.push(...fonts.missingInstalled.map((): StatusKind => 'warn'))
  kinds.push(...fonts.unresolvedInstalled.map((): StatusKind => 'warn'))
  return kinds
}

function nvidiaKinds(nvidia: DoctorReportDto['nvidia']): StatusKind[] {
  if (!nvidia.applicable) return []
  return [nvidia.matched ? 'ok' : 'warn']
}

/**
 * 소급 시크릿 스캔(⑥) 결과 -- 걸린 finding은 'error'로 센다(경고가 아니라
 * manifest에 실제로 비밀이 실려 있는 상태라 denylist 위반과 같은 심각도).
 * 없으면 빈 배열(= 전부 통과, DoctorGroup이 자동으로 접힌 카드로 보여준다).
 */
function secretScanKinds(secretScan: DoctorReportDto['secretScan']): StatusKind[] {
  return secretScan.blockedFindings.map((): StatusKind => 'error')
}

function checklistKinds(checks: DoctorReportDto['checks']): StatusKind[] {
  return checks.map((c) => doctorResultKind(c.result))
}

/** dev/deb 실행(applicable:false)은 요약 집계에서 아예 빠진다 -- 해당 없음은 통과도 경고도 아니다. */
function selfUpdateKinds(selfUpdate: SelfUpdateCheckDto): StatusKind[] {
  if (!selfUpdate.applicable) return []
  return [selfUpdate.status === 'configured' ? 'ok' : 'warn']
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { hour12: false })
}

function SummaryStat({
  kind,
  label,
  count
}: {
  readonly kind: StatusKind
  readonly label: string
  readonly count: number
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <StatusIcon kind={kind} className="size-4" />
      <span className="text-xl leading-none font-semibold tabular-nums text-foreground">
        {count}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

/** 경고·실패 항목 옆에 "그래서 뭘 해야 하나"를 시각적으로 액션임이 드러나게 보여준다. */
function DoctorActionNote({
  kind,
  text
}: {
  readonly kind: 'warn' | 'error'
  readonly text: string
}): React.JSX.Element {
  return (
    <div
      className={
        'mt-1 flex items-start gap-1.5 rounded border px-2 py-1 text-[11px] ' +
        (kind === 'error'
          ? 'border-status-error/40 bg-status-error/10 text-status-error'
          : 'border-status-warn/40 bg-status-warn/10 text-status-warn')
      }
    >
      <span className="shrink-0 font-medium">{doctorCopy.actionPrefix}:</span>
      <span className="font-mono break-all">{text}</span>
    </div>
  )
}

/**
 * 그룹 하나(Basic/AppImage/NVIDIA/Checklist)의 카드 골격. 경고·실패가 없으면
 * `<details>`로 접어 요약 한 줄만 보여주고(Density 원칙 — 전부 초록인 화면도
 * 스크롤 없이 한 화면에), 하나라도 있으면 항상 펼친 채 보여준다.
 */
function DoctorGroup({
  title,
  description,
  counts,
  summaryExtra,
  children
}: {
  readonly title: string
  readonly description: string
  readonly counts: KindCounts
  /** 접혔을 때 요약 줄에 덧붙일 추가 정보(예: Basic의 machine-id·role). */
  readonly summaryExtra?: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  const allPass = counts.warn === 0 && counts.error === 0
  const body = (
    <>
      <p className="mb-1.5 text-xs text-muted-foreground">{description}</p>
      {children}
    </>
  )
  if (allPass) {
    return (
      <details className="rounded-md border border-border bg-card/50 p-2.5">
        <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium text-foreground">
          <StatusIcon kind="ok" className="size-3.5 shrink-0" />
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">
            — {doctorCopy.allPassed}
            {summaryExtra ? ` · ${summaryExtra}` : ''}
          </span>
        </summary>
        <div className="mt-2 border-t border-border pt-2">{body}</div>
      </details>
    )
  }
  return (
    <section className="rounded-md border border-border p-3">
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      {body}
    </section>
  )
}

function DoctorView(): React.JSX.Element {
  const [report, setReport] = useState<DoctorReportWithSelfUpdate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      setReport((await window.api.engine.getDoctorReport()) as DoctorReportWithSelfUpdate)
      setLastCheckedAt(new Date())
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    window.api.engine.getDoctorReport().then(
      (r) => {
        setReport(r as DoctorReportWithSelfUpdate)
        setLastCheckedAt(new Date())
      },
      (err: unknown) => setError(err instanceof Error ? err.message : String(err))
    )
  }, [])

  async function ignoreCheck(name: string): Promise<void> {
    setPending((prev) => ({ ...prev, [name]: true }))
    try {
      const next = await window.api.engine.ignoreDoctorCheck({ name, ignored: true })
      setReport(next as DoctorReportWithSelfUpdate)
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

  const selfUpdate: SelfUpdateCheckDto = report.selfUpdate ?? {
    applicable: false,
    status: 'not-appimage'
  }

  const basicCounts = countKinds(basicKinds(report.basic, report.emptyFollower))
  const appimageCounts = countKinds(appimageKinds(report.appimage))
  const fontsCounts = countKinds(fontsKinds(report.fonts))
  const nvidiaCounts = countKinds(nvidiaKinds(report.nvidia))
  const secretScanCounts = countKinds(secretScanKinds(report.secretScan))
  const selfUpdateCounts = countKinds(selfUpdateKinds(selfUpdate))
  const checklistCounts = report.checksVisible
    ? countKinds(checklistKinds(report.checks))
    : { ok: 0, warn: 0, error: 0 }
  const totals = [
    basicCounts,
    appimageCounts,
    fontsCounts,
    nvidiaCounts,
    secretScanCounts,
    selfUpdateCounts,
    checklistCounts
  ].reduce(addCounts, {
    ok: 0,
    warn: 0,
    error: 0
  })

  return (
    <div className="flex h-full flex-col">
      {/* R5: 요약 카드 — 통과/경고/실패 건수(3초 안에 읽혀야 할 정보) + 마지막
          점검 시각 + 그 옆의 Recheck. Differences 탭 요약 카드와 같은 골격을
          공유해 화면 간 일관성을 유지한다. */}
      <section className="mb-3 shrink-0 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <SummaryStat kind="ok" label={doctorCopy.summaryOk} count={totals.ok} />
            <SummaryStat kind="warn" label={doctorCopy.summaryWarn} count={totals.warn} />
            <SummaryStat kind="error" label={doctorCopy.summaryError} count={totals.error} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {doctorCopy.lastChecked}:{' '}
              {lastCheckedAt ? formatTime(lastCheckedAt) : doctorCopy.lastCheckedNever}
            </span>
            <ActionButton
              variant="secondary"
              label={buttonCopy.refresh.label}
              subtitle={buttonCopy.refresh.subtitle}
              busy={refreshing}
              disabled={refreshing}
              onClick={() => void refresh()}
            />
          </div>
        </div>
      </section>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        <DoctorGroup
          title="Basic diagnostics"
          description="machine-id·role·manifest 폴더 존재 여부"
          counts={basicCounts}
          summaryExtra={`${report.basic.machineId} · ${report.basic.role}`}
        >
          <ul className="space-y-1 text-xs">
            <li className="font-mono text-muted-foreground">
              machine-id: {report.basic.machineId}
            </li>
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
          {report.emptyFollower.warning && (
            <DoctorActionNote kind="warn" text={report.emptyFollower.warning} />
          )}
        </DoctorGroup>

        <DoctorGroup
          title="AppImage (Gear Lever) preflight"
          description="T3 AppImage 자동 통합에 필요한 선행 조건"
          counts={appimageCounts}
        >
          <ul className="space-y-1 text-xs">
            <li>
              <StatusText kind={report.appimage.gearLeverInstalled ? 'ok' : 'error'}>
                Gear Lever 설치됨: {String(report.appimage.gearLeverInstalled)}
              </StatusText>
            </li>
            <li>
              <StatusText
                kind={
                  report.appimage.gearLeverVersionOk === null
                    ? 'muted'
                    : report.appimage.gearLeverVersionOk
                      ? 'ok'
                      : 'warn'
                }
              >
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
          {report.appimage.warnings.map((w) => (
            <DoctorActionNote key={w} kind="warn" text={w} />
          ))}
        </DoctorGroup>

        {selfUpdate.applicable && (
          <DoctorGroup
            title="Auto-update (self)"
            description="rigsync 자기 자신이 Gear Lever 자동 업데이트 소스로 지정돼 있는지"
            counts={selfUpdateCounts}
          >
            <ul className="space-y-1 text-xs">
              <li>
                <StatusText kind={selfUpdate.status === 'configured' ? 'ok' : 'warn'}>
                  {selfUpdate.status === 'configured'
                    ? '업데이트 소스 지정됨: GithubUpdater (g1r4ff3/rigsync-desktop)'
                    : '업데이트 소스 미지정'}
                </StatusText>
              </li>
            </ul>
            {selfUpdate.warning && <DoctorActionNote kind="warn" text={selfUpdate.warning} />}
          </DoctorGroup>
        )}

        <DoctorGroup
          title="Fonts"
          description="manifest 미설치·소스 미지정 폰트, fc-cache/fc-list 사용 가능 여부"
          counts={fontsCounts}
        >
          <ul className="space-y-1 text-xs">
            <li>
              <StatusText kind={report.fonts.fcCacheAvailable ? 'ok' : 'warn'}>
                fc-cache 사용 가능: {String(report.fonts.fcCacheAvailable)}
              </StatusText>
            </li>
            <li>
              <StatusText kind={report.fonts.fcListAvailable ? 'ok' : 'warn'}>
                fc-list 사용 가능: {String(report.fonts.fcListAvailable)}
              </StatusText>
            </li>
          </ul>
          {report.fonts.warnings.map((w) => (
            <DoctorActionNote key={w} kind="warn" text={w} />
          ))}
        </DoctorGroup>

        {report.nvidia.applicable && (
          <DoctorGroup
            title="NVIDIA driver"
            description="커널 모듈(NVRM) vs 설치된 드라이버 패키지 버전 비교"
            counts={nvidiaCounts}
          >
            <ul className="space-y-1 text-xs">
              <li>
                <StatusText kind={report.nvidia.matched ? 'ok' : 'warn'}>
                  NVRM {report.nvidia.nvrmVersion ?? '?'} / 패키지{' '}
                  {report.nvidia.userspaceVersion ?? '?'}
                </StatusText>
              </li>
            </ul>
            {report.nvidia.warning && <DoctorActionNote kind="warn" text={report.nvidia.warning} />}
          </DoctorGroup>
        )}

        <DoctorGroup
          title="Secret scan"
          description="manifest 저장소 전체 소급 스캔 -- Capture 관문을 우회해 비밀이 남아있는지 확인"
          counts={secretScanCounts}
        >
          {report.secretScan.blockedFindings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              감지된 항목 없음 -- manifest 저장소에 비밀로 보이는 값이 없습니다.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.secretScan.blockedFindings.map((f, i) => (
                <li
                  key={`${f.path}:${f.line}:${f.kind}:${i}`}
                  className="rounded border border-border p-2 text-xs"
                >
                  <StatusText kind="error">
                    {f.path}:{f.line} -- {f.label}
                  </StatusText>
                  <div className="mt-0.5 font-mono text-muted-foreground">{f.maskedExcerpt}</div>
                </li>
              ))}
            </ul>
          )}
          {report.secretScan.warnings.map((w) => (
            <DoctorActionNote key={w} kind="error" text={w} />
          ))}
        </DoctorGroup>

        {report.checksVisible && (
          <DoctorGroup
            title="Checklist"
            description="rigsync가 자동화하지 않는 수동 설치·설정 점검 목록"
            counts={checklistCounts}
          >
            <ul className="space-y-2">
              {report.checks.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-2 rounded border border-border p-2 text-xs"
                >
                  <div className="min-w-0">
                    <StatusText kind={doctorResultKind(c.result)}>
                      {c.name} ({c.type})
                    </StatusText>
                    <div className="mt-0.5 font-mono text-muted-foreground">{c.detail}</div>
                    {c.hint && <DoctorActionNote kind="warn" text={c.hint} />}
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
          </DoctorGroup>
        )}

        {!report.checksVisible && (
          <p className="text-xs text-muted-foreground">{emptyStateCopy.noChecks}</p>
        )}
      </div>
    </div>
  )
}

export default DoctorView
