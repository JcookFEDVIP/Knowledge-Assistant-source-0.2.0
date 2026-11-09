// Companion: ARIA, the app's character. The artwork is the owner's layered ARIA_Expression_Rig.svg (built from
// "ARIA Logo.png"), used as drawn; its eyes, pupils, brows, mouth, head and hair are animated here. Isolated by design: it only listens for `ka:state` events and never reads or shows
// search content. If this file fails or is removed, the app is unaffected (tests/isolation.test.ts verifies the engine
// never imports it).
(() => {
  try {
    const slot = document.getElementById("companion");
    if (!slot) return;
    slot.innerHTML = `
<svg class="aria-companion" viewBox="0 0 1228 1228" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true" focusable="false">
  @@SVG@@
</svg>`;
    const style = document.createElement("style");
    style.textContent = `
.aria-companion { overflow: visible; transition: opacity .3s, filter .3s; }
.aria-companion .ar-float { animation: ar-float 5s ease-in-out infinite; }
.aria-companion .ar-head { transform-box: view-box; transform-origin: 600px 760px; transition: transform .45s cubic-bezier(.2,.7,.2,1); }
.aria-companion .ar-hair-back { transform-box: view-box; transform-origin: 614px 110px; animation: ar-sway 6s ease-in-out infinite; }
.aria-companion .ar-eye, .aria-companion .ar-brow, .aria-companion .ar-mouth, .aria-companion .ar-glint { transform-box: fill-box; transform-origin: center; }
.aria-companion .ar-eye { animation: ar-blink 6s infinite; }
.aria-companion .ar-eye-r { animation-delay: .04s; }
.aria-companion .ar-pupil { animation: ar-glance 11s ease-in-out infinite; transition: transform .35s; }
.aria-companion .ar-brow { transition: transform .35s; }
.aria-companion .ar-mouth { opacity: 0; transition: opacity .2s; }
.aria-companion .ar-mouth-open { opacity: 1; }
.aria-companion .ar-wave { opacity: 0; }
.aria-companion .ar-glint { opacity: 0; transition: opacity .3s; }
/* ready (search box focused): attentive, looking down toward the search box */
.aria-companion.s-ready .ar-head { transform: scale(1.03); }
.aria-companion.s-ready .ar-brow { transform: translateY(-12px); }
.aria-companion.s-ready .ar-pupil { animation: none; transform: translate(0, 12px); }
/* typing / searching: listening on the headset */
.aria-companion.s-typing .ar-head { transform: rotate(4deg); }
.aria-companion.s-typing .ar-mouth-open, .aria-companion.s-searching .ar-mouth-open { opacity: 0; }
.aria-companion.s-typing .ar-mouth-soft, .aria-companion.s-searching .ar-mouth-soft { opacity: 1; }
.aria-companion.s-typing .ar-wave, .aria-companion.s-searching .ar-wave { animation: ar-wave 1.2s ease-in-out infinite; }
.aria-companion.s-searching .ar-wave { animation-duration: .7s; }
.aria-companion .ar-wave-2 { animation-delay: .15s !important; }
.aria-companion .ar-wave-3 { animation-delay: .3s !important; }
.aria-companion.s-searching .ar-pupil { animation: ar-scan .9s ease-in-out infinite; }
/* results: nods, talks, sparkle */
.aria-companion.s-results .ar-head { animation: ar-nod .55s ease-out 1; }
.aria-companion.s-results .ar-mouth-open { animation: ar-talk .28s ease-in-out 4; }
.aria-companion.s-results .ar-brow { transform: translateY(-14px); }
.aria-companion.s-results .ar-glint { opacity: 1; animation: ar-glint 1.6s ease-in-out 2; }
/* ambiguous: curious head tilt, one brow up, "oh?" */
.aria-companion.s-ambiguous .ar-head { transform: rotate(-8deg); }
.aria-companion.s-ambiguous .ar-brow-r { transform: translateY(-24px) rotate(-6deg); }
.aria-companion.s-ambiguous .ar-pupil { animation: none; transform: translate(-12px, -24px); }
.aria-companion.s-ambiguous .ar-mouth-open { opacity: 0; }
.aria-companion.s-ambiguous .ar-mouth-o { opacity: 1; }
/* no result: sympathetic */
.aria-companion.s-noresult .ar-head { transform: translateY(16px); }
.aria-companion.s-noresult .ar-brow-l { transform: rotate(-10deg) translateY(6px); }
.aria-companion.s-noresult .ar-brow-r { transform: rotate(10deg) translateY(6px); }
.aria-companion.s-noresult .ar-pupil { animation: none; transform: translateY(14px); }
.aria-companion.s-noresult .ar-mouth-open { opacity: 0; }
.aria-companion.s-noresult .ar-mouth-flat { opacity: 1; }
/* source open: reading along, quiet */
.aria-companion.s-source { opacity: .75; }
.aria-companion.s-source .ar-pupil { animation: none; transform: translate(0, 20px); }
.aria-companion.s-source .ar-mouth-open { opacity: 0; }
.aria-companion.s-source .ar-mouth-soft { opacity: 1; }
.aria-companion.s-source .ar-float, .aria-companion.s-error .ar-float { animation-play-state: paused; }
.aria-companion.s-error { filter: grayscale(.8); }
.aria-companion.paused * { animation-play-state: paused !important; }
@keyframes ar-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-26px) } }
@keyframes ar-sway { 0%,100% { transform: rotate(0) } 50% { transform: rotate(1.2deg) } }
@keyframes ar-blink { 0%, 93%, 100% { transform: scaleY(1) } 95% { transform: scaleY(.08) } }
@keyframes ar-glance { 0%, 38%, 62%, 100% { transform: translate(0, 0) } 44%, 56% { transform: translate(-34px, 4px) } }
@keyframes ar-scan { 0%,100% { transform: translate(-40px, 0) } 50% { transform: translate(0, 0) } }
@keyframes ar-nod { 0%,100% { transform: translateY(0) rotate(0) } 35% { transform: translateY(26px) rotate(-2deg) } 70% { transform: translateY(-10px) rotate(1.5deg) } }
@keyframes ar-talk { 0%,100% { transform: scaleY(1) } 50% { transform: scaleY(.6) } }
@keyframes ar-wave { 0%,100% { opacity: 0 } 40%,60% { opacity: .95 } }
@keyframes ar-glint { 0%,100% { transform: rotate(-10deg) scale(1) } 50% { transform: rotate(10deg) scale(1.2) } }
@media (prefers-reduced-motion: reduce) { .aria-companion, .aria-companion * { animation: none !important; transition: none !important; } }`;
    document.head.appendChild(style);
    const svg = slot.querySelector("svg.aria-companion")!;
    const STATES = ["idle", "ready", "typing", "searching", "results", "ambiguous", "noresult", "source", "error"];
    const set = (s: string) => { for (const x of STATES) svg.classList.toggle(`s-${x}`, x === s); };
    set("idle");
    let idleTimer: number | undefined;
    window.addEventListener("ka:state", (e) => {
      const s = String((e as CustomEvent).detail);
      if (!STATES.includes(s)) return;
      set(s);
      window.clearTimeout(idleTimer);
      if (s === "results" || s === "typing") idleTimer = window.setTimeout(() => set("idle"), 4000);
    });
    document.addEventListener("visibilitychange", () => svg.classList.toggle("paused", document.hidden));
  } catch {
    /* The companion is decorative; any failure leaves search untouched. */
  }
})();
