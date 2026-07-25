/**
 * apt baseline 필터 — FORWARD.md §7/정책 §8-B: `apt-mark showmanual`은
 * 배포판 기본 설치분까지 포함하므로(실측 158개), 그걸 걸러낼 "기준 이미지"가
 * 필요하다. 이 repo는 **첫 capture 시점의 상태를 기준선으로 스냅샷**하는
 * 전략을 택했다(사용자가 다른 기준 이미지를 따로 준비할 필요 없음) — 이후
 * capture/후보 계산은 baseline과의 차집합만 본다.
 *
 * 스냅샷은 `ctx.aptBaselinePath`에 줄바꿈 구분 텍스트로 저장한다(테스트가
 * 주입 가능한 경로 — 실제 홈을 안 건드림).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { RigsyncContext } from '../../context'

export function readAptBaseline(ctx: Pick<RigsyncContext, 'aptBaselinePath'>): Set<string> {
  if (!fs.existsSync(ctx.aptBaselinePath)) return new Set()
  const lines = fs
    .readFileSync(ctx.aptBaselinePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return new Set(lines)
}

export function writeAptBaseline(
  ctx: Pick<RigsyncContext, 'aptBaselinePath'>,
  packages: readonly string[]
): void {
  fs.mkdirSync(path.dirname(ctx.aptBaselinePath), { recursive: true })
  fs.writeFileSync(ctx.aptBaselinePath, [...packages].sort().join('\n') + '\n')
}

export function aptBaselineExists(ctx: Pick<RigsyncContext, 'aptBaselinePath'>): boolean {
  return fs.existsSync(ctx.aptBaselinePath)
}
