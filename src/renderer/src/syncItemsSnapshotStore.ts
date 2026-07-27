/**
 * Items(Candidates) 탭의 스냅샷 스토어 배선 — snapshotSlot.ts 참조.
 * SyncItemsView는 이미 스스로 "탭이 바뀔 때마다 언마운트/재마운트되므로
 * 매번 listSyncItems()를 새로 기다려야 한다"고 주석에 남겨둔 화면이었다
 * (성능 리팩토링 2라운드 4단계가 그 지적을 그대로 해소한다).
 */
import type { SyncItemGroupDto } from '../../shared/ipc'
import { Slot, useSlot, type SlotSnapshot } from './snapshotSlot'

export const syncItemsSnapshotSlot = new Slot<readonly SyncItemGroupDto[]>()

export async function fetchSyncItemsSnapshot(): Promise<readonly SyncItemGroupDto[]> {
  return window.api.engine.listSyncItems()
}

export function useSyncItemsSnapshot(): SlotSnapshot<readonly SyncItemGroupDto[]> {
  return useSlot(syncItemsSnapshotSlot)
}
