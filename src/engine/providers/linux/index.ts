/**
 * Linux provider — v1의 유일한 구현 대상이지만 모양은 3-OS를 가정한다
 * (FORWARD.md §3 확정 사항: "처음부터 capability + provider"). 실제 apt/snap/
 * flatpak/dconf/systemd-user/cron 어댑터는 P2에서 채운다.
 */
import type { CapabilityName } from '../../capabilities'

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
