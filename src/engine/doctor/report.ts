/**
 * doctor 종합 리포트 — 구 repo `doctor_report`(rigsync.py:1954)의 checks 평가에
 * P2d 신규 기본 진단 + T3 appimage preflight(P2c `checkAppimagePreflight`)를
 * 얹어 한 화면분으로 묶는다(코디네이터 지시 "전 capability의 preflight/check를
 * 한 화면에 통합"). fonts capability 추가로 `diffFonts`(nominal async — 내부는
 * 순수 fs 동기 로직)를 기다려야 해서 이 함수 자체도 async로 바뀌었다(호출부
 * main/ipc.ts·테스트는 await만 붙이면 된다).
 */
import fs from 'node:fs'
import type { RigsyncContext } from '../context'
import { readIgnoreSet } from '../ignore'
import { effectiveLayer } from '../manifest'
import { checkAppimagePreflight } from '../capabilities/appimage/checks'
import type {
  AppimageSystemCheckProvider,
  GearLeverProvider
} from '../capabilities/appimage/providerTypes'
import { checkFontsPreflight } from '../capabilities/fonts/checks'
import { diffFonts } from '../capabilities/fonts/diff'
import type { FontsSystemProvider } from '../capabilities/fonts/providerTypes'
import type { GitTransportProvider } from '../transport/types'
import { checkEmptyFollower } from './emptyFollowerCheck'
import { evaluateCheck } from './evaluate'
import { checkNvidiaDriverMismatch } from './nvidia'
import type { NvidiaCheckProvider } from './nvidia'
import type { DoctorSystemProvider } from './providerTypes'
import { checkManifestPortability } from './portabilityCheck'
import { checkSecretScanPreflight } from './secretScanCheck'
import { checkSelfUpdateStatus } from './selfUpdateCheck'
import type { ChecksManifest, DoctorReport } from './types'

export const CHECKS_LAYER = 'checks'

export interface BuildDoctorReportOptions {
  /** true면 config.toml이 실제로 존재(온보딩 완료) -- resolveContext의 firstRun 반전. */
  readonly configConfigured: boolean
  /**
   * P4 자기 업데이트 체크용 `process.env.APPIMAGE` — 생략하면 실제 env를 읽는다
   * (main/ipc.ts 호출부가 이 필드를 몰라도 그대로 동작하도록 optional로 둔다 --
   * 다른 에이전트 소유 파일이라 이 시그니처를 깨는 변경은 할 수 없다). 테스트는
   * 명시적으로 넘겨 실제 프로세스 env에 기대지 않는다.
   */
  readonly appImagePath?: string | null
}

export async function buildDoctorReport(
  ctx: RigsyncContext,
  systemProvider: DoctorSystemProvider,
  gearLeverProvider: GearLeverProvider,
  appimageSystemCheck: AppimageSystemCheckProvider,
  fontsSystemProvider: FontsSystemProvider,
  nvidiaProvider: NvidiaCheckProvider,
  gitTransportProvider: Pick<GitTransportProvider, 'isGitRepo' | 'hasRemote'>,
  options: BuildDoctorReportOptions
): Promise<DoctorReport> {
  const ignoreNames = readIgnoreSet(ctx, 'checks', 'names')
  const manifest = effectiveLayer(ctx, CHECKS_LAYER) as ChecksManifest
  // ignore된 check는 doctor 표에서 완전히 사라진다 -- 구 repo와 동일하게 "skip
  // 표시" 없이 그냥 목록에서 빠진다.
  const activeChecks = (manifest.check ?? []).filter((c) => !ignoreNames.has(c.name))
  const checks = activeChecks.map((c) =>
    evaluateCheck(ctx, c, systemProvider, { configConfigured: options.configConfigured })
  )
  const exitCode = checks.some((r) => r.result === 'fail') ? 1 : 0

  const appimage = checkAppimagePreflight(gearLeverProvider, appimageSystemCheck)
  const fontsDiff = await diffFonts(ctx)
  const fonts = checkFontsPreflight(ctx, fontsDiff, fontsSystemProvider)
  const nvidia = checkNvidiaDriverMismatch(nvidiaProvider)
  const secretScan = checkSecretScanPreflight(ctx)
  const portability = checkManifestPortability(ctx)
  const emptyFollower = checkEmptyFollower(ctx, gitTransportProvider)

  const appImagePath =
    options.appImagePath !== undefined ? options.appImagePath : (process.env.APPIMAGE ?? null)
  const selfUpdateAppConfig = appImagePath ? gearLeverProvider.readAppConfig(appImagePath) : null
  const selfUpdate = checkSelfUpdateStatus({
    appImagePath,
    gearLeverInstalled: appimage.gearLeverInstalled,
    appConfig: selfUpdateAppConfig
  })

  return {
    basic: {
      machineId: ctx.machineId,
      role: ctx.role,
      manifestDirExists: fs.existsSync(ctx.manifestDir),
      configConfigured: options.configConfigured
    },
    checks,
    appimage,
    fonts,
    nvidia,
    secretScan,
    portability,
    emptyFollower,
    selfUpdate,
    checksVisible: activeChecks.length > 0,
    exitCode
  }
}
