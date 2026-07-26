import { describe, expect, it } from 'vitest'
import type { PlanAction } from '../engine/plan'
import { orderCombinedPlan, type PlanPartsByCapability } from './planOrder'

function stubAction(capability: string, summary: string): PlanAction {
  return {
    capability,
    summary,
    commands: [],
    privileged: false,
    run: async () => ({ ok: true, detail: '' })
  }
}

describe('orderCombinedPlan', () => {
  it('places repos actions before every other capability (구 bootstrap의 "repos 먼저" 계약 복원)', () => {
    const parts: PlanPartsByCapability = {
      repos: [stubAction('repos', 'clone a'), stubAction('repos', 'clone b')],
      dotfiles: [stubAction('dotfiles', 'link x')],
      packages: [stubAction('packages', 'install y')],
      appimage: [stubAction('appimage', 'integrate z')],
      fonts: [stubAction('fonts', 'install font f')],
      binaries: [stubAction('binaries', 'install binary b')],
      settings: [stubAction('settings', 'dconf load p')],
      services: [stubAction('services', 'restore unit u')],
      scheduled: [stubAction('scheduled', 'restore crontab')],
      tools: [stubAction('tools', 'npm install -g w')]
    }
    const combined = orderCombinedPlan(parts)
    expect(combined.map((a) => a.capability).slice(0, 2)).toEqual(['repos', 'repos'])
    expect(combined[2].capability).toBe('dotfiles')
    // 전체 개수·나머지 순서(대문자순은 아니지만 buildCombinedPlan의 고정
    // 순서)도 유지되는지 함께 확인 — 순서 자체가 회귀 대상이므로.
    expect(combined.map((a) => a.capability)).toEqual([
      'repos',
      'repos',
      'dotfiles',
      'packages',
      'appimage',
      'fonts',
      'binaries',
      'settings',
      'services',
      'scheduled',
      'tools'
    ])
  })

  it('an empty repos plan still leaves the rest in the same fixed order', () => {
    const parts: PlanPartsByCapability = {
      repos: [],
      dotfiles: [stubAction('dotfiles', 'link x')],
      packages: [],
      appimage: [],
      fonts: [],
      binaries: [],
      settings: [],
      services: [],
      scheduled: [],
      tools: []
    }
    expect(orderCombinedPlan(parts).map((a) => a.capability)).toEqual(['dotfiles'])
  })
})
