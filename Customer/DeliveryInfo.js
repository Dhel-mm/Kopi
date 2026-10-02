/* Shared by the browser and backend. Never fetch or rewrite a rider's signed URL. */
(function (root, factory) {
  const info = factory();
  if (typeof module === "object" && module.exports) module.exports = info;
  else root.KopiDeliveryInfo = info;
})(typeof window !== "undefined" ? window : this, function () {
  function trackingUrl(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text || text.length > 2048 || /[\s\\\u0000-\u001f\u007f]/.test(text)) return null;
    try {
      const url = new URL(text);
      const host = url.hostname.toLowerCase();
      if (url.protocol !== "https:" || url.username || url.password || url.port ||
          !(host === "lalamove.com" || host.endsWith(".lalamove.com") || host === "lalamove.app.link")) return null;
      return text;
    } catch { return null; }
  }

  function messageParts(fee, link) {
    const amount = Number.isFinite(fee) && fee >= 0 ? fee.toFixed(2) : "__";
    return [
      "Hi! Your coffee order is ready. The Lalamove fee to your location is ",
      `₱${amount}`,
      ". Please prepare this amount in cash for the rider.\n\nHere's the live tracking link for your order:",
      link || "__"
    ];
  }
  function message(fee, link) {
    return messageParts(fee, link).join("");
  }
  return {trackingUrl, message, messageParts};
});
