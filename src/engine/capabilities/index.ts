/**
 * Capability = 동기화 대상의 한 종류(packages, settings, dotfiles, services, …).
 * FORWARD.md §3 "capability ↔ 구 layer 대응" 참조. P0에서는 타입 시그니처만
 * 세우고 실제 capture/diff/apply 로직은 P1(dotfiles 관통)부터 채운다.
 */

export const CAPABILITY_NAMES = [
  'packages',
  'settings',
  'dotfiles',
  'services',
  'scheduled',
  'tools',
  'repos',
  'appimage'
] as const

export type CapabilityName = (typeof CAPABILITY_NAMES)[number]

/** capability별 manifest 조각의 최소 공통 shape — 구체 타입은 각 capability가 확장한다. */
export interface CapabilityManifest {
  readonly capability: CapabilityName
}

/** 현재 머신 상태와 manifest 사이의 차이 한 항목. */
export interface CapabilityDiffEntry {
  readonly key: string
  readonly kind: 'add' | 'remove' | 'change'
  readonly detail: string
}

export interface Capability<TManifest extends CapabilityManifest = CapabilityManifest> {
  readonly name: CapabilityName

  /** 머신 현재 상태를 읽어 manifest 조각으로 회수한다 (저작 — additive-only, 불변식 ④). */
  capture(): Promise<TManifest>

  /** manifest와 머신 현재 상태를 비교한다 (읽기 전용 — 부작용 없음). */
  diff(manifest: TManifest): Promise<CapabilityDiffEntry[]>
}
