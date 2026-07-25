import { describe, expect, it } from 'vitest'
import { parseSudoScriptOutput } from './parse'
import { SudoStreamParser } from './parse'

// 케이스 출처: 구 repo gui.py TestBuildSudoScript(parse_* 부분)/
// TestParseSudoScriptOutputCancelled/TestSudoStreamParser
// (행동만 옮김 — 코드 복사 아님).

describe('parseSudoScriptOutput', () => {
  it('all ok (test_parse_all_ok)', () => {
    const out = '===RIGSYNC CMD 0===\nstuff\n===RIGSYNC CMD 1===\n===RIGSYNC DONE===\n'
    expect(parseSudoScriptOutput(out, 2)).toEqual(['ok', 'ok'])
  })

  it('failure mid-script (test_parse_failure_mid_script)', () => {
    const out = '===RIGSYNC CMD 0===\n===RIGSYNC CMD 1===\nerr\n===RIGSYNC FAIL 1===\n'
    expect(parseSudoScriptOutput(out, 3)).toEqual(['ok', 'failed', 'not-run'])
  })

  it('empty output means not-run (test_parse_empty_output_means_not_run)', () => {
    // polkit 인증 대화상자가 닫혀 스크립트가 시작조차 못한 경우.
    expect(parseSudoScriptOutput('', 2)).toEqual(['not-run', 'not-run'])
  })

  it('killed mid-command (test_parse_killed_mid_command)', () => {
    const out = '===RIGSYNC CMD 0===\npartial output'
    expect(parseSudoScriptOutput(out, 2)).toEqual(['failed', 'not-run'])
  })

  // TestParseSudoScriptOutputCancelled
  it('cancelled marks started-no-fail commands as ok (test_cancelled_marks_started_no_fail_commands_as_ok)', () => {
    const out = '===RIGSYNC CMD 0===\n===RIGSYNC CMD 1===\n'
    expect(parseSudoScriptOutput(out, 3, true)).toEqual(['ok', 'ok', 'not-run'])
  })

  it('not cancelled still treats unresolved as failed (test_not_cancelled_default_still_treats_unresolved_as_failed)', () => {
    const out = '===RIGSYNC CMD 0===\n===RIGSYNC CMD 1===\n'
    expect(parseSudoScriptOutput(out, 3)).toEqual(['failed', 'failed', 'not-run'])
  })
})

describe('SudoStreamParser', () => {
  const FULL_OUTPUT = '===RIGSYNC CMD 0===\nstuff\n===RIGSYNC CMD 1===\n===RIGSYNC FAIL 1===\n'
  const EXPECTED = [
    { kind: 'start', index: 0 },
    { kind: 'start', index: 1 },
    { kind: 'fail', index: 1 }
  ]

  function eventsForChunks(chunks: readonly string[]): unknown[] {
    const parser = new SudoStreamParser()
    for (const c of chunks) parser.feed(c)
    return parser.events
  }

  it('whole-line chunks (test_whole_line_chunks)', () => {
    const chunks = FULL_OUTPUT.match(/[^\n]*\n|[^\n]+$/g) ?? []
    expect(eventsForChunks(chunks)).toEqual(EXPECTED)
  })

  it('arbitrary fixed-width byte chunks (test_arbitrary_fixed_width_byte_chunks)', () => {
    const chunks: string[] = []
    for (let i = 0; i < FULL_OUTPUT.length; i += 7) {
      chunks.push(FULL_OUTPUT.slice(i, i + 7))
    }
    expect(chunks.some((c) => c && !c.endsWith('\n'))).toBe(true)
    expect(eventsForChunks(chunks)).toEqual(EXPECTED)
  })

  it('single-character chunks (test_single_character_chunks)', () => {
    expect(eventsForChunks(FULL_OUTPUT.split(''))).toEqual(EXPECTED)
  })

  it('one giant chunk (test_one_giant_chunk)', () => {
    expect(eventsForChunks([FULL_OUTPUT])).toEqual(EXPECTED)
  })

  it('done marker (test_done_marker)', () => {
    expect(eventsForChunks(['===RIGSYNC DONE===\n'])).toEqual([{ kind: 'done' }])
  })

  it('feed returns only new events (test_feed_returns_only_new_events)', () => {
    const parser = new SudoStreamParser()
    const first = parser.feed('===RIGSYNC CMD 0===\n')
    const second = parser.feed('===RIGSYNC CMD 1===\n')
    expect(first).toEqual([{ kind: 'start', index: 0 }])
    expect(second).toEqual([{ kind: 'start', index: 1 }])
    expect(parser.events).toEqual([
      { kind: 'start', index: 0 },
      { kind: 'start', index: 1 }
    ])
  })
})
