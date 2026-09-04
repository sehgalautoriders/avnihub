(function () {
  "use strict";
  var SUPABASE_URL = "https://tiwfuwfzjxcsbrifcdpu.supabase.co";
  // Public anon key - public by design (it ships inside every browser app of this project).
  // The lock is Row Level Security on the server, not this string.
  var ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpd2Z1d2Z6anhjc2JyaWZjZHB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1OTUxNTIsImV4cCI6MjEwMTE3MTE1Mn0.9nCkV795DHacIiqroP1m0ZvbbVsVjMHi8-okIwjERRc";

  var K_TOKEN = "avni_link_token", K_DEV = "avni_link_device", K_PC = "avni_link_pc";
  var $ = function (id) { return document.getElementById(id); };
  var token = "", pc = null, beat = null, waiting = {};

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch (e) { return null; }
  }
  function hdr() {
    return { "apikey": ANON, "Authorization": "Bearer " + ANON, "Content-Type": "application/json" };
  }
  function rpc(name, args) {
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + name,
      { method: "POST", headers: hdr(), body: JSON.stringify(args) })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
  }
  function digitsOnly(s) {
    var out = "", i, c;
    for (i = 0; i < (s || "").length; i++) { c = s.charAt(i); if (c >= "0" && c <= "9") out += c; }
    return out;
  }
  function deviceId() {
    var d = ls(K_DEV);
    if (!d) {
      d = "ph_" + Math.random().toString(16).slice(2, 10) + Date.now().toString(16).slice(-4);
      ls(K_DEV, d);
    }
    return d;
  }
  function phoneName() {
    var d = navigator.userAgentData;
    if (d && d.platform) return d.platform + " phone";
    var ua = (navigator.userAgent || "").toLowerCase();
    if (ua.indexOf("android") >= 0) return "Android phone";
    if (ua.indexOf("iphone") >= 0) return "iPhone";
    return "Phone";
  }
  function netWord() {
    var c = navigator.connection || {};
    var t = String(c.type || c.effectiveType || "").toLowerCase();
    if (t.indexOf("cellular") >= 0 || t === "4g" || t === "5g" || t === "3g") return "mobile";
    if (t.indexOf("wifi") >= 0) return "wifi";
    return "unknown";
  }
  function plainNet(n) {
    if (!n) return "internet";
    if (n.indexOf("wifi:") === 0) return "Wi-Fi (" + n.slice(5) + ")";
    if (n === "wifi") return "Wi-Fi";
    if (n === "mobile") return "mobile data";
    if (n === "ethernet") return "internet";
    return n;
  }
  function show(which) {
    $("pair").hidden = which !== "pair";
    $("live").hidden = which !== "live";
  }

  // ------------------------------------------------------------------- pair --
  function pair(code) {
    $("pairErr").textContent = "";
    $("doPair").disabled = true;
    rpc("link_pair", { p_code: code, p_device_id: deviceId(), p_name: phoneName(), p_kind: "phone" })
      .then(function (r) {
        $("doPair").disabled = false;
        if (!r || !r.ok) {
          $("pairErr").textContent = "That code did not work. Ask the PC for a fresh one.";
          return;
        }
        token = r.token; ls(K_TOKEN, token);
        pc = r.pc || null; ls(K_PC, JSON.stringify(pc));
        show("live"); start();
      })
      .catch(function () {
        $("doPair").disabled = false;
        $("pairErr").textContent = "No internet reached Avni just now. Try again.";
      });
  }

  // -------------------------------------------------------------- heartbeat --
  function tick() {
    rpc("link_hello", { p_token: token, p_net: netWord(), p_meta: { app: "avni-link-page/1.0" } })
      .then(function (r) {
        if (!r || !r.ok) { forget(true); return; }
        var peers = r.peers || [], mine = null, i;
        for (i = 0; i < peers.length; i++) if (peers[i].kind === "pc") { mine = peers[i]; break; }
        if (mine && (!pc || pc.device_id !== mine.device_id)) {
          pc = { device_id: mine.device_id, name: mine.name };
          ls(K_PC, JSON.stringify(pc));
        }
        paint(mine);
        if (r.pending) drain();
      })
      .catch(function () { paint(null, true); });
  }
  function paint(peer, offlineSelf) {
    var dot = $("dot"), pill = $("pill");
    if (offlineSelf) {
      dot.className = "dot"; pill.className = "pill wait"; pill.textContent = "No internet";
      $("pcMeta").textContent = "This phone has no internet right now. It reconnects by itself.";
      return;
    }
    if (!peer) {
      $("pcName").textContent = (pc && pc.name) || "Your PC";
      dot.className = "dot"; pill.className = "pill wait"; pill.textContent = "Looking";
      $("pcMeta").textContent = "Waiting for the PC to come online.";
      return;
    }
    $("pcName").textContent = peer.name || peer.device_id;
    if (peer.online) {
      dot.className = "dot on"; pill.className = "pill"; pill.textContent = "Connected";
      $("pcMeta").textContent = "On " + plainNet(peer.net) + " - ready";
    } else {
      dot.className = "dot off"; pill.className = "pill off"; pill.textContent = "Offline";
      $("pcMeta").textContent = "The PC is off or has no internet. It reconnects by itself.";
    }
  }

  // --------------------------------------------------------------- commands --
  function pcId() { return (pc && pc.device_id) || null; }
  function send(cmd, extra, title) {
    if (!pcId()) return;
    var corr = "c" + Math.random().toString(16).slice(2, 10);
    waiting[corr] = { title: title || cmd, at: Date.now() };
    $("out").hidden = false; $("outTitle").textContent = title || cmd;
    $("outPill").className = "pill wait"; $("outPill").textContent = "asking the PC";
    $("outBody").innerHTML = "";
    var body = { cmd: cmd }, k;
    if (extra) for (k in extra) body[k] = extra[k];
    rpc("link_send", { p_token: token, p_to: pcId(), p_kind: "cmd", p_corr: corr, p_body: body })
      .catch(function () {
        $("outPill").className = "pill off"; $("outPill").textContent = "not sent";
      });
  }
  function drain() {
    rpc("link_recv", { p_token: token, p_max: 25 }).then(function (r) {
      var msgs = (r && r.messages) || [], i;
      for (i = 0; i < msgs.length; i++) render(msgs[i]);
    }).catch(function () {});
  }
  function render(m) {
    var w = waiting[m.corr];
    if (!w) return;
    delete waiting[m.corr];
    var b = m.body || {}, took = ((Date.now() - w.at) / 1000).toFixed(1);
    $("outTitle").textContent = w.title;
    $("outPill").className = b.ok ? "pill" : "pill off";
    $("outPill").textContent = (b.ok ? "answered in " : "failed after ") + took + " s";
    var host = $("outBody"); host.innerHTML = "";
    if (b.items) {
      b.items.slice(0, 200).forEach(function (it) {
        host.appendChild(line(it.folder ? it.name + "/" : it.name,
                              it.folder ? "" : human(it.size)));
      });
      if (!b.items.length) host.appendChild(line("This folder is empty", ""));
      return;
    }
    if (b.disks) {
      if (b.pc) host.appendChild(line("PC", b.pc));
      if (b.net) host.appendChild(line("Network", plainNet(b.net)));
      if (b.uptime_s) host.appendChild(line("Awake for", hours(b.uptime_s)));
      b.disks.forEach(function (d) {
        host.appendChild(line("Drive " + d.drive + (d.read_only ? " (read-only)" : ""),
                              d.free_gb + " GB free of " + d.total_gb + " GB"));
      });
      (b.avni_running || []).forEach(function (n) { host.appendChild(line("Running", n)); });
      return;
    }
    if (b.pong) {
      host.appendChild(line("Answered by", b.pc));
      host.appendChild(line("PC network", plainNet(b.net)));
      return;
    }
    if (b.awake_for_minutes) {
      host.appendChild(line("PC will stay awake", b.awake_for_minutes + " minutes"));
      return;
    }
    host.appendChild(line("Answer", JSON.stringify(b).slice(0, 300)));
  }
  function line(a, b) {
    var d = document.createElement("div"); d.className = "item";
    var s = document.createElement("span"); s.textContent = a; d.appendChild(s);
    if (b) { var t = document.createElement("span"); t.className = "sz"; t.textContent = b; d.appendChild(t); }
    return d;
  }
  function human(n) {
    if (!n) return "0 B";
    var u = ["B", "KB", "MB", "GB", "TB"], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(1) : n) + " " + u[i];
  }
  function hours(s) {
    var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return (h ? h + " h " : "") + m + " min";
  }

  // -------------------------------------------------------------- lifecycle --
  function start() {
    if (beat) clearInterval(beat);
    tick(); drain();
    beat = setInterval(tick, 3000);
    var n = netWord();
    $("net").textContent = n === "unknown" ? "" : plainNet(n);
  }
  function forget(silent) {
    try { localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_PC); } catch (e) {}
    token = ""; pc = null;
    if (beat) { clearInterval(beat); beat = null; }
    show("pair");
    if (!silent) $("pairErr").textContent = "";
  }

  $("doPair").onclick = function () {
    var c = digitsOnly($("code").value);
    if (c.length !== 6) { $("pairErr").textContent = "The code is 6 digits."; return; }
    pair(c);
  };
  $("clearCode").onclick = function () { $("code").value = ""; $("code").focus(); };
  $("bPing").onclick = function () { send("ping", null, "Check the PC"); };
  $("bStatus").onclick = function () { send("status", null, "PC status"); };
  $("bFiles").onclick = function () { send("fs.list", { path: "D:/" }, "Files on D:"); };
  $("bWake").onclick = function () { send("wake", { minutes: 10 }, "Keep the PC awake"); };
  $("unpair").onclick = function () { forget(); };

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && token) start();
  });
  window.addEventListener("online", function () { if (token) start(); });

  token = ls(K_TOKEN) || "";
  try { pc = JSON.parse(ls(K_PC) || "null"); } catch (e) { pc = null; }
  var qs = new URLSearchParams(location.search);
  var q = digitsOnly(qs.get("c") || "");
  if (!token && q.length === 6) { show("pair"); $("code").value = q; pair(q); }
  else if (token) { show("live"); start(); }
  else show("pair");
  $("foot").textContent = "Avni Link - " + phoneName();
})();
