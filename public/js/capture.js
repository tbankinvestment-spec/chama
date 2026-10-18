/**
 * Chama Capture
 * ---------------------------------------------------------------------------
 * Self-contained, offline-first camera capture module used by the activation
 * workflow (Login → Step 7 passport photo, Step 8 national ID).
 *
 * Responsibilities
 *  - Open the device camera (getUserMedia) and grab still frames.
 *  - Face mode: run a purely local liveness check (a "real person" test) using
 *    frame-differencing motion, an active blink challenge, and image quality
 *    gates (brightness / sharpness / face-size). No external libraries.
 *  - Face mode: extract simple face properties (bounding box, average skin
 *    tone, brightness) used to personalise/crop the captured portrait.
 *  - ID mode: score a document photo for scan compliance (document-like edge
 *    density, brightness, sharpness, aspect ratio).
 *  - ID mode: OCR the captured ID via tesseract.js (CDN) and parse out the
 *    Kenyan ID number, holder name and region/block. If the CDN is not
 *    reachable the module degrades gracefully so the user can type the values.
 *
 * Exposed as window.ChamaCapture.
 */
(function (global) {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // Tunable properties — thresholds that define a "real person" and a
  // "scannable ID". Exposed publicly so the backend / other pages can reuse
  // the exact same numbers.
  // ─────────────────────────────────────────────────────────────────────────
  var CONFIG = {
    // Capture resolution / encoding
    CAPTURE_WIDTH: 720,
    CAPTURE_HEIGHT: 540,
    ANALYSIS_WIDTH: 160,
    ANALYSIS_HEIGHT: 120,
    JPEG_QUALITY: 0.9,
    ANALYSIS_INTERVAL_MS: 110,
    // Seconds the automatic live check runs before manual capture unlocks
    CAPTURE_TIME_LIMIT_S: 15,

    // Liveness — passive motion (a printed photo/screen stays still)
    MOTION_MIN_SCORE: 0.010, // minimum fraction of changed pixels
    MOTION_MAX_SCORE: 0.55,  // too chaotic = no steady face
    MIN_FRAMES_ANALYZED: 10,

    // Liveness — active blink challenge
    BLINK_DIP_MIN: 0.055,    // relative eye-region brightness drop
    BLINK_WINDOW_FRAMES: 40,

    // Image quality gates
    MIN_BRIGHTNESS: 55,
    MAX_BRIGHTNESS: 220,
    MIN_SHARPNESS: 85,       // variance of Laplacian

    // Face-region heuristics (skin-tone mask ratio of the frame)
    MIN_FACE_RATIO: 0.05,
    MAX_FACE_RATIO: 0.80,
    MIN_FACE_BOX_SIZE: 0.18, // min face box width as ratio of frame width

    // ID scan gates
    MIN_DOCUMENT_RATIO: 0.18,   // non-background area of frame
    MIN_EDGE_DENSITY: 0.045,    // text/edges present on the document
    MIN_ID_ASPECT: 1.20,        // ID cards are wider than tall
    MAX_ID_ASPECT: 2.60
  };

  var KEYWORDS = [
    'REPUBLIC', 'KENYA', 'JAMHURI', 'IDENTITY', 'CARD', 'IDENTIFICATION',
    'NATIONAL', 'SERIAL', 'NUMBER', 'NO', 'DISTRICT', 'PROVINCE', 'COUNTY',
    'DATE', 'BIRTH', 'SEX', 'MALE', 'FEMALE', 'SIGNATURE', 'HUDUMA',
    'KITAMBULISHO', 'CITIZEN', 'PLACE', 'ISSUE', 'HOLDER', 'GENDER'
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // Low-level image math (operates on ImageData)
  // ─────────────────────────────────────────────────────────────────────────

  function toGray(imageData) {
    var d = imageData.data;
    var n = imageData.width * imageData.height;
    var gray = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    }
    return gray;
  }

  function meanBrightness(gray) {
    var sum = 0;
    for (var i = 0; i < gray.length; i++) sum += gray[i];
    return sum / gray.length;
  }

  // Variance of the Laplacian — a standard blur/sharpness proxy.
  function sharpness(imageData) {
    var w = imageData.width, h = imageData.height;
    var gray = toGray(imageData);
    var sum = 0, sumSq = 0, n = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
        sum += lap; sumSq += lap * lap; n++;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return sumSq / n - mean * mean;
  }

  // Fraction of pixels that changed between two grayscale frames.
  function motionScore(prev, curr) {
    if (!prev || prev.length !== curr.length) return 0;
    var changed = 0;
    for (var i = 0; i < curr.length; i++) {
      if (Math.abs(curr[i] - prev[i]) > 14) changed++;
    }
    return changed / curr.length;
  }

  function isSkin(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    return r > 95 && g > 40 && b > 20 &&
      (max - min) > 15 && Math.abs(r - g) > 15 && r > g && r > b;
  }

  // Skin-tone mask → face ratio, bounding box and average skin colour.
  function analyseFace(imageData) {
    var d = imageData.data, w = imageData.width, h = imageData.height;
    var count = 0, rSum = 0, gSum = 0, bSum = 0;
    var minX = w, minY = h, maxX = 0, maxY = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (isSkin(d[i], d[i + 1], d[i + 2])) {
          count++; rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    var total = w * h;
    if (!count) {
      return { ratio: 0, box: null, skinTone: null };
    }
    return {
      ratio: count / total,
      box: {
        x: minX / w, y: minY / h,
        w: (maxX - minX + 1) / w,
        h: (maxY - minY + 1) / h
      },
      skinTone: {
        r: Math.round(rSum / count),
        g: Math.round(gSum / count),
        b: Math.round(bSum / count)
      }
    };
  }

  // Mean brightness of the upper-middle band (roughly the eye region).
  function eyeRegionBrightness(imageData, faceBox) {
    var d = imageData.data, w = imageData.width, h = imageData.height;
    var x0 = Math.floor((faceBox ? faceBox.x : 0.25) * w);
    var x1 = Math.floor(((faceBox ? faceBox.x + faceBox.w : 0.75)) * w);
    var y0 = Math.floor((faceBox ? faceBox.y + faceBox.h * 0.15 : 0.2) * h);
    var y1 = Math.floor((faceBox ? faceBox.y + faceBox.h * 0.55 : 0.5) * h);
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(w, x1); y1 = Math.min(h, y1);
    var sum = 0, n = 0;
    for (var y = y0; y < y1; y++) {
      for (var x = x0; x < x1; x++) {
        var i = (y * w + x) * 4;
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  // Sobel edge density — documents are dense with characters/edges.
  function edgeDensity(imageData) {
    var w = imageData.width, h = imageData.height;
    var gray = toGray(imageData);
    var edges = 0, n = 0;
    for (var y = 1; y < h - 1; y++) {
      for (var x = 1; x < w - 1; x++) {
        var i = y * w + x;
        var gx = -gray[i - w - 1] + gray[i - w + 1] - 2 * gray[i - 1] + 2 * gray[i + 1] - gray[i + w - 1] + gray[i + w + 1];
        var gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        if (Math.sqrt(gx * gx + gy * gy) > 60) edges++;
        n++;
      }
    }
    return n ? edges / n : 0;
  }

  // Document surface ratio + aspect of the detected "surface" region.
  // Pixels that are neither near-black background nor blown-out highlights
  // are treated as the document surface.
  function documentGeometry(imageData) {
    var w = imageData.width, h = imageData.height, d = imageData.data;
    var light = 0, n = w * h;
    var minX = w, minY = h, maxX = 0, maxY = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var j = (y * w + x) * 4;
        var g = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
        if (g > 45 && g < 245) {
          light++;
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    var bw = (maxX - minX) || 1, bh = (maxY - minY) || 1;
    return { documentRatio: light / n, aspect: bw / bh };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Capture session
  // ─────────────────────────────────────────────────────────────────────────

  function createSession(options) {
    options = options || {};
    var mode = options.mode === 'id' ? 'id' : 'face';
    var video = options.video;
    var canvas = options.canvas || document.createElement('canvas');
    var onStatus = typeof options.onStatus === 'function' ? options.onStatus : function () {};

    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var stream = null;
    var timer = null;
    var running = false;

    var state = {
      mode: mode,
      framesAnalyzed: 0,
      prevGray: null,
      motionSamples: [],
      motionScore: 0,
      blinkDetected: false,
      eyeSeries: [],
      brightness: 0,
      sharpness: 0,
      face: { ratio: 0, box: null, skinTone: null },
      documentRatio: 0,
      edgeDensity: 0,
      aspect: 0,
      ready: false,
      reasons: []
    };

    function drawToCanvas(targetCanvas, w, h) {
      targetCanvas.width = w;
      targetCanvas.height = h;
      var c = targetCanvas.getContext('2d', { willReadFrequently: true });
      c.drawImage(video, 0, 0, w, h);
      return c.getImageData(0, 0, w, h);
    }

    function analyseFaceFrame(img) {
      var gray = toGray(img);
      state.motionScore = motionScore(state.prevGray, gray);
      state.prevGray = gray;
      state.motionSamples.push(state.motionScore);
      if (state.motionSamples.length > CONFIG.BLINK_WINDOW_FRAMES) state.motionSamples.shift();

      state.face = analyseFace(img);
      state.brightness = meanBrightness(gray);

      var eye = eyeRegionBrightness(img, state.face.box);
      state.eyeSeries.push(eye);
      if (state.eyeSeries.length > CONFIG.BLINK_WINDOW_FRAMES) state.eyeSeries.shift();
      // Blink = a sharp dip below the window median followed by recovery.
      if (state.eyeSeries.length > 6) {
        var sorted = state.eyeSeries.slice().sort(function (a, b) { return a - b; });
        var median = sorted[Math.floor(sorted.length / 2)];
        if (median > 0) {
          var dip = (median - Math.min.apply(null, state.eyeSeries)) / median;
          if (dip >= CONFIG.BLINK_DIP_MIN) state.blinkDetected = true;
        }
      }
      state.framesAnalyzed++;
    }

    function analyseIdFrame(img) {
      var gray = toGray(img);
      state.brightness = meanBrightness(gray);
      state.edgeDensity = edgeDensity(img);
      var geom = documentGeometry(img);
      state.documentRatio = geom.documentRatio;
      state.aspect = geom.aspect;
      state.framesAnalyzed++;
    }

    function evaluate() {
      var reasons = [];
      if (mode === 'face') {
        var f = state.face;
        if (state.framesAnalyzed < CONFIG.MIN_FRAMES_ANALYZED) reasons.push('Hold still while we analyse the frame.');
        if (f.ratio < CONFIG.MIN_FACE_RATIO) reasons.push('No face detected — move closer to the camera.');
        if (f.ratio > CONFIG.MAX_FACE_RATIO) reasons.push('Too much skin in frame — step back a little.');
        if (f.box && f.box.w < CONFIG.MIN_FACE_BOX_SIZE) reasons.push('Face is too small — move closer.');
        if (state.brightness < CONFIG.MIN_BRIGHTNESS) reasons.push('Too dark — find better lighting.');
        if (state.brightness > CONFIG.MAX_BRIGHTNESS) reasons.push('Too bright — reduce glare on your face.');
        if (state.sharpness < CONFIG.MIN_SHARPNESS) reasons.push('Image is blurry — hold steady.');
        if (state.motionScore < CONFIG.MOTION_MIN_SCORE) reasons.push('No movement detected — a live person must be present.');
        if (state.motionScore > CONFIG.MOTION_MAX_SCORE) reasons.push('Too much movement — keep your face steady.');
        if (!state.blinkDetected) reasons.push('Blink slowly to prove you are a real person.');
      } else {
        if (state.brightness < CONFIG.MIN_BRIGHTNESS) reasons.push('Document is too dark — light it evenly.');
        if (state.brightness > CONFIG.MAX_BRIGHTNESS) reasons.push('Too much glare — tilt the ID away from light.');
        if (state.sharpness < CONFIG.MIN_SHARPNESS) reasons.push('Document is blurry — hold the camera steady.');
        if (state.documentRatio < CONFIG.MIN_DOCUMENT_RATIO) reasons.push('Move the ID closer to fill the frame.');
        if (state.edgeDensity < CONFIG.MIN_EDGE_DENSITY) reasons.push('Cannot read the ID — make sure the text is visible.');
        if (state.aspect < CONFIG.MIN_ID_ASPECT || state.aspect > CONFIG.MAX_ID_ASPECT) reasons.push('Align the ID flat (landscape) inside the guide.');
      }
      state.reasons = reasons;
      state.ready = reasons.length === 0;
      return state.ready;
    }

    function tick() {
      if (!running || !video || video.readyState < 2) return;
      // Keep the preview canvas full-size for capture, analyse on a small copy.
      var small = document.createElement('canvas');
      var img = drawToCanvas(small, CONFIG.ANALYSIS_WIDTH, CONFIG.ANALYSIS_HEIGHT);
      if (mode === 'face') analyseFaceFrame(img); else analyseIdFrame(img);

      // Sharpness is only meaningful on a larger frame; sample it periodically
      // for both modes (a downscaled frame loses too much high-frequency detail).
      if (state.framesAnalyzed % 5 === 0) {
        var full = drawToCanvas(canvas, CONFIG.CAPTURE_WIDTH, CONFIG.CAPTURE_HEIGHT);
        state.sharpness = sharpness(full);
      }

      evaluate();
      onStatus(publicState());
    }

    function publicState() {
      return {
        mode: state.mode,
        ready: state.ready,
        reasons: state.reasons.slice(),
        metrics: {
          framesAnalyzed: state.framesAnalyzed,
          motionScore: +state.motionScore.toFixed(4),
          blinkDetected: state.blinkDetected,
          realPerson: state.blinkDetected && state.motionScore >= CONFIG.MOTION_MIN_SCORE,
          brightness: Math.round(state.brightness),
          sharpness: Math.round(state.sharpness),
          faceDetected: state.face.ratio > CONFIG.MIN_FACE_RATIO,
          faceRatio: +state.face.ratio.toFixed(4),
          faceBox: state.face.box,
          skinTone: state.face.skinTone,
          documentDetected: state.documentRatio > CONFIG.MIN_DOCUMENT_RATIO,
          documentRatio: +state.documentRatio.toFixed(4),
          edgeDensity: +state.edgeDensity.toFixed(4),
          aspect: +state.aspect.toFixed(2)
        }
      };
    }

    function start() {
      if (running) return Promise.resolve();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('Camera is not supported on this device or browser.'));
      }
      return navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: mode === 'face' ? 'user' : 'environment',
          width: { ideal: CONFIG.CAPTURE_WIDTH },
          height: { ideal: CONFIG.CAPTURE_HEIGHT }
        },
        audio: false
      }).then(function (s) {
        stream = s;
        video.srcObject = s;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        return video.play();
      }).then(function () {
        running = true;
        state.prevGray = null;
        state.motionSamples = [];
        state.eyeSeries = [];
        state.blinkDetected = false;
        state.framesAnalyzed = 0;
        timer = setInterval(tick, CONFIG.ANALYSIS_INTERVAL_MS);
      });
    }

    function stop() {
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (stream) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }
      if (video) video.srcObject = null;
    }

    // Grab a full-resolution still + the metrics captured at that instant.
    function capture() {
      if (!running) return null;
      var img = drawToCanvas(canvas, CONFIG.CAPTURE_WIDTH, CONFIG.CAPTURE_HEIGHT);
      var metrics = publicState().metrics;
      metrics.capturedAt = new Date().toISOString();
      return {
        dataUrl: canvas.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY),
        metrics: metrics,
        passed: state.ready
      };
    }

    return {
      start: start,
      stop: stop,
      capture: capture,
      isReady: function () { return state.ready; },
      getState: publicState
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // OCR (tesseract.js via CDN) + Kenyan ID text parsing
  // ─────────────────────────────────────────────────────────────────────────

  var TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-chama-ocr]');
      if (existing) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-chama-ocr', '1');
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load the OCR engine (offline?).')); };
      document.head.appendChild(s);
    });
  }

  function runOCR(dataUrl, onProgress) {
    if (global.Tesseract && global.Tesseract.recognize) {
      return recognize(dataUrl, onProgress);
    }
    return loadScript(TESSERACT_CDN).then(function () {
      return recognize(dataUrl, onProgress);
    }).catch(function () {
      return { text: '', ok: false };
    });
  }

  function recognize(dataUrl, onProgress) {
    return global.Tesseract.recognize(dataUrl, 'eng', {
      logger: function (m) {
        if (onProgress && m && m.status) {
          onProgress(m.status, Math.round((m.progress || 0) * 100));
        }
      }
    }).then(function (result) {
      return { text: (result && result.data && result.data.text) || '', ok: true };
    }).catch(function () {
      return { text: '', ok: false };
    });
  }

  /**
   * Best-effort parser for Kenyan national ID text.
   * Returns { fullName, idNumber, region, block, raw }.
   * Anything it cannot find is left blank so the user can fill it in.
   */
  function parseKenyanId(rawText) {
    var raw = String(rawText || '');
    var lines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);

    // 1. ID number — Kenyan national IDs are 7 or 8 digits.
    var idNumber = '';
    var idMatch = raw.replace(/[^0-9\n]/g, ' ').match(/\b\d{7,8}\b/);
    if (idMatch) idNumber = idMatch[0];
    if (!idNumber) {
      var loose = raw.match(/(?:ID|NO|NUMBER|SERIAL)[^0-9]{0,6}(\d{6,9})/i);
      if (loose) idNumber = loose[1];
    }

    // 2. Name — the longest line of 2+ non-keyword alphabetic words.
    var fullName = '';
    lines.forEach(function (line) {
      var words = line.replace(/[^A-Za-z\s]/g, ' ')
        .split(/\s+/)
        .filter(function (w) { return w.length > 1; });
      if (words.length < 2) return;
      var kept = words.filter(function (w) {
        return KEYWORDS.indexOf(w.toUpperCase()) === -1;
      });
      if (kept.length >= 2) {
        var candidate = kept.join(' ');
        if (candidate.length > fullName.length) fullName = candidate;
      }
    });
    fullName = fullName.replace(/\s+/g, ' ').trim();

    // 3. Region / block — look for the classic "District / Province" labels,
    //    otherwise the last all-letters line that is not the name.
    var region = '', block = '';
    lines.forEach(function (line) {
      var m = line.match(/(?:DISTRICT|PROVINCE|COUNTY)\s*[:\-]?\s*([A-Za-z\s]{3,})/i);
      if (m && !region) region = m[1].trim();
    });
    if (!region) {
      for (var i = lines.length - 1; i >= 0; i--) {
        var l = lines[i].replace(/[^A-Za-z\s]/g, '').trim();
        if (l.length >= 4 && fullName && fullName.indexOf(l.toUpperCase().split(/\s+/)[0]) === -1 &&
            KEYWORDS.indexOf(l.toUpperCase()) === -1) {
          region = l;
          break;
        }
      }
    }

    return { fullName: fullName, idNumber: idNumber, region: region, block: block, raw: raw };
  }

  /**
   * Analyse an already-captured still. Used after a manual capture (when the
   * automatic live check timed out) so the metrics are measured on the final
   * photo that is actually submitted.
   * @returns {Promise<object>} quality/face/document metrics
   */
  function analyzeStill(dataUrl, mode) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth || CONFIG.CAPTURE_WIDTH;
        c.height = img.naturalHeight || CONFIG.CAPTURE_HEIGHT;
        var cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, c.width, c.height);
        var data = cx.getImageData(0, 0, c.width, c.height);
        var gray = toGray(data);
        var out = {
          brightness: Math.round(meanBrightness(gray)),
          sharpness: Math.round(sharpness(data))
        };
        if (mode === 'id') {
          var geom = documentGeometry(data);
          out.documentRatio = +geom.documentRatio.toFixed(4);
          out.aspect = +geom.aspect.toFixed(2);
          out.edgeDensity = +edgeDensity(data).toFixed(4);
          out.documentDetected = geom.documentRatio > CONFIG.MIN_DOCUMENT_RATIO;
        } else {
          var f = analyseFace(data);
          out.faceDetected = f.ratio > CONFIG.MIN_FACE_RATIO;
          out.faceRatio = +f.ratio.toFixed(4);
          out.faceBox = f.box;
          out.skinTone = f.skinTone;
        }
        resolve(out);
      };
      img.onerror = function () { resolve({}); };
      img.src = dataUrl;
    });
  }

  global.ChamaCapture = {
    CONFIG: CONFIG,
    createSession: createSession,
    analyzeStill: analyzeStill,
    runOCR: runOCR,
    parseKenyanId: parseKenyanId
  };

})(window);
