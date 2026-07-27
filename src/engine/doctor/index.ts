export { evaluateCheck } from './evaluate'
export { buildDoctorReport, CHECKS_LAYER } from './report'
export { ignoreDoctorCheck } from './toggle'
export { checkNvidiaDriverMismatch } from './nvidia'
export type { NvidiaCheckProvider, NvidiaDriverCheckResult, NvidiaDriverPackage } from './nvidia'
export { checkSecretScanPreflight } from './secretScanCheck'
export { checkManifestPortability } from './portabilityCheck'
export type { PortabilityCheckResult, PortabilityFinding } from './portabilityCheck'
export { checkAptShadowing } from './aptShadowCheck'
export type { AptShadowCheckResult, AptShadowFinding } from './aptShadowCheck'
export { checkManifestDirty } from './manifestDirtyCheck'
export type { ManifestDirtyCheckResult, ManifestDirtyFile } from './manifestDirtyCheck'
export { readManualSyncNotes } from './manualSyncNotes'
export type { ManualSyncNote } from './manualSyncNotes'
export type { SecretScanPreflightCheck } from './secretScanCheck'
export {
  checkSelfUpdateStatus,
  selfUpdateManualCommand,
  SELF_UPDATE_SOURCE_OWNER,
  SELF_UPDATE_SOURCE_REPO,
  SELF_UPDATE_REPO_FILENAME_GLOB
} from './selfUpdateCheck'
export type { SelfUpdateCheck, SelfUpdateCheckInput, SelfUpdateStatusCode } from './selfUpdateCheck'
export * from './types'
export * from './providerTypes'
