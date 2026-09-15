import brazil from "../assets/flags/brazil.png";
import greece from "../assets/flags/greece.png";
import japan from "../assets/flags/japan.png";

/**
 * Three cards from the deck, thrown down rather than fanned: the same
 * scattered pile the app's study screen shows, breathing slowly. The
 * artwork is the app's own — the same 4:3 rasters the release bundles.
 */
const CARDS = [
  { src: greece, tilt: -9, shift: -58, delay: 0 },
  { src: japan, tilt: 0, shift: 0, delay: 1.4 },
  { src: brazil, tilt: 9, shift: 58, delay: 2.6 },
] as const;

export function FlagFan() {
  return (
    <div className="fan" aria-hidden>
      {CARDS.map((card, position) => (
        <div
          key={card.src}
          className="fan-card"
          style={{
            ["--tilt" as string]: `${String(card.tilt)}deg`,
            ["--shift" as string]: `${String(card.shift)}px`,
            ["--delay" as string]: `${String(card.delay)}s`,
            zIndex: position,
          }}
        >
          <img src={card.src} alt="" width={160} height={120} />
        </div>
      ))}
    </div>
  );
}
