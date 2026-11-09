"""Turns the owner's ARIA_Expression_Rig.svg into the animated companion (src/app/companion.ts).
The artwork is used as drawn. Only these are added: class names for the animated parts, a head group, three extra
mouth shapes in the rig's own line style, listening waves and a sparkle. IDs are prefixed so they can't clash with the page."""
import re, sys

rig = open(sys.argv[1], encoding="utf-8").read()
body = rig[rig.index("<defs>"):rig.rindex("</svg>")].strip()

# defs ids -> ar- prefixed (gradients and the badge clip)
for i in ["blue", "skin", "hair", "top", "headset", "badge-clip"]:
    body = body.replace(f'id="{i}"', f'id="ar-{i}"').replace(f"url(#{i})", f"url(#ar-{i})")

# named groups -> classes (no page-level ids); the animated parts get the companion's class names
CLASS = {
    "left-eye": "ar-eye ar-eye-l", "right-eye": "ar-eye ar-eye-r",
    "left-pupil": "ar-pupil", "right-pupil": "ar-pupil",
    "left-brow": "ar-brow ar-brow-l", "right-brow": "ar-brow ar-brow-r",
    "mouth": "ar-mouth ar-mouth-open", "hair-back": "ar-hair-back",
}
def to_class(m):
    name = m.group(1)
    if name.startswith("ar-"):
        return m.group(0)
    return f'class="{CLASS.get(name, "ar-" + name)}"'
body = re.sub(r'id="([^"]+)"', to_class, body)
# inline transform-origin styles on the rig's groups are replaced by the stylesheet
body = re.sub(r' style="transform-box:fill-box;transform-origin:center center"', "", body)

# Neck extension behind the head: the body's neck continues up under the chin (hidden by the face), so when the head
# tilts or nods the gap shows neck, never background. Drawn at the end of the body, before the head.
neck = """
  <g class="ar-neck-extension">
   <path d="M577 817 L615 747 L606 560 L770 560 L754 750 L773 803 Z" fill="#f4a466" stroke="none"/>
   <path d="M615 747 L606 600 M754 750 L766 600" fill="none" stroke="#151319" stroke-width="12"/>
  </g>"""
body_end = body.index("</g>", body.index('<g class="ar-body">'))
body = body[:body_end] + neck + "\n " + body[body_end:]

# head: everything from the face through the front of the headset turns and nods together
start = body.index('<g class="ar-face-and-neck">')
end = body.index("</g>", body.index('<g class="ar-headset-front"')) + len("</g>")
head = body[start:end]
# extra mouths, after the rig's mouth, in the same stroke colour and fill
mouth_end = head.index("</g>", head.index('class="ar-mouth ar-mouth-open"')) + len("</g>")
extra_mouths = """
  <path class="ar-mouth ar-mouth-soft" d="M488 612 Q 572 654 646 586" fill="none" stroke="#151319" stroke-width="12"/>
  <ellipse class="ar-mouth ar-mouth-o" cx="566" cy="626" rx="27" ry="33" fill="#25171d" stroke="#151319" stroke-width="9"/>
  <path class="ar-mouth ar-mouth-flat" d="M498 642 Q 566 610 636 628" fill="none" stroke="#151319" stroke-width="12"/>"""
head = head[:mouth_end] + extra_mouths + head[mouth_end:]
body = body[:start] + '<g class="ar-head">\n' + head + "\n</g>" + body[end:]

extras = """<g class="ar-waves" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round">
  <path class="ar-wave ar-wave-1" d="M985 430 Q 1012 470 985 510"/>
  <path class="ar-wave ar-wave-2" d="M1030 400 Q 1072 470 1030 540"/>
  <path class="ar-wave ar-wave-3" d="M1075 370 Q 1132 470 1075 570"/>
</g>
<polygon class="ar-glint" points="1060,40 1082,104 1146,126 1082,148 1060,212 1038,148 974,126 1038,104" fill="#fff" stroke="#151319" stroke-width="9" stroke-linejoin="round"/>"""
cut = body.index("</defs>") + len("</defs>")
body = body[:cut] + '\n<g class="ar-float">\n' + body[cut:] + "\n" + extras + "\n</g>"
assert "`" not in body and "${" not in body
body = body.replace("\n", "\n  ")

ts = open(sys.argv[2], encoding="utf-8").read().replace("@@SVG@@", body)
open(sys.argv[3], "w", encoding="utf-8").write(ts)
print("ok", len(ts), "chars")
