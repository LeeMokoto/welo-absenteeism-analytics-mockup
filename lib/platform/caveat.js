/*
  Which form a caveat takes, by how long it is.

  The platform marks every figure that is modelled, indicative, suppressed or
  unmeasurable, and those marks share one style: uppercase mono, 10.5px, wide
  tracking. That is right for "Modelled, not live." and wrong for the
  304-character causation caveat in the control centre, which set as five
  full-width lines of capitals. The most important sentence on that screen was
  the least readable thing on it.

  Length is the only thing separating the two, and much of this text comes
  from data: an outcome's caveat, a rule's skipped note, an agent's failure
  message. Which of those is long is not knowable where the markup is written,
  and a hand-kept list of the long ones goes stale the first time one is
  reworded. So the markup asks this function instead.

  A class helper rather than a wrapper component on purpose: it changes one
  attribute and leaves the element tree alone. Rewriting these divs into a
  component is what broke the control centre the first time this was tried.
*/

/*
  80 characters, which is where these caveats actually divide.

  Measured across the five control centre screens: the markers come in at 50
  characters or fewer and sit on one line, and every caveat that wraps to a
  second line is 82 or more. Nothing falls in between, so the threshold sits
  in that gap rather than at a number picked by eye. The first attempt used
  110 and left three two-line blocks shouting in capitals.

  The rule it approximates is "does this wrap": one line of 10.5px mono with
  0.1em tracking holds roughly 55 to 60 characters in a card, and a caveat
  that needs two lines is being read rather than scanned.
*/
export const LONG_CAVEAT = 80;

export function caveatClass(text, extra = "") {
  const long = String(text == null ? "" : text).trim().length > LONG_CAVEAT;
  return ["indicative", long ? "long" : "", extra].filter(Boolean).join(" ");
}
