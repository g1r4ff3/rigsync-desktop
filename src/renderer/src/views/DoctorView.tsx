import { useEffect, useState } from 'react'
import { ActionButton } from '@/components/ActionButton'
import { Skeleton } from '@/components/ui/skeleton'
import { buttonCopy, doctorCopy, emptyStateCopy } from '../copy'
import { doctorSnapshotSlot, fetchDoctorSnapshot, useDoctorSnapshot } from '../doctorSnapshotStore'
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

/** refactor-spec-v0.2 F5(P5) -- binaries preflight는 버전성 파일명 경고뿐이라 fonts보다 단순하다. */
function binariesKinds(binaries: DoctorReportDto['binaries']): StatusKind[] {
  return binaries.warnings.map((): StatusKind => 'warn')
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

/**
 * refactor-spec-v0.2 P2 이식성 검사 -- 파일 단위 경고(warnings)로 센다.
 * 한 dotfile에서 수십 참조가 나와도(F1의 .zshrc처럼) 문제는 파일 하나다.
 * 'warn'인 이유: 지금 이 머신이 깨진 게 아니라 "적용되면 깨질" 예고라서
 * (비밀 잔존=현재 사고인 secret scan의 'error'와 구분).
 */
function portabilityKinds(portability: DoctorReportDto['portability']): StatusKind[] {
  return portability.warnings.map((): StatusKind => 'warn')
}

/**
 * apt PATH shadowing 검사 -- 관리 중인 apt 패키지가 dpkg 밖 실행파일에
 * PATH에서 가려지고 있으면 'warn'(지금 이 머신에서 실제로 잘못된 바이너리가
 * 쓰이고 있는 상태 -- portability의 "적용되면 깨질 예고"보다 더 즉각적이라
 * warn으로 센다. secret scan의 'error'만큼 심각하진 않다 -- 삭제 유도가
 * 아니라 확인 유도이므로).
 */
function aptShadowKinds(aptShadow: DoctorReportDto['aptShadow']): StatusKind[] {
  return aptShadow.warnings.map((): StatusKind => 'warn')
}

/**
 * apt 저장소 후보 없음 검사 -- 저장소 없는 로컬 .deb가 관리 목록에 잘못
 * 들어가면 follower Apply가 "Unable to locate package"로 실패한다(실사용
 * 사고 재발 방지). aptShadow와 같은 심각도(warn)로 센다 -- 지금 이 머신이
 * 깨진 건 아니지만 follower에서 확실히 실패할 예고이므로 확인을 유도한다.
 */
function aptNoCandidateKinds(aptNoCandidate: DoctorReportDto['aptNoCandidate']): StatusKind[] {
  return aptNoCandidate.warnings.map((): StatusKind => 'warn')
}

/**
 * P3(D2-a) manifest dirty 검사 -- follower dirty만 'warn'으로 센다. reference
 * dirty는 P4(`sweepLiveEditsIfDirty`)가 다음 드리프트 주기에 자동 정리하므로
 * 중립 정보일 뿐 경고가 아니다(요약 카운트에 반영하지 않는다).
 */
function manifestDirtyKinds(manifestDirty: DoctorReportDto['manifestDirty']): StatusKind[] {
  if (!manifestDirty.dirty) return []
  return manifestDirty.role === 'follower' ? ['warn'] : []
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

/**
 * 경고·실패 항목 옆에 "그래서 뭘 해야 하나"를 아이콘+차분한 경고 톤 블록으로
 * 보여준다. UI 정돈(v0.1.16): 이전엔 문장 전체를 빨간 모노스페이스 장문으로
 * 밀어붙였는데(CLAUDE.md "모노스페이스는 경로·명령·코드에만 한정" 위반이기도
 * 했다 — 실제 내용은 사람이 읽는 한국어 문장, engine/doctor/*.ts 확인),
 * StatusIcon으로 통일된 경고/오류 아이콘을 붙이고 본문은 보통 글꼴 산문으로
 * 바꾼다. 색이 있는 틴트 블록 자체는 유지한다 — 이건 "똑같은 회색 보더 박스"가
 * 아니라 의미가 다른(경고 vs 정보) 별도 색 코드라 남겨 둘 이유가 있다.
 */
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
        'mt-1.5 flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ' +
        (kind === 'error'
          ? 'border-status-error/30 bg-status-error/10 text-status-error'
          : 'border-status-warn/30 bg-status-warn/10 text-status-warn')
      }
    >
      <StatusIcon kind={kind} className="mt-0.5 shrink-0" />
      <span>
        <span className="font-medium">{doctorCopy.actionPrefix}: </span>
        <span className="break-words">{text}</span>
      </span>
    </div>
  )
}

