export { DENYLIST_PATTERNS, matchesDenylist } from './denylist'
export { backupPath, doBackup } from './backup'
export {
  MAX_SCAN_BYTES,
  isLikelyBinary,
  scanFileForSecrets,
  scanTextForSecrets,
  scanTreeForSecrets
} from './secretScan'
export type {
  FileScanOutcome,
  SecretConfidence,
  SecretFinding,
  SecretPatternKind,
  TreeScanResult
} from './secretScan'
export {
  SECRET_ALLOWLIST_LAYER,
  filterAllowlistedFindings,
  isSecretAllowlisted,
  readSecretAllowlist
} from './secretAllowlist'
export type { SecretAllowlistEntry } from './secretAllowlist'
export { scanManifestForSecrets } from './manifestScan'
export type { ManifestScanResult } from './manifestScan'
