/**
 * Doctor 탭의 스냅샷 스토어 배선 — snapshotSlot.ts 참조.
 */
import type { DoctorReportDto } from '../../shared/ipc'
import { Slot, useSlot, type SlotSnapshot } from './snapshotSlot'

export const doctorSnapshotSlot = new Slot<DoctorReportDto>()

export async function fetchDoctorSnapshot(): Promise<DoctorReportDto> {
  return window.api.engine.getDoctorReport()
}

export function useDoctorSnapshot(): SlotSnapshot<DoctorReportDto> {
  return useSlot(doctorSnapshotSlot)
}
