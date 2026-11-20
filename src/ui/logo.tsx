/**
 * Honeypot logo. The artwork is a wide (602 x 314) single-colour PNG with a transparent
 * background, so it is drawn as a CSS mask filled with the current text colour: it keeps its
 * aspect ratio at any height and follows the light/dark theme instead of staying black.
 *
 * Size it by height only (e.g. "h-6"); the width follows from the aspect ratio.
 */
const LOGO_URL = "/emoji/honeypot.png";

export function Logo({ className = "h-6" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current text-ink ${className}`}
      style={{
        aspectRatio: "602 / 314",
        maskImage: `url(${LOGO_URL})`,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskImage: `url(${LOGO_URL})`,
        WebkitMaskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
