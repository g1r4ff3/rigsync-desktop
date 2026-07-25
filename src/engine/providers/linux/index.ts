/**
 * Linux provider — v1의 유일한 구현 대상이지만 모양은 3-OS를 가정한다
 * (FORWARD.md §3 확정 사항: "처음부터 capability + provider"). apt/snap/
 * flatpak은 P2a에서 채웠다 — dconf/systemd-user/cron은 이후 phase.
 */
import type {
  AssetResolver,
  Downloader,
  GearLeverProvider
} from '../../capabilities/appimage/providerTypes'
import type { CapabilityName } from '../../capabilities'
import type { PackageProviders } from '../../capabilities/packages/providerTypes'
import type { GitProvider } from '../../capabilities/repos/providerTypes'
import type { CronProvider } from '../../capabilities/scheduled/providerTypes'
import type { DconfProvider } from '../../capabilities/settings/providerTypes'
import type { SystemdUserProvider } from '../../capabilities/services/providerTypes'
import type { ToolsProvider } from '../../capabilities/tools/providerTypes'
import type { DoctorSystemProvider } from '../../doctor/providerTypes'
import type { NvidiaCheckProvider } from '../../doctor/nvidia'
import type { ElevationExec } from '../../elevation/execTypes'
import type { GitTransportProvider } from '../../transport/types'
import { LinuxAptProvider } from './apt'
import { LinuxCronProvider } from './cron'
import { LinuxDconfProvider } from './dconf'
import { LinuxDoctorSystemProvider } from './doctorSystem'
import { DpkgSystemCheckProvider } from './dpkgSystemCheck'
import { FetchDownloader } from './downloader'
import { LinuxFlatpakProvider } from './flatpak'
import { LinuxGearLeverProvider } from './gearlever'
import { LinuxGitProvider } from './git'
import { LinuxGitTransportProvider } from './gitTransport'
import { GithubAssetResolver } from './githubAssetResolver'
import { LinuxNvidiaCheckProvider } from './nvidia'
import { LinuxPkexecExec } from './pkexec'
import { LinuxSnapProvider } from './snap'
import { LinuxSystemdUserProvider } from './systemdUser'
import { LinuxToolsProvider } from './tools'

export interface Provider {
  readonly platform: NodeJS.Platform
  readonly supports: readonly CapabilityName[]
}

/**
 * v1 capability 대응 중 linux provider가 실제로 뒷받침할 목록
 * (FORWARD.md §3 "capability ↔ 구 layer 대응" 표 순서).
 */
export const linuxProvider: Provider = {
  platform: 'linux',
  supports: [
    'packages',
    'settings',
    'dotfiles',
    'services',
    'scheduled',
    'tools',
    'repos',
    'appimage'
  ]
}

/** dev(실제 머신)에서 쓰는 packages capability provider 묶음 — main이 조립해 넘긴다. */
export const linuxPackageProviders: PackageProviders = {
  apt: new LinuxAptProvider(),
  snap: new LinuxSnapProvider(),
  flatpak: new LinuxFlatpakProvider()
}

/** dev(실제 머신)에서 pkexec를 실제로 spawn하는 ElevationExec 구현. */
export const linuxElevationExec: ElevationExec = new LinuxPkexecExec()

/** dev(실제 머신)에서 쓰는 appimage(T3) capability provider 묶음. */
export const linuxGearLeverProvider: GearLeverProvider = new LinuxGearLeverProvider()
export const linuxAssetResolver: AssetResolver = new GithubAssetResolver()
export const linuxDownloader: Downloader = new FetchDownloader()
export const linuxAppimageSystemCheck = new DpkgSystemCheckProvider()

/** P2d: dev(실제 머신)에서 쓰는 settings/services/scheduled/tools/repos/doctor provider들. */
export const linuxDconfProvider: DconfProvider = new LinuxDconfProvider()
export const linuxSystemdUserProvider: SystemdUserProvider = new LinuxSystemdUserProvider()
export const linuxCronProvider: CronProvider = new LinuxCronProvider()
export const linuxToolsProvider: ToolsProvider = new LinuxToolsProvider()
export const linuxGitProvider: GitProvider = new LinuxGitProvider()
export const linuxDoctorSystemProvider: DoctorSystemProvider = new LinuxDoctorSystemProvider()
export const linuxNvidiaCheckProvider: NvidiaCheckProvider = new LinuxNvidiaCheckProvider()

/** P4: manifest repo의 git 전송(commit/push/fetch/pull) — main이 조립해 넘긴다. */
export const linuxGitTransportProvider: GitTransportProvider = new LinuxGitTransportProvider()

export {
  DpkgSystemCheckProvider,
  FetchDownloader,
  GithubAssetResolver,
  LinuxAptProvider,
  LinuxCronProvider,
  LinuxDconfProvider,
  LinuxDoctorSystemProvider,
  LinuxFlatpakProvider,
  LinuxGearLeverProvider,
  LinuxGitProvider,
  LinuxGitTransportProvider,
  LinuxNvidiaCheckProvider,
  LinuxPkexecExec,
  LinuxSnapProvider,
  LinuxSystemdUserProvider,
  LinuxToolsProvider
}
