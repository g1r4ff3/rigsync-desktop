/**
 * crontab 스토어 경로 해석 — refactor-spec-v0.2 P2 (F2 host 라우팅의 scheduled쪽).
 *
 * crontab은 파일 단위 계약이라(entry 단위 host 오버레이가 불가능) **파일
 * 전체를 host 계층으로 올리는** 방식으로 머신 고유 crontab을 지원한다:
 * `hosts/<machineId>/scheduled/crontab.txt`가 존재하면 그 머신의
 * capture/diff/apply는 전부 그 파일을 쓰고, 없으면 기존 공통 스토어
 * (`scheduled/crontab.txt`) 그대로다.
 *
 * F1 사고와의 관계: 랩 전용 cron 라인이 공통 스토어에 실려 집 머신을 깨뜨렸다.
 * 랩 머신의 crontab을 host 스토어로 옮기면 — 랩은 자기 crontab을 계속
 * 관리하고, 다른 머신은 공통 스토어(비어 있음)를 받아 깨끗해진다.
 * 승격(파일 이동)은 사용자·코디네이터가 manifest에서 수행한다 — 앱은 존재
 * 여부만 해석하고 자발적으로 승격하지 않는다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'
import { SCHEDULED_STORE_REL_PATH } from './constants'

/** 이 머신의 crontab host 스토어 절대 경로 (존재 여부와 무관). */
export function scheduledHostStorePath(
  ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>
): string {
  return path.join(ctx.manifestDir, 'hosts', ctx.machineId, SCHEDULED_STORE_REL_PATH)
}

/**
 * 이 머신에 적용되는 crontab 스토어 절대 경로 — host 스토어가 존재하면 host,
 * 아니면 공통. capture/diff/plan이 전부 이 하나로 해석해야 세 동작이 같은
 * 파일을 본다(어긋나면 capture가 쓴 걸 diff가 못 보는 소리 없는 발산).
 */
export function scheduledStorePath(ctx: Pick<RigsyncContext, 'manifestDir' | 'machineId'>): string {
  const hostPath = scheduledHostStorePath(ctx)
  return fs.existsSync(hostPath) ? hostPath : path.join(ctx.manifestDir, SCHEDULED_STORE_REL_PATH)
}
