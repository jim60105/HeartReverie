// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Minimal DOM element builder for vanilla-JS plugin frontends. Creates an
 * element of `tag`, applies `attrs` (`class` → className, `style` → style
 * attribute, `on*` function values → event listeners, anything else →
 * setAttribute unless the value is `false`/`null`/`undefined`), and appends
 * `children` (strings become text nodes; `null`/`undefined` are skipped).
 * @param {string} tag
 * @param {Record<string, unknown> | null | undefined} attrs
 * @param {...(Node | string | null | undefined)} children
 * @returns {HTMLElement}
 */
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === "class") node.className = v;
    else if (k === "style") node.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2), v);
    } else if (v !== false && v !== null && v !== undefined) {
      node.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}
