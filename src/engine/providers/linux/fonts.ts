/**
 * 실제 fc-cache/fc-list 조회 + 실행 — `FontsSystemProvider`의 Linux 구현.
 * doctor 체크 ③(fontconfig 도구 가용성) + apply 마지막 단계(`fc-cache -f`)가
 * 이 provider를 쓴다.
 */
import type {
  FontsSystemCommandResult,
  FontsSystemProvider
} from '../../capabilities/fonts/providerTypes'
import { commandExists, run } from './exec'

export class LinuxFontsSystemProvider implements FontsSystemProvider {
  fcCacheAvailable(): boolean {
    return commandExists('fc-cache')
  }

  fcListAvailable(): boolean {
    return commandExists('fc-list')
  }

  runFcCache(): FontsSystemCommandResult {
    const result = run(['fc-cache', '-f'], 30_000)
    return { ok: result.code === 0, output: result.stdout + result.stderr }
  }
}
