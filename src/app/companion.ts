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
  <defs>
    <radialGradient id="ar-blue" cx="47%" cy="46%" r="60%"><stop stop-color="#c3efff"/><stop offset=".69" stop-color="#91d9fa"/><stop offset="1" stop-color="#69bfed"/></radialGradient>
    <linearGradient id="ar-skin" x1="0" y1="0" x2=".75" y2="1"><stop stop-color="#ffc37f"/><stop offset=".6" stop-color="#ffb16e"/><stop offset="1" stop-color="#ed975f"/></linearGradient>
    <linearGradient id="ar-hair" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="#ffe6a4"/><stop offset=".5" stop-color="#ffd27b"/><stop offset="1" stop-color="#edbd63"/></linearGradient>
    <linearGradient id="ar-top" x1="0" y1="0" x2=".6" y2="1"><stop stop-color="#ffa477"/><stop offset="1" stop-color="#ec8769"/></linearGradient>
    <linearGradient id="ar-headset" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#464650"/><stop offset=".65" stop-color="#282832"/><stop offset="1" stop-color="#19191f"/></linearGradient>
    <clipPath id="ar-badge-clip"><circle cx="614" cy="624" r="582"/></clipPath>
  </defs>
  <g class="ar-float">
  
  <g class="ar-badge"><circle cx="614" cy="624" r="590" fill="url(#ar-blue)" stroke="#15151b" stroke-width="25"/></g>
  <g clip-path="url(#ar-badge-clip)" stroke="#151319" stroke-linejoin="round" stroke-linecap="round">
   <g class="ar-hair-back">
    <path d="M263 448 C250 337 285 215 393 150 C475 99 649 72 764 137 C856 189 886 281 890 414 L954 592 C970 690 978 756 1042 858 C1082 914 1075 1033 1000 1090 L415 1210 C312 1147 250 1078 239 998 C211 941 243 863 283 830 C221 816 232 759 267 700 Z" fill="url(#ar-hair)" stroke-width="14"/>
    <path d="M306 696 C289 798 254 818 230 892 C201 964 243 1074 316 1126" fill="none" stroke="#c98f45" stroke-width="20"/>
    <path d="M856 410 C867 609 955 714 955 828 C968 919 1000 990 1034 1049" fill="none" stroke="#e3aa57" stroke-width="30"/>
    <path d="M905 613 Q932 756 947 815 M871 743 Q885 839 922 916" fill="none" stroke="#1a1719" stroke-width="10"/>
   </g>
   <g class="ar-body">
    <path d="M352 1049 C390 939 454 839 577 817 L615 747 L754 750 C773 803 820 824 876 830 C966 845 1012 906 1052 1049 L1008 1249 L371 1245 Z" fill="url(#ar-skin)" stroke-width="12"/>
    <path d="M424 1006 C554 972 724 963 851 998 Q868 1100 844 1228 L438 1227 C411 1138 403 1070 424 1006 Z" fill="url(#ar-top)" stroke-width="9"/>
    <path d="M439 1123 Q611 1190 827 1123 L823 1215 L443 1221 Z" fill="#e77a61" opacity=".42" stroke="none"/>
    <path d="M607 774 Q578 845 602 902 Q609 918 618 927" stroke="#f5e9df" stroke-width="5" fill="none"/>
    <path d="M772 792 C731 840 682 873 610 916" stroke="#f5e9df" stroke-width="5" fill="none"/>
    <ellipse cx="604" cy="939" rx="14" ry="20" transform="rotate(20 604 939)" fill="#f1f0ed" stroke="#6a6260" stroke-width="6"/>
    <path d="M727 878 Q784 848 828 851" stroke="#d77f4b" stroke-width="7" fill="none" opacity=".48"/>
   
    <g class="ar-neck-extension">
     <path d="M577 817 L615 747 L606 560 L770 560 L754 750 L773 803 Z" fill="#f4a466" stroke="none"/>
     <path d="M615 747 L606 600 M754 750 L766 600" fill="none" stroke="#151319" stroke-width="12"/>
    </g>
   </g>
   <g class="ar-head">
  <g class="ar-face-and-neck">
    <path d="M569 701 L602 804 Q536 825 471 841 L450 699 Z" fill="#d9915e" stroke-width="10"/>
    <path class="ar-face-outline" d="M351 313 C356 224 416 169 511 165 C604 154 731 192 784 292 C812 355 824 446 810 538 C820 611 759 693 695 721 C635 748 589 757 547 730 C446 704 382 646 359 575 C329 475 335 374 351 313 Z" fill="url(#ar-skin)" stroke-width="11"/>
    <path d="M702 721 C748 687 781 642 803 586 Q799 684 706 739 Q659 758 611 741 Z" fill="#d9895b" opacity=".35" stroke="none"/>
   </g>
   <g class="ar-hair-front">
    <path d="M279 417 C261 306 314 201 399 147 C464 106 549 91 608 101 C524 120 475 164 441 203 C520 178 577 198 646 251 C710 303 754 339 790 365 C724 350 675 302 614 264 C552 226 506 195 452 205 C397 211 367 261 344 339 C328 389 310 439 299 494 Z" fill="url(#ar-hair)" stroke-width="12"/>
    <path d="M443 202 C466 150 510 121 555 111 C644 94 723 149 776 207" fill="none" stroke="#151319" stroke-width="10"/>
    <path d="M585 137 Q713 175 776 301 C733 253 681 209 585 137 Z" fill="#17141a" stroke="none"/>
    <path d="M350 439 C337 514 321 583 311 662 C301 726 300 775 277 823 C242 881 217 936 230 989 C238 1031 270 1065 256 1100 L354 1179 C327 1146 343 1115 357 1080 C377 1026 344 981 370 929 C396 861 438 819 465 750 C484 690 471 633 456 586 C434 675 389 714 368 771 C352 821 361 871 333 920 C311 860 325 812 333 765 C341 700 353 632 351 554 Z" fill="url(#ar-hair)" stroke-width="12"/>
    <path d="M340 586 Q335 686 310 768 M352 722 Q369 793 344 872 M308 876 Q259 968 287 1049 M383 816 Q357 892 342 965" fill="none" stroke="#18151a" stroke-width="9"/>
    <path d="M413 733 Q431 681 446 650" fill="none" stroke="#fff0b5" stroke-width="16" opacity=".75"/>
   </g>
   <g class="ar-headset-behind-face">
    <path d="M275 417 C253 294 309 184 421 119 C535 53 675 64 775 112 C856 157 898 249 898 392" fill="none" stroke="#17171e" stroke-width="45"/>
    <path d="M276 414 C263 304 315 197 422 136 C544 71 670 84 767 130 C838 167 869 251 876 390" fill="none" stroke="#34343d" stroke-width="22"/>
   </g>
   <g class="ar-ears-and-jewelry">
    <path d="M366 552 Q350 601 370 613 Q391 626 395 601" fill="#f9e4dd" stroke-width="9"/>
    <path d="M805 545 Q795 597 812 602 Q829 606 830 567" fill="#f9e4dd" stroke-width="9"/>
   </g>
   <g class="ar-facial-features">
    <g class="ar-eyebrows" fill="none" stroke="#151319" stroke-linecap="round" stroke-width="11">
     <path class="ar-brow ar-brow-l" d="M374 365 Q413 339 461 364"/>
     <path class="ar-brow ar-brow-r" d="M579 355 Q632 315 686 337"/>
    </g>
    <g class="ar-eyes">
     <g class="ar-eye ar-eye-l">
      <path d="M369 450 C374 412 400 392 434 399 C483 398 502 432 498 476 C493 512 472 534 436 535 C395 533 376 508 369 473 Z" fill="#fff" stroke="#151319" stroke-width="10"/>
      <path d="M371 441 Q364 438 362 409 M379 423 Q370 414 365 410" stroke-width="8" fill="none"/>
      <g class="ar-pupil"><ellipse cx="468" cy="471" rx="26" ry="37" fill="#131116" stroke="none"/></g>
     </g>
     <g class="ar-eye ar-eye-r">
      <path d="M576 453 C578 411 610 388 644 386 C688 385 714 416 713 459 C713 504 683 526 644 527 C603 527 576 503 576 453 Z" fill="#fff" stroke="#151319" stroke-width="10"/>
      <path d="M692 398 Q707 399 710 384 M705 417 Q718 416 724 406" stroke-width="8" fill="none"/>
      <g class="ar-pupil"><ellipse cx="686" cy="461" rx="26" ry="37" fill="#131116" stroke="none"/></g>
     </g>
    </g>
    <g class="ar-nose"><path d="M527 490 L497 558 L540 562" fill="none" stroke="#151319" stroke-width="7"/></g>
    <g class="ar-mouth ar-mouth-open">
     <path class="ar-mouth-shape" d="M472 599 Q568 590 652 562 C654 601 621 653 578 671 C533 689 488 651 472 599 Z" fill="#25171d" stroke="#151319" stroke-width="9"/>
     <path d="M484 603 Q570 589 647 571 Q646 587 635 604 Q568 617 496 627 Z" fill="#fff" stroke="none"/>
     <path d="M520 664 Q550 624 586 633 Q611 637 620 650 Q575 690 520 664 Z" fill="#ed8c8e" stroke="none"/>
    </g>
    <path class="ar-mouth ar-mouth-soft" d="M488 612 Q 572 654 646 586" fill="none" stroke="#151319" stroke-width="12"/>
    <ellipse class="ar-mouth ar-mouth-o" cx="566" cy="626" rx="27" ry="33" fill="#25171d" stroke="#151319" stroke-width="9"/>
    <path class="ar-mouth ar-mouth-flat" d="M498 642 Q 566 610 636 628" fill="none" stroke="#151319" stroke-width="12"/>
   </g>
   <g class="ar-headset-front" stroke="#151319">
    <path d="M270 413 C247 418 239 449 242 494 C241 542 260 573 299 572 L308 398 C291 395 278 401 270 413 Z" fill="url(#ar-headset)" stroke-width="12"/>
    <path d="M851 387 L888 384 C926 390 955 416 957 463 L951 514 Q946 562 913 575 L866 570 Z" fill="#313139" stroke-width="13"/>
    <path d="M845 395 C818 397 803 438 808 481 C808 532 831 567 860 568 C885 565 894 526 889 468 C889 422 872 399 845 395 Z" fill="url(#ar-headset)" stroke-width="12"/>
    <path d="M917 559 Q860 645 665 688" fill="none" stroke="#1a1a21" stroke-width="21"/>
    <path d="M916 559 Q857 636 670 680" fill="none" stroke="#34343c" stroke-width="9"/>
    <path d="M657 672 C624 670 590 678 585 699 C582 720 598 734 626 729 L661 714 C687 700 690 673 657 672 Z" fill="url(#ar-headset)" stroke-width="10"/>
   </g>
  </g>
  </g>
  <g class="ar-waves" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round">
    <path class="ar-wave ar-wave-1" d="M985 430 Q 1012 470 985 510"/>
    <path class="ar-wave ar-wave-2" d="M1030 400 Q 1072 470 1030 540"/>
    <path class="ar-wave ar-wave-3" d="M1075 370 Q 1132 470 1075 570"/>
  </g>
  <polygon class="ar-glint" points="1060,40 1082,104 1146,126 1082,148 1060,212 1038,148 974,126 1038,104" fill="#fff" stroke="#151319" stroke-width="9" stroke-linejoin="round"/>
  </g>
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
