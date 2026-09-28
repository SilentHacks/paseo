// Web dialogs use ordinary scrolling at every breakpoint. Keep native gesture
// dependencies out of this module's import graph.
import { forwardRef, useCallback, useLayoutEffect, useRef, type Ref } from "react";
import {
  ScrollView as NativeScrollView,
  FlatList as NativeFlatList,
  type ScrollViewProps,
} from "react-native";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * Theme-driven registry updates can collapse layout for a frame (the unistyles
 * stylesheet tag's innerText is rewritten per theme key). The browser then
 * clamps scrollTop to 0 without firing a scroll event — the page visibly jumps
 * to the top. Positions live in module state keyed by the scroller's parent
 * slot so restore still works when the node (or the fiber above it) is
 * recreated mid-commit.
 */
interface ScrollerRecord {
  el: HTMLElement;
  pos: number;
}
const scrollerByParent = new WeakMap<HTMLElement, ScrollerRecord>();
const scrollerToRecord = new WeakMap<HTMLElement, ScrollerRecord>();
const liveScrollers = new Set<HTMLElement>();
let lastDetachedScroller: ScrollerRecord | null = null;
let scrollerWatchdogRaf = 0;

function scheduleScrollerWatchdog() {
  if (scrollerWatchdogRaf) return;
  scrollerWatchdogRaf = requestAnimationFrame(scrollerWatchdogTick);
}

function scrollerWatchdogTick() {
  scrollerWatchdogRaf = 0;
  let armed = false;
  for (const el of liveScrollers) {
    const rec = scrollerToRecord.get(el);
    if (!rec || !el.isConnected) continue;
    if (rec.pos > 0) {
      armed = true;
      if (el.scrollTop === 0 && el.scrollHeight > el.clientHeight) {
        el.scrollTop = rec.pos;
      }
    }
  }
  if (armed) scheduleScrollerWatchdog();
}

function onWebScrollerScroll(e: Event) {
  const el = e.target as HTMLElement;
  const rec = scrollerToRecord.get(el);
  if (rec) rec.pos = el.scrollTop;
  if (rec && rec.pos > 0) scheduleScrollerWatchdog();
}

function attachWebScroller(el: HTMLElement | null | undefined, previous: HTMLElement | null) {
  const resolved = el ?? null;
  if (resolved === previous) return resolved;
  if (!resolved) return null;
  const parent = resolved.parentElement;
  let rec = parent ? scrollerByParent.get(parent) : undefined;
  if (rec && rec.el !== resolved) {
    if (rec.pos > 0 && resolved.scrollTop === 0) resolved.scrollTop = rec.pos;
    scrollerToRecord.delete(rec.el);
    rec.el = resolved;
    scrollerToRecord.set(resolved, rec);
  } else if (!rec) {
    const dead = lastDetachedScroller;
    if (dead && dead.pos > 0 && !dead.el.isConnected && resolved.scrollTop === 0) {
      resolved.scrollTop = dead.pos;
      rec = dead;
      rec.el = resolved;
    } else {
      rec = { el: resolved, pos: 0 };
    }
    if (parent) scrollerByParent.set(parent, rec);
    scrollerToRecord.set(resolved, rec);
    lastDetachedScroller = null;
  }
  resolved.addEventListener("scroll", onWebScrollerScroll, { passive: true });
  liveScrollers.add(resolved);
  return resolved;
}

function detachWebScroller(el: HTMLElement | null) {
  if (!el) return;
  el.removeEventListener("scroll", onWebScrollerScroll);
  liveScrollers.delete(el);
  const rec = scrollerToRecord.get(el);
  // The node may still be connected at ref-detach time; the isConnected check
  // runs when the replacement attaches.
  if (rec && rec.pos > 0) lastDetachedScroller = rec;
}

function useWebScrollRestore(ref: Ref<NativeScrollView>) {
  const instanceRef = useRef<NativeScrollView | null>(null);
  const attachedEl = useRef<HTMLElement | null>(null);
  const attach = useCallback((el: HTMLElement | null | undefined) => {
    const prev = attachedEl.current;
    if ((el ?? null) === prev) return;
    detachWebScroller(prev);
    attachedEl.current = attachWebScroller(el, prev);
  }, []);
  // Host nodes can be swapped while the component instance survives; recheck
  // the DOM node after every commit, not just when the ref fires.
  useLayoutEffect(() => {
    const inst = instanceRef.current as unknown as {
      getScrollableNode?: () => HTMLElement;
    } | null;
    attach(inst?.getScrollableNode?.());
    return () => {
      if (!instanceRef.current) {
        detachWebScroller(attachedEl.current);
        attachedEl.current = null;
      }
    };
  });
  return useCallback(
    (instance: NativeScrollView | null) => {
      instanceRef.current = instance;
      attach(
        (instance as unknown as { getScrollableNode?: () => HTMLElement })?.getScrollableNode?.(),
      );
      assignRef(ref, instance);
    },
    [attach, ref],
  );
}

export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>(
  function ScrollView(props, ref) {
    const restoreRef = useWebScrollRestore(ref);
    return <NativeScrollView {...props} ref={restoreRef} />;
  },
);

export const FlatList = NativeFlatList;
