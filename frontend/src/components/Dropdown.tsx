import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react'
import { COLORS } from '../theme'

/**
 * Dark-theme dropdown matching the rest of the UI. Replaces native
 * ``<select>`` because HTML options can't be styled across browsers,
 * and the OS-native popup breaks immersion with the dark theme.
 *
 * Accessibility: uses ARIA combobox + listbox roles, full keyboard
 * support (↑↓ to move, Enter to select, Esc to close, Home/End for
 * first/last, type-to-search for single characters).
 *
 * Positioning: menu renders absolutely below the anchor. If the menu
 * would overflow the viewport bottom we'd need portal + flip logic —
 * skipped for v1 since our dropdowns open from modals and the header,
 * which always have room below.
 */

export interface DropdownOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
  /** Subtle right-aligned text on the option row (e.g. "— no API key"). */
  hint?: string
}

export interface DropdownProps<T extends string = string> {
  value: T
  onChange: (value: T) => void
  /** Options as either plain strings or full ``DropdownOption`` records. */
  options: ReadonlyArray<T | DropdownOption<T>>
  disabled?: boolean
  placeholder?: string
  /**
   * ``block``  — full-width form control styled like our other inputs.
   *              Used in forms / modals.
   * ``inline`` — transparent button with only label + caret, meant to
   *              sit inside a custom wrapper (e.g. the session header
   *              pill). No border or background of its own.
   */
  variant?: 'block' | 'inline'
  /** Extra styles layered onto the anchor. Use sparingly. */
  anchorStyle?: CSSProperties
  /** Tooltip / a11y title on the anchor. */
  title?: string
  'aria-label'?: string
}

function normalize<T extends string>(opt: T | DropdownOption<T>): DropdownOption<T> {
  return typeof opt === 'string' ? { value: opt, label: opt } : opt
}

function firstEnabledIndex(items: DropdownOption<string>[]): number {
  return items.findIndex((o) => !o.disabled)
}

function lastEnabledIndex(items: DropdownOption<string>[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].disabled) return i
  }
  return -1
}

