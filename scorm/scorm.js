// Launch-only SCORM 1.2: report "completed" on open, finish on close.
// Nothing else is sent to the LMS (no search text, no scores).
(function () {
  function findAPI(win) {
    for (var i = 0; win && i < 10; i++) {
      try {
        if (win.API) return win.API;
      } catch (e) {}
      if (win.parent === win) break;
      win = win.parent;
    }
    return null;
  }

  var api = findAPI(window);
  if (!api && window.opener) api = findAPI(window.opener);

  var finished = false;
  function call(fn, a, b) {
    try {
      return api[fn].apply(api, b === undefined ? [a] : [a, b]);
    } catch (e) {}
  }
  function finish() {
    if (!api || finished) return;
    finished = true;
    call("LMSFinish", "");
  }

  if (api) {
    call("LMSInitialize", "");
    call("LMSSetValue", "cmi.core.lesson_status", "completed");
    call("LMSCommit", "");
    window.addEventListener("pagehide", finish);
    window.addEventListener("beforeunload", finish);
  }

  var frame = document.getElementById("app");
  frame.addEventListener("load", function () {
    try {
      frame.contentWindow.focus();
    } catch (e) {}
  });
})();
