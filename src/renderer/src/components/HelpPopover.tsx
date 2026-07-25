import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Explanability 계약 ③ Help — 화면마다 하나씩, ?를 누르면 3–5문장 개념 설명
 * (reference/follower·drift·INV-1 등). 트리거 자체에도 짧은 툴팁을 달아
 * "이게 뭔지"부터 즉시 드러낸다(계약 ② Tooltip과 중첩 적용).
 */
export function HelpPopover({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="이 화면 도움말"
              className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border font-mono text-[10px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              ?
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>이 화면 개념 설명 열기</TooltipContent>
      </Tooltip>
      <PopoverContent>{text}</PopoverContent>
    </Popover>
  )
}
