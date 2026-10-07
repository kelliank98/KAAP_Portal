(function () {
  "use strict";

  var OPEN = 6 * 60;
  var DICHT = 23 * 60;
  var MAANDEN = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];

  function amsterdam(moment) {
    var delen = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(moment).forEach(function (deel) { delen[deel.type] = deel.value; });
    return {
      datum: delen.year + "-" + delen.month + "-" + delen.day,
      minuten: Number(delen.hour) * 60 + Number(delen.minute)
    };
  }

  function status(opening, moment) {
    var nu = amsterdam(moment || new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opening || "")) {
      return { soort: "binnenkort", tekst: "Binnenkort open" };
    }
    if (nu.datum < opening) {
      var d = opening.split("-");
      return { soort: "binnenkort", tekst: "Open vanaf " + Number(d[2]) + " " + MAANDEN[Number(d[1]) - 1] };
    }
    if (nu.minuten >= OPEN && nu.minuten < DICHT) {
      return { soort: "open", tekst: "Nu open · tot 23:00" };
    }
    return { soort: "dicht", tekst: nu.minuten < OPEN ? "Gesloten · open om 06:00" : "Gesloten · morgen 06:00" };
  }

  function founders(over) {
    if (!/^\d+$/.test(over || "")) return null;
    var n = Math.min(Number(over), 100);
    if (n === 0) return "De 100 plekken zijn vergeven.";
    return "Nog " + n + " van de 100 plekken vrij.";
  }

  window.kcwStatus = status;
  window.kcwFounders = founders;

  function toonStatus() {
    var s = status(document.body.getAttribute("data-opening"));
    document.querySelectorAll("[data-status]").forEach(function (el) {
      el.textContent = s.tekst;
      el.setAttribute("data-soort", s.soort);
    });
  }

  function toonFounders() {
    var tekst = founders(document.body.getAttribute("data-founders-over"));
    var el = document.querySelector("[data-founders]");
    if (!el || !tekst) return;
    el.textContent = tekst;
    el.hidden = false;
  }

  function balk() {
    var b = document.querySelector(".balk");
    var hero = document.querySelector(".hero");
    if (!b || !hero || !("IntersectionObserver" in window)) return;
    new IntersectionObserver(function (items) {
      b.classList.toggle("zichtbaar", !items[0].isIntersecting);
    }).observe(hero);
  }

  function menu() {
    var kop = document.querySelector(".kop");
    var knop = document.querySelector(".menu-knop");
    if (!kop || !knop) return;
    function zet(open) {
      kop.classList.toggle("open", open);
      knop.setAttribute("aria-expanded", open ? "true" : "false");
    }
    knop.addEventListener("click", function () { zet(!kop.classList.contains("open")); });
    document.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () { zet(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") zet(false);
    });
  }

  function vast() {
    var kop = document.querySelector(".kop");
    if (!kop) return;
    function zet() { kop.classList.toggle("vast", window.scrollY > 24); }
    zet();
    window.addEventListener("scroll", zet, { passive: true });
  }

  function rustig() {
    if (!window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("video[autoplay]").forEach(function (v) {
      v.removeAttribute("autoplay");
      v.pause();
      v.controls = true;
    });
  }

  toonStatus();
  toonFounders();
  balk();
  menu();
  vast();
  rustig();
  setInterval(toonStatus, 60000);
})();
