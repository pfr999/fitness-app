// Escáner de código de barras con la cámara (BarcodeDetector: Chrome en Android).

export const scannerSupported = () => 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/**
 * Arranca la cámara en `video` y resuelve con el primer código detectado.
 * Devuelve {promise, stop}.
 */
export function startScanner(video) {
  let stream = null, stopped = false, raf = null;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
  };
  const promise = (async () => {
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
    return await new Promise((resolve, reject) => {
      const tick = async () => {
        if (stopped) return reject(new Error('cancelado'));
        try {
          const codes = await detector.detect(video);
          const c = codes.find((x) => /^\d{8,14}$/.test(x.rawValue));
          if (c) { stop(); return resolve(c.rawValue); }
        } catch { /* fotograma no listo */ }
        raf = requestAnimationFrame(tick);
      };
      tick();
    });
  })();
  promise.catch(() => {}).finally?.(() => {});
  return { promise, stop };
}