export default function Dropdown<T extends string = string>({
  value,
  onChange,
  options,
  disabled = false,
  placeholder,
  variant = 'block',
  anchorStyle,
  title,
  'aria-label': ariaLabel,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [typed, setTyped] = useState('')
  // Flip menu alignment when opening near the right edge of the viewport
  // would otherwise force a horizontal scroll (and the browser would then
  // auto-scroll to keep the anchor visible, yanking the whole UI left).
  const [align, setAlign] = useState<'left' | 'right'>('left')
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const items = options.map((o) => normalize(o)) as DropdownOption<T>[]
  const current = items.find((o) => o.value === value)

  // Initialize active index when opening.
  useEffect(() => {
    if (!open) return
    const idx = items.findIndex((o) => o.value === value && !o.disabled)
    setActive(idx >= 0 ? idx : firstEnabledIndex(items))
    setTyped('')
    // Focus menu so subsequent arrow keys land without requiring the
    // user to Tab.
    menuRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the active option in view as the user arrows through a long list.
  useEffect(() => {
    if (!open || active < 0 || !menuRef.current) return
    const el = menuRef.current.querySelector<HTMLElement>(
      `[data-idx="${active}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // Decide which edge of the anchor to pin the menu to, based on whether
  // left-aligned would overflow the viewport. Runs synchronously after
  // layout so the correct alignment is applied on the first paint — no
  // visible jump from "opens wrong then fixes itself".
  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !menuRef.current) {
      if (!open) setAlign('left')
      return
    }
    const anchor = anchorRef.current.getBoundingClientRect()
    const menuWidth = menuRef.current.offsetWidth
    const viewportWidth = window.innerWidth
    const MARGIN = 8
    // Room to the right of the anchor's left edge? If not, pin right.
    if (anchor.left + menuWidth > viewportWidth - MARGIN) {
      setAlign('right')
    } else {
      setAlign('left')
    }
  }, [open, options.length])

  // Close when clicking anywhere outside the anchor + menu.
  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node)) return
      if (anchorRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Clear the type-to-search buffer after a short pause so the user
  // can start a new search without the previous chars bleeding in.
  useEffect(() => {
    if (!typed) return
    const t = window.setTimeout(() => setTyped(''), 700)
    return () => window.clearTimeout(t)
  }, [typed])

  const selectByIndex = (idx: number) => {
    const opt = items[idx]
    if (!opt || opt.disabled) return
    if (opt.value !== value) onChange(opt.value)
    setOpen(false)
    // Return focus to the anchor so keyboard users can keep moving.
    requestAnimationFrame(() => anchorRef.current?.focus())
  }

  const moveActive = (delta: number) => {
    if (items.length === 0) return
    let idx = active
    for (let i = 0; i < items.length; i++) {
      idx = (idx + delta + items.length) % items.length
      if (!items[idx].disabled) {
        setActive(idx)
        return
      }
    }
  }

  const handleKey = (
    e: KeyboardEvent<HTMLButtonElement | HTMLUListElement>,
  ) => {
    if (disabled) return
    if (!open) {
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'Enter' ||
        e.key === ' '
      ) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveActive(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveActive(-1)
        break
      case 'Home':
        e.preventDefault()
        setActive(firstEnabledIndex(items))
        break
      case 'End':
        e.preventDefault()
        setActive(lastEnabledIndex(items))
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (active >= 0) selectByIndex(active)
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        requestAnimationFrame(() => anchorRef.current?.focus())
        break
      case 'Tab':
        setOpen(false)
        break
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault()
          const next = (typed + e.key).toLowerCase()
          setTyped(next)
          const idx = items.findIndex(
            (o) => !o.disabled && o.label.toLowerCase().startsWith(next),
          )
          if (idx >= 0) setActive(idx)
        }
    }
  }

  const displayLabel = current?.label ?? placeholder ?? ''
  const isInline = variant === 'inline'

  return (
    <div style={isInline ? inlineOuter : blockOuter}>
      <button
        ref={anchorRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={title}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleKey}
        style={{
          ...(isInline ? inlineAnchorBase : blockAnchorStyle(open)),
          ...anchorStyle,
        }}
      >
        <span
          style={{
            flex: 1,
            textAlign: 'left',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayLabel}
        </span>
        <span
          aria-hidden
          style={{
            fontSize: 9,
            color: COLORS.textDim,
            marginLeft: 6,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        >
          ▾
        </span>
      </button>

      {open && (
        <ul
          ref={menuRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={handleKey}
          style={{
            ...menuStyle,
            left: align === 'left' ? 0 : 'auto',
            right: align === 'right' ? 0 : 'auto',
          }}
        >
          {items.length === 0 && (
            <li
              style={{
                padding: '8px 10px',
                color: COLORS.textDim,
                fontSize: 13,
                fontStyle: 'italic',
              }}
            >
              (no options)
            </li>
          )}
          {items.map((o, i) => {
            const isActive = i === active
            const isSelected = o.value === value
            const isDisabled = !!o.disabled
            return (
              <li
                key={o.value}
                data-idx={i}
                role="option"
                aria-selected={isSelected}
                aria-disabled={isDisabled || undefined}
                onMouseEnter={() => !isDisabled && setActive(i)}
                onMouseDown={(e) => {
                  // Prevent the anchor from losing focus before onClick
                  // fires — keeps the return-focus flow clean.
                  e.preventDefault()
                }}
                onClick={() => selectByIndex(i)}
                style={optionStyle(isActive, isSelected, isDisabled)}
              >
                <span style={optionLabelStyle}>{o.label}</span>
                {o.hint ? (
                  <span style={optionHintStyle}>{o.hint}</span>
                ) : isSelected ? (
                  <span aria-hidden style={optionCheckStyle}>
                    ✓
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────

const blockOuter: CSSProperties = {
  position: 'relative',
  width: '100%',
}

const inlineOuter: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
}

function blockAnchorStyle(open: boolean): CSSProperties {
  return {
    width: '100%',
    padding: '8px 10px',
    background: COLORS.bgInput,
    border: `1px solid ${open ? COLORS.blue : COLORS.border}`,
    borderRadius: 6,
    fontSize: 14,
    color: COLORS.text,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'border-color 120ms ease, box-shadow 120ms ease',
    boxShadow: open ? '0 0 0 3px rgba(92,156,246,0.12)' : undefined,
    outline: 'none',
    fontFamily: 'inherit',
    textAlign: 'left',
  }
}

const inlineAnchorBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 'inherit',
  color: 'inherit',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
}

// Menu style leaves ``left`` / ``right`` unset; the component injects
// them at runtime based on the ``align`` state so the menu flips away
// from the viewport edge it would otherwise overflow.
const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  minWidth: '100%',
  maxHeight: 280,
  overflowY: 'auto',
  margin: 0,
  padding: 4,
  background: COLORS.bgElevated,
  border: `1px solid ${COLORS.borderStrong}`,
  borderRadius: 8,
  boxShadow: COLORS.shadowFloat,
  listStyle: 'none',
  zIndex: 20,
  outline: 'none',
}

function optionStyle(
  isActive: boolean,
  isSelected: boolean,
  isDisabled: boolean,
): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderRadius: 4,
    fontSize: 13,
    color: isDisabled ? COLORS.textDim : COLORS.text,
    background: isActive && !isDisabled ? COLORS.bgCardHover : 'transparent',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    opacity: isDisabled ? 0.55 : 1,
    fontWeight: isSelected ? 500 : 400,
    userSelect: 'none',
  }
}

const optionLabelStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const optionHintStyle: CSSProperties = {
  color: COLORS.textDim,
  fontSize: 11,
  whiteSpace: 'nowrap',
}

const optionCheckStyle: CSSProperties = {
  color: COLORS.blue,
  fontSize: 12,
  fontWeight: 700,
}
