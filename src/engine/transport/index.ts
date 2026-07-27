export {
  getSyncStatus,
  syncReference,
  syncFollower,
  syncNow,
  sweepLiveEditsIfDirty,
  LIVE_EDIT_COMMIT_MESSAGE
} from './sync'
export * from './types'
export { cloneManifestRepo, classifyCloneFailure, cloneErrorGuidance } from './clone'
export type { CloneManifestResult, CloneManifestError, CloneManifestErrorKind } from './clone'
