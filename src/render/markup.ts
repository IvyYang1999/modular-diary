/**
 * DOM from SVG markup this plugin builds itself (the timeline, toolbar icons).
 * User text inside it is escaped by the builder. The markup is parsed in a
 * separate, inert document — nothing in it runs there — and the nodes are then
 * adopted, instead of being written through `innerHTML` of a live element.
 */
export function fragmentFromMarkup(dom: Document, markup: string): DocumentFragment {
  const Parser = dom.defaultView?.DOMParser ?? DOMParser
  const parsed = new Parser().parseFromString(`<!doctype html><body>${markup}</body>`, "text/html")
  const fragment = dom.createDocumentFragment()
  for (const node of Array.from(parsed.body.childNodes)) fragment.appendChild(dom.importNode(node, true))
  return fragment
}

/** Replace an element's children with the parsed markup. */
export function setMarkup(el: Element, markup: string): void {
  el.replaceChildren(fragmentFromMarkup(el.ownerDocument, markup))
}
