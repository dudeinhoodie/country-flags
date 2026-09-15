import { useRuntimeConfig } from "../config/RuntimeConfigContext";
import type { Strings } from "../i18n/strings";

/**
 * Whose work the flags are, and which deployment this is. The attribution
 * is a licence obligation rather than a courtesy: the MIT notice asks to
 * travel with the artwork. The stand tag is quiet on purpose — it exists so
 * a link to the dev site is never mistaken for the real one, not to brand.
 */
export function SiteFooter({ strings }: { strings: Strings }) {
  const { environment, appVersion } = useRuntimeConfig();
  return (
    <footer className="footer">
      <p>
        {strings.attributionFlags[0]}
        <a href="https://github.com/lipis/flag-icons" rel="noopener">
          lipis/flag-icons
        </a>
        {strings.attributionFlags[1]}
      </p>
      <p>
        {strings.attributionOutlines[0]}
        <a href="https://www.naturalearthdata.com/" rel="noopener">
          Natural Earth
        </a>
        {strings.attributionOutlines[1]}
      </p>
      {environment !== "prod" && (
        <p className="footer-stand">
          <span className="tag" title={appVersion}>
            {strings.devStand}
          </span>
        </p>
      )}
    </footer>
  );
}
