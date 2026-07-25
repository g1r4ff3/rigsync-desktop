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
import type { ElevationExec } from '../../elevation/execTypes'
import { LinuxAptProvider } from './apt'
import { DpkgSystemCheckProvider } from './dpkgSystemCheck'
import { FetchDownloader } from './downloader'
import { LinuxFlatpakProvider } from './flatpak'
import { LinuxGearLeverProvider } from './gearlever'
import { GithubAssetResolver } from './githubAssetResolver'
import { LinuxPkexecExec } from './pkexec'
import { LinuxSnapProvider } from './snap'

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

export {
  DpkgSystemCheckProvider,
  FetchDownloader,
  GithubAssetResolver,
  LinuxAptProvider,
  LinuxFlatpakProvider,
  LinuxGearLeverProvider,
  LinuxPkexecExec,
  LinuxSnapProvider
}