/**
 * 그룹 하나(Basic/AppImage/NVIDIA/Checklist)의 골격. UI 정돈(v0.1.16): 이전엔
 * 통과/경고 여부와 무관하게 전부 같은 회색 보더 카드였다("모든 섹션이 똑같은
 * 보더 카드" — 이 화면이 그 증상의 가장 심한 사례, 11개 섹션이 나란히
 * 똑같은 상자였다). 보더는 실제 상호작용 단위에만 남긴다:
 * - 통과(allPass)면 `<details>`로 접는다 — 클릭 대상이므로 hover 배경으로
 *   인터랙션을 알리고, 상시 보더 박스는 두지 않는다.
 * - 경고·실패가 있으면 펼친 채 보여주되 보더 없이 타이포 위계(굵은 제목)만으로
 *   구획한다 — 섹션 사이 구분은 부모 컨테이너의 `[&>*+*]` 구분선이 담당한다.
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
      <details>
        <summary className="-mx-1 flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1 py-1 text-sm font-semibold text-foreground hover:bg-accent/60">
          <StatusIcon kind="ok" className="size-3.5 shrink-0" />
          <span>{title}</span>
          <span className="text-xs font-normal text-muted-foreground">
            — {doctorCopy.allPassed}
            {summaryExtra ? ` · ${summaryExtra}` : ''}
          </span>
        </summary>
        <div className="mt-2 pl-5">{body}</div>
      </details>
    )
  }
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {body}
    </section>
  )
}

function DoctorView(): React.JSX.Element {
  // 4단계(스냅샷 스토어): 탭 전환 체감 0ms — doctorSnapshotStore.ts 구독으로
  // 바꿨다. 이전 데이터가 있으면 재마운트(=탭 재방문) 즉시 그대로 렌더되고,
  // 백그라운드에서 조용히 재검증된다(revalidating이 아래 Recheck 버튼의
  // busy와 같은 자리를 대신한다).
  const doctorSnapshot = useDoctorSnapshot()
  const report = doctorSnapshot.data as DoctorReportWithSelfUpdate | null
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const refreshing = doctorSnapshot.loading || doctorSnapshot.revalidating
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null)

  async function refresh(): Promise<void> {
    await doctorSnapshotSlot.revalidate(fetchDoctorSnapshot)
    setLastCheckedAt(new Date())
  }

  useEffect(() => {
    doctorSnapshotSlot.revalidate(fetchDoctorSnapshot).then(
      () => setLastCheckedAt(new Date()),
      (err: unknown) => setError(err instanceof Error ? err.message : String(err))
    )
  }, [])

  async function ignoreCheck(name: string): Promise<void> {
    setPending((prev) => ({ ...prev, [name]: true }))
    try {
      const next = await window.api.engine.ignoreDoctorCheck({ name, ignored: true })
      doctorSnapshotSlot.set(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending((prev) => ({ ...prev, [name]: false }))
    }
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col">
        {(error ?? doctorSnapshot.error) ? (
          <StatusText kind="error">{error ?? doctorSnapshot.error}</StatusText>
        ) : (
          // UI 정돈(v0.1.16): Doctor는 preflight·secret scan·portability 등
          // 여러 검사를 순차로 돌아 다른 탭보다 초기 로딩이 길다(실측: 수
          // 초~십수 초) — 요약 히어로 카드와 이어질 섹션 목록의 모양을 미리
          // 그려 빈 화면 대신 "뭐가 오는지"를 암시한다.
          <>
            <section className="mb-3 shrink-0 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-5">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-16" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            </section>
            <div className="flex-1 space-y-4 overflow-hidden pr-1">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          </>
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
  const binariesCounts = countKinds(binariesKinds(report.binaries))
  const nvidiaCounts = countKinds(nvidiaKinds(report.nvidia))
  const secretScanCounts = countKinds(secretScanKinds(report.secretScan))
  const portabilityCounts = countKinds(portabilityKinds(report.portability))
  const aptShadowCounts = countKinds(aptShadowKinds(report.aptShadow))
  const aptNoCandidateCounts = countKinds(aptNoCandidateKinds(report.aptNoCandidate))
  const manifestDirtyCounts = countKinds(manifestDirtyKinds(report.manifestDirty))
  const selfUpdateCounts = countKinds(selfUpdateKinds(selfUpdate))
  const checklistCounts = report.checksVisible
    ? countKinds(checklistKinds(report.checks))
    : { ok: 0, warn: 0, error: 0 }
  const totals = [
    basicCounts,
    appimageCounts,
    fontsCounts,
    binariesCounts,
    nvidiaCounts,
    secretScanCounts,
    portabilityCounts,
    aptShadowCounts,
    aptNoCandidateCounts,
    manifestDirtyCounts,
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

      {/* UI 정돈(v0.1.16): 섹션마다 있던 회색 보더 카드를 지우고, 대신 이
          컨테이너가 "첫 자식 제외 전부"에 상단 구분선을 준다([&>*+*] —
          allPass/펼침 여부·조건부 렌더와 무관하게 항상 올바른 첫/이후 판정,
          컴포넌트마다 반복해서 챙길 필요가 없다). 구분선 하나로 11개 섹션이
          한 데 이어지는 "밀도 있는 리스트"처럼 읽힌다 — 상자 11개가 아니라. */}
      <div className="flex-1 overflow-y-auto pr-1 [&>*+*]:mt-4 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-4">
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

        {/*
          refactor-spec-v0.2 F5(P5) -- binaries는 fonts와 같은 문제 구조를
          공유하지만(레지스트리 미등록 실행파일의 파일명 정확 일치 문제)
          fc-cache류 시스템 명령이 없어 fonts보다 단순하다. 버전성 파일명
          경고만 다룬다.
        */}
        <DoctorGroup
          title="Binaries"
          description="레지스트리 미등록 + 버전성 파일명 실행파일 (다른 머신에서 수렴하지 않을 수 있음)"
          counts={binariesCounts}
        >
          {report.binaries.warnings.length === 0 ? (
            <p className="text-xs text-muted-foreground">감지된 항목 없음.</p>
          ) : (
            report.binaries.warnings.map((w) => <DoctorActionNote key={w} kind="warn" text={w} />)
          )}
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
            <ul className="divide-y divide-border">
              {report.secretScan.blockedFindings.map((f, i) => (
                <li key={`${f.path}:${f.line}:${f.kind}:${i}`} className="py-2 text-xs first:pt-0">
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

        <DoctorGroup
          title="Portability"
          description="이 머신에 적용될 manifest 콘텐츠에 다른 사용자의 /home 경로가 박혀 있는지 확인"
          counts={portabilityCounts}
        >
          {report.portability.warnings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              감지된 항목 없음 -- 스토어의 dotfiles·crontab·서비스 유닛에 다른 사용자 홈 경로 참조가
              없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {report.portability.warnings.map((w) => (
                <li key={w} className="py-2 text-xs first:pt-0">
                  <StatusText kind="warn">{w}</StatusText>
                </li>
              ))}
            </ul>
          )}
        </DoctorGroup>

        {/*
          apt PATH shadowing -- rclone 실증 사례(공식 설치 스크립트로 깐
          /usr/bin/rclone이 apt install로 고지 없이 덮일 뻔함) 재발 방지의
          Doctor 쪽 자매 검사. Portability와 같은 골격(findings/warnings 목록,
          역할 구분 없음)을 그대로 재사용한다.
        */}
        <DoctorGroup
          title="Apt PATH shadowing"
          description="관리 중인 apt 패키지가 dpkg 밖 실행파일에 PATH에서 가려지고 있는지 확인"
          counts={aptShadowCounts}
        >
          {report.aptShadow.warnings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              감지된 항목 없음 -- 관리 중인 apt 패키지가 PATH에서 가려지고 있지 않습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {report.aptShadow.warnings.map((w) => (
                <li key={w} className="py-2 text-xs first:pt-0">
                  <StatusText kind="warn">{w}</StatusText>
                </li>
              ))}
            </ul>
          )}
        </DoctorGroup>

        {/*
          apt 저장소 후보 없음 -- 저장소 없는 로컬 .deb(gcm·rustdesk 실증
          사고)가 관리 apt 목록에 잘못 들어가면 follower Apply가 "Unable to
          locate package"로 실패한다. Apt PATH shadowing과 같은 골격
          (warnings 목록, 역할 구분 없음)을 재사용한다.
        */}
        <DoctorGroup
          title="Apt no repository candidate"
          description="관리 중인 apt 패키지 중 어떤 저장소도 후보를 제공하지 않는 것이 있는지 확인"
          counts={aptNoCandidateCounts}
        >
          {report.aptNoCandidate.warnings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              감지된 항목 없음 -- 관리 중인 apt 패키지 전부 저장소 후보가 있습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {report.aptNoCandidate.warnings.map((w) => (
                <li key={w} className="py-2 text-xs first:pt-0">
                  <StatusText kind="warn">{w}</StatusText>
                </li>
              ))}
            </ul>
          )}
        </DoctorGroup>

        {/*
          P3(D2-a) manifest dirty -- follower/reference 표현이 다르다: follower는
          다음 pull이 실패한다는 실질적 경고(warn), reference는 P4가 다음 드리프트
          주기에 자동으로 정리한다는 중립 정보(muted)다. 둘 다 같은 DoctorGroup
          골격을 쓰되 kind만 role에 따라 갈린다.
        */}
        <DoctorGroup
          title="Manifest local edits"
          description="이 머신에 적용된 manifest 작업 트리가 커밋되지 않은 채로 바뀌어 있는지 확인"
          counts={manifestDirtyCounts}
        >
          {!report.manifestDirty.dirty ? (
            <p className="text-xs text-muted-foreground">
              감지된 항목 없음 -- manifest 작업 트리가 깨끗합니다.
            </p>
          ) : (
            <div className="text-xs">
              <StatusText kind={report.manifestDirty.role === 'follower' ? 'warn' : 'muted'}>
                {report.manifestDirty.role === 'follower'
                  ? 'manifest 로컬 편집 감지'
                  : '커밋 안 된 라이브 편집'}
              </StatusText>
              {report.manifestDirty.role === 'follower' && report.manifestDirty.warning && (
                <DoctorActionNote kind="warn" text={report.manifestDirty.warning} />
              )}
              {report.manifestDirty.role === 'reference' && report.manifestDirty.note && (
                <p className="mt-1 text-muted-foreground">{report.manifestDirty.note}</p>
              )}
              <ul className="mt-2 space-y-0.5 font-mono text-muted-foreground">
                {report.manifestDirty.files.map((f) => (
                  <li key={f.path}>
                    {f.status} {f.path}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DoctorGroup>

        {/*
          수동 동기화 체크리스트 -- pass/fail이 없는 순수 정보성 목록이라
          DoctorGroup을 쓰지 않는다: DoctorGroup은 counts.warn/error===0이면
          "통과 — 펼쳐서 세부 항목 보기"로 접는데(allPass), 이 목록은 아무것도
          검증하지 않으므로 "통과"라는 표현이 맞지 않는다. 항목이 없으면(파일
          없음/이 머신에 해당 경로 없음) 섹션 자체를 숨긴다. kind="muted"는
          위 AppImage 섹션의 "확인 불가"(gearLeverVersionOk===null)와 같은
          기존 중립 상태 의미를 그대로 재사용한 것 -- 새 색상·아이콘 없음.
        */}
        {report.manualSyncNotes.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground">Manual sync checklist</h2>
            <p className="mb-1.5 text-xs text-muted-foreground">
              rigsync가 자동 동기화할 수 없어 사용자가 직접 맞춰야 하는 항목
            </p>
            <ul className="divide-y divide-border">
              {report.manualSyncNotes.map((note) => (
                <li key={note.id} className="py-2 text-xs first:pt-0">
                  <StatusText kind="muted">{note.title}</StatusText>
                  <div className="mt-0.5 whitespace-pre-line text-muted-foreground">
                    {note.detail}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {report.checksVisible && (
          <DoctorGroup
            title="Checklist"
            description="rigsync가 자동화하지 않는 수동 설치·설정 점검 목록"
            counts={checklistCounts}
          >
            <ul className="divide-y divide-border">
              {report.checks.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center justify-between gap-2 py-2 text-xs first:pt-0"
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
