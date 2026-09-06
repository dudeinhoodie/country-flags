import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { FIELD_PARAM } from "./routes";

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function escape(value: string): string {
  // `CSS.escape` is what makes an arbitrary pointer safe in a selector; a
  // browser old enough to lack it simply does not get the jump.
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replace(/["\\]/gu, "\\$&");
}

/**
 * Opens the field a finding pointed at, once the screen has the data to show
 * it (§9, acceptance criterion 7).
 *
 * The editor marks its controls with `data-field="<pointer>"`; this finds the
 * one the URL names, scrolls it into view and puts the caret in it. It fires
 * once per pointer: a click into another field must not be dragged back.
 *
 * Returns the pointer so the editor can also show the field as the one being
 * asked about — focus alone is invisible to anyone reading the page rather
 * than driving it.
 */
export function useFieldFocus(ready: boolean): string | null {
  const [search] = useSearchParams();
  const pointer = search.get(FIELD_PARAM);
  const handled = useRef<string | null>(null);
  const attempts = useRef(0);

  // No dependency list: the control the pointer names may mount a render or
  // two after the data arrives, and the guards below stop the search as soon
  // as it succeeds — or after a few tries, when the pointer names nothing
  // this editor has.
  useEffect(() => {
    if (!ready || pointer === null || pointer === "") {
      return;
    }
    if (handled.current === pointer || attempts.current > 20) {
      return;
    }
    attempts.current += 1;
    const host = document.querySelector(`[data-field="${escape(pointer)}"]`);
    if (host === null) {
      return;
    }
    handled.current = pointer;
    const target =
      (host.matches(FOCUSABLE) ? host : host.querySelector(FOCUSABLE)) ?? host;
    if (target instanceof HTMLElement) {
      if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "center" });
      }
      target.focus();
    }
  });

  return pointer;
}
