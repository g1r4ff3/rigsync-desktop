/**
 * P3 drift 체크의 "배선" 절반 — 전 capability의 diff를 **read-only로만**
 * 실행하고(capture/apply 절대 금지), 어떤 diff 필드가 "drift 항목"인지
 * 판단해 `DriftInput`으로 조립한 뒤 `summarizeDrift`(engine, 순수 함수)에
 * 넘긴다. "무엇이 drift로 치는가"는 각 capability의 diff 함수가 이미 계산해
 * 둔 배열을 그대로 옮기는 수준의 판단이라 여기(main)에 둔다 — engine 쪽
 * `drift.ts`는 이 판단을 전혀 모른다(분업 원칙).
 *
 * uncaptured/미지원-소스처럼 "정보성"이라 액션 대상이 아닌 필드는 제외한다
 * (예: apt uncaptured, appimage unsupportedSource, snap 전체 — snap은 P2c에서
 * 이미 plan/apply 밖으로 강등됐다). DiffView.tsx의 `hasXDrift` 헬퍼들과 같은
 * 판단 기준을 공유한다(의도적으로 대칭 — "Diff 탭이 amber로 보여주는 것 =
 * 트레이가 알림하는 것").
 */
import { diffAppimage } from '../engine/capabilities/appimage/diff'
import { diffDotfiles } from '../engine/capabilities/dotfiles/diff'
import { diffPackages } from '../engine/capabilities/packages/diff'
import { diffRepos } from '../engine/capabilities/repos/diff'
import { diffScheduled } from '../engine/capabilities/scheduled/diff'
import { diffServices } from '../engine/capabilities/services/diff'
import { diffSettings } from '../engine/capabilities/settings/diff'
import { diffTools } from '../engine/capabilities/tools/diff'
import type { RigsyncContext } from '../engine/context'
import { summarizeDrift, type DriftInput, type DriftSummary } from '../engine/drift'
import {
  linuxCronProvider,
  linuxDconfProvider,
  linuxGearLeverProvider,
  linuxGitTransportProvider,
  linuxPackageProviders,
  linuxSystemdUserProvider,
  linuxToolsProvider
} from '../engine/providers/linux'
import { triggerSync } from './gitSync'

/** 전 capability를 read-only diff만으로 조회해 drift 항목 목록을 조립한다. */
export async function buildDriftInput(ctx: RigsyncContext): Promise<DriftInput> {
  const [dotfiles, packages, appimage, settings, services, scheduled, tools, repos] =
    await Promise.all([
      diffDotfiles(ctx),
      diffPackages(ctx, linuxPackageProviders),
      diffAppimage(ctx, linuxGearLeverProvider),
      diffSettings(ctx, linuxDconfProvider),
      diffServices(ctx, linuxSystemdUserProvider),
      diffScheduled(ctx, linuxCronProvider),
      diffTools(ctx, linuxToolsProvider),
      diffRepos(ctx)
    ])

  return {
    dotfiles: [
      ...dotfiles.toLink,
      ...dotfiles.contentChanged,
      ...dotfiles.invalidStore,
      ...dotfiles.missingHome
    ],
    apt: [
      ...packages.apt.toInstall,
      ...packages.apt.sourcesMissing,
      ...packages.apt.sourcesContentChanged
    ],
    flatpak: [
      ...packages.flatpak.toAddRemotes.map((r) => `remote:${r.name}`),
      ...packages.flatpak.toInstall.map((a) => a.application),
      ...packages.flatpak.overridesMissing.map((id) => `override-missing:${id}`),
      ...packages.flatpak.overridesChanged.map((id) => `override-changed:${id}`)
    ],
    appimage: [...appimage.toInstall, ...appimage.pinMismatch.map((m) => m.name)],
    settings: [...settings.contentChanged],
    services: [
      ...services.missing.map((n) => `missing:${n}`),
      ...services.contentChanged.map((n) => `changed:${n}`),
      ...services.enabledMismatch.map((n) => `enabled-mismatch:${n}`)
    ],
    scheduled: scheduled.contentChanged ? ['crontab'] : [],
    tools: [...tools.toInstall, ...(tools.nodeToInstall ? [`node:${tools.nodeToInstall}`] : [])],
    repos: [
      ...repos.toClone.map((r) => r.path),
      ...repos.manualNoUrl.map((p) => `manual-no-url:${p}`)
    ]
  }
}

/**
 * `buildDriftInput` + `summarizeDrift`를 한데 묶은, 스케줄러가 직접 주입하는
 * 엔트리포인트. follower면 diff를 읽기 전에 fetch+ff-pull을 먼저 시도한다
 * (코디네이터 지시) — **실패해도 절대 여기서 멈추지 않는다**: 로컬 기준으로
 * drift 체크를 계속 진행하고, 실패 자체는 `triggerSync`가 이미
 * `getLastSyncStatus()`용 상태로 남겨(main/gitSync.ts) 상태바에 표면화된다.
 */
export async function runDriftCheck(ctx: RigsyncContext): Promise<DriftSummary> {
  if (ctx.role === 'follower') {
    await triggerSync(ctx, linuxGitTransportProvider).catch(() => {
      // 의도적으로 무시 -- 실패해도 로컬 기준으로 계속 진행한다.
    })
  }
  const input = await buildDriftInput(ctx)
  return summarizeDrift(input, new Date().toISOString())
}
