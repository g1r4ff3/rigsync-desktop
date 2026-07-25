/**
 * checks(수동 체크리스트) 레이어 평가 — 구 repo `evaluate_check`(rigsync.py:1911)
 * 행동 이식. `role` 타입은 구 repo가 `~/.config/rigsync/role` 파일 존재 여부로
 * 판정했지만, 이 repo는 role이 config.toml에서 오므로(ctx.role은 항상 유효한
 * 값) "설정이 실제로 됐는가"(config.toml 존재 = `configConfigured`)로 대체한다
 * — 의도적 차이(아래 evaluateCheck 주석 참조).
 */
import { expandHome } from '../paths'
import type { RigsyncContext } from '../context'
import type { DoctorSystemProvider } from './providerTypes'
import type { CheckEntry, CheckResult } from './types'

export interface EvaluateCheckExtra {
  /** config.toml이 실제로 존재하는지 (resolveContext의 firstRun 반전). */
  readonly configConfigured: boolean
}

export function evaluateCheck(
  ctx: Pick<RigsyncContext, 'homeDir' | 'role'>,
  check: CheckEntry,
  provider: DoctorSystemProvider,
  extra: EvaluateCheckExtra
): CheckResult {
  const { name, type, target, hint } = check

  if (type === 'file') {
    const matches = provider.fileMatches(expandHome(ctx, target))
    return {
      name,
      type,
      target,
      result: matches.length > 0 ? 'pass' : 'fail',
      detail: matches[0] ?? `no match: ${target}`,
      hint
    }
  }

  if (type === 'apt') {
    const ok = provider.isAptPackageInstalled(target)
    return { name, type, target, result: ok ? 'pass' : 'fail', detail: `dpkg -s ${target}`, hint }
  }

  if (type === 'role') {
    // 구 repo: role 파일(~/.config/rigsync/role)이 존재하면 내용과 무관하게
    // pass. 이 repo는 role이 항상 config.toml에서 온 유효값이라(never "unexpected
    // content") 판정 기준을 "config.toml이 실제로 존재하는가"로 옮긴다 --
    // "아직 온보딩 전(dev 기본값으로 뜬 것)"을 fail로 표시하는 동등한 의도.
    return {
      name,
      type,
      target,
      result: extra.configConfigured ? 'pass' : 'fail',
      detail: extra.configConfigured ? `role=${ctx.role}` : `no match: ${target}`,
      hint
    }
  }

  // cmd
  const result = provider.runShellCmd(target)
  const combined = result.combinedOutput
  const pass = result.code === 0 && (!check.expect || combined.includes(check.expect))
  const trimmed = combined.trim()
  const lastLine = trimmed ? trimmed.split('\n').at(-1) : undefined
  return {
    name,
    type,
    target,
    result: pass ? 'pass' : 'fail',
    detail: lastLine ?? `exit ${result.code}`,
    hint
  }
}
